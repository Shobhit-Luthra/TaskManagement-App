import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type IsolationFixture = {
  a: SupabaseClient;
  b: SupabaseClient;
  aId: string;
  bId: string;
  projectId: string;
  columnId: string;
  taskId: string;
  cleanup(): Promise<void>;
};

function anonClient(): SupabaseClient {
  return createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Deletes test users and everything that would block their deletion.
 * projects.owner_id, tasks.created_by, comments.author_id and
 * invitations.invited_by are ON DELETE RESTRICT, so a bare deleteUser()
 * fails (silently, before this helper) for anyone who created data, and the
 * rows accumulate in whatever database the suite runs against. Throws so a
 * leak fails the suite instead of passing unnoticed.
 */
export async function deleteTestUsers(admin: SupabaseClient, userIds: string[]): Promise<void> {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return;
  const check = ({ error }: { error: { message: string } | null }) => {
    if (error) throw new Error(`test cleanup failed: ${error.message}`);
  };
  const { data: owned, error: ownedError } = await admin
    .from("projects")
    .select("id")
    .in("owner_id", ids);
  check({ error: ownedError });
  const projectIds = (owned ?? []).map((row) => row.id as string);
  if (projectIds.length > 0) {
    // Tasks first: tasks(column_id, project_id) -> columns is not cascading,
    // so a project cascade that reaches columns before tasks is refused.
    check(await admin.from("tasks").delete().in("project_id", projectIds));
    check(await admin.from("projects").delete().in("id", projectIds));
  }
  check(await admin.from("comments").delete().in("author_id", ids));
  check(await admin.from("invitations").delete().in("invited_by", ids));
  check(await admin.from("tasks").delete().in("created_by", ids));
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`test cleanup could not delete user ${id}: ${error.message}`);
  }
}

export async function createConfirmedUser(admin: SupabaseClient, label: string) {
  const email = `rls-${label}-${crypto.randomUUID()}@example.test`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `RLS ${label}` },
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");

  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

export async function seedIsolationFixture(): Promise<IsolationFixture> {
  const admin = createAdminClient();
  const a = await createConfirmedUser(admin, "a");
  const b = await createConfirmedUser(admin, "b");

  const project = await a.client.rpc("create_project", {
    p_name: "Isolation P",
    p_description: null,
    p_timezone: "UTC",
  });
  if (project.error) throw project.error;
  const projectRow = Array.isArray(project.data) ? project.data[0] : project.data;
  if (!projectRow) throw new Error("create_project returned no project");
  const projectId = projectRow.id as string;

  const columns = await a.client
    .from("columns")
    .select("id")
    .eq("project_id", projectId)
    .order("position")
    .limit(1);
  if (columns.error || !columns.data?.[0]) throw columns.error ?? new Error("no default column");
  const columnId = columns.data[0].id as string;

  const task = await a.client.rpc("create_task", {
    p_project_id: projectId,
    p_column_id: columnId,
    p_title: "A's task",
  });
  if (task.error) throw task.error;
  const taskRow = Array.isArray(task.data) ? task.data[0] : task.data;
  if (!taskRow) throw new Error("create_task returned no task");

  return {
    a: a.client,
    b: b.client,
    aId: a.id,
    bId: b.id,
    projectId,
    columnId,
    taskId: taskRow.id as string,
    async cleanup() {
      await deleteTestUsers(admin, [b.id, a.id]);
    },
  };
}
