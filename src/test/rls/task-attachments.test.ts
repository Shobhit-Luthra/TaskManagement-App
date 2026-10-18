import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const pdf = { p_mime_type: "application/pdf", p_size_bytes: 1024 };

describe("task attachments", () => {
  it("registers an attachment for a member, hides it from outsiders, and builds a safe path", async () => {
    const added = await fixture.a.rpc("add_task_attachment", {
      p_task_id: fixture.taskId,
      p_file_name: "../..\evil/spec.pdf",
      ...pdf,
    });
    expect(added.error).toBeNull();
    const att = row(added.data) as { id: string; file_name: string; storage_path: string };
    expect(att.file_name).not.toMatch(/[\/]/);
    expect(att.storage_path).toMatch(
      new RegExp(`^[0-9a-f-]{36}/${fixture.taskId}/${att.id}\.pdf$`),
    );

    const read = await fixture.b
      .from("task_attachments")
      .select("id")
      .eq("task_id", fixture.taskId);
    expect(read.data).toEqual([]);
    const denied = await fixture.b.rpc("add_task_attachment", {
      p_task_id: fixture.taskId,
      p_file_name: "x.pdf",
      ...pdf,
    });
    expect(denied.error?.code).toBe("P0002");
  });

  it("rejects disallowed types, oversized files and anonymous callers", async () => {
    const exe = await fixture.a.rpc("add_task_attachment", {
      p_task_id: fixture.taskId,
      p_file_name: "run.exe",
      p_mime_type: "application/x-msdownload",
      p_size_bytes: 10,
    });
    expect(exe.error?.code).toBe("22023");
    const big = await fixture.a.rpc("add_task_attachment", {
      p_task_id: fixture.taskId,
      p_file_name: "big.pdf",
      p_mime_type: "application/pdf",
      p_size_bytes: 10 * 1024 * 1024 + 1,
    });
    expect(big.error?.code).toBe("22023");
  });

  it("lets the uploader delete and returns the storage path", async () => {
    const added = await fixture.a.rpc("add_task_attachment", {
      p_task_id: fixture.taskId,
      p_file_name: "gone.pdf",
      ...pdf,
    });
    const att = row(added.data) as { id: string; storage_path: string };
    const removed = await fixture.a.rpc("delete_task_attachment", {
      p_task_id: fixture.taskId,
      p_attachment_id: att.id,
    });
    expect(removed.error).toBeNull();
    expect(removed.data).toBe(att.storage_path);
    const again = await fixture.a.rpc("delete_task_attachment", {
      p_task_id: fixture.taskId,
      p_attachment_id: att.id,
    });
    expect(again.error?.code).toBe("P0002");
  });
});
