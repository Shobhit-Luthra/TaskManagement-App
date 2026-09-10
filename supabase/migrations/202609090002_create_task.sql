-- Atomic task creation: task row and its audit event either both succeed or both roll back.
create or replace function public.create_task(
  p_project_id uuid,
  p_column_id uuid,
  p_title text,
  p_description text default null,
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_priority public.task_priority default 'medium',
  p_position double precision default null,
  p_mutation_id uuid default null
) returns table (
  id uuid, column_id uuid, title varchar, description text, due_date date, priority public.task_priority,
  "position" double precision, created_at timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  created_task public.tasks%rowtype;
  task_position double precision;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not public.can_write_project(p_project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_TASK_TITLE' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 20000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if not exists (select 1 from public.columns where id = p_column_id and project_id = p_project_id and deleted_at is null) then raise exception 'INVALID_COLUMN' using errcode = '22023'; end if;
  if p_assignee_id is not null and not exists (select 1 from public.memberships where project_id = p_project_id and user_id = p_assignee_id) then raise exception 'INVALID_ASSIGNEE' using errcode = '22023'; end if;

  select coalesce(min(position) - 1, 1) into task_position from public.tasks where column_id = p_column_id and deleted_at is null;
  task_position := coalesce(p_position, task_position);
  if task_position in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then raise exception 'INVALID_POSITION' using errcode = '22023'; end if;

  insert into public.tasks (project_id, column_id, title, description, assignee_id, due_date, priority, position, mutation_id, created_by)
  values (p_project_id, p_column_id, trim(p_title), nullif(trim(p_description), ''), p_assignee_id, p_due_date, p_priority, task_position, p_mutation_id, current_user_id)
  returning * into created_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (p_project_id, current_user_id, created_task.id, 'task', created_task.id, 'created', jsonb_build_object('title', created_task.title, 'columnId', p_column_id));
  return query select created_task.id, created_task.column_id, created_task.title, created_task.description, created_task.due_date, created_task.priority, created_task.position, created_task.created_at, created_task.updated_at;
end;
$$;

revoke all on function public.create_task(uuid, uuid, text, text, uuid, date, public.task_priority, double precision, uuid) from public;
grant execute on function public.create_task(uuid, uuid, text, text, uuid, date, public.task_priority, double precision, uuid) to authenticated;
