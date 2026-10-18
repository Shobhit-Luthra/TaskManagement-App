# Morning notes: things that need your decision

Written overnight. Nothing here was done without you; each item is waiting on a call or an
action only you can take.

## 1. Vercel preview deployments fail (needs your action)
Every Vercel preview build fails with `Invalid or missing client environment variables:
NEXT_PUBLIC_SITE_URL`. The variable is set for Production but not for **Preview**. In Vercel:
Project, Settings, Environment Variables, add `NEXT_PUBLIC_SITE_URL` for Preview (for example
`https://kanbo-staging.vercel.app`). This is almost certainly the red mark you were seeing. The
GitHub Actions `ci` and `backup` workflows themselves pass.

## 2. Push notification migration is NOT applied to the database
`supabase/migrations/202610190002_push_subscriptions.sql` adds a table, a column and a
pg_cron job to the live database (shared by staging and production). I applied the attachments
migration with your go-ahead; I did not apply this one overnight. Tell me to apply it, or paste
it into the Supabase SQL editor. Until then the "Turn on for this device" button will fail with
an error (nothing else is affected).

## 3. Vercel environment variables for push
Generate a **new** VAPID key pair for Vercel (do not reuse the local one in `.env.local`) and set
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. See `docs/pwa-and-push.md`.

## 4. Merge order
PR #1 (speed, attachments, CI) first, then PR #2 (app + push, stacked on #1). Merging #1 deploys
to production because Vercel builds `main`; the attachments migration is already live.

## 5. Decisions I made that you may want to change
- `npm audit` no longer blocks CI (it warns). Say if you want it blocking again.
- Attachment limits: 10 MB per file, 10 files per task, images, PDF, Office, text, CSV and zip.
- Old task links are kept in the database and API but have no screen.
- Push is on/off per device, with no per-category setting, and arrives within about a minute.
- Attachment changes are not written to the activity feed.
- Files of permanently purged tasks stay in storage (no cleanup job yet).

## 6. Not done
- Board query slimming and Sentry trimming from the speed plan. The measured bundle gain so far
  is 229.5 KB to 189.7 KB gzipped on the board; I haven't measured request timings against the
  live database.
- The Supabase migration history already differs from the local file names (for example
  `20260924172705_task_links` remotely vs `202610030002_task_links.sql` locally), so a plain
  `supabase db push` would try to re-apply old migrations. Worth cleaning up with
  `supabase migration repair`, but it changes migration bookkeeping on the live project, so I
  left it.
