import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedIsolationFixture, type IsolationFixture } from "./setup";

let fixture: IsolationFixture;
beforeAll(async () => {
  fixture = await seedIsolationFixture();
});
afterAll(async () => {
  await fixture?.cleanup();
});

function row<T>(data: T | T[] | null): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

describe("task links", () => {
  it("lets members add links and hides them from non-members", async () => {
    const added = await fixture.a.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/spec",
      p_title: "  ",
    });
    expect(added.error).toBeNull();
    expect(row(added.data)).toMatchObject({ url: "https://example.com/spec", title: null });

    const read = await fixture.b.from("task_links").select("id").eq("task_id", fixture.taskId);
    expect(read.data).toEqual([]);
    const denied = await fixture.b.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/other",
      p_title: null,
    });
    expect(denied.error?.code).toBe("P0002");
  });

  it("rejects non-http schemes, whitespace and over-long URLs", async () => {
    for (const url of [
      "javascript:alert(1)",
      "ftp://example.com/file",
      "https://example.com/has space",
      `https://example.com/${"a".repeat(2048)}`,
    ]) {
      const result = await fixture.a.rpc("add_task_link", {
        p_task_id: fixture.taskId,
        p_url: url,
        p_title: null,
      });
      expect(result.error?.code, url).toBe("22023");
    }
  });

  it("enforces viewer, creator and admin rules and records activity", async () => {
    const admin = createAdminClient();
    await admin
      .from("memberships")
      .insert({ project_id: fixture.projectId, user_id: fixture.bId, role: "viewer" });
    const viewer = await fixture.b.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/viewer",
      p_title: null,
    });
    expect(viewer.error?.code).toBe("42501");

    await admin
      .from("memberships")
      .update({ role: "member" })
      .eq("project_id", fixture.projectId)
      .eq("user_id", fixture.bId);
    const byB = await fixture.b.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/b",
      p_title: "B's doc",
    });
    expect(byB.error).toBeNull();

    const ownerLink = await fixture.a
      .from("task_links")
      .select("id")
      .eq("task_id", fixture.taskId)
      .eq("url", "https://example.com/spec")
      .single();
    const notCreator = await fixture.b.rpc("delete_task_link", {
      p_task_id: fixture.taskId,
      p_link_id: ownerLink.data!.id,
    });
    expect(notCreator.error?.code).toBe("42501");

    const ownerDeletes = await fixture.a.rpc("delete_task_link", {
      p_task_id: fixture.taskId,
      p_link_id: row<{ id: string }>(byB.data).id,
    });
    expect(ownerDeletes.error).toBeNull();

    const activity = await fixture.a
      .from("activity")
      .select("action")
      .eq("task_id", fixture.taskId)
      .in("action", ["link_added", "link_removed"]);
    expect(activity.data?.map((entry) => entry.action).sort()).toEqual([
      "link_added",
      "link_added",
      "link_removed",
    ]);
  });

  it("caps a task at 50 links", async () => {
    const admin = createAdminClient();
    await admin.from("task_links").delete().eq("task_id", fixture.taskId);
    const seeded = await admin.from("task_links").insert(
      Array.from({ length: 50 }, (_, index) => ({
        project_id: fixture.projectId,
        task_id: fixture.taskId,
        url: `https://example.com/${index}`,
        created_by: fixture.aId,
      })),
    );
    expect(seeded.error).toBeNull();
    const overCap = await fixture.a.rpc("add_task_link", {
      p_task_id: fixture.taskId,
      p_url: "https://example.com/51",
      p_title: null,
    });
    expect(overCap.error?.code).toBe("22023");
  });
});
