create or replace function public.restore_task(p_task_id uuid)
returns table (id uuid, column_id uuid, title varchar, "position" double precision)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  new_position double precision;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks
  where tasks.id = p_task_id and tasks.deleted_at is not null for update;
  if not found or not public.is_project_member(existing_task.project_id) then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if existing_task.deleted_at < now() - interval '30 days' then raise exception 'TASK_GONE' using errcode = 'P0003'; end if;

  if not exists (
    select 1 from public.columns
    where columns.id = existing_task.column_id and columns.deleted_at is null
  ) then
    select columns.id into existing_task.column_id from public.columns
    where columns.project_id = existing_task.project_id and columns.deleted_at is null
    order by columns.position limit 1;
    if existing_task.column_id is null then raise exception 'NO_COLUMNS_AVAILABLE' using errcode = '22023'; end if;
  end if;

  select coalesce(max(tasks.position), 0) + 1000 into new_position
  from public.tasks
  where tasks.column_id = existing_task.column_id and tasks.deleted_at is null;
  update public.tasks
  set deleted_at = null, column_id = existing_task.column_id, position = new_position
  where tasks.id = p_task_id
  returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, to_value)
  values (
    existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id,
    'restored', jsonb_build_object('title', existing_task.title)
  );
  return query select existing_task.id, existing_task.column_id, existing_task.title, existing_task.position;
end;
$$;
revoke all on function public.restore_task(uuid) from public;
grant execute on function public.restore_task(uuid) to authenticated;
