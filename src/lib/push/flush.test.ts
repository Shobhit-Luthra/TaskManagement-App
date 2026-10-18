import { beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

type Result = { data: unknown; error: null };
const tables: Record<string, Result> = {};
const updates: { table: string; values: unknown; ids?: unknown }[] = [];
const deletes: { table: string; ids: unknown }[] = [];

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of ["select", "is", "gte", "order", "limit", "in"]) chain[method] = self;
  chain.then = (resolve: (value: Result) => unknown) => resolve(tables[table] as Result);
  chain.update = (values: unknown) => ({
    in: (_column: string, ids: unknown) => {
      updates.push({ table, values, ids });
      return Promise.resolve({ error: null });
    },
  });
  chain.delete = () => ({
    in: (_column: string, ids: unknown) => {
      deletes.push({ table, ids });
      return Promise.resolve({ error: null });
    },
  });
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: builder }) }));

import { flushPushQueue } from "./flush";

const notification = {
  id: "n1",
  type: "task_assigned",
  payload: { taskTitle: "Ship it" },
  user_id: "u1",
  project_id: "p1",
  task_id: "t1",
};
const sub = {
  id: "s1",
  user_id: "u1",
  endpoint: "https://fcm.googleapis.com/x",
  p256dh: "k",
  auth: "a",
};

beforeEach(() => {
  sendNotification.mockReset();
  updates.length = 0;
  deletes.length = 0;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  tables.notifications = { data: [notification], error: null };
  tables.push_subscriptions = { data: [sub], error: null };
});

describe("flushPushQueue", () => {
  it("does nothing when VAPID keys are missing", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await flushPushQueue()).toMatchObject({ sent: 0, skipped: expect.any(String) });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends a deep-linked push to each device and marks the notification handled", async () => {
    sendNotification.mockResolvedValue({});
    expect(await flushPushQueue()).toEqual({ sent: 1, pruned: 0 });
    const [target, body] = sendNotification.mock.calls[0] as [{ endpoint: string }, string];
    expect(target.endpoint).toBe(sub.endpoint);
    expect(JSON.parse(body)).toMatchObject({
      body: 'You were assigned "Ship it"',
      url: "/p/p1/board?task=t1",
    });
    expect(updates).toEqual([expect.objectContaining({ table: "notifications", ids: ["n1"] })]);
  });

  it("prunes subscriptions the push service reports gone", async () => {
    sendNotification.mockRejectedValue({ statusCode: 410 });
    expect(await flushPushQueue()).toEqual({ sent: 0, pruned: 1 });
    expect(deletes).toEqual([{ table: "push_subscriptions", ids: ["s1"] }]);
  });

  it("still marks notifications handled when the user has no devices", async () => {
    tables.push_subscriptions = { data: [], error: null };
    expect(await flushPushQueue()).toEqual({ sent: 0, pruned: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
  });
});
