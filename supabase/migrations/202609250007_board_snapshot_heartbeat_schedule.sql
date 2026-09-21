-- Ten minutes after the daily snapshot job, ping the heartbeat route so a
-- silent miss alerts via Sentry. No-ops harmlessly until the cron_site_url
-- vault secret exists (T1's operator step, same as notification-flush).
--
-- This schedule was applied directly against the project earlier in this
-- session (via mcp__supabase__apply_migration) but the corresponding file
-- was never written — caught by code review. cron.schedule() upserts by
-- job name, so re-running this is a no-op against the live schedule.
select cron.schedule(
  'board-snapshot-heartbeat',
  '15 0 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_site_url') || '/api/cron/snapshot-heartbeat',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
