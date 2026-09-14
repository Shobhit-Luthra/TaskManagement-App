# Kanbo operations runbook

## Environments

| Environment | Database | App target | Migration authority |
| --- | --- | --- | --- |
| Development | `kanbo-dev` | Local | Developers |
| Staging | `kanbo-staging` | Vercel preview/staging | CI or release operator |
| Production | `kanbo-prod` | Vercel production | Release operator |

Never point a preview deployment at production data.

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
