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
      await admin.auth.admin.deleteUser(b.id);
      await admin.auth.admin.deleteUser(a.id);
    },
  };
}
