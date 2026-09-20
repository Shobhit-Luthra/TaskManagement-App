-- Retention (M5): 30 days for soft-deleted project/task/column/comment rows
-- (matches the trash-restore window from Task 2C.5), 7 days for sent
-- notification-queue rows, 90 days for read notifications, 30 days for
-- expired invitations, 24 hours for idempotency keys (T3). `activity` is
-- never purged — it is the permanent audit trail (04 §4.10).
--
-- Local variable named to avoid the same run_key/ON CONFLICT collision
-- fixed in board_snapshot() (202609250003) — see that migration's comment.
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

  update public.job_runs set finished_at = now(), error = null
  where job_runs.job_name = 'purge_soft_deleted' and job_runs.run_key = purge_run_key;
exception when others then
  update public.job_runs set finished_at = now(), error = sqlerrm
  where job_runs.job_name = 'purge_soft_deleted' and job_runs.run_key = purge_run_key;
  raise;
end;
$$;
revoke all on function public.purge_soft_deleted() from public;
grant execute on function public.purge_soft_deleted() to service_role;

select cron.schedule('purge-soft-deleted-daily', '0 3 * * *', $$select public.purge_soft_deleted()$$);
