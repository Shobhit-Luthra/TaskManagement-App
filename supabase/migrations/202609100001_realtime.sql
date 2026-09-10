-- Board realtime: the browser subscribes directly to task and column changes,
-- filtered by RLS. `replica identity full` makes UPDATE/DELETE payloads carry the
-- full row so a soft delete (deleted_at set) and the previous column are visible
-- to subscribers.
alter table public.tasks replica identity full;
alter table public.columns replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'columns'
  ) then
    alter publication supabase_realtime add table public.columns;
  end if;
end $$;
