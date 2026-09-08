# 00 — Project Analysis

**Project codename:** Kanbo *(placeholder — rename freely; it appears only in docs, never hardcoded)*
**Document status:** Baseline. All later documents (01–07) assume the decisions here.
**Last updated:** 2026-09-08

---

## 1. Core Problem

Small teams (3–15 people) coordinating multi-step work currently fall into one of three bad states:

1. **Chat-driven coordination** — work items live in WhatsApp/Slack threads. No state, no ownership, no history. Things are lost by scroll.
2. **Spreadsheet-driven coordination** — state exists but is manual, has no notifications, and breaks under concurrent editing.
3. **Enterprise tooling** (Asana, Jira) — solves the problem but is priced, scoped and configured for organisations of 100+. Onboarding cost exceeds the value for a 6-person team.

The gap: **a shared, real-time, opinionated task board that a small team can adopt in under ten minutes, with enough measurement to tell them whether they are actually shipping.**

---

## 2. Target Users

| Segment | Description | Primary need |
|---|---|---|
| **Student project teams** | 4–8 members, hackathon or capstone work, no PM discipline | Visible ownership + deadlines |
| **Small startup teams** | 5–15 members, cross-functional | Shared state + throughput visibility |
| **Freelance/agency pods** | 2–6 members, multiple concurrent clients | Project isolation, client-shareable views |

**Explicit non-user:** enterprise programme managers. Portfolio management, resource allocation and cross-project dependency graphs are Non-Goals.

---

## 3. Main Use Cases

1. Create a project and invite teammates by email.
2. Create tasks, assign an owner, set a due date and priority.
3. Move tasks across workflow columns as work progresses, from any device.
4. See teammates' changes appear live without refreshing.
5. Discuss a specific task in-context via comments.
6. Filter the board to "my overdue tasks" or "everything labelled `backend`".
7. Read a weekly digest of what the team completed and what is now at risk.
8. Inspect throughput, cycle time and workload on an analytics dashboard.

---

## 4. Key Product Features

### Core (P0)
- Email/password + OAuth authentication
- Projects, with role-based membership
- Customisable columns (workflow stages)
- Tasks: title, description, assignee, due date, priority, labels
- Drag & drop reordering across and within columns
- Real-time multi-user synchronisation
- Immutable activity log

### Supporting (P1)
- Comments and @mentions
- Labels, filtering and search
- Subtasks / checklists
- In-app and email notifications
- List and calendar views
- Dark mode

### Measurement (P1)
- Weekly summary digest
- Analytics dashboard (throughput, cycle time, cumulative flow, workload, overdue rate)

### Deferred (P2)
- File attachments
- Public read-only share links
- Recurring tasks
- Timeline/Gantt view with dependencies

---

## 5. AI Components

**None. This is a deliberate product decision, not an oversight.**

Rationale:

- Every user-facing output in this product is a **fact about the team's own data** — how many tasks closed, who owns what, what is overdue. Facts must be correct, not plausible. A model that hallucinates a completion count actively destroys the trust the analytics feature exists to build.
- The "weekly summary" is therefore implemented as a **deterministic aggregate query** over the activity log, not a generated narrative.
- Consequences: zero inference cost, zero added latency, no prompt-injection attack surface, no vendor dependency, fully unit-testable outputs.

**Where AI could be reintroduced later, cleanly separated:**

| Candidate | Boundary condition |
|---|---|
| Natural-language task creation | Model output is a *proposal* pre-filled into a form the user confirms — never a direct write |
| Semantic task search | Ranking only; never fabricates results, only reorders existing rows |

Both sit strictly outside the deterministic core. Document 03 specifies the seam where they would attach.

---

## 6. Major Technical Challenges

| # | Challenge | Why it is hard | Where addressed |
|---|---|---|---|
| C1 | **Concurrent reordering** | Two users dragging into the same slot simultaneously must not corrupt ordering | 04 §Concurrency, fractional indexing |
| C2 | **Optimistic UI + rollback** | The board must respond in <16ms while the write is still in flight, and recover coherently on failure | 03 §Frontend, 02 §Micro-interactions |
| C3 | **Realtime echo** | Clients receive their own mutations back over the websocket and double-apply them | 03 §Realtime reconciliation |
| C4 | **Authorization at the data layer** | Frontend checks are advisory; a direct API call with a guessed project ID must fail | 07 §RBAC, RLS policies |
| C5 | **Historical state for CFD** | A cumulative flow diagram cannot be reconstructed retroactively | 04 §board_snapshots |
| C6 | **Notification fan-out** | Naive per-event email sends produce spam and hit rate limits | 03 §Background jobs, digest batching |
| C7 | **Mobile drag & drop** | Touch drag conflicts with scroll gestures | 02 §Mobile behaviour |

---

## 7. Missing Information

Items that require a decision from the product owner before or during development:

- **M1** — Team size ceiling for the MVP. Affects whether board queries need pagination.
- **M2** — Data residency requirement. Affects Supabase region selection and is irreversible without migration.
- **M3** — Whether guest/client (`Viewer`) accounts are in MVP or deferred.
- **M4** — Email sending domain and whether DNS (SPF/DKIM) access is available.
- **M5** — Retention policy for soft-deleted data.
- **M6** — Whether this is a portfolio project or intended for real users, which changes the bar for O11y and DR.

---

## 8. Assumptions Requiring Validation

Labelled per the master brief. Each is a decision made in the absence of information, not a requirement supplied by the user.

| ID | Assumption | Impact if wrong |
|---|---|---|
| A1 | Projects contain <500 active tasks | Board loads fully; above this, virtualisation is required |
| A2 | Teams are <25 members | Membership dropdowns render unpaginated |
| A3 | Realtime concurrency <10 simultaneous viewers per board | Supabase Realtime free tier is sufficient |
| A4 | Users are on evergreen browsers | No polyfills, no IE support |
| A5 | English-only UI at launch | No i18n framework in MVP; copy is still externalised to allow it later |
| A6 | Single organisation per user account is not required — users may belong to many projects directly | No tenant/org entity in the schema |
| A7 | Attachments are not required for MVP | No storage bucket provisioned initially |
| A8 | Free-tier hosting is acceptable | Cold starts and connection limits are tolerated |

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Scope creep toward Asana parity | High | P0/P1/P2 tiers are contractual; P2 requires explicit re-scoping |
| Fractional-index precision exhaustion | Medium | Renormalisation job at ~50 inserts per gap (04 §Concurrency) |
| RLS misconfiguration exposing data | Critical | Policy test suite; deny-by-default; 07 §Acceptance criteria |
| Analytics starting empty on launch day | Medium | Snapshot job ships *before* the dashboard |
| Vendor lock-in to Supabase | Medium | Business logic stays in Route Handlers, not in Postgres functions, so the data layer is portable |

---

## 10. Out of Scope (Non-Goals)

Stated explicitly so they are not silently reintroduced:

- Time tracking and billing
- Portfolio / cross-project rollups
- Custom fields and custom workflows per project
- Native mobile applications (the web app is responsive; that is the whole mobile story)
- Third-party integrations (Slack, GitHub, Google Calendar)
- Multi-language support
- Payments and subscription billing
