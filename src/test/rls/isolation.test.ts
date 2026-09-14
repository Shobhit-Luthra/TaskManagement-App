import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;

beforeAll(async () => {
  fixture = await seedIsolationFixture();
});

afterAll(async () => {
  await fixture?.cleanup();
});

const PROJECT_TABLES = [
  "projects",
  "memberships",
  "invitations",
  "columns",
  "tasks",
  "activity",
] as const;

describe("RLS isolation: a non-member cannot see another project", () => {
  it.each(PROJECT_TABLES)("%s returns zero rows", async (table) => {
    const filter = table === "projects" ? "id" : "project_id";
    const { data, error } = await fixture.b.from(table).select("*").eq(filter, fixture.projectId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("hides subtasks and user profiles belonging to the project owner", async () => {
    const subtasks = await fixture.b.from("subtasks").select("*").eq("task_id", fixture.taskId);
    const users = await fixture.b.from("users").select("id").eq("id", fixture.aId);
    expect(subtasks.data).toEqual([]);
    expect(users.data).toEqual([]);
  });

  it("keeps the fixture owner's rows visible", async () => {
    const { data } = await fixture.a.from("tasks").select("id").eq("project_id", fixture.projectId);
    expect(data).toHaveLength(1);
  });
});

describe("RLS isolation: a non-member cannot write to another project", () => {
  it("rejects direct task insertion", async () => {
    const { error } = await fixture.b.from("tasks").insert({
      project_id: fixture.projectId,
      column_id: fixture.columnId,
      title: "intruder",
      position: 1,
      created_by: fixture.bId,
    });
    expect(error).not.toBeNull();
  });

  it("rejects task moves and project updates", async () => {
    const move = await fixture.b.rpc("move_task", {
      p_task_id: fixture.taskId,
      p_column_id: fixture.columnId,
      p_position: 0.5,
      p_mutation_id: crypto.randomUUID(),
    });
    const update = await fixture.b.rpc("update_project", {
      p_project_id: fixture.projectId,
      p_name: "hijack",
      p_description: null,
      p_timezone: "UTC",
    });
    expect(move.error).not.toBeNull();
    expect(update.error).not.toBeNull();
  });

  it("keeps activity append-only and the limiter service-role-only", async () => {
    const deletion = await fixture.a
      .from("activity")
      .delete()
      .eq("project_id", fixture.projectId)
      .select();
    const update = await fixture.a
      .from("activity")
      .update({ action: "deleted" })
      .eq("project_id", fixture.projectId)
      .select();
    const rateLimit = await fixture.a.rpc("consume_rate_limit", {
      p_key: "test",
      p_limit: 1,
      p_window_seconds: 60,
    });
    expect(deletion.data ?? []).toEqual([]);
    expect(update.data ?? []).toEqual([]);
    expect(rateLimit.error).not.toBeNull();
  });
});

describe("public-table RLS audit", () => {
  it("reports no public table without forced RLS", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createAdminClient().rpc("tables_without_rls");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
