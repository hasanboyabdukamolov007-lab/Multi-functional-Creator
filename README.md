# Multi-functional Creator

A professional control panel for building **websites, admin panels, web & mobile apps, APIs and 3D scenes** — with a
secure **Secrets Vault** and **Forge**, a built-in expert AI copilot that can operate the whole panel.

Everything in the panel is a registered *function* (currently **522**): reachable from the command palette
(<kbd>Ctrl/⌘ K</kbd>), keyboard shortcuts, and the copilot.

> Status: **Phase 1** of 6 (see [`docs/SPEC.md`](docs/SPEC.md)). Modules marked *P2–P5* in the sidebar are on the roadmap.

## What's in Phase 1

| Module | Highlights |
|---|---|
| **Builder** | 54 components (layout, typography, media, forms, data, navigation, sections, feedback, custom HTML) defined once and rendered to the canvas, **HTML** and **React**. Drag-and-drop canvas + layers tree, double-click inline text editing, inspector, multiple pages, site design tokens, 9 templates (SaaS landing, admin dashboard, portfolio, pricing, blog, contact, coming soon, e-commerce, mobile app), desktop/tablet/mobile preview, undo/redo, clipboard, Monaco code panel with **two-way** JSON sync, leak scan on every export, autosave. |
| **3D Studio** | 14 primitives, 6 extruded shapes with bevel, Loop subdivision, physical (PBR) materials with 24 presets, 5 light types and lighting rigs, offline studio/sunset/night/warehouse environments, shadows, fog, transform gizmo (world/local, snapping), outliner, keyframe **timeline** with 8 easings and auto-key, scene presets, import **GLB/GLTF/OBJ/FBX/STL**, export **GLB/GLTF/OBJ/STL/PNG/JSON**. |
| **Secrets Vault** | AES-256-GCM **envelope encryption** (fresh data key per version, master key outside the DB, AAD-bound ciphertexts, master-key rotation), per-environment (dev/staging/prod) and per-project scopes, masked values with **audited** reveal/copy, versions + rollback, expiry & rotation alerts, `.env` import/export, deploy-time resolution (project overrides workspace), leak scanner. |
| **Forge copilot** | Agentic Claude copilot (default **Claude Opus 5.5**; Fable 5.2 / Sonnet 5.5 / Haiku 5.5 selectable, effort low→max) with 22 workspace tools: inspect state, search & run any panel function, create/open projects, generate and edit pages, model/animate 3D scenes, set themes; plus web search & fetch. Streams thinking summaries and tool activity. Its API key lives in the vault. **Other AI providers are optional**: OpenAI-compatible endpoints can be added in Settings → AI; none are enabled by default. |
| **Shell** | 12 built-in themes + live **theme editor** (import/export), English / O‘zbekcha / Русский, command palette, shortcuts, dockable/resizable panels, onboarding tour, toasts. |
| **Teams** | Passwordless **magic-link** sign-in, multi-tenant workspaces, owner/admin/editor/viewer roles, **audit log** of sign-ins, reveals, exports and settings changes. |

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

To enable Forge, add a secret named `ANTHROPIC_API_KEY` in the Secrets Vault (the copilot panel has a one-click button).

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
project overrides, role enforcement and workspace isolation, copilot configuration).

## Roadmap

2. Component library to 100+, exporters (Next.js / React Native / API generator), data & API tools, workflows
3. Deploy targets (Vercel, Netlify, VPS/Docker, AWS/GCP/Railway, GitHub, app stores) with vault injection; monitoring
4. Motion timeline & Lottie, video/GIF export, image & vector editor, brand kit, asset manager/CDN, 3D asset library
5. Real-time co-editing, comments, version history & Git, marketplace, plugin SDK
6. Desktop (Tauri) and mobile (Expo) apps, SaaS billing
