# 05 — API Specification

**Product:** Kanbo
**Base URL:** `https://{host}/api/v1`
**Depends on:** `01_prd.md`, `03_system_design.md`, `04_database_design.md`

---

## 1. Scope Note

Per the hybrid architecture in `03 §1`, **reads and realtime subscriptions go directly from the browser to Postgres through the Supabase client, protected by RLS.** This API covers everything that carries business logic: mutations, aggregation, invitations and notifications.

The rule a developer needs to remember: *if the operation writes an activity row, it goes through this API.*

Read endpoints are still specified below, because non-browser clients (a future mobile app, a CLI, integration tests) need them, and because relying on a client library for reads is a deployment detail, not a contract.

---

## 2. Conventions

| Aspect | Convention |
|---|---|
| Naming | Plural, kebab-case paths; camelCase JSON bodies |
| IDs | UUIDv7, string |
| Dates | ISO-8601 UTC (`2026-09-08T14:30:00Z`); `dueDate` is a plain date (`2026-09-12`) |
| Versioning | URL path `/v1`. Breaking changes ship as `/v2`; additive changes never bump |
| Auth | `Authorization: Bearer <jwt>`, or the session cookie for same-origin browser calls |
| Content type | `application/json` |
| Pagination | Cursor-based; `?limit=&cursor=` |
| Idempotency | `Idempotency-Key` header on POST |
| Correlation | `X-Request-Id` echoed on every response |

### Error envelope

Every non-2xx response, without exception:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Task title is required",
    "details": [{ "field": "title", "issue": "required" }],
    "requestId": "01J8X2K9P3Q4R5S6T7"
  }
}
```

| Code | HTTP | Meaning |
|---|:--:|---|
| `VALIDATION_ERROR` | 422 | Payload failed schema validation |
| `UNAUTHENTICATED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Authenticated but insufficient role |
| `NOT_FOUND` | 404 | Absent, or present but invisible to this user |
| `CONFLICT` | 409 | Uniqueness or optimistic-concurrency failure |
| `GONE` | 410 | Expired invitation |
| `RATE_LIMITED` | 429 | Throttled; `Retry-After` present |
| `INTERNAL_ERROR` | 500 | Unexpected; details never exposed |

**404 vs 403.** A user with no membership on a project receives **404, not 403**, for that project's resources. A 403 confirms the resource exists, which leaks the existence of private projects to anyone probing IDs.

### Pagination

```json
{ "data": [ ... ], "pagination": { "nextCursor": "01J8X...", "hasMore": true } }
```

Cursor over `(created_at, id)`. Offset pagination is not used — it skips or duplicates rows when the underlying set changes mid-scroll, which on an active board it constantly does.

### Rate limits

| Group | Limit | Key |
|---|---|---|
| Auth (`/auth/*`) | 5 / 15 min | IP + email |
| Password reset | 3 / hour | Email |
| Invitations | 20 / hour | User |
| Writes | 100 / min | User |
| Reads | 300 / min | User |
| Analytics | 30 / min | User |

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### Idempotency

All POST endpoints accept `Idempotency-Key`. The key and its response are cached for 24h; a replay returns the original response rather than creating a second resource. Required for task creation and invitations, where a double-tap on mobile is routine.

### Optimistic concurrency

Task and comment updates accept `expectedUpdatedAt`. If the stored value differs, the API returns 409 with the current entity so the client can present a conflict rather than silently overwriting a teammate.

---

## 3. Authentication

Handled by Supabase Auth (GoTrue) at `/auth/v1/*`. Documented for completeness; not reimplemented.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/signup` | email, password, displayName → session |
| POST | `/auth/login` | → session |
| POST | `/auth/logout` | Revoke refresh token |
| POST | `/auth/refresh` | Rotate tokens |
| POST | `/auth/forgot-password` | Always 200 regardless of account existence |
| POST | `/auth/reset-password` | token + newPassword |
| GET | `/auth/oauth/google` | OAuth redirect |

**Enumeration rule:** login failure and password reset return identical responses whether or not the account exists.

---

## 4. Users

### `GET /users/me`
Auth required. Returns the profile plus notification preferences.

```json
{
  "id": "01J8X...", "email": "a@example.com", "displayName": "Aditi R",
  "avatarUrl": null, "timezone": "Asia/Kolkata", "createdAt": "2026-08-01T10:00:00Z"
}
```

### `PATCH /users/me`
Body: `displayName?` (1–80), `avatarUrl?` (https URL), `timezone?` (IANA). → 200 · 422.

### `GET /users/me/notification-preferences` · `PUT /users/me/notification-preferences`
Body: `{ "preferences": [{ "category": "assignment", "inApp": true, "email": false }] }`.
Categories: `assignment`, `mention`, `comment`, `due_soon`, `weekly_digest`. → 200 · 422.

### `DELETE /users/me`
Requires `{ "confirmation": "<email>" }`. Fails 409 if the user owns any project (`01 §BR-1`). Anonymises PII, retains activity with `actorId: null`.

---

## 5. Projects

### `POST /projects`
Auth. Idempotency-Key recommended.
Body: `name` (1–120, required), `description?` (≤2000), `timezone?`.
Processing: single transaction creating project + owner membership + three default columns (To Do, In Progress with `isInProgressColumn`, Done with `isDoneColumn`) + activity.
→ **201**

```json
{
  "id": "01J8X...", "name": "Kanbo MVP", "description": null,
  "ownerId": "01J8W...", "timezone": "Asia/Kolkata", "isArchived": false,
  "role": "owner",
  "columns": [
    { "id": "01J8Y...", "name": "To Do", "position": 1, "isDoneColumn": false },
    { "id": "01J8Z...", "name": "In Progress", "position": 2, "isInProgressColumn": true },
    { "id": "01J90...", "name": "Done", "position": 3, "isDoneColumn": true }
  ],
  "createdAt": "2026-09-08T09:00:00Z"
}
```
Errors: 401 · 422.

### `GET /projects`
Query: `limit` (1–50, default 20), `cursor`, `includeArchived` (default false).
Returns only projects where the caller has a membership. Each item includes `role`, `memberCount`, `openTaskCount`, `lastActivityAt`.

### `GET /projects/:id`
Member. → 200 with project, columns, members. → 404 if not a member.

### `PATCH /projects/:id`
Owner/Admin. Body: `name?`, `description?`, `timezone?`, `isArchived?`. → 200 · 403 · 404.

### `DELETE /projects/:id`
**Owner only.** Body: `{ "confirmation": "<exact project name>" }`. Cascading soft delete of all descendants in one transaction. → 204 · 403 · 422.

### `POST /projects/:id/transfer-ownership`
Owner only. Body: `{ "newOwnerId": "..." }`. Target must be an existing member. Transaction: old owner → `admin`, new owner → `owner`, `projects.owner_id` updated, activity written. → 200 · 403 · 422.

---

## 6. Memberships and Invitations

### `GET /projects/:id/members`
Member. Returns members with `userId`, `displayName`, `avatarUrl`, `role`, `joinedAt`, plus `pendingInvitations` (Owner/Admin only — Members do not need to see who was invited and declined).

### `POST /projects/:id/invitations`
Owner/Admin. Idempotency-Key recommended.
Body: `email` (required), `role` ∈ {admin, member, viewer}.
Validation: cannot invite an existing member (409); cannot grant a role ≥ your own (403); re-inviting a pending email is idempotent (200, resends).
Processing: generate a 32-byte random token → store **SHA-256 hash only** → send email with the plaintext token → activity.
→ **201** `{ "id", "email", "role", "expiresAt", "status": "pending" }`
Errors: 403 · 409 · 422 · 429.

### `DELETE /projects/:id/invitations/:invitationId`
Owner/Admin. Revokes a pending invitation. → 204.

### `POST /invitations/:token/accept`
Auth required. Validates hash, expiry and `accepted_at IS NULL`. The invitation email must match the authenticated user's **verified** email — otherwise 403, preventing invitation hijacking by anyone who obtains the link.
Transaction: create membership → set `accepted_at` → activity.
→ 200 `{ "projectId", "role" }` · 403 · 410 (expired/used).

### `POST /invitations/:token/decline` → 204.

### `PATCH /projects/:id/members/:userId`
Owner/Admin. Body: `{ "role": "admin" }`.
Rules: cannot change an Owner's role (use transfer); Admins cannot create Admins-or-above; cannot demote the last Owner. → 200 · 403 · 422.

### `DELETE /projects/:id/members/:userId`
Owner/Admin, or self (leave). Cannot remove the Owner. Transaction: delete membership → unassign their open tasks → activity. → 204 · 403 · 422.

---

## 7. Columns

### `POST /projects/:id/columns`
Member+. Body: `name` (1–60), `position?` (defaults to end), `wipLimit?`, `isDoneColumn?`, `isInProgressColumn?`.
Setting `isDoneColumn: true` clears the flag on the previous done-column in the same transaction (only one per project). → 201 · 403 · 422.

### `PATCH /columns/:id`
Member+. Body: `name?`, `position?`, `wipLimit?`, `isDoneColumn?`, `isInProgressColumn?`. → 200.

### `DELETE /columns/:id`
Member+. Body: `{ "taskDisposition": "move" | "delete", "targetColumnId"? }`.
`move` requires `targetColumnId` in the same project. Never cascades silently. → 204 · 422.

---

## 8. Tasks

### `GET /projects/:id/tasks`
Member. Query: `columnId`, `assigneeId` (repeatable), `labelId` (repeatable), `priority` (repeatable), `dueState` ∈ `overdue|today|week|none`, `q` (search, ≥2 chars), `includeDeleted` (Owner/Admin only), `limit`, `cursor`.
Filters compose AND across dimensions, OR within a dimension. Default sort `(column position, task position)`; List view may pass `sort`.

```json
{
  "data": [{
    "id": "01J91...", "projectId": "01J8X...", "columnId": "01J8Y...",
    "title": "Implement drag and drop", "description": "Using dnd-kit",
    "assignee": { "id": "01J8W...", "displayName": "Rahul", "avatarUrl": null },
    "dueDate": "2026-09-15", "priority": "high", "position": 2.5,
    "labels": [{ "id": "01J92...", "name": "frontend", "color": "#3B82F6" }],
    "subtaskProgress": { "completed": 2, "total": 5 },
    "commentCount": 3,
    "createdAt": "2026-09-08T09:15:00Z", "updatedAt": "2026-09-08T11:00:00Z"
  }],
  "pagination": { "nextCursor": null, "hasMore": false }
}
```

### `POST /projects/:id/tasks`
Member+. Idempotency-Key recommended.
Body: `title` (1–200, required), `columnId` (required), `description?`, `assigneeId?`, `dueDate?`, `priority?`, `labelIds?`, `position?`, `mutationId?`.
Validation: column belongs to this project; assignee is a current member; unknown `labelIds` rejected. Past `dueDate` allowed (`01 §23`).
Processing: compute position if absent → transaction (insert task → link labels → activity) → enqueue assignment notification.
→ 201 · 403 · 422.

### `GET /tasks/:id`
Member. Returns the full task with subtasks, comments (first page), labels and recent activity. → 200 · 404.

### `PATCH /tasks/:id`
Member+. Body: any of `title`, `description`, `assigneeId` (null to unassign), `dueDate` (null to clear), `priority`, `labelIds`, `expectedUpdatedAt`.
`expectedUpdatedAt` mismatch → 409 with the current entity. → 200 · 403 · 409 · 422.

### `PATCH /tasks/:id/position` — the hot path
Member+.
Body: `{ "columnId": "...", "position": 2.5, "mutationId": "..." }`.
Validation: target column in the same project and not deleted; `position` finite.
Processing: transaction — update task → insert activity (`moved`, with `fromColumn`/`toColumn`; `completed` if the target has `isDoneColumn`, `reopened` if moving out of one) → commit → realtime broadcast carrying `mutationId`.
Precision guard: if the submitted position is indistinguishable from a neighbour, the server renormalises the column and returns canonical positions for every affected task.

```json
{
  "id": "01J91...", "columnId": "01J8Z...", "position": 2.5,
  "updatedAt": "2026-09-08T12:00:00Z",
  "renormalized": false,
  "affectedTasks": []
}
```
Errors: 403 · 404 (column) · 422.

### `DELETE /tasks/:id` — soft delete. → 204.
### `POST /tasks/:id/restore` — within retention. → 200 · 410 if purged.

### Subtasks
`POST /tasks/:id/subtasks` — `title`, `position?` → 201
`PATCH /subtasks/:id` — `title?`, `isCompleted?`, `position?` → 200
`DELETE /subtasks/:id` → 204

---

## 9. Labels

`GET /projects/:id/labels` → 200 · Member
`POST /projects/:id/labels` — `name` (1–40), `color` (`#RRGGBB`) → 201 · 409 on duplicate name
`PATCH /labels/:id` → 200 · `DELETE /labels/:id` → 204 (removes all task associations)

---

## 10. Comments

### `GET /tasks/:id/comments`
Member. Cursor-paginated, oldest first.

### `POST /tasks/:id/comments`
Member+ (**Viewers receive 403**). Body: `body` (1–5000), `mentionedUserIds?`.
Mentions are validated against project membership; non-members are dropped and rendered as plain text, with no notification. Body is stored as raw markdown and sanitised at render.
→ 201 · 403 · 422.

### `PATCH /comments/:id` — author only, `expectedUpdatedAt` supported → 200 · 403 · 409
### `DELETE /comments/:id` — author, or Owner/Admin. Soft delete → 204

---

## 11. Activity

### `GET /projects/:id/activity`
Member. Query: `actorId`, `action`, `taskId`, `from`, `to`, `limit`, `cursor`.

```json
{
  "data": [{
    "id": "01J93...",
    "actor": { "id": "01J8W...", "displayName": "Rahul" },
    "action": "moved", "entityType": "task", "entityId": "01J91...",
    "taskTitle": "Implement drag and drop",
    "fromValue": { "columnName": "To Do" },
    "toValue": { "columnName": "In Progress" },
    "createdAt": "2026-09-08T12:00:00Z"
  }],
  "pagination": { "nextCursor": "01J93...", "hasMore": true }
}
```

**No POST, PATCH or DELETE exists for activity.** The log is append-only and written only inside mutation transactions (`04 §4.10`).

---

## 12. Analytics

All endpoints: Member+ (Viewers included — read-only visibility is the point of the role). Cached 5 minutes. Every aggregate response carries `sampleSize`, so the UI can show it (`02 §S4`).

### `GET /projects/:id/analytics/summary`
Query: `from`, `to` (default last 12 weeks).

```json
{
  "range": { "from": "2026-06-16", "to": "2026-09-08" },
  "completedCount": 84, "createdCount": 97,
  "medianCycleTimeDays": 3.2, "cycleTimeSampleSize": 41,
  "overdueRate": 0.12, "openTaskCount": 23
}
```

### `GET /projects/:id/analytics/throughput`
Query: `from`, `to`, `interval` ∈ `week|day` (default week).
Counts `completed` activity events grouped by ISO week.
`{ "data": [{ "periodStart": "2026-08-31", "completedCount": 12 }] }`

### `GET /projects/:id/analytics/cycle-time`
Per task: first transition into an `isInProgressColumn` → most recent `completed` event. Reports **median** with p25/p75, plus `sampleSize`. Buckets with fewer than 3 tasks return `null` rather than a misleading point.
`{ "data": [{ "periodStart": "2026-08-31", "medianDays": 3.1, "p25": 1.4, "p75": 6.0, "sampleSize": 12 }] }`

### `GET /projects/:id/analytics/cumulative-flow`
Reads `board_snapshots`. Dates with no snapshot are returned with `"taskCounts": null` — an explicit gap, **never interpolated** (`01 §FR-10`).
`{ "data": [{ "date": "2026-09-07", "taskCounts": { "01J8Y...": 8, "01J8Z...": 4, "01J90...": 31 } }], "columns": [...] }`

### `GET /projects/:id/analytics/workload`
Open (non-done, non-deleted) tasks grouped by assignee, with overdue counts and an `unassigned` bucket.

### `GET /projects/:id/summary/weekly`
Query: `weekOf?` (ISO date, defaults to the current week).
The **deterministic** digest. Fixed template, values from SQL aggregation. No language model is involved (`01 §FR-9`).

```json
{
  "weekOf": "2026-09-01",
  "completed": { "count": 12, "tasks": [{ "id": "...", "title": "..." }] },
  "created": { "count": 15 },
  "wentOverdue": { "count": 3, "tasks": [...] },
  "dueNextWeek": { "count": 8, "tasks": [...] },
  "byMember": [{ "userId": "...", "displayName": "Rahul", "completedCount": 5 }],
  "isQuietWeek": false
}
```

---

## 13. Notifications

`GET /notifications` — query `unreadOnly`, `limit`, `cursor` → 200
`POST /notifications/:id/read` → 204
`POST /notifications/read-all` — optional `projectId` scope → 204
`GET /notifications/unread-count` → `{ "count": 7 }` (cached 30s)

---

## 14. Admin

No cross-tenant admin surface exists in MVP. There is no endpoint through which any user can read another project's data. Operational tasks run through direct database access with the service role, audited separately. This is a deliberate reduction of attack surface — an admin API is the highest-value target in any multi-tenant system, and this product does not yet need one.

---

## 15. Not in MVP

`POST /tasks/:id/attachments` (presigned upload), `POST /projects/:id/share-links`, `GET /projects/:id/export`, and any `/ai/*` endpoint. The AI namespace is reserved and specified in shape only (`03 §9`): it would return **proposals for user confirmation**, never perform writes.

---

## 16. Frontend Coverage Check

Every screen in `02` has backing endpoints:

| Screen | Endpoints |
|---|---|
| Project list | `GET /projects` |
| Board | direct read + `POST/PATCH/DELETE /tasks`, `/tasks/:id/position`, `/columns` |
| Task modal | `GET/PATCH /tasks/:id`, `/subtasks`, `/comments`, `/labels` |
| Analytics | `/analytics/*`, `/summary/weekly` |
| Activity | `GET /projects/:id/activity` |
| Settings | `/projects/:id`, `/members`, `/invitations`, `/columns` |
| My Tasks | `GET /projects/:id/tasks?assigneeId=me` across memberships |
| Notifications | `/notifications/*` |
| Invitation acceptance | `/invitations/:token/accept` |
| Account settings | `/users/me`, `/users/me/notification-preferences` |

No orphan endpoints. No unsupported screens.
