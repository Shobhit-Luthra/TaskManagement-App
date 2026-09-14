import { createHash } from "node:crypto";
import { log } from "@/lib/log";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";

export async function isBreachedPassword(
  password: string,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<boolean> {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const response = await (deps.fetch ?? fetch)(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 2000),
    });
    if (!response.ok) {
      log("warn", "auth.breach_check_unavailable", { status: response.status });
      return false;
    }
    return (await response.text()).split(/\r?\n/).some((line) => line.split(":")[0] === suffix);
  } catch (error) {
    log("warn", "auth.breach_check_unavailable", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
