/** Starter prompts — all of them work with Forge's built-in engine (no AI model needed). */
export const STARTERS = [
  { id: "landing", title: "Build a SaaS landing page", prompt: 'Create a landing page for a project management startup called "Orbit" with pricing, testimonials and FAQ' },
  { id: "coffee", title: "Website for a coffee shop", prompt: 'Create a website for a coffee shop called "Bean There" with a gallery and contact form' },
  { id: "dashboard", title: "Design an admin dashboard", prompt: "Create an admin dashboard for an online store in dark mode" },
  { id: "store", title: "Online clothing store", prompt: "Create an online store for clothing in pink" },
  { id: "turntable", title: "Model a 3D product turntable", prompt: "Create a 3D scene with a gold torus knot on a pedestal, studio lighting, make it spin" },
  { id: "logo3d", title: "Make a 3D animated logo", prompt: "Create a 3D scene with three chrome stars in a circle, night environment, make them float" },
  { id: "theme", title: "Create a theme from my brand color", prompt: "Dark theme from #0f766e" },
  { id: "vault-audit", title: "Audit my secrets vault", prompt: "Audit my vault secrets" },
  { id: "uz", title: "O‘zbekcha: klinika sayti", prompt: "Klinika uchun narxlar va aloqa bilan sayt yarat" },
  { id: "ru", title: "Русский: портфолио фотографа", prompt: "Создай портфолио для фотографа в тёмной теме" },
  { id: "explain", title: "What can Forge do?", prompt: "help" },
] as const;
