import { n, type BNode, type SiteTokens } from "./model";

export interface Template {
  id: string;
  name: string;
  description: string;
  tokens?: Partial<SiteTokens>;
  build: () => BNode[];
}

const navbar = (brand: string, links = "Features|#features\nPricing|#pricing\nFAQ|#faq", cta = "Get started") => n("navbar", { brand, links, ctaText: cta, ctaHref: "#signup", sticky: true });
const footer = (brand: string) => n("footer", { text: `© 2026 ${brand}. All rights reserved.`, links: "Privacy|/privacy\nTerms|/terms\nContact|/contact" });

export const TEMPLATES: Template[] = [
  {
    id: "saas-landing",
    name: "SaaS landing page",
    description: "Hero, logos, features, stats, pricing, testimonial, FAQ and CTA",
    build: () => [
      navbar("Nimbus"),
      n("hero", { eyebrow: "New · Workflows 2.0", title: "Automate the busywork. Ship what matters.", subtitle: "Nimbus connects your tools, automates handoffs and gives every team a live view of the work — no code required.", primaryText: "Start free trial", primaryHref: "#signup", secondaryText: "Watch 2-min demo", secondaryHref: "#demo", align: "center" }),
      n("logos", { title: "Trusted by fast-moving teams", names: "Northwind\nGlobex\nInitech\nUmbrella\nHooli\nVandelay" }),
      n("features", { title: "Built for how teams really work", subtitle: "Everything connects, so nothing falls through the cracks.", items: "bolt|Instant automations|Trigger workflows from any event in 40+ apps.\nchart|Live dashboards|See progress, bottlenecks and SLAs in real time.\nshield|Enterprise security|SSO, audit logs and encryption at rest by default.\nusers|Shared workspaces|Bring sales, support and ops into one place.\ncloud|Runs anywhere|Cloud-hosted or on your own infrastructure.\ncode|Developer API|Extend everything with webhooks and a typed SDK.", columns: 3 }),
      n("statsband", { items: "3.2M|Tasks automated / month\n41%|Less time on handoffs\n99.98%|Uptime last 12 months\n4.8/5|Average G2 rating" }),
      n("pricing", { title: "Plans that scale with you", plans: "Starter|$0|/month|Up to 3 users;5 automations;Community support|\nTeam|$24|/user/month|Unlimited automations;Live dashboards;Priority support;SSO|featured\nEnterprise|Custom||Dedicated cluster;Custom SLAs;Security review;Success manager|" }),
      n("section", { tone: "surface" }, [n("grid", { minWidth: 300, gap: 24 }, [n("testimonial", {}), n("testimonial", { quote: "Onboarding took an afternoon. A month later we couldn't imagine working without it.", author: "Marcus Lee", role: "COO, Fieldwork" })])]),
      n("faq", { items: "Is there a free trial?|Yes — 14 days on any paid plan, no credit card needed.\nCan I cancel anytime?|Yes. Plans are month-to-month unless you choose annual billing.\nDo you offer discounts for nonprofits?|Yes, 50% off any plan. Contact our team.\nWhere is my data stored?|In the region you choose: EU, US or Asia-Pacific." }),
      n("cta", { title: "Give your team its time back", text: "Start a free 14-day trial. Setup takes minutes.", buttonText: "Start free trial", buttonHref: "#signup" }),
      footer("Nimbus Inc."),
    ],
  },
  {
    id: "admin-dashboard",
    name: "Admin dashboard",
    description: "App shell with KPIs, chart, progress and data table",
    tokens: { bg: "#f6f7fb", surface: "#ffffff" },
    build: () => [
      n("appshell", { brand: "Acme Admin", items: "Overview\nCustomers\nOrders\nProducts\nInvoices\nReports\nSettings", active: 0 }, [
        n("pageheader", { title: "Overview", subtitle: "Business performance for the last 30 days", actionText: "Export report" }),
        n("grid", { minWidth: 200, gap: 16 }, [
          n("stat", { label: "Revenue", value: "$128,430", delta: "+8.2% vs last month", trend: "up" }),
          n("stat", { label: "Active customers", value: "3,912", delta: "+214", trend: "up" }),
          n("stat", { label: "Churn rate", value: "1.8%", delta: "-0.3 pts", trend: "up" }),
          n("stat", { label: "Open tickets", value: "47", delta: "+6", trend: "down" }),
        ]),
        n("grid", { minWidth: 320, gap: 16 }, [
          n("chart", { title: "Revenue by month (k$)", labels: "Jan, Feb, Mar, Apr, May, Jun, Jul", values: "82, 91, 88, 104, 112, 119, 128" }),
          n("box", {}, [n("heading", { text: "Quota usage", level: 3 }), n("progress", { label: "API requests", value: 72 }), n("progress", { label: "Storage", value: 41 }), n("progress", { label: "Seats", value: 88 })], { display: "flex", flexDirection: "column", gap: "16px" }),
        ]),
        n("table", { columns: "Order, Customer, Date, Amount, Status", rows: "#10482, Northwind, Nov 12, $2,400, Paid\n#10481, Globex, Nov 12, $890, Pending\n#10480, Initech, Nov 11, $12,050, Paid\n#10479, Umbrella, Nov 10, $430, Refunded\n#10478, Hooli, Nov 10, $3,180, Paid", striped: true }),
      ]),
    ],
  },
  {
    id: "portfolio",
    name: "Portfolio",
    description: "Personal intro, selected work and contact",
    tokens: { primary: "#0f766e", headingFont: `Georgia, "Times New Roman", serif` },
    build: () => [
      navbar("Aziza Karimova", "Work|#work\nAbout|#about\nContact|#contact", "Hire me"),
      n("hero", { eyebrow: "Product designer · Tashkent", title: "I design calm, useful software.", subtitle: "Ten years shaping products for fintech, health and public services. Currently open to senior and lead roles.", primaryText: "See my work", primaryHref: "#work", secondaryText: "Download CV", secondaryHref: "#", align: "left" }),
      n("section", {}, [n("heading", { text: "Selected work", level: 2 }), n("spacer", { height: 24 }), n("grid", { minWidth: 280, gap: 24 }, [
        n("card", { title: "Banking app redesign", text: "Raised task success from 61% to 94% for 2M monthly users.", linkText: "Case study →", href: "#" }),
        n("card", { title: "Clinic booking system", text: "Cut appointment no-shows by 30% with smarter reminders.", linkText: "Case study →", href: "#" }),
        n("card", { title: "Gov services portal", text: "Unified 40 services behind one accessible, bilingual interface.", linkText: "Case study →", href: "#" }),
      ])]),
      n("contact", { title: "Let's work together", text: "Tell me about your product and timeline." }),
      footer("Aziza Karimova"),
    ],
  },
  {
    id: "pricing-page",
    name: "Pricing page",
    description: "Plans, comparison table and FAQ",
    build: () => [
      navbar("Nimbus"),
      n("hero", { eyebrow: "Pricing", title: "Pay for what you use", subtitle: "Every plan includes unlimited projects and a 14-day free trial.", primaryText: "", secondaryText: "", align: "center" }),
      n("pricing", {}),
      n("section", {}, [n("heading", { text: "Compare plans", level: 2 }), n("spacer", { height: 16 }), n("table", { columns: "Feature, Starter, Pro, Enterprise", rows: "Projects, 1, Unlimited, Unlimited\nTeam members, 2, 20, Unlimited\nCustom domains, —, ✓, ✓\nSSO & SCIM, —, —, ✓\nSupport, Community, Priority, Dedicated", striped: true })]),
      n("faq", {}),
      footer("Nimbus Inc."),
    ],
  },
  {
    id: "blog-article",
    name: "Blog article",
    description: "Readable long-form post layout",
    tokens: { maxWidth: "760px" },
    build: () => [
      navbar("The Build Log", "Articles|#\nNewsletter|#\nAbout|#", "Subscribe"),
      n("section", {}, [
        n("breadcrumb", { items: "Blog|/blog\nEngineering|/blog/engineering\nShipping safely" }),
        n("spacer", { height: 16 }),
        n("badge", { text: "Engineering", tone: "primary" }),
        n("heading", { text: "How we ship 40 times a day without breaking production", level: 1 }),
        n("row", { gap: 12 }, [n("avatar", { name: "Timur Saidov", size: 40 }), n("text", { text: "Timur Saidov · 8 min read · Nov 2026", size: "sm" }, [], { color: "var(--color-muted)" })]),
        n("spacer", { height: 16 }),
        n("image", { alt: "Deployment pipeline diagram", rounded: true }),
        n("spacer", { height: 16 }),
        n("text", { text: "Fast releases are not about moving recklessly. They come from small changes, strong automation and a culture where rolling back is cheap.", size: "lg" }),
        n("heading", { text: "1. Keep every change small", level: 2 }),
        n("text", { text: "Our median pull request touches 60 lines. Small diffs review faster, test faster and are trivial to revert." }),
        n("quote", { text: "If a deploy scares you, deploy more often — in smaller pieces.", cite: "Our on-call handbook" }),
        n("heading", { text: "2. Feature flags everywhere", level: 2 }),
        n("list", { items: "Ship dark, release gradually\nKill switches for every risky path\nClean up flags within two sprints" }),
        n("code", { code: "if (flags.enabled('new-checkout', user)) {\n  return renderNewCheckout();\n}" }),
      ], { paddingTop: "40px" }),
      footer("The Build Log"),
    ],
  },
  {
    id: "contact-page",
    name: "Contact page",
    description: "Contact form, details and map",
    build: () => [
      navbar("Studio North", "Services|#\nWork|#\nContact|#contact", "Book a call"),
      n("section", {}, [n("grid", { minWidth: 320, gap: 40 }, [
        n("column", { gap: 16 }, [n("heading", { text: "Let's talk", level: 1 }), n("text", { text: "Questions, projects or partnerships — we reply within one business day.", size: "lg" }), n("list", { items: "hello@studionorth.example\n+998 71 000 00 00\nAmir Temur Ave 1, Tashkent" })]),
        n("form", {}, [n("input", { label: "Full name", name: "name", type: "text", placeholder: "Your name", required: true }), n("input", {}), n("select", { label: "Topic", name: "topic", options: "New project\nSupport\nPartnership\nOther" }), n("textarea", {}), n("checkbox", { label: "Send me occasional product updates" }), n("button", { text: "Send message", submit: true, fullWidth: true })]),
      ])]),
      n("section", { tone: "surface" }, [n("embed", { title: "Office location", height: 360 })]),
      footer("Studio North"),
    ],
  },
  {
    id: "coming-soon",
    name: "Coming soon",
    description: "Launch teaser with waitlist signup",
    tokens: { bg: "#0b0b14", surface: "#151526", text: "#f3f3fb", muted: "#a0a0bd", border: "#2a2a44", primary: "#8b5cf6" },
    build: () => [
      n("section", {}, [n("column", { gap: 20 }, [
        n("badge", { text: "Launching Q1 2027", tone: "primary" }),
        n("heading", { text: "Something new for creators is coming.", level: 1 }),
        n("text", { text: "Join the waitlist for early access and founder pricing.", size: "xl" }, [], { color: "var(--color-muted)" }),
        n("form", {}, [n("row", { gap: 8 }, [n("input", { label: "", placeholder: "you@email.com" }, [], { flex: "1", minWidth: "220px" }), n("button", { text: "Join waitlist", submit: true })])], { width: "100%", maxWidth: "520px" }),
      ], { alignItems: "center", textAlign: "center", minHeight: "70vh", justifyContent: "center" })]),
    ],
  },
  {
    id: "product-page",
    name: "E-commerce product",
    description: "Product gallery, details, reviews",
    build: () => [
      navbar("Bazaar", "New in|#\nWomen|#\nMen|#\nSale|#", "Cart (2)"),
      n("section", {}, [n("grid", { minWidth: 320, gap: 40 }, [
        n("image", { alt: "Handwoven ikat throw in indigo and saffron", rounded: true }),
        n("column", { gap: 16 }, [
          n("breadcrumb", { items: "Home|/\nHome & living|/home\nThrows" }),
          n("heading", { text: "Handwoven Ikat Throw", level: 1 }),
          n("row", { gap: 8 }, [n("badge", { text: "★ 4.9 (312 reviews)", tone: "neutral" }), n("badge", { text: "In stock", tone: "success" })]),
          n("text", { text: "$149", size: "xl" }, [], { fontWeight: "800", fontSize: "2rem" }),
          n("text", { text: "Woven by artisans in Margilan from 100% silk-cotton blend. Each piece is unique; colours may vary slightly." }),
          n("select", { label: "Size", name: "size", options: "130 × 170 cm\n150 × 200 cm" }),
          n("row", { gap: 12 }, [n("button", { text: "Add to cart", size: "lg" }), n("button", { text: "♡ Save", variant: "secondary", size: "lg" })]),
          n("accordion", { summary: "Shipping & returns", text: "Free shipping over $100. 30-day returns on unused items." }),
          n("accordion", { summary: "Care instructions", text: "Dry clean only. Store folded away from direct sunlight." }),
        ]),
      ])]),
      n("section", { tone: "surface" }, [n("heading", { text: "What customers say", level: 2 }), n("spacer", { height: 16 }), n("grid", { minWidth: 280, gap: 16 }, [n("testimonial", { quote: "Even more beautiful in person. The colours are rich and the weave is tight.", author: "Malika T.", role: "Verified buyer" }), n("testimonial", { quote: "Arrived in four days, beautifully packed. Bought a second as a gift.", author: "James R.", role: "Verified buyer" })])]),
      footer("Bazaar"),
    ],
  },
  {
    id: "mobile-app",
    name: "Mobile app screen",
    description: "Phone-first app home with cards and actions",
    tokens: { radius: "18px", maxWidth: "480px" },
    build: () => [
      n("section", {}, [n("column", { gap: 16 }, [
        n("row", { gap: 12, justify: "space-between" }, [n("column", { gap: 2 }, [n("text", { text: "Good morning", size: "sm" }, [], { color: "var(--color-muted)" }), n("heading", { text: "Sardor", level: 2 })]), n("avatar", { name: "Sardor B", size: 44 })]),
        n("stat", { label: "Balance", value: "$12,480.20", delta: "+$320 this week", trend: "up" }),
        n("row", { gap: 8 }, [n("button", { text: "Send", size: "sm" }), n("button", { text: "Request", variant: "secondary", size: "sm" }), n("button", { text: "Top up", variant: "secondary", size: "sm" })]),
        n("heading", { text: "Recent activity", level: 3 }),
        n("table", { columns: "Merchant, Amount", rows: "Korzinka, -$24.10\nUzum Market, -$61.00\nSalary, +$2,400.00\nYandex Go, -$3.20", striped: false }),
        n("alert", { tone: "info", title: "Tip", text: "Turn on round-ups to save automatically." }),
      ])], { paddingTop: "24px" }),
    ],
  },
];
