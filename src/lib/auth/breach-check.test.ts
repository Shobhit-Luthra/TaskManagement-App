import { describe, expect, it, vi } from "vitest";
import { isBreachedPassword } from "./breach-check";

const range =
  "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n";
const fetchWith = (body: string, ok = true) =>
  vi.fn(async () => new Response(body, { status: ok ? 200 : 500 }));

describe("isBreachedPassword", () => {
  it("sends only the SHA-1 prefix and detects a matching suffix", async () => {
    const fetch = fetchWith(range);
    await expect(isBreachedPassword("password", { fetch })).resolves.toBe(true);
    const call = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0];
    expect(String(call?.[0])).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    expect(call?.[1]).toMatchObject({ headers: { "Add-Padding": "true" } });
  });

  it("returns false for absent, unavailable, or failed range results", async () => {
    await expect(
      isBreachedPassword("correct horse battery staple 42", { fetch: fetchWith(range) }),
    ).resolves.toBe(false);
    await expect(isBreachedPassword("password", { fetch: fetchWith("", false) })).resolves.toBe(
      false,
    );
    await expect(
      isBreachedPassword("password", {
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }),
      }),
    ).resolves.toBe(false);
  });
});
