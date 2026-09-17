-- Keeps floating-point task positions safely separated. This is deliberately
-- server-side: the browser may only propose a drop position.
create or replace function public.renormalize_column(p_column_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  task_row record;
  next_position double precision := 1000;
begin
  for task_row in
    select tasks.id
    from public.tasks
    where tasks.column_id = p_column_id and tasks.deleted_at is null
    order by tasks.position, tasks.id
    for update
  loop
    update public.tasks set position = next_position where tasks.id = task_row.id;
    next_position := next_position + 1000;
  end loop;
end;
$$;
revoke all on function public.renormalize_column(uuid) from public;
grant execute on function public.renormalize_column(uuid) to authenticated;

create or replace function public.move_task(
  p_task_id uuid, p_column_id uuid, p_position double precision, p_mutation_id uuid
) returns table (id uuid, column_id uuid, "position" double precision, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  existing_task public.tasks%rowtype;
  source_is_done boolean;
  target_is_done boolean;
  activity_kind public.activity_action;
  source_column_id uuid;
  final_position double precision := p_position;
  collides boolean;
begin
  if current_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  select * into existing_task from public.tasks where tasks.id = p_task_id and tasks.deleted_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_project_member(existing_task.project_id) then raise exception 'TASK_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.can_write_project(existing_task.project_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_position in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then raise exception 'INVALID_POSITION' using errcode = '22023'; end if;
  select columns.is_done_column into target_is_done
  from public.columns
  where columns.id = p_column_id and columns.project_id = existing_task.project_id and columns.deleted_at is null;
  if not found then raise exception 'INVALID_COLUMN' using errcode = '22023'; end if;
  select columns.is_done_column into source_is_done from public.columns where columns.id = existing_task.column_id;
  source_column_id := existing_task.column_id;

  select exists (
    select 1 from public.tasks
    where tasks.column_id = p_column_id
      and tasks.id <> p_task_id
      and tasks.deleted_at is null
      and abs(tasks.position - p_position) < 1e-6
  ) into collides;
  if collides then
    perform public.renormalize_column(p_column_id);
    select coalesce(max(tasks.position), 0) + 1000 into final_position
    from public.tasks
    where tasks.column_id = p_column_id and tasks.id <> p_task_id and tasks.deleted_at is null;
  end if;

  activity_kind := case
    when target_is_done and not coalesce(source_is_done, false) then 'completed'
    when coalesce(source_is_done, false) and not target_is_done then 'reopened'
    else 'moved'
  end;
  update public.tasks
  set column_id = p_column_id, position = final_position, mutation_id = p_mutation_id
  where tasks.id = p_task_id
  returning * into existing_task;
  insert into public.activity (project_id, actor_id, task_id, entity_type, entity_id, action, from_value, to_value)
  values (
    existing_task.project_id, current_user_id, existing_task.id, 'task', existing_task.id, activity_kind,
    jsonb_build_object('columnId', source_column_id), jsonb_build_object('columnId', p_column_id)
  );
  return query select existing_task.id, existing_task.column_id, existing_task.position, existing_task.updated_at;
end;
$$;
revoke all on function public.move_task(uuid, uuid, double precision, uuid) from public;
grant execute on function public.move_task(uuid, uuid, double precision, uuid) to authenticated;

create or replace function public.renormalize_positions() returns void
language plpgsql security definer set search_path = public as $$
declare
  column_row record;
begin
  for column_row in
    select columns.id from public.columns
    where columns.deleted_at is null and exists (
      select 1 from (
        select tasks.position, lag(tasks.position) over (order by tasks.position, tasks.id) as previous_position
        from public.tasks
        where tasks.column_id = columns.id and tasks.deleted_at is null
      ) gaps
      where gaps.previous_position is not null and gaps.position - gaps.previous_position < 1e-4
    )
  loop
    perform public.renormalize_column(column_row.id);
  end loop;
end;
$$;
revoke all on function public.renormalize_positions() from public;
grant execute on function public.renormalize_positions() to service_role;

-- The production pg_cron schedule is provisioned with the other jobs in 2F.
-- This authenticated wrapper makes the pure SQL job testable without granting
-- clients access to either job_runs or the job function.
create or replace function public.run_renormalize_positions_for_test(p_run_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_run_key is null or char_length(p_run_key) not between 1 and 120 then
    raise exception 'INVALID_RUN_KEY' using errcode = '22023';
  end if;
  insert into public.job_runs (job_name, run_key)
  values ('renormalize_positions', p_run_key)
  on conflict (job_name, run_key) do nothing;
  begin
    perform public.renormalize_positions();
    update public.job_runs
    set finished_at = now(), error = null
    where job_runs.job_name = 'renormalize_positions' and job_runs.run_key = p_run_key;
  exception when others then
    update public.job_runs
    set finished_at = now(), error = sqlerrm
    where job_runs.job_name = 'renormalize_positions' and job_runs.run_key = p_run_key;
    raise;
  end;
end;
$$;
revoke all on function public.run_renormalize_positions_for_test(text) from public;
grant execute on function public.run_renormalize_positions_for_test(text) to authenticated;
