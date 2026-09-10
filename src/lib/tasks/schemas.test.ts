import { describe, expect, it } from "vitest";
import { createTaskSchema, moveTaskSchema, updateTaskSchema } from "./schemas";

const id = "a3e1aa95-074f-4e84-a96b-5c5b874d9fd1";

describe("task schemas", () => {
  it("requires a trimmed title and a valid column id", () => {
    expect(createTaskSchema.safeParse({ title: "  ", columnId: id }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "Task", columnId: "not-an-id" }).success).toBe(
      false,
    );
  });

  it("rejects non-finite ordering positions", () => {
    expect(
      moveTaskSchema.safeParse({ columnId: id, mutationId: id, position: Infinity }).success,
    ).toBe(false);
  });

  it("accepts a complete task update and rejects invalid task metadata", () => {
    expect(
      updateTaskSchema.safeParse({
        title: "  Plan launch  ",
        description: null,
        dueDate: "2026-10-01",
        priority: "high",
      }).success,
    ).toBe(true);
    expect(
      updateTaskSchema.safeParse({
        title: "Task",
        description: "a".repeat(20_001),
        dueDate: "2026-99-99",
        priority: "critical",
      }).success,
    ).toBe(false);
  });

  it("enforces the task title limit on creation", () => {
    expect(createTaskSchema.safeParse({ title: "a".repeat(201), columnId: id }).success).toBe(
      false,
    );
  });
});
