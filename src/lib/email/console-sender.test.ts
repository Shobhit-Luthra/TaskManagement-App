import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleEmailSender } from "./console-sender";

describe("ConsoleEmailSender", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a redacted line and returns an id", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const sender = new ConsoleEmailSender();
    const result = await sender.send({
      to: "person@example.com",
      subject: "You're invited",
      text: "plain",
      html: "<p>html</p>",
      category: "transactional",
    });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out).toHaveBeenCalledTimes(1);
    const line = JSON.parse(out.mock.calls[0]![0] as string);
    expect(line.event).toBe("email.sent");
    expect(line.to).toBe("[redacted]");
    expect(line.subject).toBe("You're invited");
    expect(line.category).toBe("transactional");
  });
});
