import { describe, expect, it } from "vitest";
import { createProjectSchema, createdProjectSchema } from "./schemas";

describe("createProjectSchema", () => {
  it("trims the name and converts optional blank fields to undefined", () => {
    const result = createProjectSchema.parse({
      name: "  Kanbo MVP  ",
      description: "",
      timezone: "",
    });
    expect(result).toEqual({ name: "Kanbo MVP", description: undefined, timezone: undefined });
  });

  it("rejects blank and oversized names", () => {
    expect(createProjectSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "a".repeat(121) }).success).toBe(false);
  });

  it("requires a complete, canonical RPC result", () => {
    expect(
      createdProjectSchema.safeParse({
        id: "a3e1aa95-074f-4e84-a96b-5c5b874d9fd1",
        name: "Kanbo MVP",
        description: null,
        timezone: "UTC",
        role: "owner",
        columns: [],
        created_at: "2026-09-09T00:00:00Z",
      }).success,
    ).toBe(true);
    expect(createdProjectSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
});
