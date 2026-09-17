-- Idempotency and operational visibility for every database-backed scheduled
-- job. Clients have no direct access; security-definer functions write it.
create table public.job_runs (
  job_name text not null check (char_length(job_name) between 1 and 100),
  run_key text not null check (char_length(run_key) between 1 and 120),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  primary key (job_name, run_key)
);

alter table public.job_runs enable row level security;
alter table public.job_runs force row level security;
