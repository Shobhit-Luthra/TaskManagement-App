create or replace function public.move_column(p_column_id uuid, p_position double precision)
returns table (id uuid, "position" double precision)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_column public.columns%rowtype;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_column from public.columns where columns.id = p_column_id and columns.deleted_at is null for update;
  if not found or not public.is_project_member(existing_column.project_id) then raise exception 'COLUMN_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.memberships
    where memberships.project_id = existing_column.project_id
      and memberships.user_id = current_user_id
      and memberships.role in ('owner', 'admin')
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_position in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then raise exception 'INVALID_POSITION' using errcode = '22023'; end if;
  update public.columns set position = p_position where columns.id = p_column_id returning * into existing_column;
  return query select existing_column.id, existing_column.position;
end;
$$;
revoke all on function public.move_column(uuid, double precision) from public;
grant execute on function public.move_column(uuid, double precision) to authenticated;

create or replace function public.delete_column(p_column_id uuid, p_move_tasks_to uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_column public.columns%rowtype;
  surviving_columns integer;
  open_task_count integer;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_column from public.columns where columns.id = p_column_id and columns.deleted_at is null for update;
  if not found or not public.is_project_member(existing_column.project_id) then raise exception 'COLUMN_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.memberships
    where memberships.project_id = existing_column.project_id
      and memberships.user_id = current_user_id
      and memberships.role in ('owner', 'admin')
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select count(*) into surviving_columns from public.columns
  where columns.project_id = existing_column.project_id and columns.deleted_at is null;
  if surviving_columns <= 1 then raise exception 'LAST_COLUMN' using errcode = '22023'; end if;
  select count(*) into open_task_count from public.tasks
  where tasks.column_id = p_column_id and tasks.deleted_at is null;

  if p_move_tasks_to <> p_column_id then
    if not exists (
      select 1 from public.columns
      where columns.id = p_move_tasks_to
        and columns.project_id = existing_column.project_id
        and columns.deleted_at is null
    ) then raise exception 'INVALID_TARGET_COLUMN' using errcode = '22023'; end if;
    update public.tasks
    set column_id = p_move_tasks_to,
        position = tasks.position + (
          select coalesce(max(target_tasks.position), 0)
          from public.tasks target_tasks
          where target_tasks.column_id = p_move_tasks_to and target_tasks.deleted_at is null
        )
    where tasks.column_id = p_column_id and tasks.deleted_at is null;
  else
    update public.tasks set deleted_at = now()
    where tasks.column_id = p_column_id and tasks.deleted_at is null;
  end if;
  update public.columns set deleted_at = now() where columns.id = p_column_id;
  insert into public.activity (project_id, actor_id, entity_type, entity_id, action, to_value)
  values (
    existing_column.project_id, current_user_id, 'column', p_column_id, 'deleted',
    jsonb_build_object('name', existing_column.name, 'taskCount', open_task_count,
      'movedTo', case when p_move_tasks_to <> p_column_id then p_move_tasks_to else null end)
  );
end;
$$;
revoke all on function public.delete_column(uuid, uuid) from public;
grant execute on function public.delete_column(uuid, uuid) to authenticated;
