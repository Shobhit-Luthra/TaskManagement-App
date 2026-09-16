-- 24h storage for Idempotency-Key replay (T3, 05 §2). Applied to task
-- create and invitation create only, per the withIdempotency() calls that
-- use it. Service-role only — the app server is the only caller.
create table public.idempotency_keys (
  user_id uuid not null references public.users(id) on delete cascade,
  key text not null check (char_length(key) <= 200),
  request_hash text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;
-- No policies: deny by default, service role only (bypasses RLS).
