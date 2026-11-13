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
| 4 | Users | Team now, SaaS later — multi-tenant workspaces from day one, billing off |
| 5 | Auth | Magic-link (passwordless) login |
| 6 | Builder | Visual drag-and-drop + Monaco code editor, two-way synced |
| 7 | Outputs | Websites & landing pages, admin panels & dashboards, web & mobile apps, APIs & backend services |
| 8 | Vault | AES-256-GCM envelope encryption, master key outside DB, masked by default, audited reveals, per project × environment scoping |
| 9 | Vault extras | Auto-inject at deploy, rotation & expiry alerts with version history, `.env` import/export, leak scanner |
| 10 | 3D | Pro web 3D studio (Three.js): primitives, mesh editing (extrude/bevel/subdivide), PBR materials, lights, cameras, keyframe timeline + curve editor, GLTF/OBJ/FBX import/export, embeddable scenes |
| 11 | Motion | UI micro-interactions, timeline motion editor, Lottie/SVG animation, MP4/WebM/GIF export |
| 12 | Deploy | Vercel/Netlify, own VPS/Docker (SSH, Nginx, SSL), AWS/GCP/Railway, GitHub + App Store/Google Play (Expo EAS) |
| 13 | AI | Super-powered agentic copilot with expert-level skill: plans, generates, debugs, designs, writes copy, builds 3D scenes, deploys. Claude by default (strongest model), multi-provider capable; API keys kept in the vault |
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

1. **Foundation + core** — monorepo, app shell, themes + theme editor, i18n (en/uz/ru), function registry +
   command palette, magic-link auth, workspaces/roles, Secrets Vault, visual+code builder, 3D studio,
   AI copilot, every module scaffolded and registered.
2. **Builder depth** — component library (100+), templates, exporters (React/Next/RN/API), data tools.
3. **Deploy & ops** — deploy targets, secret injection, monitoring, notifications.
4. **Creative depth** — motion timeline, Lottie, video export, image editor, assets/CDN, 3D asset library.
5. **Collaboration & ecosystem** — real-time co-editing, comments, versioning/Git, marketplace, plugin SDK.
6. **Platforms** — Tauri desktop and Expo mobile packaging, billing for SaaS.
