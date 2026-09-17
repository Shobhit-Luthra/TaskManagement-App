# Kanbo Sub-plan 2E — Filters, search & My Tasks (P1)

> **Status: expanded to step-level.** The full TDD, step-by-step plan (failing test → code → passing test → commit for all 4 tasks) lives in `2E-filters-search-1.md`. This file is now a quick-reference index of the task summaries; execute `2E-filters-search-1.md` with `superpowers:subagent-driven-development`. Do not start until Sub-plan 2D has shipped to staging with CI green.
>
> **Read first:** `00-master-roadmap.md` §2 (Gap Register — the G*/T* ids referenced below), §4 (cross-cutting rules, including the security-property requirement for auth/membership/token tasks), and the *Interfaces* blocks of the previous sub-plans — every task here consumes `withApiHandler` / `mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS` (`src/lib/api/rate-limit.ts`), `createAdminClient` (`src/lib/supabase/admin.ts`), `seedIsolationFixture` (`src/test/rls/setup.ts`) and `log` (`src/lib/log.ts`) from 2A.
>
> **Commit rule:** Conventional Commits, no AI co-author or session trailers.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2E.

**Definition of done:** every task's acceptance tests green; new tables covered by the RLS isolation suite; `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green; preview deployment on staging exercised manually; CI green on the PR.

---

## Tasks

**Task 2E.1 — Filter model + URL state (G10)**
- Files: `src/lib/filters/schema.ts` (Zod: `assignee[]`, `label[]`, `priority[]`, `due ∈ overdue|today|week|none`, `q`), `src/lib/filters/apply.ts` (`applyFilters(tasks, filters, { projectTimezone, now })` — pure; AND across dimensions, OR within; case-insensitive substring on title+description), `use-filter-state.ts` (URL search params, 250 ms debounce on `q`).
- Acceptance: table-driven unit tests incl. timezone edge (G3: 23:30 in `Asia/Kolkata` vs UTC); unknown keys ignored.

**Task 2E.2 — Filter bar, chips, search, shortcuts**
- Files: `board/filter-bar.tsx`, `search-input.tsx`, keyboard `/`, `F`, `N`, `?` (`02 §21`), empty state "No tasks match · Clear filters"; dragged-out card fades rather than vanishes.
- Acceptance: component tests; shortcuts don't fire inside inputs.

**Task 2E.3 — List view parity + inline edit (S6)**
- Files: `src/components/list/task-table.tsx` shares the board's data + filter hook; sortable columns; inline assignee/due/priority.

**Task 2E.4 — My Tasks (G5)**
- Files: `src/app/(app)/my-tasks/page.tsx`, RLS-direct query `tasks where assignee_id = auth.uid()` across projects, grouped by due state in each project's timezone; nav link.

---

---

## Verification (sub-plan exit)

See `00-master-roadmap.md` §6. Playwright flows relevant to this sub-plan are listed there; add the ones this sub-plan enables to `e2e/` when Playwright is introduced (first needed in 2B.4).
