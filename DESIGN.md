---
name: Kanbo
description: Warm Editorial Workspace for a focused small-team Kanban app.
colors:
  background: "#fff8f6"
  foreground: "#292524"
  card: "#f7f4ee"
  popover: "#ffffff"
  muted: "#fbf2f0"
  muted-foreground: "#52443c"
  border: "#e7e2d7"
  input: "#e7e2d7"
  primary: "#854d27"
  primary-foreground: "#ffffff"
  secondary: "#eee9df"
  secondary-foreground: "#78350f"
  accent: "#eee9df"
  accent-foreground: "#78350f"
  destructive: "#ba1a1a"
  ring: "#854d27"
  brand-primary: "#693612"
  brand-secondary: "#78350f"
  tertiary: "#b45309"
  surface-lowest: "#ffffff"
  surface-low: "#fbf2f0"
  surface-high: "#eee9df"
  surface-highest: "#e9e1df"
  outline: "#85746a"
  status-amber-bg: "#fef3c7"
  status-amber-fg: "#92400e"
  status-amber-border: "#fde68a"
  status-neutral-bg: "#eee9df"
  status-neutral-fg: "#57534e"
  status-neutral-border: "#e7e2d7"
  status-completed-bg: "#ecfccb"
  status-completed-fg: "#3f6212"
  status-completed-border: "#d9f99d"
  dark-background: "#1e1815"
  dark-foreground: "#f3e9e2"
  dark-card: "#2a221d"
  dark-popover: "#171310"
  dark-muted: "#241d19"
  dark-muted-foreground: "#c9b8ab"
  dark-border: "#4a3c33"
  dark-input: "#4a3c33"
  dark-primary: "#6d3915"
  dark-primary-foreground: "#ffdbc8"
  dark-secondary: "#322822"
  dark-secondary-foreground: "#ffb693"
  dark-accent: "#322822"
  dark-accent-foreground: "#ffb693"
  dark-destructive: "#ffb4ab"
  dark-ring: "#ffb68a"
  dark-brand-primary: "#ffb68a"
  dark-brand-secondary: "#ffb693"
  dark-tertiary: "#ffb68e"
  dark-surface-lowest: "#171310"
  dark-surface-low: "#241d19"
  dark-surface-high: "#322822"
  dark-surface-highest: "#392e27"
  dark-outline: "#8a7565"
  dark-status-amber-bg: "rgb(245 158 11 / 0.16)"
  dark-status-amber-fg: "#fbbf24"
  dark-status-amber-border: "rgb(245 158 11 / 0.35)"
  dark-status-neutral-bg: "#322822"
  dark-status-neutral-fg: "#c9b8ab"
  dark-status-neutral-border: "#4a3c33"
  dark-status-completed-bg: "rgb(16 185 129 / 0.16)"
  dark-status-completed-fg: "#6ee7b7"
  dark-status-completed-border: "rgb(16 185 129 / 0.35)"
typography:
  headline-lg:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "2.25rem"
    fontWeight: 500
    lineHeight: "2.75rem"
  headline-md:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: "2rem"
  body:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    lineHeight: "1.25rem"
  label:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    lineHeight: "1rem"
rounded:
  sm: "0.25rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  full: "9999px"
spacing:
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  6: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0.5rem 1rem"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
  input:
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0.25rem 0.75rem"
  navigation-active:
    backgroundColor: "{colors.background}"
    textColor: "{colors.brand-primary}"
    rounded: "{rounded.md}"
    padding: "0.75rem"
  chip-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.5rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "1.5rem 0"
---

# Design System: Kanbo

## Overview

**Creative North Star: "Warm Editorial Workspace"**

Kanbo uses the Warm Editorial Workspace direction: cream and parchment surfaces, bronze actions, chestnut accents, and espresso text. Editorial serif headings give hierarchy to a practical workspace with compact sans-serif controls.

The system keeps the project and task data central. Board, List, and Timeline lead into a shared task drawer; notification and authentication surfaces use the same warm material language. Light and dark themes preserve those semantic relationships.

**Key Characteristics:**

- Warm tonal surfaces with restrained borders.
- Serif section hierarchy over compact sans-serif controls.
- Responsive workspace navigation and full-width mobile drawers.

## Colors

Warm paper neutrals carry the interface; bronze and chestnut identify actions and selected context. Frontmatter records the light palette and its `dark-` equivalents; `src/app/globals.css` applies the latter through `.dark`.

### Primary

Bronze (`primary`) fills primary actions and supplies the light focus ring. Deep bronze (`brand-primary`) carries selected navigation and brand accents. Keep `primary-foreground` paired with filled actions.

### Secondary

Chestnut (`secondary-foreground`, `brand-secondary`) sits on taupe cream (`secondary`, `accent`).

### Tertiary

Warm amber (`tertiary`) provides small highlights. Status palettes pair background, foreground, and border tokens for amber, neutral, and completed states. Destructive red communicates errors and deletion.

### Neutral

Cream (`background`) is the canvas; soft sand (`card`) and the `surface-*` family separate regions. Espresso (`foreground`) is primary text. `muted-foreground` is the deeper readable metadata color; `outline` is a separate stronger outline role, not the default text color. `border` and `input` provide hairlines.

**The Semantic Pair Rule.** Use foreground and background tokens as pairs so light and dark themes remain coherent.

## Typography

**Display Font:** Newsreader, with a serif fallback.
**Body Font:** Plus Jakarta Sans, with UI sans-serif fallbacks.
**Label/Mono Font:** JetBrains Mono is loaded and mapped to the mono utility; the sampled workspace does not establish a recurring mono treatment.

Newsreader gives section titles a quiet editorial character. Most shipped controls and metadata use Tailwind's compact `text-sm` and `text-xs` sizes rather than the larger custom body ramp.

### Hierarchy

- **Large heading:** Newsreader (500), used for authentication and page titles.
- **Section heading:** Newsreader (500), used for task drawers, notification headings, and grouped lists; summary counts may use regular weight.
- **Body:** Plus Jakarta Sans, generally regular with medium weight for interactive titles and controls.
- **Label:** Compact sans-serif metadata; forms commonly use medium-weight body-size labels.

The frontmatter reflects recurring usage. The stylesheet also defines a display and mobile headline ramp, but those unused definitions are not prescriptions for new surfaces.

**The Editorial Hierarchy Rule.** Use Newsreader for page and major section headings; keep forms, task content, and navigation in Plus Jakarta Sans.

## Layout

The workspace has an 80px header. At the large breakpoint (1024px), a 224px sidebar sits beside a flexible, shrinkable content region; below it, navigation becomes a horizontal strip above the content. Header padding changes from 16px to 28px at 640px. Common internal spacing follows 8, 12, 16, and 24px steps.

Grouped list summaries use two columns on narrow screens and four from 640px. Task tables preserve their 56rem minimum width inside a horizontal scroll region. Task details and notifications are full-width on mobile, limited to 640px and 460px respectively from 640px. Drawer forms change to two columns at that breakpoint and retain a sticky task action footer.

Authentication uses a centered card capped at 28rem, with wider internal padding on larger screens.

## Elevation & Depth

Warm tonal layers and borders do most of the separation. The timeline uses the subtle tier-one shadow on hover; authentication uses tier two. Existing generic card and sheet primitives also retain their standard soft shadows, so the implementation is not universally flat. Exact shadow values are in the sidecar and global stylesheet.

**The Tonal Layer Rule.** Use warm surface differences and hairline borders to separate workspace regions; reserve stronger lift for floating surfaces.

## Shapes

Controls use the actual medium radius (12px), containers commonly use large (16px) or extra-large (24px), and chips and avatars use full rounding. This reflects the current Tailwind token mapping: the plan's intended 8px controls did not become the default button/input radius. Sheets are edge-attached rectangular panels rather than rounded floating cards.

## Components

### Buttons

Compact, medium-weight sans-serif controls. Primary actions use the bronze pair and a 90% opacity color on hover; outline actions use a canvas background and accent hover; ghost actions expose accent color on hover. The default height is 36px. Focus uses a 3px ring at half opacity, and disabled actions reduce opacity and stop pointer interaction.

### Chips

Rounded pills carry short statuses and metadata. Secondary chips use the chestnut/taupe pair; status chips use their dedicated semantic triplets. Labels remain readable text rather than color alone.

### Cards / Containers

Generic cards use sand, a hairline border, 24px corners, and soft shadow. Grouped list sections use 16px corners and bordered separators. Authentication overrides the card to the lowest surface, removes its border, and applies tier-two lift.

### Inputs / Fields

Default inputs have 12px corners, a hairline input border, transparent light background, and a tinted dark background. Their height is 36px; small-screen text is 16px and becomes 14px at the medium breakpoint (768px). Placeholder text uses the readable muted token. Focus changes the border and adds a 3px ring; invalid fields use destructive color. Drawer-native fields use the same warm border and background vocabulary with a 2px focus ring.

### Navigation

Workspace links have rounded corners, 12px padding, medium sans-serif labels, and small SVG icons. Active links use canvas against the taupe sidebar with deep bronze text; hover uses a translucent canvas. Board/List/Timeline belong to project context. Preserve the skip link and keyboard focus outlines.

### Task and notification drawers

Shared sheets keep an explicit title, contextual content, close control, and scrollable content. Task sections separate details, subtasks, and activity with borders. Notifications provide filter tabs, unread indicators, and real read-state actions. The sheet source declares 500ms open and 300ms close durations with ease-in-out; animation utility availability must be verified before treating those declarations as guaranteed rendered motion.

## Do's and Don'ts

### Do:

- **Do** use semantic theme tokens and check both themes.
- **Do** retain visible focus, readable muted text, and explicit loading, empty, and error states.
- **Do** preserve horizontal table scrolling and full-width drawers on small screens.
- **Do** render real task and notification data with permission-aware controls.

### Don't:

- **Don't** substitute generic cool gray surfaces for the established warm palette.
- **Don't** use the serif heading face for dense task controls.
- **Don't** add a decorative Do Not Disturb control without a working data model.
