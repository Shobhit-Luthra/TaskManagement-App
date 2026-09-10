-- Subtasks are managed through narrow security-definer functions so project
-- membership is checked from the parent task instead of exposing direct writes.
create or replace function public.create_subtask(p_task_id uuid, p_title text)
returns table (id uuid, task_id uuid, title varchar, is_completed boolean, "position" double precision, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
  subtask_row public.subtasks%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where id = p_task_id and deleted_at is null;
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
  select * into parent_task from public.tasks where id = p_task_id and deleted_at is null;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into subtask_row from public.subtasks where id = p_subtask_id and task_id = parent_task.id for update;
  if not found then raise exception 'SUBTASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_title is not null then
    if char_length(trim(p_title)) not between 1 and 200 then raise exception 'INVALID_SUBTASK_TITLE' using errcode = '22023'; end if;
    subtask_row.title := trim(p_title);
  end if;
  if p_is_completed is not null then subtask_row.is_completed := p_is_completed; end if;
  update public.subtasks set title = subtask_row.title, is_completed = subtask_row.is_completed where id = subtask_row.id returning * into subtask_row;
  return query select subtask_row.id, subtask_row.task_id, subtask_row.title, subtask_row.is_completed, subtask_row.position, subtask_row.created_at, subtask_row.updated_at;
end;
$$;

create or replace function public.delete_subtask(p_task_id uuid, p_subtask_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  parent_task public.tasks%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into parent_task from public.tasks where id = p_task_id and deleted_at is null;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(parent_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.subtasks where id = p_subtask_id and task_id = parent_task.id;
  if not found then raise exception 'SUBTASK_NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.create_subtask(uuid, text) from public;
revoke all on function public.update_subtask(uuid, uuid, text, boolean) from public;
revoke all on function public.delete_subtask(uuid, uuid) from public;
grant execute on function public.create_subtask(uuid, text) to authenticated;
grant execute on function public.update_subtask(uuid, uuid, text, boolean) to authenticated;
grant execute on function public.delete_subtask(uuid, uuid) to authenticated;
