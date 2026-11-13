export const STARTERS = [
  { id: "landing", title: "Build a SaaS landing page", prompt: "Create a new site project and build a polished, conversion-focused landing page for a project-management SaaS called \"Orbit\": navbar, hero, logo cloud, features, pricing (3 plans), testimonials, FAQ and a final CTA. Use a fresh indigo/teal palette and real copy." },
  { id: "dashboard", title: "Design an admin dashboard", prompt: "Create an admin panel project with a dark sidebar dashboard for an online store: KPI stats, a revenue chart, quota progress bars and a recent-orders table. Make the tokens dark mode." },
  { id: "turntable", title: "Model a 3D product turntable", prompt: "Create a 3D scene: a ceramic pedestal with a gold torus knot on top, three-point lighting, studio environment, and a 6-second looping turntable spin with a gentle bob." },
  { id: "theme", title: "Create a theme from my brand color", prompt: "Create and apply a custom dark panel theme built around the brand color #0f766e, with good contrast and slightly rounder corners." },
  { id: "vault-audit", title: "Audit my secrets vault", prompt: "Review my vault: list what is expired, expiring or due for rotation, and give me a short prioritized rotation plan." },
  { id: "a11y", title: "Review this page for accessibility", prompt: "Review the open builder page for accessibility (contrast, heading order, alt text, labels, focus) and fix what you can directly." },
  { id: "api", title: "Write a production API service", prompt: "Write a production-ready Fastify + TypeScript REST API for a todo app with Postgres, JWT auth, input validation with zod, and tests. Read secrets from environment variables and tell me which ones to add to the vault." },
  { id: "translate", title: "Translate the page to Uzbek", prompt: "Add an Uzbek version of the current builder page as a new page, translating all copy naturally." },
  { id: "logo3d", title: "Make a 3D animated logo", prompt: "Create a 3D scene with an extruded, bevelled star in chrome and a neon ring behind it, night environment, and a pop-in + spin animation." },
  { id: "explain", title: "Explain what this panel can do", prompt: "Give me a concise tour of what you and this panel can do right now, grouped by module, and suggest three things to try." },
] as const;
