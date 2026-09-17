import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;
let secondColumnId: string;

beforeAll(async () => {
  fixture = await seedIsolationFixture();
  const { data, error } = await fixture.a
    .from("columns")
    .select("id")
    .eq("project_id", fixture.projectId)
    .is("deleted_at", null)
    .order("position");
  if (error || !data?.[1]) throw error ?? new Error("fixture did not create two columns");
  secondColumnId = data[1].id;
});
afterAll(async () => {
  await fixture?.cleanup();
});

describe("move_column", () => {
  it("allows an administrator to reorder but returns P0002 to a non-member", async () => {
    const denied = await fixture.b.rpc("move_column", {
      p_column_id: secondColumnId,
      p_position: 0.5,
    });
    expect(denied.error?.code).toBe("P0002");
    const moved = await fixture.a.rpc("move_column", {
      p_column_id: secondColumnId,
      p_position: 0.5,
    });
    expect(moved.error).toBeNull();
    const row = Array.isArray(moved.data) ? moved.data[0] : moved.data;
    expect(row?.position).toBe(0.5);
  });
});

describe("delete_column", () => {
  it("moves open tasks to the chosen surviving column and soft-deletes the source", async () => {
    const source = fixture.columnId;
    const deleted = await fixture.a.rpc("delete_column", {
      p_column_id: source,
      p_move_tasks_to: secondColumnId,
    });
    expect(deleted.error).toBeNull();
    const { data: task } = await fixture.a
      .from("tasks")
      .select("column_id, deleted_at")
      .eq("id", fixture.taskId)
      .single();
    expect(task?.column_id).toBe(secondColumnId);
    expect(task?.deleted_at).toBeNull();
    const { data: column } = await createAdminClient()
      .from("columns")
      .select("deleted_at")
      .eq("id", source)
      .single();
    expect(column?.deleted_at).not.toBeNull();
  });
});
