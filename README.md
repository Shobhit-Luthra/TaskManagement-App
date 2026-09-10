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

## Checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Database migrations

Migrations live in `supabase/migrations/`. They establish the core data model, row-level security, default project columns, and transaction-safe functions for creating, moving, updating, and soft-deleting tasks. Do not edit a migration after it has been applied to a shared environment; add a new migration instead.

## Deployment

Configure the same environment variables in the hosting provider, set `NEXT_PUBLIC_SITE_URL` to the deployed origin, and add its `/auth/callback` URL to Supabase Auth redirect settings. Apply migrations to each Supabase environment before deploying its matching application environment.
