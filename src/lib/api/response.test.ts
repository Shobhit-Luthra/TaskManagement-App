import { describe, expect, it } from "vitest";
import { apiError } from "./response";

describe("apiError", () => {
  it("returns the documented error envelope without internal details", async () => {
    const response = apiError(401, "UNAUTHENTICATED", "Sign in to view projects.");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHENTICATED", message: "Sign in to view projects." },
    });
  });
});
