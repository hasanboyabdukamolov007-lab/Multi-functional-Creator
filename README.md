# Multi-functional Creator

A professional control panel for building **websites, admin panels, web & mobile apps, APIs and 3D scenes**, then
deploying, monitoring and sharing them. It includes a secure **Secrets Vault** and **Forge**, a built-in copilot that
operates the whole panel with **no AI model required**.

Everything in the panel is a registered *function* (currently **650+**). Each one is reachable from the command palette
(<kbd>Ctrl/⌘ K</kbd>), keyboard shortcuts and Forge.

> Status: all **6 phases** of [`docs/SPEC.md`](docs/SPEC.md) are shipped. The panel runs in any browser, installs as
> an app (PWA), and has a desktop app for Windows/macOS/Linux ([`apps/desktop`](apps/desktop)) and a mobile app
> for Android/iOS ([`apps/mobile`](apps/mobile)).

## Modules

| Area | Highlights |
|---|---|
| **Builder** | 100+ components and 9 templates on a drag-and-drop canvas with inline editing, an inspector, layers, site design tokens, Google Fonts and 17 motion presets. Phone/tablet/desktop preview; a Monaco code panel with two-way JSON sync; an accessibility checker. Exports static HTML, React, a **Next.js** project or a **React Native / Expo** app, and every export is scanned for leaked secrets. |
| **3D Studio** | Primitives, extruded and bevelled shapes, subdivision, PBR materials (24 presets), lights, environments and shadows. A keyframe timeline, a 14-model asset library, and import of GLB/GLTF/OBJ/FBX/STL. Exports GLB/GLTF/OBJ/STL/PNG plus **WebM/GIF recordings**. |
| **Motion** | Timeline editor with bezier easing; exports CSS keyframes or Web Animations code; a Lottie player. |
| **Media & Brand** | Asset store with public URLs (deduplicated, 1 GB per workspace, WebP optimisation on the device), image editor, vector (SVG) editor, brand kit, icon and font browser. |
| **Secrets Vault** | AES-256-GCM **envelope encryption** with the master key outside the DB and master-key rotation. Per-environment and per-project scopes; masked values with **audited** reveal; versions and rollback; expiry and rotation alerts; `.env` import/export; a leak scanner. Secrets are injected into API calls, workflows and deploys as `{{ secrets.NAME }}`. |
| **Data & APIs** | Server-side API tester (SSRF-guarded). Database browser for Postgres/MySQL/MongoDB, read-only by default and audited. Schema designer with migration diffs and live-DB import. Fastify + Postgres **API generator** with OpenAPI. **Workflows** with webhook and cron triggers. |
| **Deploy** | Targets: **Vercel, Netlify, GitHub (Pages), S3-compatible storage** (AWS, R2, B2… via SigV4), **your own server over SSH/SFTP** (with a generated Nginx config), or a signed webhook. Vault tokens are injected at deploy time; history, redeploy and rollback included. |
| **Monitoring** | Uptime monitors with incidents and a **public status page**. Cookieless analytics snippet: page views, referrers, Core Web Vitals, JS errors. Alerts to email, Telegram, Slack, Discord, webhooks or **push to phones**. |
| **Collaboration** | **Live presence** (avatars and teammates' selections), threaded **comments with @mentions** (in-app, email and push), automatic and named **versions**, restore, **branches and merge**. |
| **Ecosystem** | **Marketplace** for sharing templates, 3D scenes, schemas, APIs, workflows, brand kits and plugins with your team or publicly. **Plugin SDK**: plugins run in a sandboxed iframe and can only use the permissions their manifest declares. |
| **Forge** | Works offline in English, O‘zbekcha and Русский. It plans and runs multi-step requests with the panel's own tools: pages, 3D scenes, databases and APIs, exports, themes, vault audits. It answers and teaches web, CSS, JS/TS, React, APIs, databases, security, DevOps, design and 3D from a built-in knowledge base, fixes HTML/CSS/JS/JSON/SQL, and quizzes you. **AI add-ons** (Claude or OpenAI-compatible) are optional and off by default. |
| **Forge Lab** | Shows what Forge has learned and how. It trains an on-device classifier from your 👍/👎 and confirmed commands, keeps testing itself on paraphrases, runs design experiments (a Thompson-sampling bandit), and mines your projects and imports for your house style. Team memory syncs through the server. |
| **Academy** | A narrated, animated video course generated from Forge's knowledge and the function registry (106 lessons, about 100 minutes, en/uz/ru). It rebuilds itself as Forge learns and new functions appear. Lessons export as WebM video. |
| **Teams & billing** | Passwordless sign-in by **magic link or 6-digit code**, multi-tenant workspaces, owner/admin/editor/viewer roles, an audit log, and device/session management. Optional **Stripe billing** with Free/Pro/Team plans and usage limits. |

**On every device.** The UI adapts from 4K screens down to 360 px phones: tabbed panes on small screens, touch
targets sized for fingers, and no horizontal scrolling. It installs from the browser as a PWA (offline shell, Web Push).
Native shells are in `apps/desktop` (Tauri 2) and `apps/mobile` (Expo); Settings → Devices & apps links them and shows
a QR code for opening the panel on a phone.

**What Forge is, honestly:** a deterministic planner plus on-device statistical learning (BM25 retrieval, naive Bayes
intent classification, bandit experiments). It is not a large language model. It's fast, private and free, and it
improves from use. For open-ended writing or reasoning, enable an AI add-on in Settings → AI.

## Quick start (development)

Requirements: Node 20+ and pnpm 10.

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:5173, enter any email, and either click **Open sign-in link** or type the code shown on screen.
Without SMTP in development, both appear in the UI and the server log. Data is stored in an embedded PostgreSQL
(PGlite) under `apps/server/data/`, and a development vault key is generated there automatically.

Forge works immediately: press <kbd>Ctrl/⌘ J</kbd> and describe what you want, or ask it to *"teach me CSS grid"*.

## Production (single process)

```bash
pnpm build
```

```bash
NODE_ENV=production VAULT_MASTER_KEY="$(openssl rand -base64 32)" PUBLIC_URL=https://panel.example.com SMTP_URL=smtps://user:pass@smtp.example.com:465 pnpm start
```

The API serves the built web app on one origin (default port 8787). Keep `VAULT_MASTER_KEY` in your host's secret
store, because losing it makes vault values unrecoverable. Set `DATABASE_URL` to use an external PostgreSQL. Every
option, including billing, push and download links, is documented in [`apps/server/.env.example`](apps/server/.env.example).

## Deploy on Vercel

The repo is Vercel-ready (`vercel.json` + `scripts/vercel-build.mjs`): the web app is served from Vercel's CDN and the
API runs as one streaming Node function.

1. **Import** the GitHub repo at vercel.com → *Add New… → Project*. Leave the build settings as they are; the *Root Directory* can be the repo root or `apps/web` (both contain a `vercel.json`).
2. **Database:** in the project's *Storage* tab, create a **Neon Postgres** database and connect it. This sets
   `DATABASE_URL` automatically. Any Postgres works (Supabase, Neon, RDS…); for those, set `DATABASE_URL` yourself.
3. **Environment variables** (*Settings → Environment Variables*):
   - `VAULT_MASTER_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`). Back it up; without it, vault values
     can't be decrypted.
   - `SMTP_URL`: for sign-in emails. For example, Gmail with an app password:
     `smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`
   - `MAIL_FROM`: for example, `Multi-functional Creator <you@gmail.com>`
4. **Redeploy**, open your `*.vercel.app` URL and sign in. Forge works right away; AI add-ons are optional.

**Scheduled work on Vercel** (workflows, uptime checks): set `CRON_SECRET` and add a cron job that calls
`GET /api/cron/tick` with `Authorization: Bearer <CRON_SECRET>` every minute. This can be Vercel Cron or any external
pinger; Vercel's Hobby plan only allows daily crons, so use an external pinger there. On a long-running server the
built-in scheduler needs nothing.

Limits on Vercel: request bodies are capped at 4.5 MB, so single uploads to the asset store top out at about 3 MB
there (15 MB on your own server), and a copilot turn or live-collaboration stream runs up to 300 s before the client
reconnects.

## Turning on SaaS billing (optional)

Without Stripe, billing is off and every workspace is unlimited, which suits self-hosting. To sell plans:

1. In Stripe, create two recurring prices (Pro and Team) and a webhook endpoint
   `https://<your-domain>/api/billing/webhook` with the events `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and
   `invoice.payment_failed`. Enable the Customer Portal.
2. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM` (optionally
   `STRIPE_TRIAL_DAYS`) and redeploy.

New workspaces start on Free (3 projects, 2 members, 250 MB). Owners upgrade in **Settings → Billing** through Stripe
Checkout and manage cards or cancel in the Customer Portal. Card data never reaches this server. Limits apply when
something new is created, and downgrading never deletes anything. Workspaces that existed before billing was turned
on keep their plan.

## Desktop and mobile apps

- **Desktop** ([`apps/desktop`](apps/desktop)): run the *Desktop release* GitHub Action, or `npm run build` locally,
  to get Windows/macOS/Linux installers. Users enter the panel address and sign in with the email code.
- **Mobile** ([`apps/mobile`](apps/mobile)): build with EAS (the *Mobile build* action or `eas build`) to get an
  installable APK or store bundles. It adds push notifications, a Face ID / fingerprint lock and native file saving.

Set `DESKTOP_DOWNLOAD_URL`, `ANDROID_DOWNLOAD_URL` and `IOS_DOWNLOAD_URL` so Settings → Devices & apps links to your
builds.

## Architecture

```
packages/core   Shared TypeScript: function registry, roles & permissions, plans & limits, .env parser, leak scanner
apps/server     Fastify API: auth, workspaces, projects, vault (envelope crypto), audit, data tools, workflows,
                deploy providers, monitoring & analytics, assets, collaboration, marketplace & plugins, billing, push
apps/web        React + Vite panel: shell, builder, 3D studio, motion, media, vault, data, deploy, monitoring,
                collaboration, marketplace, plugins, Forge brain & Lab, Academy, PWA
apps/desktop    Tauri 2 desktop shell (Rust)
apps/mobile     Expo / React Native mobile shell
docs/SPEC.md    Product decisions and phases
```

- **Security**:
  - httpOnly session cookies and a CSRF header check on every state-changing request.
  - Per-route rate limits, role checks on every endpoint, and workspace isolation.
  - Secrets are never returned in list responses or shown to Forge or AI add-ons.
  - All outbound requests go through an SSRF guard. Webhooks are signature-verified.
  - Plugins are sandboxed, and the native shells give the remote page no native API access.
- **Live collaboration** uses Server-Sent Events plus optimistic concurrency: every save carries the version it
  started from, so nobody silently overwrites a teammate.
- **Copilot add-ons**: the browser owns the agent loop. Each turn streams from `POST /api/w/:id/ai/turn`, and tool
  calls run client-side against the live workspace.

## Tests

```bash
pnpm test
```

```bash
pnpm --filter @mfc/web test
```

- **Server**: vault crypto (including tampering and key rotation) and sign-in links and codes (attempt limits).
  Roles and workspace isolation, plus the SSRF guard, templating, cron, workflows and the API tester.
  Deploy providers and notification channels, run against mock services.
  Uptime, analytics, assets, comments and mentions, versions and branches, the marketplace and plugins.
  Stripe billing against a mock Stripe (signature checks, idempotency, plan changes, limits), Web Push encryption and
  VAPID signing, and Expo push. With `TEST_PG_URL` set, the database browser runs against a real PostgreSQL.
- **Web**: the Forge planner and brain (search in three languages, the code fixer, the classifier, self-training).
  The Academy, the generators and exporters, the motion timeline, i18n completeness, and that every function and
  lesson link is registered.
- **Desktop**: `cargo test` in `apps/desktop/src-tauri`.
- **Mobile**: `npx tsc --noEmit` and `npx expo export` in `apps/mobile`.
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs all of these on every push.
