import { createHmac, timingSafeEqual } from "node:crypto";

/** Fixed-length-digest compare so a wrong-length or wrong-value secret takes
 * the same time to reject — never diff raw strings/buffers of caller-controlled
 * length directly against timingSafeEqual (which throws on length mismatch and
 * otherwise leaks length via that throw). */
export function verifyCronSecret(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedDigest = createHmac("sha256", "compare").update(provided).digest();
  const expectedDigest = createHmac("sha256", "compare").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
