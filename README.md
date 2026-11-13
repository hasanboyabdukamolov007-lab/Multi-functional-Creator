# Multi-functional Creator

A professional control panel for building **websites, admin panels, web & mobile apps, APIs and 3D scenes** — with a
secure **Secrets Vault** and **Forge**, a built-in expert AI copilot that can operate the whole panel.

Everything in the panel is a registered *function* (currently **620**): reachable from the command palette
(<kbd>Ctrl/⌘ K</kbd>), keyboard shortcuts, and the copilot.

> Status: **Phase 2** of 6 complete (see [`docs/SPEC.md`](docs/SPEC.md)). Modules marked *P3–P5* in the sidebar are on the roadmap.

## What's in Phase 1

| Module | Highlights |
|---|---|
| **Builder** | 54 components (layout, typography, media, forms, data, navigation, sections, feedback, custom HTML) defined once and rendered to the canvas, **HTML** and **React**. Drag-and-drop canvas + layers tree, double-click inline text editing, inspector, multiple pages, site design tokens, 9 templates (SaaS landing, admin dashboard, portfolio, pricing, blog, contact, coming soon, e-commerce, mobile app), desktop/tablet/mobile preview, undo/redo, clipboard, Monaco code panel with **two-way** JSON sync, leak scan on every export, autosave. |
| **3D Studio** | 14 primitives, 6 extruded shapes with bevel, Loop subdivision, physical (PBR) materials with 24 presets, 5 light types and lighting rigs, offline studio/sunset/night/warehouse environments, shadows, fog, transform gizmo (world/local, snapping), outliner, keyframe **timeline** with 8 easings and auto-key, scene presets, import **GLB/GLTF/OBJ/FBX/STL**, export **GLB/GLTF/OBJ/STL/PNG/JSON**. |
| **Secrets Vault** | AES-256-GCM **envelope encryption** (fresh data key per version, master key outside the DB, AAD-bound ciphertexts, master-key rotation), per-environment (dev/staging/prod) and per-project scopes, masked values with **audited** reveal/copy, versions + rollback, expiry & rotation alerts, `.env` import/export, deploy-time resolution (project overrides workspace), leak scanner. |
| **Forge copilot** | **Works on its own — no AI model, no API key.** A built-in engine that understands English, O‘zbekcha and Русский, plans multi-step requests and carries them out with the panel's own tools: industry-aware pages in 12 domains (landing, dashboard, store, portfolio, blog, pricing, contact, coming soon, mobile) written in your language, component inserts and restyling, site palettes, 3D scenes from descriptions (shapes, counts, colors, 24 materials, layouts, pedestal, lighting, environments, animations), panel themes, navigation, vault audits, leak scans, exports and any of 500+ functions. **AI add-ons are optional and off by default**: an admin can enable Claude (agentic, with web search) or add OpenAI-compatible providers in Settings → AI. |
| **Shell** | 12 built-in themes + live **theme editor** (import/export), English / O‘zbekcha / Русский, command palette, shortcuts, dockable/resizable panels, onboarding tour, toasts. |
| **Teams** | Passwordless **magic-link** sign-in, multi-tenant workspaces, owner/admin/editor/viewer roles, **audit log** of sign-ins, reveals, exports and settings changes. |

## What's in Phase 2

| Module | Highlights |
|---|---|
| **Builder (deeper)** | 100+ components, accessibility checker, and **project exporters**: whole site as static HTML, a **Next.js** App Router project, or a **React Native / Expo** app — each as a ZIP that builds as-is. |
| **API tester** | Postman-style requests sent **from the server** (SSRF-guarded: private networks blocked, redirects re-checked, size/time caps), `{{ secrets.NAME }}` from the vault with values masked in responses, saved requests, cURL / fetch snippets, insert JSON responses into the builder as a table. |
| **Database browser** | PostgreSQL, MySQL/MariaDB and MongoDB connections whose URLs live in the vault; schema tree, SQL console with **read-only transactions by default**, 1000-row cap, CSV/JSON export, every query audited. |
| **Schema designer** | Drag-and-drop ER diagram with foreign keys, PostgreSQL/MySQL DDL, **migration diff** against what was last applied, apply to a connected database in one click. |
| **API generator** | Describe resources → a complete **Fastify + PostgreSQL** service: CRUD with zod validation, pagination/sorting, API-key or JWT auth, SQL migrations, OpenAPI 3.1, Dockerfile, README — downloaded as a ZIP. |
| **Workflows** | Visual automations: manual, **webhook** and **cron** triggers; HTTP, condition, variables, delay, email, log and transform steps; `{{ }}` templating with vault secrets; run history with redacted logs. Scheduled runs work on a long-running server and on Vercel via `/api/cron/tick`. |
| **Forge** | Understands backend requests offline, e.g. *"create a database and API for orders with total, status and product, and customers with name, email"* (also in O‘zbekcha and Русский), and project exports (*"export as Next.js"*). |

## Quick start (development)

Requirements: Node 20+ and pnpm 10.

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:5173, enter any email and click **Open sign-in link** (in development without SMTP the link is
shown on screen and printed in the server log). Data is stored in an embedded PostgreSQL (PGlite) under
`apps/server/data/`, and a development vault key is generated there automatically.

Forge works immediately — press <kbd>Ctrl/⌘ J</kbd> and describe what you want. Optional: to use Claude as an add-on, enable it in Settings → AI and add `ANTHROPIC_API_KEY` to the Secrets Vault.

## Production (single process)

```bash
pnpm build
```

```bash
NODE_ENV=production VAULT_MASTER_KEY="$(openssl rand -base64 32)" PUBLIC_URL=https://panel.example.com SMTP_URL=smtps://user:pass@smtp.example.com:465 pnpm start
```

The API serves the built web app on one origin (default port 8787). Keep `VAULT_MASTER_KEY` in your host's secret
store — losing it makes vault values unrecoverable. Set `DATABASE_URL` to use an external PostgreSQL. All options are
documented in [`apps/server/.env.example`](apps/server/.env.example).

## Deploy on Vercel

The repo is Vercel-ready (`vercel.json` + `scripts/vercel-build.mjs`): the web app is served from Vercel's CDN and the
API runs as one streaming Node function.

1. **Import** the GitHub repo at vercel.com → *Add New… → Project*. Leave the build settings as they are; the *Root Directory* can be the repo root or `apps/web` (both contain a `vercel.json`).
2. **Database:** in the project's *Storage* tab, create a **Neon Postgres** database and connect it — this sets
   `DATABASE_URL` automatically. (Any Postgres works: Supabase, Neon, RDS… — set `DATABASE_URL` yourself.)
3. **Environment variables** (*Settings → Environment Variables*):
   - `VAULT_MASTER_KEY` — 32 random bytes, base64 (`openssl rand -base64 32`). Back it up: without it vault values
     can't be decrypted.
   - `SMTP_URL` — for sign-in emails, e.g. Gmail with an app password:
     `smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`
   - `MAIL_FROM` — e.g. `Multi-functional Creator <you@gmail.com>`
4. **Redeploy**, open your `*.vercel.app` URL and sign in. Forge works right away; AI add-ons are optional.

**Scheduled workflows on Vercel:** set `CRON_SECRET` and add a cron job (Vercel Cron or any external pinger) that
calls `GET /api/cron/tick` with `Authorization: Bearer <CRON_SECRET>` every minute (Vercel's Hobby plan allows daily
crons only, so use an external pinger there). On a long-running server the built-in scheduler needs nothing.

Limits on Vercel: request bodies are capped at 4.5 MB (so large imported 3D models can't be saved until the asset
manager ships), and a single copilot turn can run up to 300 s.

## Architecture

```
packages/core   Shared TypeScript: function registry, role/permission matrix, .env parser, leak scanner
apps/server     Fastify API — auth, workspaces, projects, vault (envelope crypto), audit, copilot turn streaming
apps/web        React + Vite panel — shell, builder, 3D studio (three.js / react-three-fiber), vault UI, copilot
docs/SPEC.md    Product decisions and phased roadmap
```

- **Copilot loop**: the browser owns the agent loop. Each turn is streamed from `POST /api/w/:id/ai/turn` (SSE); tool
  calls run client-side against the live workspace, results are appended, and the next turn starts. History is
  append-only so thinking blocks remain valid. The server holds the API key and adds web tools, prompt caching and
  server-side refusal fallbacks.
- **Security**: httpOnly session cookies, CSRF header check on every state-changing request, per-route rate limits,
  role checks on every endpoint, workspace isolation, secrets never returned in list/metadata responses and never
  shown to the copilot.

## Tests

```bash
pnpm test
```

Covers the core package (leak scanner, `.env` round-trips, roles, registry) and the API (vault crypto incl. tampering
and key rotation, magic-link auth, encrypted storage, reveal auditing, rotation/rollback, `.env` import/export with
project overrides, role enforcement and workspace isolation, copilot configuration), the network guard, templating,
cron, the API tester, workflows (webhooks, branching, secret redaction, schedule de-duplication), and — with
`TEST_PG_URL` set — the database browser against a real PostgreSQL. The web package tests the Forge planner, the SQL and
API generators and the project exporters (`pnpm --filter @mfc/web test`).

## Roadmap

2. ✅ Component library to 100+, exporters (Next.js / React Native / API generator), data & API tools, workflows
3. Deploy targets (Vercel, Netlify, VPS/Docker, AWS/GCP/Railway, GitHub, app stores) with vault injection; monitoring
4. Motion timeline & Lottie, video/GIF export, image & vector editor, brand kit, asset manager/CDN, 3D asset library
5. Real-time co-editing, comments, version history & Git, marketplace, plugin SDK
6. Desktop (Tauri) and mobile (Expo) apps, SaaS billing
