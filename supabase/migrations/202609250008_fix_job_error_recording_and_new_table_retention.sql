-- Bugfix (code review I2): the EXCEPTION handler's own UPDATE was rolled
-- back along with everything else because the handler ended with `raise;`,
-- re-raising into the caller's single-statement transaction (pg_cron calls
-- these as one top-level statement, and a function cannot commit
-- independently of its caller) — so error recording on failure never
-- actually persisted. Fix: record the error and return normally instead of
-- re-raising; job_runs plus the heartbeat route is this system's failure
-- signal, not the raw exception propagating to pg_cron's own logs.
create or replace function public.board_snapshot() returns void
language plpgsql security definer set search_path = public as $$
declare
  snapshot_run_key text := to_char(now(), 'YYYY-MM-DD');
begin
  insert into public.job_runs (job_name, run_key, started_at)
  values ('board_snapshot', snapshot_run_key, now())
  on conflict (job_name, run_key) do nothing;

  insert into public.board_snapshots (project_id, column_id, snapshot_date, task_count)
  select c.project_id, c.id, current_date, count(t.id)
  from public.columns c
  left join public.tasks t on t.column_id = c.id and t.deleted_at is null
  where c.deleted_at is null
  group by c.project_id, c.id
  on conflict (project_id, column_id, snapshot_date) do nothing;

  update public.job_runs set finished_at = now(), error = null
  where job_runs.job_name = 'board_snapshot' and job_runs.run_key = snapshot_run_key;
exception when others then
  update public.job_runs set finished_at = now(), error = sqlerrm
  where job_runs.job_name = 'board_snapshot' and job_runs.run_key = snapshot_run_key;
end;
$$;
revoke all on function public.board_snapshot() from public;
grant execute on function public.board_snapshot() to service_role;

-- Retention for the tables this sub-plan introduced (code review I4) —
-- board_snapshots at ~projects*columns rows/day, job_runs at a handful/day,
-- neither previously covered by purge_soft_deleted().
create or replace function public.purge_soft_deleted() returns void
language plpgsql security definer set search_path = public as $$
declare
  purge_run_key text := to_char(now(), 'YYYY-MM-DD');
begin
  insert into public.job_runs (job_name, run_key, started_at)
  values ('purge_soft_deleted', purge_run_key, now())
  on conflict (job_name, run_key) do nothing;

  delete from public.tasks where tasks.deleted_at is not null and tasks.deleted_at < now() - interval '30 days';
  delete from public.columns where columns.deleted_at is not null and columns.deleted_at < now() - interval '30 days';
  delete from public.projects where projects.deleted_at is not null and projects.deleted_at < now() - interval '30 days';

  if to_regclass('public.comments') is not null then
    execute 'delete from public.comments where deleted_at is not null and deleted_at < now() - interval ''30 days''';
  end if;

  delete from public.invitations
  where invitations.accepted_at is null
    and invitations.declined_at is null
    and invitations.expires_at < now() - interval '30 days';

  delete from public.idempotency_keys where idempotency_keys.created_at < now() - interval '24 hours';

  if to_regclass('public.notification_queue') is not null then
    execute 'delete from public.notification_queue where sent_at is not null and sent_at < now() - interval ''7 days''';
  end if;

  if to_regclass('public.notifications') is not null then
    execute 'delete from public.notifications where read_at is not null and read_at < now() - interval ''90 days''';
  end if;

  delete from public.board_snapshots where board_snapshots.snapshot_date < current_date - interval '400 days';
  delete from public.job_runs where job_runs.started_at < now() - interval '90 days';

  update public.job_runs set finished_at = now(), error = null
  where job_runs.job_name = 'purge_soft_deleted' and job_runs.run_key = purge_run_key;
exception when others then
  update public.job_runs set finished_at = now(), error = sqlerrm
  where job_runs.job_name = 'purge_soft_deleted' and job_runs.run_key = purge_run_key;
end;
$$;
revoke all on function public.purge_soft_deleted() from public;
grant execute on function public.purge_soft_deleted() to service_role;
