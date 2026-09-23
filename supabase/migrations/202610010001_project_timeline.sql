-- Read-only due-date timeline. RLS and membership checks apply to every caller.
create or replace function public.project_timeline(p_project_id uuid)
returns table (
  id uuid, title varchar, due_date date, priority public.task_priority,
  column_id uuid, column_name varchar, is_done boolean, assignee_id uuid
)
language plpgsql stable security invoker set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.deleted_at is null
      and public.is_project_member(p.id)
  ) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;
  return query
    select t.id, t.title, t.due_date, t.priority, t.column_id,
      c.name, c.is_done_column, t.assignee_id
    from public.tasks t
    join public.columns c on c.id = t.column_id and c.project_id = t.project_id
    where t.project_id = p_project_id and t.deleted_at is null and c.deleted_at is null
    order by t.due_date asc nulls last, t.position, t.id;
end;
$$;
revoke all on function public.project_timeline(uuid) from public, anon;
grant execute on function public.project_timeline(uuid) to authenticated;
