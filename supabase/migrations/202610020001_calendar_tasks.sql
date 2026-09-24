-- Calendar window of tasks by due date (spec 3A). One project when
-- p_project_id is given, otherwise the caller's assigned tasks across every
-- project they belong to. Security invoker: RLS applies to every read.
create or replace function public.calendar_tasks(
  p_project_id uuid,
  p_from date,
  p_to date,
  p_include_undated boolean default false
)
returns table (
  id uuid, project_id uuid, project_name varchar, title varchar, description text,
  due_date date, priority public.task_priority, column_id uuid, column_name varchar,
  is_done boolean, assignee_id uuid, updated_at timestamptz, can_edit boolean,
  subtask_done integer, subtask_total integer
)
language plpgsql stable security invoker set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 41 then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.deleted_at is null and public.is_project_member(p.id)
  ) then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  return query
    select t.id, t.project_id, p.name, t.title, t.description, t.due_date, t.priority,
      t.column_id, c.name, c.is_done_column, t.assignee_id, t.updated_at,
      public.can_write_project(t.project_id),
      coalesce(s.done, 0)::integer, coalesce(s.total, 0)::integer
    from public.tasks t
    join public.projects p on p.id = t.project_id and p.deleted_at is null
    join public.columns c on c.id = t.column_id and c.project_id = t.project_id and c.deleted_at is null
    left join lateral (
      select count(*) filter (where st.is_completed) as done, count(*) as total
      from public.subtasks st where st.task_id = t.id
    ) s on true
    where t.deleted_at is null
      and public.is_project_member(t.project_id)
      and (case when p_project_id is null then t.assignee_id = auth.uid() else t.project_id = p_project_id end)
      and t.due_date between p_from and p_to
    order by t.due_date, t.position, t.id;

  if p_include_undated then
    return query
      select t.id, t.project_id, p.name, t.title, t.description, t.due_date, t.priority,
        t.column_id, c.name, c.is_done_column, t.assignee_id, t.updated_at,
        public.can_write_project(t.project_id),
        coalesce(s.done, 0)::integer, coalesce(s.total, 0)::integer
      from public.tasks t
      join public.projects p on p.id = t.project_id and p.deleted_at is null
      join public.columns c on c.id = t.column_id and c.project_id = t.project_id and c.deleted_at is null
      left join lateral (
        select count(*) filter (where st.is_completed) as done, count(*) as total
        from public.subtasks st where st.task_id = t.id
      ) s on true
      where t.deleted_at is null
        and public.is_project_member(t.project_id)
        and (case when p_project_id is null then t.assignee_id = auth.uid() else t.project_id = p_project_id end)
        and t.due_date is null
      order by t.updated_at desc, t.id
      limit 100;
  end if;
end;
$$;
revoke all on function public.calendar_tasks(uuid, date, date, boolean) from public, anon;
grant execute on function public.calendar_tasks(uuid, date, date, boolean) to authenticated;
