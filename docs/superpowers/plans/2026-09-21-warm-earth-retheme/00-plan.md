# Kanbo: Warm Earth re-theme + new screens from Stitch mockups

## Context

The user generated 10 screens in a Google Stitch project ("Kanbo Project Management App", id `9392556529250955770`) exploring a new visual direction called "Warm Earth" (design system: "Warm Editorial Workspace" — cream/parchment surfaces, bronze/chestnut accents, Newsreader serif headings over Plus Jakarta Sans body text, JetBrains Mono for utility text). The request is to pull the real screens + code out of Stitch, and convert/rebuild them in this repo's actual stack (Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui), replacing the current generic neutral-gray shadcn theme app-wide and filling in two pieces of UI that don't fully exist yet (a real Task Detail panel, a real Notifications Center) using the mockups as the reference design.

Of the 10 Stitch screens, 5 are unstyled/legacy duplicates (earlier drafts of List View, Task Detail Panel, and Notifications Center predating the Warm Earth pass) — confirmed with the user to skip those and use only the 5 "(Warm Earth)" screens + the Design System asset + the logo. Confirmed with the user this is a full app re-theme, not a scoped addition: Login, Board View, and List View (already fully built against the current neutral theme) get restyled in place; Task Detail and Notifications Center get newly built as their own components using shadcn `Sheet`.

Two decisions were confirmed directly with the user (do not re-litigate):
- **Dark mode**: the app has a working dark-mode toggle today (`next-themes` + `.dark` CSS vars). The user chose to **keep it working** by deriving a dark variant of the Warm Earth palette now, even though Stitch only designed a light theme — see the "Dark variant (derived)" token table below.
- **Do Not Disturb switch**: the Notifications Center mockup shows a DND toggle with no backing data model. The user chose to **drop it entirely** from the build — do not render it, do not stub it.

The 5 mockup HTML files + logo.svg were downloaded to `scratchpad/stitch-screens/` (board-view.html, login.html, task-detail-panel.html, notifications-center.html, list-view.html, logo.svg) during planning and structurally analyzed — re-read them directly during implementation for exact markup/icon names rather than re-deriving from this plan's summaries. (That scratchpad path is session-local, outside this repo — re-download from Stitch project `9392556529250955770` if starting a fresh session; screen IDs are listed in the "Mockup structure" section below.)

## Design tokens — Warm Editorial Workspace

Source of truth: the Stitch design system's `styleGuidelines` prose is more detailed than its raw `namedColors` block and the two disagree on hairline border color (prose says `#e7e2d7`, block says `#d7c2b8`) — **prefer the prose values** given below; they were cross-checked against the actual mockup HTML structure during planning.

### Light (default)
| Token | Value | Use |
|---|---|---|
| background / surface | `#fff8f6` | app canvas |
| surface-container-lowest | `#ffffff` | floating popovers/cards |
| surface-container-low | `#fbf2f0` | subtle recessed areas |
| surface-container | `#f7f4ee` | cards, workspace panels (prose "Soft Sand") |
| surface-container-high | `#eee9df` | sidebar, modals, tooltips (prose "Muted Taupe Cream") |
| surface-container-highest | `#e9e1df` | deepest recessed tier |
| on-surface (ink) | `#292524` / `#1e1b1a` | primary text ("Dark Espresso") |
| on-surface-variant (muted) | `#78716c` / `#52443c` | timestamps, placeholders, meta labels |
| outline-variant (hairline border) | `#e7e2d7` | default card/table/divider border |
| outline | `#85746a` | stronger borders, disabled states |
| primary | `#693612` | text-on-primary-container contexts |
| primary-container (accent) | `#854d27` | buttons, focus rings, active indicators ("Bronze") |
| on-primary | `#ffffff` | text on primary-container |
| secondary | `#78350f` | active nav, elevated interactive ("Chestnut") |
| tertiary | `#b45309` | badges, notifications, micro-highlights ("Warm Amber") |
| error | `#ba1a1a` | destructive actions |

Status chips: Amber/In-Progress `bg #fef3c7 / text #92400e / border #fde68a`; Neutral/Mocha `bg #eee9df / text #57534e / border #e7e2d7`; Completed `bg #ecfccb / text #3f6212 / border #d9f99d`.

Typography: `display` 48/56 400, `headline-lg` 36/44 500, `headline-lg-mobile` 28/34 500, `headline-md` 24/32 500 — all **Newsreader**. `headline-sm` 18/26 600 Plus Jakarta Sans. `body-lg` 16/26, `body-md` 14/22, `body-sm` 13/18 — Plus Jakarta Sans 400. `label-md` 12/16 600, `label-sm` 11/14 600 — Plus Jakarta Sans. `code-sm` 12/16 — JetBrains Mono.

Radii: sm 0.25rem, DEFAULT 0.5rem (buttons/inputs), md 0.75rem, lg 1rem (cards/columns), xl 1.5rem (modals/sheets), full 9999px (badges/avatars). Shadows: flat layer none (hairline border only); tier1 `0 2px 6px -1px rgba(41,37,36,.04),0 1px 3px -1px rgba(41,37,36,.02)` (hover/toolbars); tier2 `0 12px 24px -4px rgba(41,37,36,.07),0 4px 8px -2px rgba(41,37,36,.03)` (modals/dropdowns). Spacing: gutter 1.25rem (1.75rem desktop), margin 1rem (2.5rem desktop, 1.75rem tablet), space-xs .25rem, space-sm .5rem, space-md .875rem, space-lg 1.5rem, space-xl 2.25rem.

### Dark (derived — not part of the original Stitch design, built during planning to keep dark mode working)
Derived by inverting the lightness ramp while staying in the same warm bronze/espresso hue family, reusing the design system's own M3 "fixed-dim"/"inverse" tokens where they already fit so the dark palette isn't arbitrary:

| Token | Value |
|---|---|
| background / surface | `#1e1815` |
| surface-container-lowest | `#171310` |
| surface-container-low | `#241d19` |
| surface-container | `#2a221d` |
| surface-container-high | `#322822` |
| surface-container-highest | `#392e27` |
| on-surface (ink) | `#f3e9e2` |
| on-surface-variant (muted) | `#c9b8ab` |
| outline-variant (hairline) | `#4a3c33` |
| outline | `#8a7565` |
| primary | `#ffb68a` (theme's `primary-fixed-dim`) |
| on-primary | `#321300` (theme's `on-primary-fixed`) |
| primary-container | `#6d3915` (theme's `on-primary-fixed-variant`, repurposed as dark container bg) |
| on-primary-container | `#ffdbc8` |
| secondary | `#ffb693` (theme's `secondary-fixed-dim`) |
| on-secondary | `#351000` |
| tertiary | `#ffb68e` (theme's `tertiary-fixed-dim`) |
| on-tertiary | `#331200` |
| error | `#ffb4ab` |
| on-error | `#690005` |
| error-container | `#93000a` |
| on-error-container | `#ffdad6` |

Status chips in dark mode: keep the same hue families at lower saturation/higher lightness against dark bg — Amber `bg rgba(245,158,11,.16) / text #fbbf24 / border rgba(245,158,11,.35)`; Neutral `bg #322822 / text #c9b8ab / border #4a3c33`; Completed `bg rgba(16,185,129,.16) / text #6ee7b7 / border rgba(16,185,129,.35)`.

## Current codebase facts (confirmed by reading files during planning)

- `src/app/globals.css`: Tailwind v4 CSS-first config, no `tailwind.config.*`. HSL vars under `:root`/`.dark`, mapped into `@theme inline`. Only `--radius` (0.5rem) drives sm/md/lg/xl via `calc()`. `--font-sans` is just a system stack — no custom fonts loaded yet.
- `components.json`: shadcn style `new-york`, baseColor `neutral`, cssVariables true, iconLibrary lucide. Only `button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`, `sonner.tsx` exist in `src/components/ui/`.
- `src/components/app-shell.tsx`: the *only* shared layout today — simple header (Kanbo logo link, "My Tasks" link, account email link, `NotificationBell`, `ThemeToggle`, `SignOutButton`), no sidebar, no Board/List/Timeline sub-nav. Rendered by `src/app/(app)/layout.tsx`.
- `src/components/board/project-board.tsx` (1253 lines): `ProjectBoard` (main, dnd-kit), `TaskComposer`, `TaskCard`, `ColumnDropSurface`, `TaskEditor` (~line 708–1026, the existing inline task-detail panel: title/description/due/priority/assignee/labels, optimistic-concurrency conflict handling via `expectedUpdatedAt`, delete-confirm), `SubtaskList`. `board/page.tsx` also hardcodes header nav links (Activity/Analytics/Settings/Trash) inline (~lines 70–127) that duplicate what should become the shared sub-nav.
- `src/components/list/task-table.tsx`: flat semantic `<table>`, sortable `<th>`, inline `<select>`/`<input type=date>` editors, `onOpenTask` callback into the same task-detail logic. No grouping/accordion today.
- `src/components/notifications/bell.tsx` + `notification-list.tsx`: small badge + absolutely-positioned dropdown, fetches `GET /api/v1/notifications` (flat, 50 max) and `POST /api/v1/notifications/read-all`. A per-notification `POST /api/v1/notifications/[notificationId]/read` route already exists but isn't wired to any UI yet. `notification_preferences` route only has per-category **email** booleans — no in-app DND concept (confirmed dropped per the user's decision above).
- `src/app/(auth)/login/page.tsx` → `AuthFormShell` (generic Card shell reused by login/signup/forgot-password/reset-password) → `AuthForm` (generic `useActionState`-driven form) — keep both parametric, don't hardcode login-specific markup into them.
- Existing test files (`bell.test.tsx`, `task-composer.test.tsx`, `use-filter-state.test.tsx`, `announcer.test.tsx`, etc.) may assert on specific classNames — check after each phase.

## Mockup structure (from downloaded HTML analysis — re-read the files directly for exact markup/icon spans)

Stitch screen IDs (project `9392556529250955770`), for re-fetching if needed: Board View `622282eb86ca4981a6e3bc58bf45f5a3`, Login `4f3c809aaf904d8e8204a2dfc25b5bac`, Task Detail Panel `43190b0b06f3404b865fb0d8e4963d47`, Notifications Center `1c7b2852382c413e9d9c16901ba69302`, List View `1f3d5aaff0044908976a8cde18e5e639`, Logo `76ad663a2e044e9c81d7855d203b8f6e`.

All four in-app screens (Board, Task Detail, Notifications, List) share one app shell: fixed header (logo, breadcrumb pill, `⌘K` search, New Task button, icon buttons, avatar dropdown) + sub-bar (Board/List/Timeline/My Tasks tabs, active = `text-primary border-b-2 border-primary`) + fixed left sidebar (`w-64`, Workspaces list, Quick Views list, sync-status pill). **Icons are Google Material Symbols Outlined** (`<span class="material-symbols-outlined">name</span>`), not lucide — every icon needs a lucide-react mapping (table below, provisional — revalidate against the actual downloaded HTML `<span>` contents during implementation).

- **Board View**: horizontal-scroll columns (`w-80`, `rounded-2xl`), task cards (`rounded-xl`, hover lift + tier1 shadow, ring-2 when selected) with issue key, priority chip, title, tag pills, optional checklist progress bar, footer (due date/comment icons + assignee avatar). One card variant has an image-preview banner.
- **Task Detail Panel**: **right-docked slide-over drawer** (`fixed right-0 w-[540px]`), not a centered dialog — backdrop scrim dims/blurs the board behind it. Body: editable title, metadata grid (Assignee/Due/Estimate/Labels), Description card with a nested code/kbd callout, Subtasks (progress bar + checkboxes + inline add), Attachments (icon tiles), Comments/Activity Log as tabs, rich comment composer (formatting toolbar), comment thread with `@mention` highlighting, sticky footer (Close/Save).
- **Notifications Center**: also a **panel overlay** (not a full page), `max-w-[460px]`, anchored top-right over a dimmed/blurred board. Header (title, unread pill, mark-all-read). 4-tab filter bar: All/Unread/Mentions/Assigned. Notification row: avatar + type badge-icon overlay, name + relative time, message body, unread = left accent bar + tinted background. Footer: "View all history" link (**no DND switch — dropped per user decision**).
- **List View**: sub-toolbar (view switcher, search, filter chips, group-by, columns-config, Add Task), 4-tile metrics strip, then a table (`grid-cols-[48px_minmax(320px,2fr)_130px_160px_120px_130px_160px_90px_80px]`) **grouped into collapsible accordion sections per status** (colored dot + label + count + group progress bar), rows with drag handle, checkbox, title+checklist chip, status/priority pills, assignee avatar, due date, tags, activity icons, hover-reveal row actions.
- **Login**: centered card, Newsreader headline, Google button + divider + form, password field has a visibility-toggle icon (currently non-functional in the mockup — must become real `useState` in `AuthForm`).
- **Logo**: trivial inline SVG, 3 ascending bronze/chestnut/amber bars + "Kanbo" wordmark.

### Icon mapping (Material Symbols Outlined → lucide-react) — provisional, revalidate against mockup HTML
`view_kanban`→`LayoutGrid`, `notifications`→`Bell`, `chat_bubble_outline`→`MessageCircle`, `check_circle`→`CheckCircle2`, `expand_more`→`ChevronDown`, `flag`→`Flag`, `attach_file`→`Paperclip`, `keyboard_double_arrow_up`→`ChevronsUp`, `search`→`Search`, `close`→`X`, `more_horiz`/`more_vert`→`MoreHorizontal`/`MoreVertical`, `add`→`Plus`, `calendar_today`→`Calendar`, `person`/`account_circle`→`User`/`UserCircle`, `keyboard_arrow_left`/`right`→`ChevronLeft`/`ChevronRight`, `filter_list`→`ListFilter`, `visibility`/`visibility_off`→`Eye`/`EyeOff`, `delete`→`Trash2`, `edit`→`Pencil`, `mark_email_read`→`MailCheck`, `dashboard`→`LayoutDashboard`, `folder`→`FolderKanban`, `logout`→`LogOut`.

## Implementation plan

Each numbered step is independently committable and visually verifiable in the browser (per repo convention — UI work needs a real dev-server walkthrough, not just typecheck).

### Phase 1 — Token & font foundation
1. Rewrite `src/app/globals.css`: replace `:root`/`.dark` color vars with the Warm Editorial Workspace light/dark tables above (keep `.dark` — dark mode stays, per the user's decision). Add radius tokens (sm/DEFAULT/md/lg/xl/full) and shadow tokens (tier1/tier2) and status-chip color triads to `@theme inline`.
2. Load fonts via `next/font/google` in the root layout (`Newsreader` weights 400/500, `Plus_Jakarta_Sans`, `JetBrains_Mono`), expose as `--font-serif`/`--font-sans`/`--font-mono` CSS vars, wire into `@theme inline`. Add type-scale utilities (`text-display`, `text-headline-lg`, etc.) as Tailwind v4 `@theme` font-size/line-height pairs.
3. Verify: `npm run dev`, confirm `/login` picks up new background/typography, `npm run typecheck` clean, toggle dark mode and confirm the derived dark palette renders sensibly.

### Phase 2 — shadcn primitives
4. `npx shadcn add sheet dialog tabs dropdown-menu accordion badge avatar separator tooltip command` (skip `switch` — only needed for the dropped DND toggle; add later if another boolean control needs it). Spot-check each renders correctly against the new tokens.

### Phase 3 — Shared app shell
5. Add project-scoped sub-nav: new `src/app/(app)/p/[projectId]/layout.tsx` housing the Board/List/Timeline/My Tasks tab bar, replacing the duplicated header nav currently hardcoded into `board/page.tsx` (~70–127) and `list/page.tsx` (~62–70).
6. Extend `src/components/app-shell.tsx` with the left sidebar (Workspaces/Quick Views) — check first whether a "workspaces" concept exists in the data model; if not, degrade sidebar sections to real existing routes (`/projects`, `/my-tasks`) rather than inventing a workspaces feature. Restyle header: swap in `logo.svg`, replace the plain email link + `SignOutButton` with an avatar `DropdownMenu`, add `⌘K` search via `Command`/`CommandDialog` if in scope.
7. Verify: click through `/projects`, `/my-tasks`, a project's board/list — active tab highlights correctly, no duplicate nav, avatar menu opens/signs out correctly.

### Phase 4 — Login restyle
8. Restyle `auth-form-shell.tsx`/`auth-form.tsx` to match `login.html` (warm card, Newsreader headline, tier2 shadow). Add password visibility toggle as real `useState` (`Eye`/`EyeOff`, `type={show ? "text" : "password"}`) gated to password-type fields.
9. Verify: `/login`, `/signup`, `/forgot-password`, `/reset-password` all render correctly since they share these two components.

### Phase 5 — Board View restyle
10. Restyle `project-board.tsx`'s columns, `TaskCard`, `ColumnDropSurface`, filter bar, `TaskComposer`, `comment-thread.tsx`, assignee/label pickers, mention autocomplete — Tailwind class/token swap only, preserve all dnd-kit logic untouched (highest regression-risk file in the plan).
11. Verify: drag-and-drop, WIP limits, filters, keyboard shortcuts dialog all still work; smoke-test every interactive affordance, not just visuals.

### Phase 6 — Task Detail Drawer extraction
12. Create `src/components/board/task-detail-drawer.tsx` on shadcn `Sheet` (`side="right"`), lifting the existing `TaskEditor` logic (project-board.tsx ~708–1026) near-verbatim — same state/save/conflict/delete flow, just new outer markup (`Sheet`/`SheetContent`/`SheetHeader`, Comments/Activity as `Tabs` per the mockup). Keep `SubtaskList` nested as-is.
13. Swap `ProjectBoard`'s render of the old inline `TaskEditor` for the new drawer; delete the old inline version once parity confirmed. Wire `list/page.tsx`/`task-table.tsx`'s `onOpenTask` to the same shared drawer.
14. Verify: open a task from both Board and List; confirm comments, mentions, assignee/label pickers, subtasks, conflict banner, and delete-confirm all behave identically to before; Escape/focus-trap works via Sheet's built-in a11y.

### Phase 7 — Notifications Center
15. Build `src/components/notifications/notifications-center.tsx` on shadcn `Sheet` + `Tabs` (All/Unread/Mentions/Assigned), client-filtering the existing flat `GET /api/v1/notifications` list by `type` (no server-side filter exists today — acceptable at the current 50-item cap). Wire per-item mark-read to the already-existing but unused `POST /api/v1/notifications/[notificationId]/read` route. Restyle unread accent-bar/chips/empty-state. **Do not render a DND control** (dropped).
16. Replace `bell.tsx`'s dropdown usage with the new center, keeping the realtime unread-count badge hook intact.
17. Verify: mark single/all read, tab filtering, realtime badge increment still fires.

### Phase 8 — List View restyle
18. Restyle `task-table.tsx` row/cell styling; build a grouping wrapper (e.g. `src/components/list/grouped-task-list.tsx`) using shadcn `Accordion`, grouping tasks by column/status (matching the mockup's per-status accordion sections) while keeping existing inline-edit cells.
19. Restyle `project-task-list.tsx`'s composer/filter-bar wrapper.
20. Verify: sorting, inline edits, accordion expand/collapse, readOnly/viewer role still behave correctly.

### Phase 9 — App-wide sweep
21. Grep `src/components`/`src/app` for leftover hardcoded gray/neutral Tailwind classes (`bg-white`, `text-gray-*`, `bg-muted` used literally rather than via the semantic tokens) that the migration might have missed.
22. Confirm generated `button.tsx`/`card.tsx`/`input.tsx`/`label.tsx`/`sonner.tsx` render correctly against new tokens (radius/shadow may be hardcoded rather than var-driven — check).
23. Run `npm run typecheck`, `npm run lint`, `npm test` — existing tests asserting specific classNames (`bell.test.tsx`, `task-composer.test.tsx`, etc.) likely need selector updates.

## Verification plan

After each phase: `npm run dev` and manually walk the affected pages/states in a browser (per repo convention, UI work needs a real walkthrough, not just typecheck). Full pass at the end:
- `/login`, `/signup`, `/forgot-password`, `/reset-password`
- `/projects`, sidebar nav, avatar menu, dark-mode toggle
- Project board: column rendering, drag a card, filter bar, shortcuts dialog, open task into drawer, comment/mention/assignee/label/due-date edits, delete with confirm, trigger an optimistic-concurrency conflict (edit same task in two tabs)
- Project list: sort columns, inline edits, open task into the same shared drawer, expand/collapse accordion groups
- Notifications: trigger one via a second test account (mention/assignment), confirm realtime badge, open center, filter tabs, mark single/all read
- `npm run typecheck`, `npm run lint`, `npm test` all green
