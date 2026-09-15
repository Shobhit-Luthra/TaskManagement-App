-- Bugfix: every RPC below declares `returns table (id uuid, ...)`, which creates a
-- plpgsql OUT parameter named `id`. Unqualified `where id = ...` references inside
-- those function bodies are ambiguous against that OUT parameter and Postgres raises
-- "column reference id is ambiguous" on every call. Discovered by running the RLS
-- integration suite against a real Supabase project (src/test/rls). Fix: qualify
-- every such reference with its table name. No behavioural change otherwise.

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
  if not exists (select 1 from public.columns where columns.id = p_column_id and columns.project_id = p_project_id and columns.deleted_at is null) then raise exception 'INVALID_COLUMN' using errcode = '22023'; end if;
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

create or replace function public.move_task(
  p_task_id uuid,
  p_column_id uuid,
  p_position double precision,
  p_mutation_id uuid
) returns table (id uuid, column_id uuid, "position" double precision, updated_at timestamptz) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  source_is_done boolean;
  target_is_done boolean;
  activity_kind public.activity_action;
  source_column_id uuid;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  source_column_id := existing_task.column_id;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_position in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then raise exception 'INVALID_POSITION' using errcode = '22023'; end if;
  select is_done_column into target_is_done from public.columns where columns.id = p_column_id and columns.project_id = existing_task.project_id and columns.deleted_at is null;
  if not found then raise exception 'INVALID_COLUMN' using errcode = '22023'; end if;
  select is_done_column into source_is_done from public.columns where columns.id = existing_task.column_id;
  activity_kind := case
    when target_is_done and not coalesce(source_is_done, false) then 'completed'
    when coalesce(source_is_done, false) and not target_is_done then 'reopened'
    else 'moved'
  end;
  update public.tasks set column_id = p_column_id, position = p_position, mutation_id = p_mutation_id where tasks.id = p_task_id returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, activity_kind,
    jsonb_build_object('columnId', source_column_id), jsonb_build_object('columnId', p_column_id));
  return query select existing_task.id, existing_task.column_id, existing_task.position, existing_task.updated_at;
end;
$$;

create or replace function public.update_task(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_due_date date,
  p_priority public.task_priority
) returns table (
  id uuid, column_id uuid, title varchar, description text, due_date date, priority public.task_priority,
  "position" double precision, created_at timestamptz, updated_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  before_value jsonb;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_TASK_TITLE' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 20000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  before_value := jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority);
  update public.tasks set title = trim(p_title), description = nullif(trim(p_description), ''), due_date = p_due_date, priority = p_priority where tasks.id = p_task_id returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, 'updated', before_value,
    jsonb_build_object('title', existing_task.title, 'description', existing_task.description, 'dueDate', existing_task.due_date, 'priority', existing_task.priority));
  return query select existing_task.id, existing_task.column_id, existing_task.title, existing_task.description, existing_task.due_date, existing_task.priority, existing_task.position, existing_task.created_at, existing_task.updated_at;
end;
$$;

create or replace function public.create_subtask(p_task_id uuid, p_title text)
returns table (id uuid, task_id uuid, title varchar, is_completed boolean, "position" double precision, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
  subtask_row public.subtasks%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_SUBTASK_TITLE' using errcode = '22023'; end if;
  insert into public.subtasks (task_id, title, position)
  values (parent_task.id, trim(p_title), coalesce((select max(s.position) + 1 from public.subtasks s where s.task_id = parent_task.id), 1))
  returning * into subtask_row;
  return query select subtask_row.id, subtask_row.task_id, subtask_row.title, subtask_row.is_completed, subtask_row.position, subtask_row.created_at, subtask_row.updated_at;
end;
$$;

create or replace function public.update_subtask(p_task_id uuid, p_subtask_id uuid, p_title text, p_is_completed boolean)
returns table (id uuid, task_id uuid, title varchar, is_completed boolean, "position" double precision, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
  subtask_row public.subtasks%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into subtask_row from public.subtasks where subtasks.id = p_subtask_id and subtasks.task_id = parent_task.id for update;
  if not found then raise exception 'SUBTASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_title is not null then
    if char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_SUBTASK_TITLE' using errcode = '22023'; end if;
    subtask_row.title := trim(p_title);
  end if;
  if p_is_completed is not null then subtask_row.is_completed := p_is_completed; end if;
  update public.subtasks set title = subtask_row.title, is_completed = subtask_row.is_completed where subtasks.id = subtask_row.id returning * into subtask_row;
  return query select subtask_row.id, subtask_row.task_id, subtask_row.title, subtask_row.is_completed, subtask_row.position, subtask_row.created_at, subtask_row.updated_at;
end;
$$;

create or replace function public.update_project_column(p_project_id uuid, p_column_id uuid, p_name text, p_wip_limit smallint, p_is_done_column boolean)
returns table (id uuid, project_id uuid, name varchar, "position" double precision, wip_limit smallint, is_done_column boolean, is_in_progress_column boolean)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); column_row public.columns%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 60 then raise exception 'INVALID_COLUMN_NAME' using errcode = '22023'; end if;
  if p_wip_limit is not null and p_wip_limit <= 0 then raise exception 'INVALID_WIP_LIMIT' using errcode = '22023'; end if;
  select * into column_row from public.columns where columns.id = p_column_id and columns.project_id = p_project_id and columns.deleted_at is null for update;
  if not found then raise exception 'COLUMN_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_is_done_column then update public.columns set is_done_column = false where columns.project_id = p_project_id and columns.id <> p_column_id and columns.is_done_column; end if;
  update public.columns set name = trim(p_name), wip_limit = p_wip_limit, is_done_column = p_is_done_column where columns.id = p_column_id returning * into column_row;
  return query select column_row.id, column_row.project_id, column_row.name, column_row.position, column_row.wip_limit, column_row.is_done_column, column_row.is_in_progress_column;
end; $$;

create or replace function public.update_project(p_project_id uuid, p_name text, p_description text, p_timezone text) returns table (id uuid, name varchar, description text, timezone varchar, updated_at timestamptz) language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); project_row public.projects%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if not exists (select 1 from public.memberships where project_id = p_project_id and user_id = current_user_id and role in ('owner', 'admin')) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'INVALID_PROJECT_NAME' using errcode = '22023'; end if;
  if p_description is not null and char_length(p_description) > 2000 then raise exception 'INVALID_DESCRIPTION' using errcode = '22023'; end if;
  if p_timezone is null or char_length(trim(p_timezone)) not between 1 and 64 then raise exception 'INVALID_TIMEZONE' using errcode = '22023'; end if;
  update public.projects set name = trim(p_name), description = nullif(trim(p_description), ''), timezone = trim(p_timezone) where projects.id = p_project_id and projects.deleted_at is null returning * into project_row;
  if not found then raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value) values (p_project_id, current_user_id, 'project', p_project_id, 'updated', jsonb_build_object('name', project_row.name));
  return query select project_row.id, project_row.name, project_row.description, project_row.timezone, project_row.updated_at;
end; $$;
