import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";

describe("log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line with request fields", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("info", "api.request", { route: "/api/v1/projects", status: 200, durationMs: 12 });
    const line = JSON.parse(output.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({ level: "info", event: "api.request", status: 200 });
    expect(typeof line.timestamp).toBe("string");
  });

  it("redacts sensitive values and routes errors to stderr", () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log("warn", "auth.failed", { accessToken: "secret", userEmail: "a@example.test" });
    log("error", "api.failed");
    expect(JSON.parse(output.mock.calls[0]?.[0] as string)).toMatchObject({
      accessToken: "[redacted]",
      userEmail: "[redacted]",
    });
    expect(error).toHaveBeenCalledOnce();
  });
});
