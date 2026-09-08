# Kanbo Plan 1A — Foundation & Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Kanbo Next.js application with tooling, CI, a hosted Supabase dev project, and a complete email + Google authentication flow with an email-verification gate and protected routes.

**Architecture:** Next.js 15 App Router (React 19, TypeScript strict) deployed on Vercel. Authentication is Supabase Auth (GoTrue) accessed through `@supabase/ssr` with httpOnly cookie sessions — a browser client for client components, a server client for Server Components / Route Handlers / Server Actions, and Next.js middleware that refreshes the session on every navigation and guards protected routes. No database schema is created in this plan (that is Plan 1B); protected pages only read the authenticated user from the session.

**Tech Stack:** Next.js 15, React 19, TypeScript 5 (strict), Tailwind CSS 4, shadcn/ui, `@supabase/ssr`, `@supabase/supabase-js`, Zod, Vitest, @testing-library/react, Playwright, ESLint, Prettier, Husky, lint-staged, Sentry, GitHub Actions, Vercel, Supabase CLI (`npx supabase`, no local Docker).

**Spec:** `docs/superpowers/specs/2026-09-08-kanbo-build-decisions.md`, plus `03_system_design.md` §6 (Authentication), `07_security_spec.md` §2–§3, §5 (CSP/headers), §8 (secrets), `02_ux_ui_spec.md` §S10 (auth screens), `05_api_spec.md` §3 (auth endpoints).

## Global Constraints

- **TypeScript strict mode on; no `any` in application code.** (`01 §12`)
- **Node:** 20.x or newer (dev machine runs 24.18.1). `package.json` `engines.node` = `">=20"`.
- **Package manager:** npm. Commit `package-lock.json`.
- **Supabase region:** `ap-south-1` (Mumbai) for every Supabase project. Irreversible.
- **Three Supabase projects:** `kanbo-dev` (local dev), `kanbo-staging` (Vercel previews), `kanbo-prod`. This plan provisions and uses `kanbo-dev` only.
- **Secrets:** never prefix a secret with `NEXT_PUBLIC_`. `SUPABASE_SERVICE_ROLE_KEY` is server-only and is NOT used anywhere in Plan 1A. `.env*` files are git-ignored; only `.env.example` is committed. (`07 §8`)
- **Session storage:** httpOnly, Secure, SameSite=Lax cookies via `@supabase/ssr`. Never `localStorage`. (`03 §6`, `07 §3`)
- **Enumeration resistance:** login failure, signup with an existing email, and password reset all return generic, identical-looking responses. (`07 §2`)
- **Password policy:** minimum 10 characters. No composition rules. (`07 §2`)
- **Auth screens:** single-column centred card; Google button above a divider, email form below; validate on blur and submit, never per-keystroke; generic error copy. (`02 §S10`)
- **Commit style:** Conventional Commits (`feat:`, `chore:`, `test:`, `ci:`, `docs:`). Commit at the end of every task; end commit messages with:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93
  ```
- **App directory:** the Next.js app is created at the repository root (the repo currently holds only `docs/` and the numbered spec markdown files).

---

## File Structure

```
/                              repo root (already contains docs/ and NN_*.md specs)
  package.json                 scripts, deps, engines
  next.config.ts               security headers, Sentry wrapper
  tsconfig.json                strict
  .env.example                 documented env var names, no values
  .env.local                   git-ignored, real kanbo-dev values
  .gitignore
  .eslintrc / eslint.config.mjs
  .prettierrc
  .husky/pre-commit
  vitest.config.ts
  vitest.setup.ts
  playwright.config.ts
  middleware.ts                session refresh + route guards
  sentry.client.config.ts
  sentry.server.config.ts
  sentry.edge.config.ts
  .github/workflows/ci.yml

  src/
    app/
      layout.tsx               root layout, font, <html lang>
      globals.css              Tailwind entry + design tokens
      page.tsx                 landing (public, minimal)
      (auth)/
        layout.tsx             centred-card auth shell
        login/page.tsx
        signup/page.tsx
        forgot-password/page.tsx
        reset-password/page.tsx
        verify-email/page.tsx  "check your inbox" + resend
      auth/
        callback/route.ts      OAuth + email-link code exchange
        confirm/route.ts       email OTP confirmation (token_hash)
      (app)/
        layout.tsx             authenticated shell (requires verified user)
        projects/page.tsx      placeholder protected page (proves the guard)
      actions/
        auth.ts                server actions: signIn, signUp, signOut, requestReset, resetPassword, resendVerification

    components/
      ui/                      shadcn-generated primitives (button, input, label, card, form, ...)
      auth/
        auth-form-shell.tsx    shared card + heading + Google button + divider
        sign-in-form.tsx
        sign-up-form.tsx
        forgot-password-form.tsx
        reset-password-form.tsx

    lib/
      env.ts                   Zod-validated process.env accessor
      supabase/
        client.ts              createBrowserClient wrapper
        server.ts              createServerClient wrapper (cookies())
        middleware.ts          updateSession helper used by middleware.ts
      auth/
        schemas.ts             Zod: emailSchema, passwordSchema, signInSchema, signUpSchema, resetRequestSchema, resetPasswordSchema
        errors.ts              mapAuthError(): Supabase error -> generic user-facing message
      utils.ts                 cn() classname helper (shadcn standard)

    test/
      helpers/
        render.tsx             Testing Library render with providers

  supabase/
    config.toml                project ref for kanbo-dev, no local services
    .gitignore

  e2e/
    auth.spec.ts               Playwright: signup -> verify -> login -> guard -> logout
```

**Decomposition rationale:** auth UI (`components/auth/*`) and auth server logic (`app/actions/auth.ts`, `lib/auth/*`) change together and live near each other but are split by responsibility (rendering vs. server mutation vs. validation). The Supabase client wrappers are isolated in `lib/supabase/` so Plan 1B and 1C consume one stable interface. Env access goes through a single validated module so a missing variable fails loudly at boot, not deep in a request.

---

## Task 1: Repository init and Next.js scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `.git/` (via `git init`)

**Interfaces:**
- Consumes: nothing.
- Produces: a running Next.js dev server on `http://localhost:3000`; `npm run build`, `npm run dev`, `npm run start`, `npm run typecheck` scripts.

- [ ] **Step 1: Initialise git and guard the working tree**

```bash
cd "C:/Users/luthr/OneDrive/Documents/Projects/TaskManagement App"
git init
git branch -M main
git checkout -b feat/1a-foundation-auth
printf "node_modules/\n.next/\n.env\n.env.local\n.env*.local\ncoverage/\nplaywright-report/\ntest-results/\n.vercel\nnext-env.d.ts\n*.tsbuildinfo\n.sentryclirc\n" > .gitignore
git add .gitignore docs 0*.md
git commit -m "chore: track existing specs and add gitignore

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

- [ ] **Step 2: Scaffold Next.js into the repo root**

Run (non-interactive; scaffolds into current directory):

```bash
npx --yes create-next-app@latest . --ts --app --src-dir --tailwind --eslint --use-npm --no-import-alias --turbopack --skip-install
```

If `create-next-app` refuses because the directory is non-empty, scaffold into a temp dir and move files:

```bash
npx --yes create-next-app@latest .kanbo-scaffold --ts --app --src-dir --tailwind --eslint --use-npm --no-import-alias --turbopack --skip-install
# then move everything except node_modules from .kanbo-scaffold into the repo root, and delete .kanbo-scaffold
```

- [ ] **Step 3: Install dependencies**

```bash
npm install
```

- [ ] **Step 4: Force TypeScript strict and set the path alias**

Edit `tsconfig.json` so `compilerOptions` contains exactly these (merge, do not drop Next's defaults):

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```

- [ ] **Step 5: Add scripts and engines to `package.json`**

Merge into `package.json`:

```jsonc
{
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "format": "prettier --write .",
    "db:push": "supabase db push",
    "db:diff": "supabase db diff"
  }
}
```

- [ ] **Step 6: Minimal root layout and landing page**

`src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Kanbo",
  description: "A real-time Kanban board for small teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:

```tsx
import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-semibold">Kanbo</h1>
      <p className="text-muted-foreground">A real-time Kanban board for small teams.</p>
      <div className="flex gap-3">
        <Link href="/signup" className="underline">Sign up</Link>
        <Link href="/login" className="underline">Sign in</Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Verify build and typecheck pass**

Run: `npm run typecheck && npm run build`
Expected: both succeed, no errors.

- [ ] **Step 8: Verify dev server renders**

Run: `npm run dev`, open `http://localhost:3000`, confirm the landing page renders, stop the server.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 15 app with strict TypeScript

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 2: Linting, formatting, and pre-commit hooks

**Files:**
- Create: `.prettierrc`, `.prettierignore`, `.husky/pre-commit`
- Modify: `package.json` (devDeps, `lint-staged` block), `eslint.config.mjs`

**Interfaces:**
- Consumes: the scaffold from Task 1.
- Produces: `npm run lint` and `npm run format`; a pre-commit hook running `lint-staged`.

- [ ] **Step 1: Install dev tooling**

```bash
npm install -D prettier prettier-plugin-tailwindcss eslint-config-prettier husky lint-staged
```

- [ ] **Step 2: Prettier config**

`.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

`.prettierignore`:

```
.next
node_modules
coverage
playwright-report
package-lock.json
supabase/.branches
supabase/.temp
```

- [ ] **Step 3: Turn off ESLint rules that fight Prettier and ban `any`**

Append to `eslint.config.mjs` config array:

```js
{
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
},
// eslint-config-prettier must be last
(await import("eslint-config-prettier")).default,
```

- [ ] **Step 4: lint-staged block in `package.json`**

```jsonc
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"]
  }
}
```

- [ ] **Step 5: Install Husky and add the hook**

```bash
npx husky init
printf "npx lint-staged\n" > .husky/pre-commit
```

- [ ] **Step 6: Run formatting once across the repo**

Run: `npm run format`

- [ ] **Step 7: Verify lint passes**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 8: Verify the hook blocks a bad commit**

Temporarily add `const x: any = 1;` to `src/app/page.tsx`, run `git add -A && git commit -m "test"`, expect the commit to be REJECTED by the hook. Revert the change.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: add prettier, eslint-prettier, husky pre-commit lint-staged

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 3: Tailwind design tokens and shadcn/ui

**Files:**
- Modify: `src/app/globals.css` (semantic color tokens, light + dark)
- Create: `components.json` (shadcn config), `src/lib/utils.ts`, `src/components/ui/*` (button, input, label, card, form, sonner)

**Interfaces:**
- Consumes: Tailwind 4 from the scaffold.
- Produces: `cn()` from `@/lib/utils`; shadcn primitives importable from `@/components/ui/*`. Semantic tokens: `--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, `--primary`, `--primary-foreground`, `--destructive`, `--ring`.

- [ ] **Step 1: Define semantic tokens in `globals.css`**

Replace the `@theme` / `:root` block with light + dark token sets. Minimum token list (HSL or oklch, your call — be consistent):

```css
@import "tailwindcss";

:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 4%;
  --card: 0 0% 100%;
  --muted: 240 5% 96%;
  --muted-foreground: 240 4% 46%;
  --border: 240 6% 90%;
  --primary: 240 6% 10%;
  --primary-foreground: 0 0% 98%;
  --destructive: 0 72% 51%;
  --ring: 240 5% 65%;
  --radius: 0.5rem;
}

.dark {
  --background: 240 10% 4%;
  --foreground: 0 0% 98%;
  --card: 240 10% 6%;
  --muted: 240 4% 16%;
  --muted-foreground: 240 5% 65%;
  --border: 240 4% 18%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 6% 10%;
  --destructive: 0 63% 45%;
  --ring: 240 5% 45%;
}

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-border: hsl(var(--border));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-ring: hsl(var(--ring));
  --radius-lg: var(--radius);
}

body {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
```

- [ ] **Step 2: Initialise shadcn/ui**

```bash
npx --yes shadcn@latest init -d
```

Answer prompts for: style = default, base color = neutral, CSS variables = yes. If the CLI overwrites `globals.css` tokens, re-apply Step 1's values afterward.

- [ ] **Step 3: Add the primitives auth needs**

```bash
npx --yes shadcn@latest add button input label card form sonner
```

- [ ] **Step 4: Mount the toaster in the root layout**

Add `<Toaster />` from `@/components/ui/sonner` to `src/app/layout.tsx` `<body>`.

- [ ] **Step 5: Verify build**

Run: `npm run typecheck && npm run build`
Expected: success.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add tailwind semantic tokens and shadcn/ui primitives

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 4: Vitest + Testing Library harness

**Files:**
- Create: `vitest.config.ts`, `vitest.setup.ts`, `src/test/helpers/render.tsx`, `src/lib/auth/schemas.ts`, `src/lib/auth/schemas.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks except the scaffold.
- Produces:
  - `npm run test` runs Vitest in `jsdom`.
  - `src/lib/auth/schemas.ts` exports:
    - `emailSchema: z.ZodString`
    - `passwordSchema: z.ZodString` (min 10)
    - `signInSchema: z.ZodObject<{ email; password }>`
    - `signUpSchema: z.ZodObject<{ email; password; displayName }>` — `displayName` 1–80 chars, trimmed
    - `resetRequestSchema: z.ZodObject<{ email }>`
    - `resetPasswordSchema: z.ZodObject<{ password; confirmPassword }>` with a refine that the two match
  - types: `SignInInput`, `SignUpInput`, `ResetRequestInput`, `ResetPasswordInput` via `z.infer`.

- [ ] **Step 1: Install test deps**

```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom
npm install zod
```

- [ ] **Step 2: Vitest config**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

`vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

- [ ] **Step 3: Write the failing schema test**

`src/lib/auth/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  passwordSchema,
  signUpSchema,
  resetPasswordSchema,
} from "./schemas";

describe("passwordSchema", () => {
  it("rejects passwords shorter than 10 characters", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
  });
  it("accepts a 10+ character password", () => {
    expect(passwordSchema.safeParse("abcdefghij").success).toBe(true);
  });
});

describe("signUpSchema", () => {
  it("trims and requires a display name of 1-80 chars", () => {
    expect(signUpSchema.safeParse({ email: "a@b.com", password: "abcdefghij", displayName: "  " }).success).toBe(false);
    const ok = signUpSchema.safeParse({ email: "a@b.com", password: "abcdefghij", displayName: "  Aditi  " });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.displayName).toBe("Aditi");
  });
});

describe("resetPasswordSchema", () => {
  it("fails when passwords do not match", () => {
    expect(resetPasswordSchema.safeParse({ password: "abcdefghij", confirmPassword: "different99" }).success).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `npm run test -- src/lib/auth/schemas.test.ts`
Expected: FAIL — `Cannot find module './schemas'`.

- [ ] **Step 5: Implement `schemas.ts`**

```ts
import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(200);

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(80, "Names are limited to 80 characters");

export const signInSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password") });

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npm run test -- src/lib/auth/schemas.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 7: Add the render helper**

`src/test/helpers/render.tsx`:

```tsx
import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

export function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, options);
}

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test: add vitest harness and auth validation schemas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 5: Validated environment module

**Files:**
- Create: `src/lib/env.ts`, `src/lib/env.test.ts`, `.env.example`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `clientEnv: { NEXT_PUBLIC_SUPABASE_URL: string; NEXT_PUBLIC_SUPABASE_ANON_KEY: string; NEXT_PUBLIC_SITE_URL: string; NEXT_PUBLIC_SENTRY_DSN?: string }`
  - `serverEnv: { SUPABASE_SERVICE_ROLE_KEY: string; SENTRY_AUTH_TOKEN?: string }` — lazy, only read on the server
  - `getServerEnv(): typeof serverEnv` — throws if called and a required var is missing

- [ ] **Step 1: Write the failing test**

`src/lib/env.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

describe("client env", () => {
  it("throws a helpful error when a public var is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test -- src/lib/env.test.ts`
Expected: FAIL — module resolves without throwing (no `env.ts` yet, import error text differs).

- [ ] **Step 3: Implement `env.ts`**

```ts
import { z } from "zod";

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
});

const parsedClient = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});

if (!parsedClient.success) {
  const missing = parsedClient.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`Invalid or missing client environment variables: ${missing}`);
}

export const clientEnv = parsedClient.data;

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SENTRY_AUTH_TOKEN: z.string().optional(),
});

let cachedServerEnv: z.infer<typeof serverSchema> | null = null;

export function getServerEnv() {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must not be called in the browser");
  }
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing server environment variables: ${missing}`);
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npm run test -- src/lib/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `.env.example`**

```dotenv
# Public — safe to ship to the browser
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SENTRY_DSN=

# Server only — NEVER prefix with NEXT_PUBLIC_
SUPABASE_SERVICE_ROLE_KEY=
SENTRY_AUTH_TOKEN=
```

- [ ] **Step 6: Add an ESLint guard against secret leakage**

Append to `eslint.config.mjs` rules:

```js
"no-restricted-syntax": [
  "error",
  {
    selector: "Identifier[name=/^NEXT_PUBLIC_.*(SERVICE|SECRET|PRIVATE|SERVICE_ROLE)/i]",
    message: "Secrets must not be exposed with the NEXT_PUBLIC_ prefix (07 §8).",
  },
],
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add zod-validated environment module and secret-prefix lint guard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 6: Provision the `kanbo-dev` Supabase project

**Files:**
- Create: `supabase/config.toml`, `supabase/.gitignore`
- Modify: `.env.local` (git-ignored — created here, never committed)

**Interfaces:**
- Consumes: nothing.
- Produces: a live `kanbo-dev` Supabase project in `ap-south-1`; `.env.local` populated with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`; a linked `supabase/` directory for Plan 1B migrations.

> **This task requires the human operator to run interactive auth commands.** The executing agent stops and asks the operator to run each `login` step in their terminal with the `!` prefix, then continues.

- [ ] **Step 1: Authenticate the Supabase CLI**

Operator runs in the Claude Code prompt:

```
! npx --yes supabase login
```

- [ ] **Step 2: Create the dev project**

Operator runs (replace `<ORG_ID>` from `npx supabase orgs list`, choose a strong db password, keep it in a password manager):

```
! npx --yes supabase projects create kanbo-dev --org-id <ORG_ID> --region ap-south-1 --db-password "<STRONG_PASSWORD>"
```

Record the printed **project ref**.

- [ ] **Step 3: Initialise and link the local `supabase/` directory**

```bash
npx --yes supabase init
npx --yes supabase link --project-ref <PROJECT_REF>
```

`supabase/.gitignore` must contain:

```
.branches
.temp
.env
```

- [ ] **Step 4: Retrieve the API keys**

```bash
npx --yes supabase projects api-keys --project-ref <PROJECT_REF>
```

- [ ] **Step 5: Write `.env.local` (never commit)**

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

- [ ] **Step 6: Configure Auth redirect URLs**

In the Supabase dashboard → Authentication → URL Configuration for `kanbo-dev`:
- Site URL: `http://localhost:3000`
- Redirect URLs: add `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm`

- [ ] **Step 7: Enable Google as an auth provider (dev)**

Dashboard → Authentication → Providers → Google. Operator supplies a Google OAuth client ID + secret from Google Cloud Console (authorized redirect URI: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`). If Google credentials are not ready, mark this step blocked and continue — email/password auth does not depend on it; Task 11 covers the Google button and can be verified later.

- [ ] **Step 8: Confirm connectivity**

Run: `npx --yes supabase projects list`
Expected: `kanbo-dev` shown as linked (●).

- [ ] **Step 9: Commit (config only — no secrets)**

```bash
git add supabase/config.toml supabase/.gitignore
git commit -m "chore: init and link supabase project directory for kanbo-dev

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 7: Supabase SSR client wrappers

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/middleware.ts`
- Create: `src/lib/supabase/client.test.ts`

**Interfaces:**
- Consumes: `clientEnv` from `@/lib/env`.
- Produces:
  - `createClient(): SupabaseClient` — browser, from `client.ts` (`"use client"` safe)
  - `createClient(): Promise<SupabaseClient>` — server, from `server.ts`, async because it awaits `cookies()`
  - `updateSession(request: NextRequest): Promise<NextResponse>` — from `middleware.ts`, refreshes the auth cookie and returns the response to forward
- Later tasks import the browser client from `@/lib/supabase/client` and the server client from `@/lib/supabase/server`.

- [ ] **Step 1: Install Supabase packages**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Browser client**

`src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
```

- [ ] **Step 3: Server client**

`src/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component — safe to ignore, middleware refreshes
          }
        },
      },
    },
  );
}
```

- [ ] **Step 4: Middleware session helper**

`src/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/", "/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"];
const AUTH_ROUTE_PREFIXES = ["/auth/"];

function isPublic(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return AUTH_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Verified-email gate: an authenticated but unconfirmed user may only see /verify-email and auth routes.
  if (user && !user.email_confirmed_at && pathname !== "/verify-email" && !pathname.startsWith("/auth/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/verify-email";
    return NextResponse.redirect(url);
  }

  // A fully signed-in, verified user has no reason to see login/signup.
  if (user && user.email_confirmed_at && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/projects";
    return NextResponse.redirect(url);
  }

  return response;
}
```

- [ ] **Step 5: Write a smoke test for the browser client**

`src/lib/supabase/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));

describe("createClient (browser)", () => {
  it("returns a client exposing auth and from()", async () => {
    const { createClient } = await import("./client");
    const supabase = createClient();
    expect(supabase.auth).toBeDefined();
    expect(typeof supabase.from).toBe("function");
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npm run test -- src/lib/supabase/client.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add supabase ssr client, server, and middleware helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 8: Root middleware wiring + auth error mapper

**Files:**
- Create: `middleware.ts` (repo root), `src/lib/auth/errors.ts`, `src/lib/auth/errors.test.ts`

**Interfaces:**
- Consumes: `updateSession` from `@/lib/supabase/middleware`.
- Produces:
  - active Next.js middleware guarding every route except static assets
  - `mapAuthError(error: { message?: string; status?: number } | null): string` — returns a generic, enumeration-safe message; never echoes Supabase internals

- [ ] **Step 1: Root `middleware.ts`**

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 2: Write the failing error-mapper test**

`src/lib/auth/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapAuthError } from "./errors";

describe("mapAuthError", () => {
  it("returns a generic credential message for invalid login", () => {
    expect(mapAuthError({ message: "Invalid login credentials", status: 400 })).toBe(
      "That email or password is incorrect.",
    );
  });
  it("never leaks whether an account exists on signup collision", () => {
    const msg = mapAuthError({ message: "User already registered", status: 422 });
    expect(msg).toBe("Check your inbox to continue.");
  });
  it("falls back to a generic message for unknown errors", () => {
    expect(mapAuthError({ message: "some internal detail" })).toBe("Something went wrong. Please try again.");
  });
  it("handles null", () => {
    expect(mapAuthError(null)).toBe("Something went wrong. Please try again.");
  });
});
```

- [ ] **Step 3: Run, verify it fails**

Run: `npm run test -- src/lib/auth/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `errors.ts`**

```ts
type AuthErrorLike = { message?: string; status?: number } | null;

const GENERIC = "Something went wrong. Please try again.";

export function mapAuthError(error: AuthErrorLike): string {
  if (!error?.message) return GENERIC;
  const m = error.message.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email or password is incorrect.";
  if (m.includes("email not confirmed")) return "Please verify your email address first.";
  if (m.includes("user already registered")) return "Check your inbox to continue.";
  if (m.includes("password")) return "Use at least 10 characters.";
  if (m.includes("rate limit") || error.status === 429) return "Too many attempts. Try again in a few minutes.";
  return GENERIC;
}
```

- [ ] **Step 5: Run, verify it passes**

Run: `npm run test -- src/lib/auth/errors.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 6: Manual guard check**

Run `npm run dev`, visit `http://localhost:3000/projects` while logged out → expect redirect to `/login?next=/projects`. Visit `/` → renders. Stop server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire root middleware guard and enumeration-safe auth error mapper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 9: Auth server actions

**Files:**
- Create: `src/app/actions/auth.ts`, `src/app/actions/auth.test.ts`

**Interfaces:**
- Consumes: `@/lib/supabase/server` `createClient`, `@/lib/auth/schemas`, `@/lib/auth/errors` `mapAuthError`, `@/lib/env` `clientEnv`.
- Produces server actions, each returning `{ ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string> }`:
  - `signUp(_prev, formData: FormData)` — validates `signUpSchema`, calls `supabase.auth.signUp` with `emailRedirectTo: ${SITE_URL}/auth/confirm`, `data: { display_name }`; on success redirects to `/verify-email`
  - `signIn(_prev, formData: FormData)` — validates `signInSchema`, `signInWithPassword`; on success redirects to the `next` param or `/projects`
  - `signOut()` — `supabase.auth.signOut()`, redirect `/login`
  - `requestPasswordReset(_prev, formData)` — validates `resetRequestSchema`, `resetPasswordForEmail(email, { redirectTo: ${SITE_URL}/auth/confirm?type=recovery })`; **always** returns `{ ok: true }` regardless of account existence
  - `resetPassword(_prev, formData)` — validates `resetPasswordSchema`, `supabase.auth.updateUser({ password })`; redirect `/login`
  - `resendVerification(_prev, formData)` — `supabase.auth.resend({ type: "signup", email })`; always `{ ok: true }`

- [ ] **Step 1: Write failing tests (mock the Supabase server client)**

`src/app/actions/auth.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const signUp = vi.fn();
const signInWithPassword = vi.fn();
const resetPasswordForEmail = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock("@/lib/env", () => ({ clientEnv: { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signUp, signInWithPassword, resetPasswordForEmail } }),
}));

function fd(entries: Record<string, string>) {
  const f = new FormData();
  Object.entries(entries).forEach(([k, v]) => f.set(k, v));
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe("signUp", () => {
  it("returns field errors for a weak password without calling Supabase", async () => {
    const { signUp: action } = await import("./auth");
    const res = await action(undefined, fd({ email: "a@b.com", password: "short", displayName: "Aditi" }));
    expect(res).toMatchObject({ ok: false });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("redirects to /verify-email on success", async () => {
    signUp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const { signUp: action } = await import("./auth");
    await expect(
      action(undefined, fd({ email: "a@b.com", password: "abcdefghij", displayName: "Aditi" })),
    ).rejects.toThrow("REDIRECT:/verify-email");
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "a@b.com",
        password: "abcdefghij",
        options: expect.objectContaining({
          emailRedirectTo: "http://localhost:3000/auth/confirm",
          data: { display_name: "Aditi" },
        }),
      }),
    );
  });
});

describe("requestPasswordReset", () => {
  it("returns ok:true even when the account does not exist", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: { message: "user not found" } });
    const { requestPasswordReset } = await import("./auth");
    const res = await requestPasswordReset(undefined, fd({ email: "ghost@b.com" }));
    expect(res).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test -- src/app/actions/auth.test.ts`
Expected: FAIL — `./auth` not found.

- [ ] **Step 3: Implement `src/app/actions/auth.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { mapAuthError } from "@/lib/auth/errors";
import {
  signInSchema,
  signUpSchema,
  resetRequestSchema,
  resetPasswordSchema,
} from "@/lib/auth/schemas";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

function zodToFieldErrors(issues: { path: (string | number)[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? "form");
    if (!out[key]) out[key] = i.message;
  }
  return out;
}

export async function signUp(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: zodToFieldErrors(parsed.error.issues) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
      data: { display_name: parsed.data.displayName },
    },
  });
  if (error) return { ok: false, message: mapAuthError(error) };
  redirect("/verify-email");
}

export async function signIn(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Enter your email and password.", fieldErrors: zodToFieldErrors(parsed.error.issues) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, message: mapAuthError(error) };
  const next = String(formData.get("next") || "/projects");
  redirect(next.startsWith("/") ? next : "/projects");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email address.", fieldErrors: zodToFieldErrors(parsed.error.issues) };
  }
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/auth/confirm?type=recovery`,
  });
  // Enumeration-safe: never reveal whether the account exists.
  return { ok: true };
}

export async function resetPassword(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: zodToFieldErrors(parsed.error.issues) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: mapAuthError(error) };
  redirect("/login?reset=1");
}

export async function resendVerification(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") || "");
  if (email) {
    const supabase = await createClient();
    await supabase.auth.resend({ type: "signup", email });
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npm run test -- src/app/actions/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add auth server actions with zod validation and enumeration resistance

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 10: Auth UI — shell, forms, and pages

**Files:**
- Create: `src/app/(auth)/layout.tsx`, `src/components/auth/auth-form-shell.tsx`, `src/components/auth/sign-in-form.tsx`, `src/components/auth/sign-up-form.tsx`, `src/components/auth/forgot-password-form.tsx`, `src/components/auth/reset-password-form.tsx`
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/reset-password/page.tsx`, `src/app/(auth)/verify-email/page.tsx`
- Create: `src/components/auth/sign-in-form.test.tsx`

**Interfaces:**
- Consumes: the server actions from `@/app/actions/auth`, shadcn `ui/*`, `useActionState` from React 19.
- Produces: the five auth routes rendering per `02 §S10`. `<GoogleButton />` lives in `auth-form-shell.tsx` and calls the browser client `signInWithOAuth({ provider: "google", options: { redirectTo: ${origin}/auth/callback } })`.

- [ ] **Step 1: Auth route-group layout (centred card shell)**

`src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
```

- [ ] **Step 2: `auth-form-shell.tsx` with the Google button and divider**

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function AuthFormShell({
  title,
  showGoogle = true,
  children,
  footer,
}: {
  title: string;
  showGoogle?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  async function google() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {showGoogle && (
          <>
            <Button type="button" variant="outline" onClick={google} className="w-full">
              Continue with Google
            </Button>
            <div className="relative text-center text-xs text-muted-foreground">
              <span className="bg-card px-2 relative z-10">or</span>
              <span className="absolute inset-x-0 top-1/2 -z-0 border-t" />
            </div>
          </>
        )}
        {children}
        {footer && <div className="text-center text-sm text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: `sign-in-form.tsx` (client, `useActionState`)**

```tsx
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn, type ActionResult } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(signIn, undefined);
  const err = state && !state.ok ? state : undefined;

  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        {err?.fieldErrors?.email && <p className="text-xs text-destructive">{err.fieldErrors.email}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
        {err?.fieldErrors?.password && <p className="text-xs text-destructive">{err.fieldErrors.password}</p>}
      </div>
      {err && !err.fieldErrors && <p className="text-sm text-destructive" role="alert">{err.message}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <Link href="/forgot-password" className="text-center text-xs text-muted-foreground underline">
        Forgot your password?
      </Link>
    </form>
  );
}
```

- [ ] **Step 4: The remaining three forms**

Build `sign-up-form.tsx` (fields: displayName, email, password; binds `signUp`), `forgot-password-form.tsx` (field: email; binds `requestPasswordReset`; on `state.ok` render "If that email has an account, a reset link is on its way."), `reset-password-form.tsx` (fields: password, confirmPassword; binds `resetPassword`). Follow the exact structure of `sign-in-form.tsx`: `useActionState`, `noValidate`, per-field error `<p>`, form-level `role="alert"`, disabled pending button.

- [ ] **Step 5: The five pages**

Each page is a Server Component that renders `<AuthFormShell>` wrapping the matching form.

`src/app/(auth)/login/page.tsx`:

```tsx
import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import Link from "next/link";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthFormShell
      title="Sign in to Kanbo"
      footer={<>New here? <Link href="/signup" className="underline">Create an account</Link></>}
    >
      <SignInForm next={next} />
    </AuthFormShell>
  );
}
```

`signup/page.tsx` mirrors it with `<SignUpForm />`. `forgot-password/page.tsx` and `reset-password/page.tsx` pass `showGoogle={false}`. `verify-email/page.tsx`:

```tsx
import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { resendVerification } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function VerifyEmailPage() {
  return (
    <AuthFormShell title="Check your inbox" showGoogle={false}>
      <p className="text-sm text-muted-foreground">
        We sent you a verification link. Click it to finish setting up your account.
      </p>
      <form action={resendVerification} className="flex flex-col gap-2">
        <Input name="email" type="email" placeholder="you@example.com" required />
        <Button type="submit" variant="outline">Resend the link</Button>
      </form>
    </AuthFormShell>
  );
}
```

- [ ] **Step 6: Write the failing component test**

`src/components/auth/sign-in-form.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/helpers/render";

vi.mock("@/app/actions/auth", () => ({ signIn: vi.fn() }));

import { SignInForm } from "./sign-in-form";

describe("SignInForm", () => {
  it("renders email and password fields with visible labels", () => {
    render(<SignInForm />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("carries the next param as a hidden input", () => {
    const { container } = render(<SignInForm next="/p/123/board" />);
    expect(container.querySelector('input[name="next"]')).toHaveValue("/p/123/board");
  });
});
```

- [ ] **Step 7: Run, verify it passes**

Run: `npm run test -- src/components/auth/sign-in-form.test.tsx`
Expected: PASS.

- [ ] **Step 8: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: success.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: auth screens — sign in, sign up, password reset, verify email

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 11: OAuth / email-link callback routes

**Files:**
- Create: `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts`
- Create: `src/app/auth/callback/route.test.ts`

**Interfaces:**
- Consumes: `@/lib/supabase/server` `createClient`.
- Produces:
  - `GET /auth/callback?code=...&next=...` — exchanges the PKCE `code` for a session, redirects to `next` (default `/projects`); on error redirects to `/login?error=oauth`
  - `GET /auth/confirm?token_hash=...&type=...` — verifies an email OTP (`signup`, `recovery`, `email_change`), redirects: `recovery` → `/reset-password`, else `/projects`; on error → `/login?error=confirm`

- [ ] **Step 1: Write the failing test**

`src/app/auth/callback/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

describe("GET /auth/callback", () => {
  it("redirects to next on a successful code exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost:3000/auth/callback?code=abc&next=/projects"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/projects");
  });

  it("redirects to /login?error=oauth when exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?error=oauth");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test -- src/app/auth/callback/route.test.ts`
Expected: FAIL — `./route` not found.

- [ ] **Step 3: Implement `src/app/auth/callback/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const safeNext = next && next.startsWith("/") ? next : "/projects";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
```

- [ ] **Step 4: Implement `src/app/auth/confirm/route.ts`**

```ts
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=confirm", url.origin));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return NextResponse.redirect(new URL("/login?error=confirm", url.origin));
  }
  const dest = type === "recovery" ? "/reset-password" : "/projects";
  return NextResponse.redirect(new URL(dest, url.origin));
}
```

- [ ] **Step 5: Run, verify it passes**

Run: `npm run test -- src/app/auth/callback/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add oauth and email-otp confirmation callback routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 12: Authenticated shell + protected placeholder page + sign-out

**Files:**
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/projects/page.tsx`, `src/components/auth/sign-out-button.tsx`

**Interfaces:**
- Consumes: `@/lib/supabase/server` `createClient`, `signOut` action.
- Produces: `/projects` route that requires a verified session and shows the user's email + a working sign-out button. This is the placeholder Plan 1B replaces with the real project list.

- [ ] **Step 1: Authenticated layout with a hard server-side check**

`src/app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (!user.email_confirmed_at) redirect("/verify-email");

  return <div className="min-h-dvh">{children}</div>;
}
```

- [ ] **Step 2: Sign-out button**

`src/components/auth/sign-out-button.tsx`:

```tsx
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" size="sm">Sign out</Button>
    </form>
  );
}
```

- [ ] **Step 3: Placeholder projects page**

`src/app/(app)/projects/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <SignOutButton />
      </div>
      <p className="text-sm text-muted-foreground">Signed in as {user?.email}. Project list arrives in Plan 1B.</p>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: success.

- [ ] **Step 5: Manual end-to-end check against `kanbo-dev`**

With `.env.local` populated and `npm run dev` running:
1. `/signup` → submit real email + 10-char password + name → lands on `/verify-email`.
2. Open the Supabase dashboard → Authentication → Users → confirm the user exists, unconfirmed.
3. Click the confirmation link in the email (or copy the `token_hash` link) → lands on `/projects`.
4. Reload `/projects` → still authenticated. Visit `/login` → redirected to `/projects`.
5. Sign out → `/login`. Visit `/projects` → redirected to `/login?next=/projects`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: authenticated shell, protected projects placeholder, sign-out

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 13: Security headers and CSP

**Files:**
- Modify: `next.config.ts`
- Create: `src/lib/security/headers.ts`, `src/lib/security/headers.test.ts`

**Interfaces:**
- Consumes: `clientEnv` (for the Supabase origin in `connect-src`).
- Produces: `securityHeaders(): { key: string; value: string }[]` used by `next.config.ts` `headers()`. Covers HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, and a CSP with `frame-ancestors 'none'`, `default-src 'self'`, `connect-src 'self' <supabase-url> wss://<supabase-host>`, `img-src 'self' data: https:`, `style-src 'self' 'unsafe-inline'` (Tailwind), `script-src 'self'`. (`07 §5`, `07 §18.10`)

- [ ] **Step 1: Write the failing test**

`src/lib/security/headers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  clientEnv: { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" },
}));

import { securityHeaders } from "./headers";

describe("securityHeaders", () => {
  const map = Object.fromEntries(securityHeaders().map((h) => [h.key, h.value]));

  it("sets frame-ancestors none and blocks framing", () => {
    expect(map["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(map["X-Frame-Options"]).toBe("DENY");
  });
  it("allows the supabase origin and websockets in connect-src", () => {
    expect(map["Content-Security-Policy"]).toContain("https://abc.supabase.co");
    expect(map["Content-Security-Policy"]).toContain("wss://abc.supabase.co");
  });
  it("sets HSTS and nosniff", () => {
    expect(map["Strict-Transport-Security"]).toContain("max-age=");
    expect(map["X-Content-Type-Options"]).toBe("nosniff");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm run test -- src/lib/security/headers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/security/headers.ts`**

```ts
import { clientEnv } from "@/lib/env";

export function securityHeaders(): { key: string; value: string }[] {
  const supabaseUrl = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseHost = new URL(supabaseUrl).host;

  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseUrl} wss://${supabaseHost}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
}
```

- [ ] **Step 4: Wire into `next.config.ts`**

```ts
import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
```

- [ ] **Step 5: Run, verify it passes; then build**

Run: `npm run test -- src/lib/security/headers.test.ts && npm run build`
Expected: PASS + build success.

- [ ] **Step 6: Manual header check**

`npm run dev`, then `curl -sI http://localhost:3000/login | grep -i -E "content-security|strict-transport|x-content-type|x-frame"` → all present.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add CSP and security response headers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 14: Sentry error tracking

**Files:**
- Create: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation.ts`
- Modify: `next.config.ts` (wrap with `withSentryConfig`), `.env.example`

**Interfaces:**
- Consumes: `clientEnv.NEXT_PUBLIC_SENTRY_DSN` (optional — Sentry is a no-op when unset).
- Produces: client + server error capture; source-map upload gated on `SENTRY_AUTH_TOKEN` being present in CI/prod only.

- [ ] **Step 1: Install**

```bash
npm install @sentry/nextjs
```

- [ ] **Step 2: Config files (all three) guard on the DSN**

`sentry.client.config.ts`:

```ts
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({ dsn, tracesSampleRate: 0.1, replaysOnErrorSampleRate: 1.0, replaysSessionSampleRate: 0 });
}
```

`sentry.server.config.ts` and `sentry.edge.config.ts`: same guard, `Sentry.init({ dsn, tracesSampleRate: 0.1 })`.

`src/instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}
```

- [ ] **Step 3: Wrap `next.config.ts`**

```ts
import { withSentryConfig } from "@sentry/nextjs";
// ...existing nextConfig with headers()...
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableSourceMapUpload: !process.env.SENTRY_AUTH_TOKEN,
});
```

- [ ] **Step 4: Add the new env names to `.env.example`**

```dotenv
SENTRY_ORG=
SENTRY_PROJECT=
```

- [ ] **Step 5: Verify build succeeds with no DSN set**

Run: `npm run build`
Expected: success; Sentry logs that it is disabled (no DSN).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: integrate Sentry, no-op without a DSN

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 15: Playwright E2E for the auth journey

**Files:**
- Create: `playwright.config.ts`, `e2e/auth.spec.ts`, `e2e/helpers/mailbox.ts`
- Modify: `package.json` (already has `test:e2e`), `.gitignore` (already covers reports)

**Interfaces:**
- Consumes: the running app + `kanbo-dev`. Uses the Supabase admin API (service role) to read the latest confirmation link for a throwaway address, OR uses `supabase.auth.admin.generateLink`. Because `SUPABASE_SERVICE_ROLE_KEY` is available in `.env.local`, the helper calls `generateLink` server-side within the test's Node context.
- Produces: one E2E spec proving signup → confirm → protected access → sign-out → guard.

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Mailbox helper via Supabase admin**

`e2e/helpers/mailbox.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function confirmationUrlFor(email: string, password: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { redirectTo: "http://localhost:3000/auth/confirm" },
  });
  if (error) throw error;
  return data.properties.action_link;
}

export async function deleteUser(email: string): Promise<void> {
  const { data } = await admin.auth.admin.listUsers();
  const user = data.users.find((u) => u.email === email);
  if (user) await admin.auth.admin.deleteUser(user.id);
}
```

- [ ] **Step 4: Write the spec**

`e2e/auth.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { confirmationUrlFor, deleteUser } from "./helpers/mailbox";

const email = `e2e+${Date.now()}@kanbo.test`;
const password = "correcthorsebattery";

test.afterAll(async () => {
  await deleteUser(email);
});

test("sign up, confirm email, reach protected page, sign out, get guarded", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email/);

  const link = await confirmationUrlFor(email, password);
  await page.goto(link);
  await expect(page).toHaveURL(/\/projects/);
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects/);
});
```

> Note: `generateLink` with `type: "signup"` both creates the user and returns the confirm link, so the form submission above may collide. If it does, change the spec to submit the form first, then call `admin.auth.admin.generateLink({ type: "magiclink", email })` to fetch a fresh link for the already-created user, or confirm the user directly with `admin.auth.admin.updateUserById(id, { email_confirm: true })` and then navigate to `/projects`.

- [ ] **Step 5: Run the E2E suite**

Run: `npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: end-to-end auth journey with Playwright

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 16: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: all prior scripts.
- Produces: a CI workflow running on every push and PR: install → typecheck → lint → unit tests → build. E2E runs in a separate job gated on repository secrets being present (skipped on forks).

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder-anon-key
          NEXT_PUBLIC_SITE_URL: http://localhost:3000

  e2e:
    runs-on: ubuntu-latest
    needs: verify
    if: ${{ github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.STAGING_SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.STAGING_SUPABASE_SERVICE_ROLE_KEY }}
          NEXT_PUBLIC_SITE_URL: http://localhost:3000
```

- [ ] **Step 2: Note the required GitHub secrets**

Add to `.env.example` as a comment block, and tell the operator to set repository secrets `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` once `kanbo-staging` exists (Task 17). Until then the `e2e` job will fail on missing secrets — mark it `continue-on-error: true` temporarily and remove that line in Task 17.

- [ ] **Step 3: Validate the YAML locally**

Run: `npx --yes yaml-lint .github/workflows/ci.yml` (or `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))"`)
Expected: parses cleanly.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "ci: add typecheck/lint/test/build and gated e2e workflow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93"
```

---

## Task 17: Vercel deploy skeleton + staging Supabase

**Files:**
- Create: `vercel.json` (optional — only if header/region overrides are needed; otherwise skip)
- Modify: `.env.example` (document the Vercel-set vars)

**Interfaces:**
- Consumes: the built app.
- Produces: a deployed preview URL on Vercel wired to `kanbo-staging`; `main` deploying to a production URL wired to `kanbo-prod` (prod DB schema is empty until Plan 1B migrations run).

> Interactive operator steps.

- [ ] **Step 1: Create the staging and prod Supabase projects**

```
! npx --yes supabase projects create kanbo-staging --org-id <ORG_ID> --region ap-south-1 --db-password "<PW>"
! npx --yes supabase projects create kanbo-prod --org-id <ORG_ID> --region ap-south-1 --db-password "<PW>"
```

Configure each project's Auth URL config: staging Site URL = the Vercel preview pattern / a stable staging domain; prod Site URL = the production domain. Add `/auth/callback` and `/auth/confirm` redirect URLs for each.

- [ ] **Step 2: Push the repo to GitHub**

```
! gh repo create kanbo --private --source . --push
```

(or create the repo in the GitHub UI and `git remote add origin … && git push -u origin feat/1a-foundation-auth`)

- [ ] **Step 3: Import into Vercel and set env vars**

```
! npx --yes vercel link
! npx --yes vercel env add NEXT_PUBLIC_SUPABASE_URL preview
! npx --yes vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview
! npx --yes vercel env add NEXT_PUBLIC_SITE_URL preview
! npx --yes vercel env add NEXT_PUBLIC_SUPABASE_URL production
! npx --yes vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
! npx --yes vercel env add NEXT_PUBLIC_SITE_URL production
! npx --yes vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

Preview vars point at `kanbo-staging`; production vars at `kanbo-prod`. Do **not** put the service-role key in `preview` unless E2E needs it there — if so, scope it carefully.

- [ ] **Step 4: First deploy**

```
! npx --yes vercel deploy
```

Visit the preview URL, confirm the landing page and `/login` render and that `/projects` redirects to `/login`.

- [ ] **Step 5: Set GitHub Actions secrets for the gated E2E job**

```
! gh secret set STAGING_SUPABASE_URL
! gh secret set STAGING_SUPABASE_ANON_KEY
! gh secret set STAGING_SUPABASE_SERVICE_ROLE_KEY
```

Then remove the temporary `continue-on-error: true` from `.github/workflows/ci.yml` if it was added.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feat/1a-foundation-auth
gh pr create --fill --base main
```

PR description ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01FtzuvPP7j19GjU2ndxAj93
```

- [ ] **Step 7: Confirm CI is green on the PR, then commit any workflow fix**

```bash
git add -A
git commit -m "ci: finalize e2e secrets wiring" --allow-empty
git push
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| Next.js 15 App Router + TS strict scaffold (`06 §2`) | 1 |
| Lint/format/pre-commit (`06 §5`) | 2 |
| Tailwind 4 + shadcn/ui + semantic tokens (`06 §2`, `02 §23`) | 3 |
| Vitest + Testing Library (`06 §5`) | 4, 10 |
| Zod shared validation (`07 §5`) | 4, 9 |
| Secrets never `NEXT_PUBLIC_` + lint guard (`07 §8`) | 5 |
| Supabase provisioning, `ap-south-1` (M2) | 6, 17 |
| `@supabase/ssr` cookie sessions, no localStorage (`03 §6`, `07 §3`) | 7 |
| Middleware session refresh + route guards (`03 §6`) | 7, 8 |
| Enumeration resistance (`07 §2`) | 8, 9 |
| Email/password auth, 10-char min (`07 §2`, `05 §3`) | 4, 9, 10 |
| Email verification gate (`07 §2`) | 7, 11, 12 |
| Password reset flow (`05 §3`, `02 §S10`) | 9, 10, 11 |
| Google OAuth (`01 §21`, `05 §3`) | 6, 10, 11 |
| Auth screen layout — Google above divider, blur validation, generic errors (`02 §S10`) | 10 |
| `404 not 403` / server re-verification principle (`03 §6`) | 12 (server-side `getUser` check) |
| Security headers + CSP, `frame-ancestors 'none'` (`07 §5`, `07 §18.10`) | 13 |
| Sentry with release tagging (`03 §16`, `06 §4`) | 14 |
| Playwright E2E for auth (`06 §5`) | 15 |
| CI: typecheck → lint → test → build (`03 §24`) | 16 |
| Preview never points at prod DB (`03 §24`, `07 §13`) | 17 |
| Conventional commits, frequent (`writing-plans`) | every task |

Gaps intentionally deferred: `users` profile-mirror table + `handle_new_user` trigger, RLS, pgTAP, rate limiting on auth endpoints, `AppError` envelope, structured request logging → **Plan 1B** (they need the schema and the Route Handler layer, neither of which exists yet). `display_name` captured at signup is stored in `auth.users.user_metadata` here and copied into the `users` row by the 1B trigger. Rate limiting on `/auth/*` is a Supabase dashboard setting (enable "rate limits" for email + token endpoints) plus the app-level limiter in 1B; note it for the operator during Task 6.

**2. Placeholder scan:** No "TBD"/"handle appropriately" left. Task 4 Step 4 and Task 10 Step 4 describe building sibling forms "following the exact structure of" a fully-shown reference component — the reference code is present in the same task, which the No-Placeholders rule permits (the pattern is shown, not deferred). Task 15 Step 4 carries an explicit fallback note because Supabase's `generateLink` semantics vary by project setting; both branches are spelled out.

**3. Type consistency:**
- `ActionResult` defined in Task 9 (`{ ok: true } | { ok: false; message; fieldErrors? }`); consumed unchanged in Task 10.
- `createClient` is the name in both `lib/supabase/client.ts` (sync) and `lib/supabase/server.ts` (async) — deliberate, matching Supabase's own docs; tests and callers `await` the server one.
- `securityHeaders()` return shape `{ key; value }[]` defined Task 13, consumed by `next.config.ts` in the same task.
- `mapAuthError` signature identical in Task 8 (definition) and Task 9 (use).
- `confirmationUrlFor` / `deleteUser` defined and used within Task 15.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-08-kanbo-1a-foundation-auth.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Tasks 6 and 17 pause for you to run interactive `login` / `create` commands.

**2. Inline Execution** — I execute tasks in this session using executing-plans, with checkpoints for your review.

**Which approach?**
