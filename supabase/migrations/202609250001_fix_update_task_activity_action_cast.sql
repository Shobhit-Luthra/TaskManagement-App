-- Bugfix: the assigned/unassigned activity-kind CASE expression produced
-- untyped text, and Postgres has no implicit cast from text to the
-- activity_action enum, so update_task raised 42804 on every assignee
-- change. Discovered by running the RLS integration suite for the first
-- time against a real Supabase project (these migrations were written but
-- never applied until now). Fix: cast each branch to public.activity_action.
create or replace function public.update_task(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_due_date date,
  p_priority public.task_priority,
  p_assignee_id uuid default null,
  p_expected_updated_at timestamptz default null
) returns table (
  id uuid, column_id uuid, title varchar, description text, due_date date,
  priority public.task_priority, "position" double precision, assignee_id uuid,
  created_at timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  previous_assignee_id uuid;
  before_value jsonb;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found or not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_expected_updated_at is not null and p_expected_updated_at is distinct from existing_task.updated_at then
    raise exception 'CONFLICT' using errcode = '40001';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_TASK_TITLE' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 20000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.memberships where memberships.project_id = existing_task.project_id and memberships.user_id = p_assignee_id
  ) then raise exception 'INVALID_ASSIGNEE' using errcode = '22023'; end if;
  previous_assignee_id := existing_task.assignee_id;
  before_value := jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority, 'assigneeId', previous_assignee_id);
  update public.tasks set title = trim(p_title), description = nullif(trim(p_description), ''), due_date = p_due_date, priority = p_priority, assignee_id = p_assignee_id
  where tasks.id = p_task_id returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'updated', before_value,
    jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority, 'assigneeId', existing_task.assignee_id));
  if previous_assignee_id is distinct from existing_task.assignee_id then
    insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
    values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id,
      case when existing_task.assignee_id is null then 'unassigned'::public.activity_action else 'assigned'::public.activity_action end,
      jsonb_build_object('assigneeId', previous_assignee_id), jsonb_build_object('assigneeId', existing_task.assignee_id));
  end if;
  return query select existing_task.id, existing_task.column_id, existing_task.title, existing_task.description,
    existing_task.due_date, existing_task.priority, existing_task.position, existing_task.assignee_id,
    existing_task.created_at, existing_task.updated_at;
end;
$$;
revoke all on function public.update_task(uuid, text, text, date, public.task_priority, uuid, timestamptz) from public;
grant execute on function public.update_task(uuid, text, text, date, public.task_priority, uuid, timestamptz) to authenticated;
