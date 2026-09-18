-- T1: all schedules run on pg_cron inside Supabase. Pure-SQL jobs run
-- directly; jobs that must send email go through pg_net -> the guarded
-- /api/cron/[job] route (CRON_SECRET), never a bare pg_cron SQL job.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Due-soon scan (03 §13): tasks due within 24h, in the project's own
-- timezone (G3), not done, with an assignee, not already notified for this
-- due date (enforced by notifications_due_soon_once, migration 202609230001).
-- Pure SQL — enqueue_notifications only ever queues; it never sends email
-- itself, so this job needs no pg_net call.
create or replace function public.due_soon_scan() returns void
language plpgsql security definer set search_path = public as $$
declare task_row record;
begin
  for task_row in
    select t.id, t.project_id, t.title, t.assignee_id, t.due_date
    from public.tasks t
    join public.columns c on c.id = t.column_id
    join public.projects p on p.id = t.project_id
    where t.deleted_at is null
      and not c.is_done_column
      and t.assignee_id is not null
      and t.due_date is not null
      and (t.due_date::timestamp at time zone p.timezone) <= now() + interval '24 hours'
      and (t.due_date::timestamp at time zone p.timezone) > now()
  loop
    perform public.enqueue_notifications(
      'due_soon', task_row.project_id, task_row.id, null, array[task_row.assignee_id],
      jsonb_build_object('taskTitle', task_row.title, 'dueDate', task_row.due_date)
    );
  end loop;
end;
$$;
revoke all on function public.due_soon_scan() from public, anon, authenticated;

select cron.schedule('due-soon-scan', '0 * * * *', $$select public.due_soon_scan();$$);

-- Position renormalisation (04 §9, deferred here from 2C.2 per that
-- migration's own note) — nightly, pure SQL, one call per non-deleted
-- column that currently holds tasks.
select cron.schedule(
  'renormalize-positions',
  '30 2 * * *',
  $$
  select public.renormalize_column(c.id)
  from public.columns c
  where c.deleted_at is null
    and exists (select 1 from public.tasks t where t.column_id = c.id and t.deleted_at is null);
  $$
);

-- notification-flush and weekly-digest send email, so per T1 they go
-- through pg_net -> POST /api/cron/<job> with a CRON_SECRET bearer header.
-- The two secrets below (cron_site_url, cron_secret) are an operator step:
-- run once per environment via the Supabase SQL editor or `supabase secrets`,
-- e.g. `select vault.create_secret('https://staging.kanbo.example', 'cron_site_url');`
-- and `select vault.create_secret('<the CRON_SECRET env value>', 'cron_secret');`
-- Both schedules are created here but no-op harmlessly until those secrets
-- exist (net.http_post to a null url fails and the job_runs row records the
-- error; it does not affect any other job).
select cron.schedule(
  'notification-flush',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_site_url') || '/api/cron/notification-flush',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('run_key', to_char(now(), 'YYYYMMDDHH24MI'))
  );
  $$
);
