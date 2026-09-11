# 06 — Technology Stack

**Product:** Kanbo
**Depends on:** `03_system_design.md`

Every entry answers six questions: what it is, why it is needed, why it was selected, what was considered instead, what it costs, and what it risks.

---

## 1. Stack at a Glance

| Layer | Choice |
|---|---|
| Language | TypeScript 5.x (strict) |
| Framework | Next.js 15 (App Router) + React 19 |
| Styling | Tailwind CSS 4 |
| Components | shadcn/ui + Radix UI |
| Drag & drop | dnd-kit |
| Server state | TanStack Query v5 |
| Client state | Zustand |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| Dates | date-fns + `@date-fns/tz` |
| Database | PostgreSQL 16 (Supabase) |
| Auth | Supabase Auth (GoTrue) |
| Realtime | Supabase Realtime |
| Backend | Next.js Route Handlers |
| Validation | Zod (shared client/server) |
| Scheduling | pg_cron + Vercel Cron |
| Email | Resend + React Email |
| Hosting | Vercel |
| Errors | Sentry |
| Testing | Vitest · Testing Library · Playwright · pgTAP |
| Quality | ESLint · Prettier · Husky · lint-staged |
| CI/CD | GitHub Actions + Vercel |

---

## 2. Frontend

### TypeScript (strict)
**What:** JavaScript with a compile-time type system.
**Why needed:** The board has genuinely complex state — optimistic overlays, realtime events, drag coordinates. Type errors here manifest as cards vanishing, which is exactly the class of bug users never forgive.
**Why selected:** Zod schemas generate types shared by client and server, so an API contract change breaks the build rather than production.
**Alternatives:** Plain JavaScript (faster to start, unmaintainable past ~5k lines); JSDoc types (weaker inference).
**Cost:** Free. **Risk:** A modest learning curve if you are coming from Python.

### Next.js 15 + React 19
**What:** A React framework providing routing, server rendering, and backend API routes in one codebase.
**Why needed:** You need a frontend *and* a backend. Next gives both without running two projects.
**Why selected:** Server Components let the board's initial state render server-side (no loading flash), while the interactive board stays a client component. Route Handlers host the mutation API in the same repo with the same types.
**Alternatives:** *Vite + React SPA + separate FastAPI* — cleaner separation, better if the backend is the learning goal, but two deployments and duplicated types. *Remix* — excellent, smaller ecosystem. *SvelteKit* — smaller bundles, but React is what interviewers ask about.
**Cost:** Free. **Risk:** App Router has real complexity around the server/client boundary; expect to hit "you're importing a server module in a client component" a few times.

### Tailwind CSS 4 + shadcn/ui
**What:** Tailwind is utility-class styling. shadcn/ui is a set of accessible components you copy into your repo rather than install.
**Why needed:** `02` specifies modals, dropdowns, date pickers, popovers. Hand-building accessible versions of those is weeks of work you should not spend.
**Why selected:** shadcn components live in *your* codebase, so restyling is editing a file — not fighting a library's theme API. Radix underneath handles focus trapping and ARIA correctly, which is most of `01 §24` solved for free.
**Alternatives:** MUI (heavier, opinionated aesthetics); Chakra (good, less controllable); plain CSS Modules (full control, far more work).
**Cost:** Free. **Risk:** Utility classes make JSX visually noisy; extract component classes when a pattern repeats three times.

### dnd-kit
**What:** A drag-and-drop toolkit for React.
**Why needed:** Drag and drop *is* the product.
**Why selected:** It ships a keyboard sensor, which delivers the keyboard-equivalent drag that `01 §24` requires — the single largest accessibility risk in a Kanban app. It handles touch, pointer and sensor coordination, supports multiple containers (columns), and is actively maintained.
**Alternatives:** `react-beautiful-dnd` — **deprecated, do not use**; native HTML5 drag API — no touch support, inconsistent across browsers.
**Cost:** Free. **Risk:** The mental model (sensors, collision detection, modifiers) takes a day to click.

### TanStack Query v5 + Zustand
**What:** TanStack Query caches server data. Zustand is a small client-state store.
**Why needed:** These are two genuinely different kinds of state, and `03 §3` keeps them separate deliberately. Server data is fetched, cached and invalidated. Drag state and optimistic overlays are neither.
**Why selected:** Conflating them is the standard way optimistic UI becomes unmaintainable. Zustand is ~1KB with no provider ceremony.
**Alternatives:** Redux Toolkit (more boilerplate than this needs); React Context (re-renders the whole subtree — fatal on a 500-card board); SWR (fine, weaker mutation ergonomics).
**Cost:** Free.

### Recharts
**What:** Chart components for React.
**Why needed:** Five visualisations in `01 §FR-10`.
**Why selected:** Declarative React components; the stacked `AreaChart` gives the cumulative flow diagram almost directly.
**Alternatives:** Chart.js (imperative, canvas-based, awkward in React); D3 directly (total control, far more code); Visx (powerful, lower level).
**Cost:** Free. **Risk:** ~100KB — code-split it so the board route never loads it.

### date-fns
**What:** Date utilities.
**Why needed:** Timezone handling is the source of half of all "overdue" bugs. Users in different zones must agree on what "due Friday" means.
**Why selected:** Tree-shakeable, immutable, explicit timezone handling.
**Alternatives:** Moment.js (deprecated); Day.js (smaller, weaker timezone support); native `Temporal` (not yet broadly shipped).

---

## 3. Backend and Data

### PostgreSQL 16
Justified in full in `04 §1`. Short version: the domain is relational, the analytics are window functions, and RLS is the authorization boundary.
**Alternatives:** MongoDB (would force client-side joins for board loads); MySQL (no RLS, weaker JSON); SQLite (no concurrent writes — disqualifying for a multi-user product).

### Supabase
**What:** Managed Postgres bundled with authentication, a realtime layer, storage and auto-generated APIs.
**Why needed:** You need a database, auth, and realtime. Building auth alone properly — hashing, sessions, reset flows, OAuth, rate limiting — is weeks of work with a high cost of getting it subtly wrong.
**Why selected:** It is real Postgres, not a proprietary store. RLS gives database-enforced multi-tenancy. Realtime rides Postgres logical replication, so a database write *is* the broadcast — you cannot write to the DB and forget to notify clients.
**Alternatives:**
- *Firebase* — excellent realtime, but document-based; the analytics in `01 §FR-10` would be painful, and lock-in is deeper.
- *Self-hosted Postgres + custom auth* — maximum control and maximum learning, roughly 4 extra weeks.
- *PlanetScale / Neon* — good databases, no auth or realtime; you would add Clerk and Pusher and end up with three vendors.
**Cost:** Free tier covers 500MB and 200 concurrent realtime connections — comfortably within A1–A3. Pro is $25/month.
**Risk:** Vendor coupling. **Mitigation (`03 §1`):** all business logic lives in TypeScript Route Handlers, never in Postgres functions or Edge Functions, so the database layer is portable to any Postgres.

### Zod
**What:** A schema validator that infers TypeScript types from the schema.
**Why needed:** Every API boundary needs validation, and `04 §13` makes it layer two of three.
**Why selected:** One schema produces both runtime validation and the static type. There is no way for them to drift, because they are the same object.
**Alternatives:** Yup (weaker inference); Joi (no TS inference); manual validation (guaranteed to drift).

### Resend + React Email
**What:** A transactional email API, and JSX-based email templates.
**Why needed:** Invitations, digests and notifications. Sending through Gmail SMTP gets you rate-limited and spam-foldered within a day.
**Why selected:** Simple API, good deliverability, generous free tier. React Email means templates are components, not HTML tables from 2004.
**Alternatives:** SendGrid (more features, clunkier); AWS SES (cheapest at scale, worst DX, requires sandbox exit).
**Cost:** 3 000 emails/month free.
**Blocked on M4** — deliverability requires SPF/DKIM records on a domain you control.

### pg_cron + Vercel Cron
**What:** Schedulers. `pg_cron` runs SQL inside Postgres; Vercel Cron calls an HTTP endpoint on a schedule.
**Why needed:** Six scheduled jobs in `03 §13`, including the snapshot job whose data is irreplaceable.
**Why selected:** Split by need — pure-SQL jobs (snapshots, purges, renormalisation) run in the database with no network hop or cold start; jobs needing application logic (digests, email flush) run as Route Handlers.
**Alternatives:** GitHub Actions cron (free, less reliable timing); a dedicated queue like Inngest or Trigger.dev (better retries and observability, another vendor).
**Cost:** Free. **Risk:** Vercel Hobby allows limited cron frequency — check current limits before relying on the 5-minute flush.

---

## 4. Hosting and Operations

### Vercel
**Why selected:** First-class Next.js support, per-PR preview deployments (which `03 §24` depends on), edge CDN, zero-config.
**Alternatives:** Netlify (comparable); Railway/Render (containers, better for long-running processes); self-hosted VPS (cheapest, most operational work).
**Cost:** Free Hobby tier.
**Risk:** Serverless cold starts on the free tier; function timeouts cap long jobs — keep the digest job batched per project rather than global.

### Sentry
**Why needed:** Without error tracking you learn about bugs from users, or never.
**Why selected:** Source-map support, release tagging, session replay on errors.
**Alternatives:** LogRocket (better replay, pricier); console logs only (not a strategy).
**Cost:** 5 000 errors/month free.

---

## 5. Testing and Quality

| Tool | Purpose | Why this one |
|---|---|---|
| **Vitest** | Unit tests | Fast, Jest-compatible API, native ESM/TS |
| **Testing Library** | Component tests | Tests behaviour, not implementation details |
| **Playwright** | E2E | Real browsers; drag-and-drop and realtime need real event dispatch |
| **pgTAP** | **RLS policy tests** | The one non-obvious pick — see below |
| ESLint + Prettier | Static analysis, formatting | Standard |
| Husky + lint-staged | Pre-commit gates | Cheap prevention |

**On pgTAP.** RLS policies are security-critical SQL that no application test exercises — your integration tests run as an authenticated user who *should* have access, so they pass whether the policy is correct or absent. pgTAP lets you assert the negative case directly: connect as user B, query user A's project, assert zero rows. `07` makes this an acceptance criterion, and it is the single highest-value test suite in this project.

---

## 6. Cost Summary

| Service | Free tier | Paid |
|---|---|---|
| Vercel | Hobby | $20/mo Pro |
| Supabase | 500MB, 2 projects, 200 realtime connections | $25/mo Pro |
| Resend | 3 000 emails/mo | $20/mo |
| Sentry | 5 000 errors/mo | $26/mo |
| GitHub | Unlimited public repos, Actions minutes | — |
| **Total** | **₹0** | **~$91/mo** |

The MVP as scoped runs entirely on free tiers. Assumption A8 states this explicitly; if M6 designates this as production, budget the paid tiers primarily for Supabase point-in-time recovery.

---

## 7. Deliberately Rejected

| Technology | Why not |
|---|---|
| GraphQL | Query-shape diversity does not justify the operational cost; the read path bypasses the API anyway |
| Redux Toolkit | More ceremony than this app's state needs |
| `react-beautiful-dnd` | Deprecated |
| Docker/Kubernetes | Nothing here needs orchestration |
| Microservices | One developer, one domain. Distributing this would add failure modes and remove nothing |
| Redis | Postgres handles caching and queuing at this scale; adding Redis is premature |
| **Any LLM API** | Per `00 §5` — every output is a fact about the user's data, and facts must be correct rather than plausible |
| Prisma | Fights RLS; the repository pattern with the Supabase client is simpler here |
| tRPC | Genuinely close. Rejected only because REST keeps the API callable from non-TypeScript clients later |

---

## 8. Python Alternative

Since your background is stronger in Python, the honest comparison:

**FastAPI + SQLAlchemy + Alembic + PostgreSQL, with React on the front.**

**Gains:** you write the auth layer, the ORM mappings and the migrations yourself, which teaches more backend engineering than Supabase will. FastAPI's Pydantic models mirror Zod closely.
**Costs:** roughly 3–4 additional weeks. You build sessions, password reset, OAuth, and rate limiting from scratch. Realtime needs a separate WebSocket layer (FastAPI WebSockets or Pusher) rather than falling out of the database. Two deployments instead of one. Types are duplicated across Python and TypeScript with nothing enforcing agreement.

**Recommendation:** take the TypeScript stack. Not because Python is worse, but because this project's difficulty should live in the *concurrency, realtime and authorization* problems — which are the interesting parts and the ones an interviewer will probe — rather than in re-implementing authentication. If you later want the backend depth, rewriting the API layer against the same Postgres schema is a well-scoped follow-up project, and the schema in `04` transfers unchanged.
