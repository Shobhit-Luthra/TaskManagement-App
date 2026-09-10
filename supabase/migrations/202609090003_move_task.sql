-- Moves are audit-safe: the task position and activity event commit together.
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
  select * into existing_task from public.tasks where id = p_task_id and deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  source_column_id := existing_task.column_id;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_position in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then raise exception 'INVALID_POSITION' using errcode = '22023'; end if;
  select is_done_column into target_is_done from public.columns where id = p_column_id and project_id = existing_task.project_id and deleted_at is null;
  if not found then raise exception 'INVALID_COLUMN' using errcode = '22023'; end if;
  select is_done_column into source_is_done from public.columns where id = existing_task.column_id;
  activity_kind := case
    when target_is_done and not coalesce(source_is_done, false) then 'completed'
    when coalesce(source_is_done, false) and not target_is_done then 'reopened'
    else 'moved'
  end;
  update public.tasks set column_id = p_column_id, position = p_position, mutation_id = p_mutation_id where id = p_task_id returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, activity_kind,
    jsonb_build_object('columnId', source_column_id), jsonb_build_object('columnId', p_column_id));
  return query select existing_task.id, existing_task.column_id, existing_task.position, existing_task.updated_at;
end;
$$;

revoke all on function public.move_task(uuid, uuid, double precision, uuid) from public;
grant execute on function public.move_task(uuid, uuid, double precision, uuid) to authenticated;
