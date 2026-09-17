# Kanbo Sub-plan 2D — Comments, mentions & labels (P1)

> **Status: expanded to step-level.** The full TDD (failing test → code → passing test → commit) plan for all four tasks below lives in `2D-comments-labels-1.md`. This file is now a quick-reference index of the task summaries; execute from `2D-comments-labels-1.md` with `superpowers:subagent-driven-development`. Do not start until Sub-plan 2C has shipped to staging with CI green.
>
> **Read first:** `00-master-roadmap.md` §2 (Gap Register — the G*/T* ids referenced below), §4 (cross-cutting rules, including the security-property requirement for auth/membership/token tasks), and the *Interfaces* blocks of the previous sub-plans — every task here consumes `withApiHandler` / `mapRpcError` (`src/lib/api/handler.ts`), `RATE_LIMITS` (`src/lib/api/rate-limit.ts`), `createAdminClient` (`src/lib/supabase/admin.ts`), `seedIsolationFixture` (`src/test/rls/setup.ts`) and `log` (`src/lib/log.ts`) from 2A.
>
> **Commit rule:** Conventional Commits, no AI co-author or session trailers.

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md` + `docs/specs/00`–`07`; `00-master-roadmap.md` §5 Sub-plan 2D.

**Definition of done:** every task's acceptance tests green; new tables covered by the RLS isolation suite; `npm run test && npm run test:rls && npm run typecheck && npm run lint && npm run build && npm run size` green; preview deployment on staging exercised manually; CI green on the PR.

---

## Tasks

**Task 2D.1 — Comments schema + RPCs**
- Files: migration `2026091110_comments.sql`: table per `04 §4.9`, `alter type activity_action add value 'commented'` (G9), RLS (read: member; insert: `can_write_project`; update: author; soft-delete: author or Owner/Admin), RPCs `create_comment`, `update_comment(expected_updated_at)`, `soft_delete_comment`, publication add `comments`.
- Security: Viewer → 403 on write (`07 §18.4`); body 1–5000 enforced in SQL and Zod.

**Task 2D.2 — Mention parsing + sanitised rendering (G7, T10)**
- Files: `src/lib/comments/mentions.ts` (`parseMentions(body): string[]`, `renderMentionsForDisplay`), `src/lib/comments/markdown.tsx` (react-markdown + rehype-sanitize schema), ESLint `no-restricted-syntax` rule banning `dangerouslySetInnerHTML`.
- Acceptance: XSS corpus (script, iframe, `javascript:` href, `onerror`) renders inert (`07 §18.7`); mention of a non-member becomes plain text; ids come from server parse, not client.

**Task 2D.3 — Comment thread UI + mention autocomplete**
- Files: `board/comment-thread.tsx`, `mention-autocomplete.tsx` (peers list), draft preserved on failure (`01 §22`), realtime append.
- Acceptance: component tests; E2E two-browser comment appears live.

**Task 2D.4 — Labels**
- Files: migration `labels`, `task_labels` per `04 §4.8` + RLS + RPCs `set_task_labels(p_task_id, p_label_ids uuid[])` (activity `updated`); routes `GET/POST /projects/:id/labels`, `PATCH/DELETE /labels/:id`; `label-picker.tsx`, chips on cards (name text always shown — no colour-only), Settings → Labels tab.
- Acceptance: duplicate name → 409; colour regex; delete removes associations; RLS isolation.

---

---

## Verification (sub-plan exit)

See `00-master-roadmap.md` §6. Playwright flows relevant to this sub-plan are listed there; add the ones this sub-plan enables to `e2e/` when Playwright is introduced (first needed in 2B.4).
