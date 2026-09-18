import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/email", () => ({ getEmailSender: () => ({ send: mocks.send }) }));
vi.mock("@/lib/log", () => ({ log: vi.fn() }));
import { flushNotificationQueue } from "./flush";

function query(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const chain = {
    select: vi.fn(),
    is: vi.fn(),
    lte: vi.fn(),
    lt: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
    gte: vi.fn(),
    update: vi.fn(),
    in: vi.fn(),
    then: result.then.bind(result),
  };
  for (const method of [
    chain.select,
    chain.is,
    chain.lte,
    chain.lt,
    chain.eq,
    chain.single,
    chain.gte,
    chain.update,
    chain.in,
  ])
    method.mockReturnValue(chain);
  return chain;
}

beforeEach(() => vi.resetAllMocks());

describe("notification email flush", () => {
  it("escapes untrusted HTML and marks only the notifications included in the email as sent", async () => {
    const notificationsUpdate = query(null);
    const queries = [
      query([{ id: "q1", user_id: "u1", window_start: "2026-01-01T00:00:00Z", attempts: 0 }]),
      query({
        email: "member@example.test",
        display_name: "<img src=x>",
        email_undeliverable_at: null,
      }),
      query([
        { id: "n1", type: "task_assigned", payload: { taskTitle: "<script>alert(1)</script>" } },
      ]),
      notificationsUpdate,
      query(null),
    ];
    mocks.from.mockImplementation(() => queries.shift());
    mocks.send.mockResolvedValue({ id: "sent" });
    expect(await flushNotificationQueue()).toEqual({ sent: 1, failed: 0 });
    const message = mocks.send.mock.calls[0]![0];
    expect(message.html).toContain("&lt;img src=x&gt;");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>");
    expect(notificationsUpdate.in).toHaveBeenCalledWith("id", ["n1"]);
  });

  it("fails visibly if the queue cannot be read", async () => {
    const error = { code: "connection_failed" };
    mocks.from.mockReturnValue(query(null, error));
    await expect(flushNotificationQueue()).rejects.toEqual(error);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("backs off on a user lookup failure without sending an email", async () => {
    const retry = query(null);
    const queries = [
      query([{ id: "q1", user_id: "u1", window_start: "2026-01-01T00:00:00Z", attempts: 0 }]),
      query(null, new Error("lookup failed")),
      retry,
    ];
    mocks.from.mockImplementation(() => queries.shift());
    expect(await flushNotificationQueue()).toEqual({ sent: 0, failed: 1 });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(retry.update).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1 }));
  });
});
