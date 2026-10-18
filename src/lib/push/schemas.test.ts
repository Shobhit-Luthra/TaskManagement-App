import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, pushSubscriptionSchema } from "./schemas";

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/?token=abc",
  ])("accepts %s", (endpoint) => expect(isAllowedPushEndpoint(endpoint)).toBe(true));

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://evil.example.com/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.com/x",
    "https://169.254.169.254/latest/meta-data",
    "not a url",
  ])("rejects %s", (endpoint) => expect(isAllowedPushEndpoint(endpoint)).toBe(false));
});

it("requires both keys", () => {
  const result = pushSubscriptionSchema.safeParse({
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "k" },
  });
  expect(result.success).toBe(false);
});
