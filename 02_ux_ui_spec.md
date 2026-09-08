# 02 — UX / UI Specification

**Product:** Kanbo
**Depends on:** `01_prd.md`

---

## 1. Information Architecture

Three levels, no deeper. Depth is the enemy of adoption.

```
Account
└── Projects (list)
    └── Project
        ├── Board      (default)
        ├── List
        ├── Analytics
        ├── Activity
        └── Settings   (Owner/Admin)
```

Task detail is a **modal over the board**, not a route change in appearance — but it *is* URL-addressable (`/p/:id/board?task=:taskId`) so tasks are linkable and the back button closes the modal. This is the standard pattern and users expect it.

---

## 2. Sitemap

| Route | Screen | Auth |
|---|---|---|
| `/` | Landing | Public |
| `/login` | Sign in | Public |
| `/signup` | Sign up | Public |
| `/forgot-password`, `/reset-password` | Password recovery | Public |
| `/invite/:token` | Invitation acceptance | Public → auth |
| `/projects` | Project list | Required |
| `/p/:projectId/board` | Board | Member |
| `/p/:projectId/list` | List view | Member |
| `/p/:projectId/analytics` | Analytics | Member |
| `/p/:projectId/activity` | Activity feed | Member |
| `/p/:projectId/settings` | Project settings | Owner/Admin |
| `/me/tasks` | My Tasks (cross-project) | Required |
| `/me/settings` | Account & notifications | Required |
| `/404`, `/403` | Error pages | Any |

---

## 3. Navigation Structure

**Desktop:** persistent left sidebar (project switcher, My Tasks, account) + top bar within a project (view tabs, filters, search, member avatars, notification bell, invite button).

**Mobile:** bottom tab bar (Board · My Tasks · Notifications · Account). Project switcher moves into a slide-over drawer. View tabs become a segmented control under the header.

---

## 4. Screen Inventory

Landing · Sign up · Sign in · Password recovery · Invitation acceptance · Project list · Board · Task detail modal · List view · Analytics · Activity feed · Project settings · My Tasks · Account settings · Notification centre · 403 · 404.

Seventeen screens. Nothing else is invented.

---

## 5. Screen-by-Screen Requirements

### S1 — Board *(the product)*

- **Purpose:** View and manipulate all project work.
- **Entry points:** Project list, invitation redirect, notification deep link, direct URL.
- **User type:** Owner, Admin, Member (full); Viewer (read-only).
- **Layout:** Horizontally scrolling flex row of fixed-width (300px) columns; each column is a vertically scrolling stack of cards with a sticky header and a sticky footer composer.
- **Components:** ProjectHeader, ViewTabs, FilterBar, SearchInput, MemberAvatarStack, Column, TaskCard, InlineComposer, AddColumnButton, RealtimePresenceIndicator, ConnectionBanner.
- **Content per card:** title (2 lines max, then ellipsis), label chips, assignee avatar, due-date badge, priority icon, subtask progress (`2/5`), comment count.
- **Actions:** create task, drag task, drag column, open task, quick-assign from card menu, edit column, filter, search, invite.
- **Navigation:** Card click → task modal. Tab switch → List/Analytics/Activity.
- **States:** loading (skeleton columns) · empty project (three default columns, first one showing a prominent composer) · empty column (dashed drop target) · filtered · offline/disconnected · read-only (Viewer).
- **Validation:** Inline composer requires non-blank title; Enter submits and keeps the composer open for rapid entry; Esc closes.
- **Error handling:** Failed move → card animates back, toast with Retry. Failed create → card persists locally with an "unsaved" marker and a retry affordance. Never silently discard user input.
- **Responsive:** ≥1024px multi-column with horizontal scroll · 768–1023px narrower columns (260px) · <768px single column at a time with a swipeable column pager and a position indicator.

### S2 — Task Detail Modal

- **Purpose:** Full editing and discussion for one task.
- **Entry:** Card click, deep link, notification.
- **Layout:** Two-pane on desktop (left: title, description, subtasks, comments; right: metadata sidebar — status/column, assignee, due date, priority, labels, created/updated). Single scrolling column on mobile, full-screen sheet.
- **Components:** InlineEditableTitle, MarkdownEditor, SubtaskList, CommentThread, MentionAutocomplete, AssigneePicker, DatePicker, PriorityPicker, LabelPicker, ActivityMiniFeed, DeleteButton.
- **Actions:** edit any field (auto-save on blur, debounced 500ms), add subtask, comment, mention, delete (confirm dialog), copy link.
- **States:** loading · saving (subtle inline indicator, not a blocking spinner) · saved · conflict (remote edit while you were typing) · deleted-remotely (modal shows "This task was deleted" and offers Close).
- **Validation:** title non-blank (reverts to previous on blank blur); description ≤20 000 chars; comment 1–5000.
- **Error handling:** Save failure keeps the field editable and dirty; the user never loses typed text.
- **Responsive:** desktop centred modal max-width 900px; mobile full-screen sheet with a sticky close button.

### S3 — Project List

- **Purpose:** Choose or create a project.
- **Layout:** Card grid, each showing name, member avatars, open task count, last activity.
- **States:** loading skeleton · empty ("Create your first project" with a single-field form — name only, nothing else, because J1 is a ten-minute promise) · populated.
- **Actions:** open, create, archive (Owner/Admin), leave.

### S4 — Analytics

- **Purpose:** Answer "are we improving?"
- **Layout:** Date-range selector (default last 12 weeks) → four stat tiles (completed, median cycle time, overdue rate, active tasks) → charts stacked: Throughput (bar), Cycle time trend (line), Cumulative flow (stacked area), Workload (horizontal bar).
- **Content rule:** every aggregate shows its **sample size** next to it (`median 3.2d · n=41`). A median over four tasks is not a trend, and the UI must not pretend otherwise.
- **States:** loading (skeleton charts) · insufficient data (<2 weeks → explanatory card, not an empty chart) · snapshot gaps (CFD renders a visible break, never interpolates) · error per chart, page still usable.

### S5 — Weekly Summary Panel

Rendered on the Board and Analytics screens. Sections: Completed this week (count + list), Created, Went overdue, Due next week, Per-member completions. Fixed template, values from SQL. Empty week shows a short "quiet week" variant.

### S6 — List View

Table: title, assignee, column, due date, priority, labels. Sortable columns, same filters as board, inline editing of assignee/due/priority. Rows are the same data source as the board — one query, two renderers.

### S7 — Activity Feed

Reverse-chronological, day-grouped. Each entry: actor avatar, human-readable sentence, relative timestamp, deep link. Filterable by actor and action type. Infinite scroll, cursor-paginated.

### S8 — Project Settings

Tabs: General (name, description, timezone, archive/delete) · Members (table with role dropdowns, remove, pending invitations with resend/revoke) · Columns (rename, reorder, set `is_done_column`, set WIP limit).

### S9 — Account Settings

Profile (name, avatar, email) · Password · Notification preferences (per-category in-app/email toggles) · Theme (System/Light/Dark) · Danger zone.

### S10 — Auth Screens

Single-column centred card, product mark, minimal fields. Google OAuth button above the divider, email form below. Inline field validation on blur, never on every keystroke. Generic error messaging on failed login — never reveal whether an account exists.

### S11 — Invitation Acceptance

Shows inviter name, project name, and role being granted before any signup step, so the user knows what they are joining. Then: signed in → Accept/Decline. Not signed in → signup form prefilled with the invited email (email field locked, with an explanation).

---

## 6. User Flows

**F1 — Signup to first task**
`/signup` → validate → verify email banner (non-blocking; the app is usable) → `/projects` empty state → name input → `POST /projects` → board with three default columns → focus auto-placed in the To Do composer → type title → Enter → card appears.
*Design intent: the cursor lands in the composer automatically. The user's first action requires zero clicks.*

**F2 — Drag a task**
Pointer down → 5px threshold before drag starts (so taps still open the card) → card lifts (scale 1.02, shadow) → valid drop zones highlight → drop → optimistic reposition → PATCH → on success, silent; on failure, revert animation + toast.

**F3 — Invite a member**
Invite button → modal (email + role) → submit → optimistic pending row → email dispatched → recipient clicks → F4.

**F4 — Accept invitation**
`/invite/:token` → validate token (expired → 410 screen with "Request a new invite") → show project context → authenticate or sign up → membership created → redirect to board with a welcome toast.

**F5 — Filter to my overdue work**
FilterBar → Assignee: me → Due: Overdue → board reduces, chips appear, URL updates → chip dismiss or "Clear all" restores.

---

## 7. Wireframe Descriptions

**Board, desktop.** Left sidebar 240px. Top bar 56px: project name and breadcrumb left; view tabs centre; search, filter, avatar stack, bell, Invite button right. Below, the board canvas fills remaining height with `overflow-x: auto`. Columns 300px wide, 12px gap, 16px canvas padding. Column header: name, count badge, WIP-limit indicator, overflow menu. Cards 8px apart, 12px internal padding, 8px radius.

**Board, mobile.** Header 48px collapses to project name + overflow. One column fills the viewport width minus 32px peek of the next, so swipeability is discoverable. Column pager dots under the header. FAB bottom-right adds a task to the visible column. Bottom tab bar 56px.

**Task modal, desktop.** 900×min(80vh) centred, 24px padding. Left pane flexible; right sidebar 280px fixed with stacked labelled metadata rows.

**Analytics, desktop.** Four stat tiles in a row, then charts full-width stacked, each in a bordered card with title, sample size and the chart at 280px height.

---

## 8. Component Requirements

| Component | Key props / behaviour |
|---|---|
| `TaskCard` | `task`, `isDragging`, `isGhost`, `onOpen`; memoised — a board of 500 cards must not re-render wholesale on one change |
| `Column` | `column`, `tasks`, `wipLimit`; own scroll container; header sticky |
| `InlineComposer` | Textarea autosize; Enter submits, Shift+Enter newline, Esc cancels; stays open after submit |
| `FilterBar` | Controlled by URL params; chips are removable; "Clear all" appears only when filters are active |
| `AssigneePicker` | Searchable, restricted to project members, keyboard-navigable |
| `DueDateBadge` | Variants: none, upcoming, due-today, overdue. **Icon + text, not colour alone** |
| `Avatar` / `AvatarStack` | Initials fallback; stack overflows to `+N` after 4 |
| `Toast` | Max 3 stacked; errors persist until dismissed, successes auto-dismiss at 4s |
| `ConfirmDialog` | Destructive actions; the confirm button carries the verb ("Delete task"), never "OK" |
| `EmptyState` | Icon, headline, one-line body, single primary action |
| `ChartCard` | Title, sample size, chart, per-chart error boundary |

---

## 9–11. Responsive / Mobile / Desktop Behaviour

**Breakpoints:** `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280.

| Aspect | Mobile <768 | Tablet 768–1023 | Desktop ≥1024 |
|---|---|---|---|
| Board | One column, swipe pager | 2–3 columns visible | All columns, horizontal scroll |
| Navigation | Bottom tabs + drawer | Collapsible sidebar | Persistent sidebar |
| Task detail | Full-screen sheet | Modal 90vw | Modal 900px two-pane |
| Drag | Long-press 200ms to lift | Pointer drag | Pointer drag |
| Filters | Bottom sheet | Popover | Inline bar |

**Mobile drag is the hard part.** Touch drag and vertical scroll compete for the same gesture. Resolution: a 200ms long-press activates drag with a haptic tick; before that, the gesture belongs to the scroller. Auto-scroll triggers when the dragged card is within 60px of a viewport edge.

---

## 12–15. Loading, Empty, Error and Success States

- **Loading:** skeletons matching final layout (never centred spinners on full pages — layout shift is worse than a slightly longer wait). Inline actions show button-local spinners and disable the button.
- **Empty:** as tabulated in `01 §22`. Every empty state offers exactly one action.
- **Error:** field-level for validation; toast for transient action failures; full-page only for 403/404/500. Copy is plain and actionable — no codes, no stack traces, no "an error occurred".
- **Success:** optimistic UI means most successes are silent. Explicit confirmation only where the user cannot see the result: invitation sent, settings saved, member removed.

---

## 16–19. Dialogs, Modals, Forms, Validation

**Confirmation required for:** delete task, delete column (with a task-disposition choice), remove member, delete project (type the project name to confirm), transfer ownership, leave project.

**Modals:** focus trapped, `Esc` closes unless the form is dirty (then confirm discard), focus returns to the trigger, background scroll locked, backdrop click closes only non-dirty modals.

**Form rules:** labels are always visible (placeholders are not labels); validate on blur and on submit, never per-keystroke; the first invalid field receives focus on failed submit; submit buttons disable during the request but never move.

**Validation messages** — specific and human:

| Field | Rule | Message |
|---|---|---|
| Email | RFC-5322 | "Enter a valid email address" |
| Password | ≥10 chars | "Use at least 10 characters" |
| Task title | 1–200 | "Add a title" / "Titles are limited to 200 characters" |
| Project name | 1–120 | "Give your project a name" |
| Comment | 1–5000 | "Comment is too long (5000 character limit)" |
| Invite | Not already a member | "That person is already on this project" |

---

## 20. Search / Filter / Sort Interactions

Search debounced 250ms, minimum 2 characters, matches highlighted in results. Filters apply instantly (client-side under A1). Sort available in List view only — the board's order *is* the user's ordering and must never be overridden by a sort control. Filter and sort state lives in the URL.

---

## 21–22. Accessibility and Keyboard Navigation

Requirements per `01 §24`. Shortcuts:

| Key | Action |
|---|---|
| `N` | New task in focused column |
| `/` | Focus search |
| `F` | Open filters |
| `Esc` | Close modal / cancel drag |
| `Space` | Lift / drop focused card |
| `↑ ↓ ← →` | Move lifted card, or navigate cards |
| `Enter` | Open focused card |
| `?` | Shortcut reference |

Every card is a focusable element with `role="button"` and an accessible name including title, column and assignee. Board changes announce via a polite live region, **throttled** — ten remote moves must not produce ten announcements.

---

## 23–26. Design System

**Typography** — Inter (or system stack). Display 30/36 semibold · H1 24/32 semibold · H2 20/28 semibold · H3 16/24 semibold · Body 14/20 regular · Small 13/18 · Caption 12/16 · Card title 14/20 medium. Line length capped at 72ch for descriptions.

**Spacing** — 4px base scale: 4, 8, 12, 16, 24, 32, 48, 64. Card padding 12. Column gap 12. Section gap 24. No arbitrary values.

**Colour** — semantic tokens only, never raw hex in components: `bg`, `surface`, `surface-raised`, `border`, `text`, `text-muted`, `primary`, `danger`, `warning`, `success`. Dark mode is a token remap, not a second stylesheet.

**Priority** — Low / Medium / High / Urgent, each with a distinct icon *and* label.

**Elevation** — flat surfaces, one shadow level for dragging cards, one for modals. Depth signals interaction, not decoration.

**Component states** — every interactive component defines default, hover, focus-visible, active, disabled, loading, error. Focus-visible is a 2px ring at 2px offset, never removed.

---

## 27–28. Micro-interactions and Animation

| Interaction | Spec |
|---|---|
| Card lift | scale 1.02, shadow-lg, 120ms ease-out |
| Card drop | position settle 180ms ease-out |
| Failed move revert | return to origin 250ms ease-in-out + toast |
| Column highlight on drag-over | border colour 100ms |
| Modal open | fade + 4px rise, 160ms |
| Toast | slide-in 200ms, auto-dismiss 4s (errors persist) |
| Skeleton | 1.5s shimmer loop |
| Remote change | 600ms subtle highlight so teammates' edits are noticeable but not startling |

All animation respects `prefers-reduced-motion: reduce` by dropping to opacity-only or none. Nothing above 300ms — beyond that the UI feels sluggish rather than smooth.
