-- Web push: one row per browser/device a user has enabled push on. Rows are read and
-- written only through the service role (the push API route) and by the owner via RLS.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 2048 and endpoint ~ '^https://'),
  p256dh text not null check (char_length(p256dh) <= 256),
  auth text not null check (char_length(auth) <= 256),
  user_agent varchar(255),
  created_at timestamptz not null default now()
);
create index idx_push_subscriptions_user on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
create policy push_subscriptions_self_read on public.push_subscriptions for select to authenticated
  using (push_subscriptions.user_id = auth.uid());
create policy push_subscriptions_self_delete on public.push_subscriptions for delete to authenticated
  using (push_subscriptions.user_id = auth.uid());
-- Inserts go through the API route (service role) so the endpoint is validated first.

-- Tracks which notifications have been offered to push, so the flush never double-sends.
alter table public.notifications add column push_sent_at timestamptz;
create index idx_notifications_push_pending on public.notifications(created_at)
  where push_sent_at is null;

-- Same pg_net -> guarded /api/cron/<job> plumbing as notification-flush (needs the
-- cron_site_url and cron_secret vault secrets). Every minute so pushes feel immediate.
select cron.schedule(
  'push-flush',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_site_url') || '/api/cron/push-flush',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('run_key', to_char(now(), 'YYYYMMDDHH24MI'))
  );
  $$
);
