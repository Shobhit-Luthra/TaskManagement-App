-- Daily per-column task counts, the input the analytics dashboard reads for
-- throughput and the cumulative-flow diagram (00 §9 — this job ships before
-- the dashboard is exposed so there is always at least one day of data).
create table public.board_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  column_id uuid not null references public.columns(id) on delete cascade,
  snapshot_date date not null,
  task_count integer not null default 0 check (task_count >= 0),
  created_at timestamptz not null default now(),
  unique (project_id, column_id, snapshot_date)
);
alter table public.board_snapshots enable row level security;
alter table public.board_snapshots force row level security;
create policy board_snapshots_member_read on public.board_snapshots
  for select using (public.is_project_member(project_id));
create index idx_board_snapshots_project_date on public.board_snapshots(project_id, snapshot_date);

-- job_runs already exists (202609190001_job_runs.sql); guarded defensively
-- in case this migration ever runs against an environment without it.
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  run_key text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  unique (job_name, run_key)
);
alter table public.job_runs enable row level security;
alter table public.job_runs force row level security;
-- No policies — deny by default. Only the service-role client (cron routes,
-- this RPC, the RLS seeder) can read or write job_runs.

create or replace function public.board_snapshot() returns void
language plpgsql security definer set search_path = public as $$
declare
  -- Named to avoid colliding with any column named run_key/job_name in this
  -- function's embedded SQL (a same-named plpgsql variable makes bare
  -- references in an INSERT target list or ON CONFLICT column list either a
  -- syntax error or ambiguous — see 202609250001/202609250002's fixes).
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
  raise;
end;
$$;
revoke all on function public.board_snapshot() from public;
grant execute on function public.board_snapshot() to service_role;

-- 00:05 UTC daily, after the day's activity has settled.
select cron.schedule('board-snapshot-daily', '5 0 * * *', $$select public.board_snapshot()$$);
