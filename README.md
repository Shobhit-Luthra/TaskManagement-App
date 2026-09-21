# Kanbo

Kanbo is a focused Kanban board for small teams. It provides email and Google authentication, protected projects, responsive boards, task creation and editing, priority and due-date tracking, drag-and-drop task movement, soft deletion, and a light/dark theme.

## Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS
- Supabase Auth and Postgres with row-level security
- Zod validation, Vitest, ESLint, Prettier

## Local setup

1. Install Node 20 or later and npm.
2. Create a Supabase project in the Mumbai region (`ap-south-1`).
3. Copy `.env.example` to `.env.local`, then add the project URL and anonymous key. Set `NEXT_PUBLIC_SITE_URL` to the URL you will use locally.
4. Install dependencies and apply the migrations:

   ```bash
   npm install
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npm run db:push
   ```

5. In Supabase Authentication settings, add `http://localhost:3000/auth/callback` to the allowed redirect URLs. Configure your email provider and, if desired, Google OAuth.
6. Start the app:

   ```bash
   npm run dev
   ```

Open http://localhost:3000, create an account, verify your email, create a project, and add your first task.

## Repository layout

```
docs/specs/                 product, UX, system, database, API, tech-stack and security specs (authoritative)
docs/superpowers/specs/     build decisions and amendments
docs/superpowers/plans/     implementation plans (2026-09-11-kanbo-mvp/ is the current roadmap)
src/app/                    Next.js App Router pages, server actions, /api/v1 route handlers
src/components/             UI (shadcn primitives in ui/, feature components alongside)
src/lib/                    shared logic: env, auth, api helpers, realtime, schemas
supabase/migrations/        forward-only SQL migrations (schema, RLS, RPCs)
ENGINEERING_RULES.md        engineering rules that apply to every change
```

## Checks

```bash
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run test:rls
npm run build
npm run size
```

## Database migrations

Migrations live in `supabase/migrations/`. They establish the core data model, row-level security, default project columns, and transaction-safe functions for creating, moving, updating, and soft-deleting tasks. Do not edit a migration after it has been applied to a shared environment; add a new migration instead.

## Deployment

Kanbo is live at **https://kanbo-orcin.vercel.app** (Vercel project `kanbo`, region `bom1`, auto-deployed from `main`).

| Environment | Supabase project | Vercel target | Migration owner |
| --- | --- | --- | --- |
| Development | `Task Management App` (`bewkxittluulfnxjeojw`) | Local development | Developers |
| Production | same project, for now | Production | Release operator |

Launch decision (2026-09-21): one Supabase project serves both development/CI and production until there are real users, so CI's RLS suite creates and removes throwaway rows in the live database. Splitting into `kanbo-staging` / `kanbo-prod` is the first operational task once real data exists: create the second project, `supabase db push`, repoint the `STAGING_*` GitHub secrets at the non-production one.

Set these variables for every environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_AUTH_TOKEN`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, and `EMAIL_PROVIDER` (currently `console`). Keep server-only variables out of browser-prefixed names.

In each Supabase project, set the matching Site URL and allow `<origin>/auth/callback` and `<origin>/auth/confirm`. Staging must also allow `https://*-<vercel-team>.vercel.app/auth/callback` for preview deployments.
