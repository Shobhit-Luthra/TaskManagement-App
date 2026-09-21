# Kanbo operations runbook

## Environments

| Environment | Database | App target | Migration authority |
| --- | --- | --- | --- |
| Development / CI | Supabase `Task Management App` (`bewkxittluulfnxjeojw`) | Local, Vercel previews | Developers |
| Production | same project (see README "Deployment") | https://kanbo-orcin.vercel.app | Release operator |

Production launched 2026-09-21 on a single Supabase project. Split staging from production before onboarding real users.

Scheduled jobs: `pg_cron` runs `due_soon_scan`, `purge_soft_deleted` and `board_snapshots` in-database, and calls back into the app (`/api/cron/notification-flush`, `/api/cron/snapshot-heartbeat`) using the Vault secrets `cron_site_url` and `cron_secret`; `cron_secret` must equal Vercel's `CRON_SECRET`. Rotate both together.

## If the site is down

1. Uptime monitor: not yet configured (Task 2G.7 Step 4 — add a free UptimeRobot check on `https://kanbo-orcin.vercel.app/` and record the link here).
2. Vercel → project `kanbo` → Deployments: is the latest production deployment `Ready`? Roll back to the previous one if not.
3. Supabase → project `Task Management App`: free projects pause after inactivity; restore it if paused.
4. Sentry: not configured at launch; check Vercel runtime logs instead.

## Restore drill

Download a `kanbo-prod-*` backup artifact, then restore it only into a reset `kanbo-dev` project:

```bash
gpg --decrypt dump.tgz.gpg > dump.tgz
tar xzf dump.tgz
supabase db reset --linked
psql "$DEV_DB_URL" -f schema.sql
psql "$DEV_DB_URL" -f data.sql
```

Smoke-test login and a project board afterwards. Record the drill date and result here: pending first production artifact.

## Rotating secrets

Rotate `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, Sentry credentials, and backup passphrases in the relevant provider first, then update GitHub Actions/Vercel environment settings. Keep each environment’s credentials distinct. Do not add any secret to the repository.

## Snapshot job missed

The snapshot heartbeat and alert response are added in roadmap task 2G.1. Until then, inspect scheduled-job runs in Supabase and investigate a missing daily run before exposing analytics.

## Rate-limit tuning

Policies live in `src/lib/api/rate-limit.ts`. Modify the named policy, retain server-side enforcement, and validate the affected write/read route receives the expected rate-limit headers before deployment.
