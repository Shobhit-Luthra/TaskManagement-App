# 04 — Database Design

**Product:** Kanbo
**Depends on:** `01_prd.md`, `03_system_design.md`

---

## 1. Database Technology Recommendation

**PostgreSQL 16**, managed by Supabase.

**Why relational and not a document store.** This domain is relationships: users↔projects (many-to-many with attributes), projects→columns→tasks, tasks→comments, tasks↔labels. The analytics requirements are aggregate queries across those joins. A document database would force either denormalisation with update anomalies, or client-side joins.

**Why Postgres specifically:**

| Capability | Why this project needs it |
|---|---|
| Row Level Security | The authorization boundary for direct client reads (`03 §7`) |
| Real ACID transactions | Mutation + activity insert must be atomic (`01 §FR-8`) |
| `pg_cron` | Snapshots and purges without extra infrastructure |
| Window functions / CTEs | Cycle time and cumulative flow are window queries |
| `pg_trgm` | Substring search on task titles without a search engine |
| Logical replication | Powers the realtime layer |
| Partial and composite indexes | Board queries filter on `deleted_at IS NULL` constantly |

---

## 2. Entities

`users` · `projects` · `memberships` · `invitations` · `columns` · `tasks` · `subtasks` · `labels` · `task_labels` · `comments` · `activity` · `board_snapshots` · `notifications` · `notification_queue` · `notification_preferences`

Fifteen tables. Each earns its place.

---

## 3. Conventions

- **Primary keys:** `UUID` (v7 — time-ordered, so index locality is preserved unlike v4). Never sequential integers: enumerable IDs leak volume and invite IDOR probing.
- **Timestamps:** `TIMESTAMPTZ`, always UTC. Rendering timezone is a client concern.
- **Audit fields:** every mutable table carries `created_at`, `updated_at`, and where meaningful `created_by`.
- **Soft delete:** `deleted_at TIMESTAMPTZ NULL`. Non-null means deleted. Every application query filters `deleted_at IS NULL`; partial indexes make that free.
- **Naming:** snake_case, plural tables, singular columns, FKs as `<entity>_id`.

---

## 4. Table Specifications

### 4.1 `users`

Mirrors `auth.users`, holding application-level profile data. Auth credentials stay in the auth schema and are never duplicated here.

| Column | Type | Null | Default | Key | Index | Description |
|---|---|:--:|---|---|---|---|
| `id` | uuid | ✗ | — | PK, FK→`auth.users.id` | — | Matches the auth identity |
| `email` | citext | ✗ | — | — | UNIQUE | Case-insensitive; `a@x.com` = `A@x.com` |
| `display_name` | varchar(80) | ✗ | — | — | — | Shown on cards and comments |
| `avatar_url` | text | ✓ | NULL | — | — | External or storage URL |
| `timezone` | varchar(64) | ✗ | `'UTC'` | — | — | IANA name; used for digest scheduling |
| `created_at` | timestamptz | ✗ | `now()` | — | — | |
| `updated_at` | timestamptz | ✗ | `now()` | — | — | Trigger-maintained |
| `deleted_at` | timestamptz | ✓ | NULL | — | partial | Soft delete |

**Constraints:** `display_name` non-blank after trim; `timezone` validated against `pg_timezone_names`.

### 4.2 `projects`

| Column | Type | Null | Default | Key | Index | Description |
|---|---|:--:|---|---|---|---|
| `id` | uuid | ✗ | `uuidv7()` | PK | — | |
| `name` | varchar(120) | ✗ | — | — | — | |
| `description` | text | ✓ | NULL | — | — | |
| `owner_id` | uuid | ✗ | — | FK→`users.id` | ✓ | Denormalised for fast ownership checks |
| `timezone` | varchar(64) | ✗ | `'UTC'` | — | — | Digest scheduling |
| `is_archived` | boolean | ✗ | `false` | — | — | Read-only, not deleted |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | | | | partial | |

**Intentional denormalisation:** `owner_id` duplicates what `memberships.role='owner'` already expresses. Justified because ownership is checked on nearly every authorization path, and the join is avoidable. **Consistency risk:** the two can diverge. Mitigation — ownership changes only ever happen through a single `transfer_ownership` service that updates both inside one transaction, plus a nightly consistency check.

**ON DELETE:** `owner_id` is `ON DELETE RESTRICT`. A user with projects cannot be deleted until ownership is transferred (`01 §BR-1`).

### 4.3 `memberships`

The join table making users↔projects many-to-many, carrying `role` as the relationship attribute.

| Column | Type | Null | Default | Key | Index | Description |
|---|---|:--:|---|---|---|---|
| `id` | uuid | ✗ | `uuidv7()` | PK | — | |
| `project_id` | uuid | ✗ | — | FK→`projects.id` CASCADE | composite | |
| `user_id` | uuid | ✗ | — | FK→`users.id` CASCADE | composite | |
| `role` | membership_role | ✗ | `'member'` | — | — | ENUM: owner, admin, member, viewer |
| `created_at` | timestamptz | ✗ | `now()` | — | — | |
| `updated_at` | timestamptz | ✗ | `now()` | — | — | |

**Unique constraint:** `UNIQUE (project_id, user_id)` — a user holds exactly one role per project. This single constraint is what prevents an entire class of duplicate-invite and privilege-confusion bugs.

**Partial unique index:** `UNIQUE (project_id) WHERE role = 'owner'` — enforces BR-1 (exactly one owner) at the database level rather than trusting application code.

**No soft delete.** Removing a member must revoke access immediately; a soft-deleted membership row risks an RLS policy forgetting the filter.

### 4.4 `invitations`

| Column | Type | Null | Default | Key | Index | Description |
|---|---|:--:|---|---|---|---|
| `id` | uuid | ✗ | `uuidv7()` | PK | — | |
| `project_id` | uuid | ✗ | — | FK CASCADE | ✓ | |
| `email` | citext | ✗ | — | — | composite | Invitee |
| `role` | membership_role | ✗ | `'member'` | — | — | Role to grant |
| `token_hash` | text | ✗ | — | — | UNIQUE | **SHA-256 of the token, not the token.** A DB leak must not yield usable invitations |
| `invited_by` | uuid | ✗ | — | FK→`users.id` | — | |
| `expires_at` | timestamptz | ✗ | `now() + 7d` | — | ✓ | |
| `accepted_at` | timestamptz | ✓ | NULL | — | — | Non-null = consumed, single-use |
| `created_at` | timestamptz | ✗ | `now()` | — | — | |

**Partial unique index:** `UNIQUE (project_id, email) WHERE accepted_at IS NULL` — resending is idempotent instead of producing duplicate rows.

### 4.5 `columns`

| Column | Type | Null | Default | Key | Index | Description |
|---|---|:--:|---|---|---|---|
| `id` | uuid | ✗ | `uuidv7()` | PK | — | |
| `project_id` | uuid | ✗ | — | FK CASCADE | composite | |
| `name` | varchar(60) | ✗ | — | — | — | |
| `position` | double precision | ✗ | — | — | composite | Fractional index |
| `wip_limit` | smallint | ✓ | NULL | — | — | Soft warning only, not enforced |
| `is_done_column` | boolean | ✗ | `false` | — | — | **Drives all completion analytics** |
| `is_in_progress_column` | boolean | ✗ | `false` | — | — | Cycle-time start marker |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | | | | partial | |

**Design note.** Completion is a property of *where the card is*, not a boolean on the task (`01 §BR-6`). A `task.is_done` flag inevitably drifts from the visible board, and then analytics and the board tell different stories. Deriving from column position means they cannot disagree.

**Constraint:** at most one `is_done_column = true` per project, enforced by a partial unique index.

### 4.6 `tasks`

| Column | Type | Null | Default | Key | Index | Description |
|---|---|:--:|---|---|---|---|
| `id` | uuid | ✗ | `uuidv7()` | PK | — | |
| `project_id` | uuid | ✗ | — | FK CASCADE | ✓ | **Denormalised** — see below |
| `column_id` | uuid | ✗ | — | FK RESTRICT | composite | |
| `title` | varchar(200) | ✗ | — | — | trigram | |
| `description` | text | ✓ | NULL | — | trigram | Markdown source, ≤20 000 chars |
| `assignee_id` | uuid | ✓ | NULL | FK→`users.id` SET NULL | ✓ | |
| `due_date` | date | ✓ | NULL | — | partial | Date, not timestamp — "due Friday" has no meaningful time |
| `priority` | task_priority | ✗ | `'medium'` | — | — | ENUM: low, medium, high, urgent |
| `position` | double precision | ✗ | — | — | composite | Fractional index |
| `mutation_id` | uuid | ✓ | NULL | — | — | Realtime echo suppression (`03 §3`) |
| `created_by` | uuid | ✗ | — | FK→`users.id` | — | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | | | | partial | |

**Intentional denormalisation — `project_id`.** It is reachable via `column_id → columns.project_id`. Duplicating it is justified on two grounds: every RLS policy on `tasks` would otherwise require a join to `columns` on *every row read*, and realtime subscriptions filter on `project_id` directly — Supabase Realtime filters on the row's own columns and cannot traverse a foreign key.

**Consistency risk:** a task could point at a column in a different project. Mitigated by a composite foreign key — `FOREIGN KEY (column_id, project_id) REFERENCES columns(id, project_id)`, which requires a `UNIQUE (id, project_id)` on `columns`. This makes the invalid state structurally impossible rather than merely discouraged. Worth the extra index.

**`column_id` is ON DELETE RESTRICT**, not CASCADE. Deleting a column must be an explicit decision about its tasks (`01 §FR-12`), never a silent cascade.

### 4.7 `subtasks`

`id` · `task_id` (FK CASCADE) · `title` varchar(200) · `is_completed` boolean default false · `position` double precision · `created_at` · `updated_at`.

Here `is_completed` **is** a boolean, because subtasks have no columns to derive state from. Consistent reasoning, different conclusion.

### 4.8 `labels` and `task_labels`

`labels`: `id` · `project_id` (FK CASCADE) · `name` varchar(40) · `color` varchar(7) (validated `^#[0-9A-Fa-f]{6}$`) · `created_at`. **Unique:** `(project_id, name)`.

`task_labels`: `task_id` · `label_id`, composite PK `(task_id, label_id)`. Pure join table, no surrogate key, both directions indexed.

### 4.9 `comments`

`id` · `task_id` (FK CASCADE) · `author_id` (FK RESTRICT) · `body` text (1–5000) · `mentioned_user_ids` uuid[] · `created_at` · `updated_at` · `deleted_at`.

**`mentioned_user_ids` as an array** rather than a join table: mentions are only ever read alongside their comment, never queried independently. A GIN index covers the one case ("comments mentioning me") if it is ever needed. This is a deliberate, bounded denormalisation.

Soft delete preserves thread coherence — a hard-deleted comment leaves replies referring to nothing.

### 4.10 `activity` — the analytics foundation

| Column | Type | Null | Default | Index | Description |
|---|---|:--:|---|---|---|
| `id` | uuid | ✗ | `uuidv7()` | PK | Time-ordered by construction |
| `project_id` | uuid | ✗ | — | composite | |
| `actor_id` | uuid | ✓ | — | ✓ | Nullable: system actions have no actor |
| `task_id` | uuid | ✓ | NULL | composite | |
| `entity_type` | varchar(20) | ✗ | — | — | task, column, membership, comment, project |
| `entity_id` | uuid | ✗ | — | — | |
| `action` | activity_action | ✗ | — | composite | ENUM: created, updated, moved, assigned, unassigned, completed, reopened, commented, deleted, restored, member_added, member_removed, role_changed |
| `from_value` | jsonb | ✓ | NULL | — | Previous state fragment |
| `to_value` | jsonb | ✓ | NULL | — | New state fragment |
| `created_at` | timestamptz | ✗ | `now()` | composite | |

**Append-only.** No UPDATE, no DELETE from application code; enforced by RLS granting only INSERT and SELECT. If the activity log can be rewritten, the audit trail and every analytic derived from it are worthless.

**`actor_id` is ON DELETE SET NULL, not CASCADE.** Deleting a user must never erase project history.

**Growth:** the only unbounded table alongside `board_snapshots`. Partition by month (`RANGE` on `created_at`) once it passes ~10M rows.

### 4.11 `board_snapshots` — irreplaceable history

| Column | Type | Null | Index | Description |
|---|---|:--:|---|---|
| `id` | uuid | ✗ | PK | |
| `project_id` | uuid | ✗ | composite | |
| `column_id` | uuid | ✗ | composite | |
| `snapshot_date` | date | ✗ | composite | |
| `task_count` | integer | ✗ | — | Open tasks in this column that day |
| `created_at` | timestamptz | ✗ | — | |

**Unique:** `(project_id, column_id, snapshot_date)` — this constraint is what makes the daily cron job safely idempotent. An at-least-once scheduler retrying its run cannot double-insert.

**This is the one table whose data cannot be recreated.** Cycle time and throughput are derivable from `activity` at any point in the future; the cumulative flow diagram is not. If the job does not run on a given day, that day's board shape is gone permanently. Hence the monitoring alert in `03 §16`.

### 4.12 Notification tables

`notifications` — in-app: `id` · `user_id` · `project_id` · `task_id` · `type` · `payload` jsonb · `read_at` · `created_at`. Index `(user_id, created_at DESC) WHERE read_at IS NULL`.

`notification_queue` — outbound email: `id` · `user_id` · `type` · `payload` jsonb · `send_after` · `sent_at` · `attempts` smallint · `last_error`. Index `(send_after) WHERE sent_at IS NULL`.

`notification_preferences` — `user_id` · `category` · `in_app` bool · `email` bool. PK `(user_id, category)`.

---

## 5. Relationships and Cardinality

| Parent | Child | Cardinality | On delete |
|---|---|---|---|
| users | memberships | 1:N | CASCADE |
| projects | memberships | 1:N | CASCADE |
| users ↔ projects | via memberships | M:N | — |
| projects | columns | 1:N | CASCADE |
| projects | tasks | 1:N | CASCADE |
| columns | tasks | 1:N | **RESTRICT** |
| users | tasks (assignee) | 1:N | SET NULL |
| tasks | subtasks | 1:N | CASCADE |
| tasks ↔ labels | via task_labels | M:N | CASCADE |
| tasks | comments | 1:N | CASCADE |
| projects | activity | 1:N | CASCADE |
| users | activity (actor) | 1:N | **SET NULL** |

---

## 6. ER Diagram Specification

```
users ──1:N──< memberships >──N:1── projects
  │                                    │
  │                                    ├──1:N──< columns
  │                                    │            │ (id, project_id)
  │                                    │            │ composite FK
  │                                    ├──1:N──< tasks
  │                                    │            ├──1:N──< subtasks
  │                                    │            ├──1:N──< comments
  │                                    │            └──M:N──< task_labels >── labels
  ├──1:N──< tasks (assignee, SET NULL) │
  ├──1:N──< comments (author)          ├──1:N──< activity
  └──1:N──< activity (actor, SET NULL) ├──1:N──< board_snapshots
                                        ├──1:N──< invitations
                                        └──1:N──< labels
```

---

## 7. Indexes

Every index below exists to serve a named query, not on speculation.

| Index | Table | Definition | Serves |
|---|---|---|---|
| `idx_tasks_board` | tasks | `(project_id, column_id, position) WHERE deleted_at IS NULL` | The board load. The single most important index in the system |
| `idx_tasks_assignee` | tasks | `(assignee_id, due_date) WHERE deleted_at IS NULL` | My Tasks, workload analytics |
| `idx_tasks_due` | tasks | `(project_id, due_date) WHERE due_date IS NOT NULL AND deleted_at IS NULL` | Overdue filters, due-soon scan |
| `idx_tasks_title_trgm` | tasks | GIN `(title gin_trgm_ops)` | Substring search |
| `idx_columns_board` | columns | `(project_id, position) WHERE deleted_at IS NULL` | Column ordering |
| `idx_memberships_lookup` | memberships | `(user_id, project_id)` | **Every RLS policy evaluation** — hot path |
| `idx_activity_project_time` | activity | `(project_id, created_at DESC)` | Activity feed |
| `idx_activity_analytics` | activity | `(project_id, action, created_at)` | Throughput, cycle time, digest |
| `idx_activity_task` | activity | `(task_id, created_at)` | Per-task history |
| `idx_snapshots_cfd` | board_snapshots | `(project_id, snapshot_date, column_id)` | Cumulative flow |
| `idx_comments_task` | comments | `(task_id, created_at) WHERE deleted_at IS NULL` | Comment thread |
| `idx_notifications_unread` | notifications | `(user_id, created_at DESC) WHERE read_at IS NULL` | Notification bell |
| `idx_queue_pending` | notification_queue | `(send_after) WHERE sent_at IS NULL` | Flush job |

**Note the pattern:** partial indexes on `WHERE deleted_at IS NULL`. Since every application query carries that predicate, the index stores only live rows — smaller, faster, and it excludes purged data automatically.

---

## 8. Constraints Summary

| Constraint | Table | Rule |
|---|---|---|
| CHECK | tasks | `char_length(trim(title)) BETWEEN 1 AND 200` |
| CHECK | tasks | `position` is finite (`NOT isnan` and not infinite) |
| CHECK | comments | `char_length(body) BETWEEN 1 AND 5000` |
| CHECK | labels | `color ~ '^#[0-9A-Fa-f]{6}$'` |
| CHECK | columns | `wip_limit IS NULL OR wip_limit > 0` |
| UNIQUE | memberships | `(project_id, user_id)` |
| UNIQUE partial | memberships | `(project_id) WHERE role = 'owner'` |
| UNIQUE partial | columns | `(project_id) WHERE is_done_column` |
| UNIQUE | columns | `(id, project_id)` — supports the composite FK from tasks |
| UNIQUE partial | invitations | `(project_id, email) WHERE accepted_at IS NULL` |
| UNIQUE | board_snapshots | `(project_id, column_id, snapshot_date)` |
| UNIQUE | labels | `(project_id, name)` |

---

## 9. Fractional Indexing — Specification

`position` is `double precision`, not an integer.

**Why.** With integer positions `1,2,3,4`, moving a card from the bottom to the top rewrites every row in the column. At ten concurrent users that is a lock-contention and lost-update generator. With floats, inserting between `2.0` and `3.0` writes `2.5` — **one row**.

**Placement rules:**

| Case | New position |
|---|---|
| Between two cards | `(prev + next) / 2` |
| Top of column | `first - 1.0` |
| Bottom of column | `last + 1.0` |
| Empty column | `1.0` |

**The failure mode.** IEEE-754 doubles have ~52 bits of mantissa. Repeatedly halving the same gap exhausts precision after roughly 50 consecutive inserts, at which point `(a+b)/2 == a` and two cards collide.

**Mitigations, in order:**
1. Server detects `newPosition == prev || newPosition == next` and triggers renormalisation for that column immediately.
2. Nightly `renormalize_positions` job rewrites any column whose minimum gap is below `1e-6`, reassigning `1.0, 2.0, 3.0, …` inside a transaction.
3. Ordering ties broken deterministically by `(position, id)` so a collision produces a stable — if arbitrary — order rather than a flickering one.

**Production alternative:** LexoRank-style string ranks avoid precision limits entirely. Rejected for MVP as unnecessary complexity given the mitigations above; the `position` column type is the only thing that would need to change.

---

## 10. Soft Deletion Strategy

| Table | Soft delete | Reason |
|---|---|---|
| tasks, columns, projects, comments, users | ✅ | User-recoverable; deletion is frequently a mistake |
| memberships | ❌ | Access revocation must be immediate and unambiguous |
| activity, board_snapshots | ❌ | Append-only historical record |
| subtasks, task_labels | ❌ | Trivially recreated; cascade with parent |

Retention 30 days (pending M5), then hard-deleted by `purge_soft_deleted`. Cascading soft delete on a project sets `deleted_at` on all descendants in one transaction — a project that appears deleted while its tasks still return from queries is a data-leak bug.

---

## 11. Transaction Requirements

| Operation | Must be atomic across |
|---|---|
| Create project | projects + memberships(owner) + 3 default columns + activity |
| Move task | tasks UPDATE + activity INSERT |
| Accept invitation | memberships INSERT + invitations UPDATE(accepted_at) + activity |
| Remove member | memberships DELETE + tasks UPDATE(assignee→NULL) + activity |
| Delete column | tasks reassign or soft-delete + columns UPDATE + activity |
| Transfer ownership | 2× memberships UPDATE + projects UPDATE(owner_id) + activity |
| Renormalise column | all task position UPDATEs in one statement |

Isolation level `READ COMMITTED` is sufficient throughout — no operation reads then writes based on a value that another transaction could change underneath it, with the exception of position computation, which is handled by design rather than by locking.

---

## 12. Race Conditions and Concurrency Problems

| # | Race | Consequence if unhandled | Resolution |
|---|---|---|---|
| R1 | Two users drop cards into the same gap simultaneously | Identical positions, order flickers between clients | Both writes succeed with distinct floats in almost all cases; exact ties broken by `(position, id)`; renormalisation cleans up |
| R2 | Task moved while another user is deleting its column | FK violation or orphaned task | `ON DELETE RESTRICT` + column existence re-checked inside the move transaction |
| R3 | Two users edit the same task's title concurrently | Silent lost update | Optimistic concurrency: client sends `updated_at`; mismatch returns 409 and the UI surfaces a conflict |
| R4 | Member removed while they have the board open | Continued access | RLS re-evaluates per query; realtime channel closes on membership delete |
| R5 | Snapshot cron fires twice (at-least-once delivery) | Duplicated counts, corrupted CFD | `UNIQUE (project_id, column_id, snapshot_date)` + `ON CONFLICT DO NOTHING` |
| R6 | Digest job runs twice | Duplicate emails | Idempotency key `(job_name, project_id, run_date)` |
| R7 | Invitation accepted twice (double-click, retry) | Duplicate membership | `UNIQUE (project_id, user_id)` + `accepted_at` set in the same transaction |
| R8 | Two Owners assigned during a transfer | Ambiguous authority | Partial unique index `(project_id) WHERE role='owner'` makes it impossible |
| R9 | Precision exhaustion mid-drag | Two cards at the same position | Server-side detection triggers immediate renormalisation |
| R10 | Client applies its own realtime echo | Card visibly jumps twice | `mutation_id` reconciliation (`03 §3`) |

**The pattern worth internalising:** nearly every resolution above is a *database constraint*, not application logic. Application-level checks race; constraints do not.

---

## 13. Data Validation Layers

1. **Client** — immediate feedback, UX only. Assumed bypassable.
2. **API (Zod)** — types, lengths, formats, enums. The real gate.
3. **Database** — CHECK, UNIQUE, FK, NOT NULL. The final guarantee.

Layer 3 exists because layer 2 will eventually have a bug, and because `pg_cron` jobs and manual queries bypass layer 2 entirely.

---

## 14. Data Retention

| Data | Retention |
|---|---|
| Soft-deleted rows | 30 days, then purged (M5) |
| Activity log | Indefinite — required for analytics |
| Board snapshots | Indefinite — irreplaceable |
| Sent notifications | 90 days |
| Notification queue (sent) | 7 days |
| Expired invitations | 30 days after expiry |
| Deleted user accounts | PII anonymised within 30 days; activity rows retained with `actor_id = NULL` |

---

## 15. Scalability Considerations

- `activity` and `board_snapshots` grow without bound while all other tables are bounded by team size. Partition both by month when `activity` exceeds ~10M rows.
- Analytics queries move to a materialised view refreshed nightly if p95 exceeds the 1.5s target.
- A read replica serves analytics before any sharding is considered — this workload will not need sharding.
- `uuidv7` keeps B-tree inserts append-mostly; `uuidv4` would fragment the index and progressively degrade write performance.

---

## 16. Normalisation Assessment

The schema is in **3NF** with three documented, deliberate exceptions:

| Denormalisation | Justification | Consistency guard |
|---|---|---|
| `tasks.project_id` | Avoids a join in every RLS evaluation; required for realtime filtering | Composite FK `(column_id, project_id)` makes divergence structurally impossible |
| `projects.owner_id` | Ownership is checked on nearly every authorization path | Single transactional transfer path + nightly consistency check |
| `comments.mentioned_user_ids` array | Mentions are never queried independently of their comment | GIN index available if that changes |

No unintentional normalisation violations. No repeating groups, no partial or transitive dependencies elsewhere.

---

## 17. Migration Discipline

SQL migration files, version-controlled, forward-only, one logical change per file, reviewed as code. No schema changes made through the Supabase dashboard — an undocumented production schema cannot be reproduced in staging, and every environment difference eventually becomes an incident.
