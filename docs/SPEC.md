# Multi-functional Creator — Product Spec

A professional, multi-platform **control panel for creating other panels, sites, apps and APIs**, with a
secure secrets vault, a pro web 3D studio, motion tools, deployment, monitoring and an expert-level AI copilot.
Target: **500+ functions**, all reachable from the command palette.

## Decisions (from requirements interview)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Platforms | Web + Desktop + Mobile |
| 2 | Stack | React + TypeScript (Next.js/Vite web, Tauri desktop, Expo/React Native mobile) |
| 3 | Backend | Self-hosted Node API (Fastify/NestJS) + PostgreSQL |
| 4 | Users | Team now, SaaS later — multi-tenant workspaces from day one, billing off unless Stripe is configured |
| 5 | Auth | Magic-link (passwordless) login |
| 6 | Builder | Visual drag-and-drop + Monaco code editor, two-way synced |
| 7 | Outputs | Websites & landing pages, admin panels & dashboards, web & mobile apps, APIs & backend services |
| 8 | Vault | AES-256-GCM envelope encryption, master key outside DB, masked by default, audited reveals, per project × environment scoping |
| 9 | Vault extras | Auto-inject at deploy, rotation & expiry alerts with version history, `.env` import/export, leak scanner |
| 10 | 3D | Pro web 3D studio (Three.js): primitives, mesh editing (extrude/bevel/subdivide), PBR materials, lights, cameras, keyframe timeline + curve editor, GLTF/OBJ/FBX import/export, embeddable scenes |
| 11 | Motion | UI micro-interactions, timeline motion editor, Lottie/SVG animation, MP4/WebM/GIF export |
| 12 | Deploy | Vercel/Netlify, own VPS/Docker (SSH, Nginx, SSL), AWS/GCP/Railway, GitHub + App Store/Google Play (Expo EAS) |
| 13 | AI | **Forge**, a built-in engine that works on its own with **no AI model by default** (not even Claude): multilingual request understanding, planning and execution through panel tools. AI models — Claude or OpenAI-compatible providers — are **optional add-ons**, off until an admin enables them. API keys live in the vault |
| 14 | Panel style | Fully themeable — built-in themes + theme editor |
| 15 | Languages | English, Uzbek (Latin), Russian; i18n-ready for more |
| 16 | Library | 100+ UI components, project templates, 3D asset library, marketplace/sharing |
| 17 | Data tools | Visual DB designer + migrations, data browser/SQL console, API connector & tester, workflow automation |
| 18 | Collaboration | Real-time co-editing (Yjs), comments & mentions, version history & branches + Git, activity/audit log |
| 19 | Monitoring | Live logs & errors, analytics (incl. Core Web Vitals), uptime & health checks, notifications hub (email/Telegram/Slack/push) |
| 20 | Media | Image editor (incl. vector/SVG, background removal, AI images), brand kit/design tokens, icon & font manager, asset manager/CDN |
| 21 | UX | Command palette (Ctrl+K), onboarding & guided tours, dockable/customizable workspace, plugin/extension SDK |
| 22 | Delivery | Phased; each phase runnable and pushed |

## Phases

All six phases are shipped, and each one was runnable and pushed when it landed.

1. ✅ **Foundation + core**: monorepo, app shell, themes + theme editor, i18n (en/uz/ru), function registry +
   command palette, magic-link auth, workspaces/roles, Secrets Vault, visual + code builder, 3D studio, Forge copilot.
2. ✅ **Builder depth**: component library (100+), templates, exporters (React/Next/RN/API), data tools.
   Shipped: static/Next.js/Expo project ZIPs; API tester (server-side, SSRF-guarded, vault templating); database
   browser (Postgres/MySQL/MongoDB, read-only by default, audited); schema designer with migration diffs; Fastify +
   Postgres API generator with OpenAPI; workflow engine (manual/webhook/cron; HTTP/condition/set/delay/email/log/
   transform) with run history; Forge intents for backends and exports.
   Design notes:
   - Outbound requests resolve DNS at connect time and refuse private, loopback and link-local addresses unless
     `ALLOW_PRIVATE_NETWORK=1`.
   - Database URLs are vault secrets, decrypted only per request.
   - Workflow logs are redacted of every secret value used.
   - Scheduled runs are de-duplicated by a unique `(workflow_id, scheduled_for)` index, so a long-running scheduler
     and `/api/cron/tick` can coexist.
3. ✅ **Deploy & ops**:
   - Deploy targets: Vercel, Netlify, GitHub (Pages branch), S3-compatible storage (SigV4), SSH/SFTP with a generated
     Nginx config, and signed webhooks. Vault tokens are resolved at deploy time; deployment history, redeploy and
     rollback.
   - Uptime monitors with incidents and public status pages.
   - Cookieless analytics (page views, referrers, Core Web Vitals, JS errors).
   - Notification channels: email, Telegram, Slack, Discord, webhook, and (Phase 6) push.
   - Deviation: AWS/GCP/Railway are covered through S3-compatible storage, SSH or a webhook to their deploy hooks,
     not dedicated providers. Publishing user projects to app stores goes through the Expo export + EAS, not one click.
4. ✅ **Creative depth**:
   - Motion timeline (bezier easing → CSS/WAAPI), 17 builder motion presets, Lottie player.
   - WebM/GIF recording of 3D scenes. Deviation: MP4 is not offered, because browsers record WebM natively.
   - Image editor and vector (SVG) editor, brand kit, icon and Google Fonts browser.
   - Asset store with public URLs, dedupe and per-workspace quota; 3D asset library.
5. ✅ **Collaboration & ecosystem**:
   - Live presence and selections over SSE.
   - Comments with @mentions and notifications.
   - Automatic and named versions, restore, branches and merge.
   - Marketplace for templates, scenes, schemas, APIs, workflows, brand kits and plugins; sandboxed plugin runtime
     with a permissioned SDK.
   - Deviation from decision 18: co-editing is page-level with optimistic concurrency and live reload rather than
     character-level Yjs merging. Git integration is the GitHub deploy provider, not in-panel Git.
6. ✅ **Platforms**:
   - Tauri 2 desktop app (Windows/macOS/Linux) with a connect screen, native downloads, tray and single instance;
     the remote page gets no IPC.
   - Expo mobile app (Android/iOS): WebView panel with push, biometric lock and native file saving.
   - 6-digit sign-in codes for the native apps.
   - Web Push for the PWA and Expo push for mobile.
   - Stripe SaaS billing (Free/Pro/Team limits, Checkout, Customer Portal, signed idempotent webhooks), off unless
     configured.
   - GitHub Actions for CI, desktop installers and EAS mobile builds.

Cross-cutting work added along the way:
- **Every device**: responsive layouts down to 360 px with tabbed panes on small screens, and an installable PWA.
- **Forge brain**:
  - A trilingual knowledge base with BM25 search, a code fixer, and a naive Bayes intent classifier trained from
    feedback.
  - Continuous self-tests and bandit design experiments; house-style mining from projects and imports.
  - Team memory synced through the server; the Forge Lab page.
- **Academy**: a narrated, animated course generated from the knowledge base and the registry. It rebuilds itself
  as both grow, and lessons export as WebM video.
