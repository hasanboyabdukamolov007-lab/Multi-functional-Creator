import { n, type BNode, type SiteTokens } from "../../builder/model";
import { DOMAIN_COPY, UI_COPY } from "./content";
import type { PageSpec } from "./planner";

export interface GeneratedPage {
  name: string;
  title: string;
  brand: string;
  tokens: Partial<SiteTokens>;
  nodes: BNode[];
  /** Project kind that fits the page type. */
  kind: "site" | "panel" | "app";
}

const DARK: Partial<SiteTokens> = { bg: "#0c0e14", surface: "#151823", text: "#eef0f6", muted: "#9aa1b2", border: "#262b3a" };
const LIGHT: Partial<SiteTokens> = { bg: "#ffffff", surface: "#f6f7fb", text: "#14161f", muted: "#5f6677", border: "#e3e6ee" };

/** Pick readable text for a background color (WCAG relative luminance). */
export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#ffffff";
  const v = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  return L > 0.4 ? "#111318" : "#ffffff";
}

const lines = (s: string) => s.split("\n").filter(Boolean);
const part = (s: string, i: number) => s.split("|")[i] ?? "";

export function generatePage(spec: PageSpec): GeneratedPage {
  const domain = DOMAIN_COPY[spec.domain] ?? DOMAIN_COPY.saas;
  const c = domain.copy[spec.lang];
  const ui = UI_COPY[spec.lang];
  const brand = spec.brand ?? c.brand;
  const primary = spec.primary ?? domain.primary;
  const dark = spec.dark ?? !!domain.dark;
  const tokens: Partial<SiteTokens> = { ...(dark ? DARK : LIGHT), primary, primaryText: onColor(primary) };
  const want = (section: string, byDefault: boolean) => (spec.exclude.includes(section) ? false : spec.include.includes(section) || byDefault);
  const testimonials = () => n("section", { tone: "surface" }, [n("heading", { text: ui.testimonials, level: 2 }, [], { textAlign: "center" }), n("spacer", { height: 24 }), n("grid", { minWidth: 300, gap: 24 }, [ui.t1, ui.t2].map((t) => n("testimonial", { quote: part(t, 0), author: part(t, 1), role: part(t, 2) })))]);
  const faq = () => n("faq", { title: ui.faq, items: ui.faqItems });
  const pricing = () => (c.plans ? n("pricing", { title: ui.pricing, plans: c.plans }) : null);
  const contact = () => n("contact", { title: ui.contact, text: ui.contactText, buttonText: ui.send });
  const footer = () => n("footer", { text: `© 2026 ${brand}. ${ui.rights}`, links: lines(ui.nav).slice(0, 3).join("\n") });
  const navbar = () => n("navbar", { brand, links: ui.nav, ctaText: c.cta, ctaHref: "#contact", sticky: true });
  const features = () => n("features", { title: ui.features, subtitle: ui.featuresSub, items: c.features, columns: 3 });
  const stats = () => n("statsband", { items: c.stats });
  const cta = () => n("cta", { title: ui.ctaTitle, text: ui.ctaText, buttonText: c.cta, buttonHref: "#contact" });
  const newsletter = () => n("section", { tone: "surface" }, [n("column", { gap: 12 }, [n("heading", { text: ui.newsletter, level: 2 }), n("text", { text: ui.newsletterText }), n("form", {}, [n("row", { gap: 8 }, [n("input", { label: "", name: "email", type: "email", placeholder: ui.emailPlaceholder, required: true }, [], { flex: "1", minWidth: "220px" }), n("button", { text: ui.subscribe, submit: true })])])], { alignItems: "center", textAlign: "center" })]);
  const team = () => n("section", {}, [n("heading", { text: ui.team, level: 2 }, [], { textAlign: "center" }), n("spacer", { height: 24 }), n("grid", { minWidth: 200, gap: 24 }, ["Aziza Karimova|CEO", "Timur Saidov|CTO", "Malika Usmonova|Design", "Jasur Aliyev|Growth"].map((p) => n("column", { gap: 8 }, [n("avatar", { name: part(p, 0), size: 72 }), n("heading", { text: part(p, 0), level: 4 }), n("text", { text: part(p, 1), size: "sm" }, [], { color: "var(--color-muted)" })], { alignItems: "center", textAlign: "center" })))]);
  const gallery = () => n("section", {}, [n("heading", { text: ui.gallery, level: 2 }), n("spacer", { height: 24 }), n("grid", { minWidth: 240, gap: 16 }, [1, 2, 3, 4, 5, 6].map((i) => n("image", { alt: `${brand} ${ui.gallery} ${i}`, rounded: true })))]);

  let nodes: Array<BNode | null> = [];
  let kind: GeneratedPage["kind"] = "site";
  let name = brand;

  switch (spec.type) {
    case "dashboard": {
      kind = "panel";
      name = `${brand} Admin`;
      const statItems = lines(c.stats).slice(0, 4);
      nodes = [
        n("appshell", { brand: `${brand} Admin`, items: spec.lang === "uz" ? "Umumiy\nMijozlar\nBuyurtmalar\nMahsulotlar\nHisobotlar\nSozlamalar" : spec.lang === "ru" ? "Обзор\nКлиенты\nЗаказы\nТовары\nОтчёты\nНастройки" : "Overview\nCustomers\nOrders\nProducts\nReports\nSettings", active: 0 }, [
          n("pageheader", { title: spec.lang === "uz" ? "Umumiy ko‘rinish" : spec.lang === "ru" ? "Обзор" : "Overview", subtitle: spec.lang === "uz" ? "So‘nggi 30 kun" : spec.lang === "ru" ? "Последние 30 дней" : "Last 30 days", actionText: spec.lang === "uz" ? "Eksport" : spec.lang === "ru" ? "Экспорт" : "Export" }),
          n("grid", { minWidth: 200, gap: 16 }, statItems.map((s, i) => n("stat", { label: part(s, 1), value: part(s, 0), delta: ["+8.2%", "+3.1%", "-0.4 pts", "+12"][i], trend: i === 2 ? "down" : "up" }))),
          n("grid", { minWidth: 320, gap: 16 }, [
            n("chart", { title: spec.lang === "uz" ? "Oylik ko‘rsatkich" : spec.lang === "ru" ? "Показатель по месяцам" : "Monthly trend", labels: "Jan, Feb, Mar, Apr, May, Jun, Jul", values: "82, 91, 88, 104, 112, 119, 128" }),
            n("box", {}, [n("heading", { text: spec.lang === "uz" ? "Rejalar bajarilishi" : spec.lang === "ru" ? "Выполнение плана" : "Goals", level: 3 }), n("progress", { label: "Q3", value: 72 }), n("progress", { label: "Q4", value: 41 })], { display: "flex", flexDirection: "column", gap: "16px" }),
          ]),
          n("table", { columns: spec.lang === "uz" ? "Raqam, Mijoz, Sana, Summa, Holat" : spec.lang === "ru" ? "Номер, Клиент, Дата, Сумма, Статус" : "ID, Customer, Date, Amount, Status", rows: "#1048, Northwind, 12.11, $2,400, ✓\n#1047, Globex, 12.11, $890, …\n#1046, Initech, 11.11, $12,050, ✓\n#1045, Hooli, 10.11, $3,180, ✓", striped: true }),
        ]),
      ];
      break;
    }
    case "portfolio":
      nodes = [
        n("navbar", { brand, links: spec.lang === "uz" ? "Ishlar|#work\nMen haqimda|#about\nAloqa|#contact" : spec.lang === "ru" ? "Работы|#work\nОбо мне|#about\nКонтакты|#contact" : "Work|#work\nAbout|#about\nContact|#contact", ctaText: c.cta, ctaHref: "#contact", sticky: true }),
        n("hero", { eyebrow: c.eyebrow, title: c.title, subtitle: c.subtitle, primaryText: c.cta, primaryHref: "#contact", secondaryText: ui.work, secondaryHref: "#work", align: "left" }),
        n("section", {}, [n("heading", { text: ui.work, level: 2 }), n("spacer", { height: 24 }), n("grid", { minWidth: 280, gap: 24 }, lines(c.features).slice(0, 3).map((f) => n("card", { title: part(f, 1), text: part(f, 2), linkText: ui.readMore, href: "#" })))]),
        want("testimonials", true) ? testimonials() : null,
        contact(),
        footer(),
      ];
      break;
    case "shop":
      nodes = [
        navbar(),
        n("hero", { eyebrow: c.eyebrow, title: c.title, subtitle: c.subtitle, primaryText: c.cta, primaryHref: "#products", secondaryText: ui.secondary, secondaryHref: "#features", align: "center" }),
        n("section", {}, [n("heading", { text: ui.products, level: 2 }), n("spacer", { height: 24 }), n("grid", { minWidth: 220, gap: 20 }, ["Linen shirt|$59", "Silk scarf|$45", "Cotton dress|$89", "Wool coat|$189"].map((p) => n("column", { gap: 8 }, [n("image", { alt: part(p, 0), rounded: true }), n("heading", { text: part(p, 0), level: 4 }), n("text", { text: part(p, 1) }, [], { fontWeight: "700" }), n("button", { text: ui.addToCart, size: "sm", fullWidth: true })])))]),
        want("features", true) ? features() : null,
        want("testimonials", true) ? testimonials() : null,
        want("newsletter", true) ? newsletter() : null,
        want("faq", false) ? faq() : null,
        footer(),
      ];
      break;
    case "blog":
      nodes = [
        navbar(),
        n("hero", { eyebrow: c.eyebrow, title: ui.articles, subtitle: c.subtitle, primaryText: "", secondaryText: "", align: "center" }),
        n("section", {}, [n("grid", { minWidth: 280, gap: 24 }, lines(c.features).map((f) => n("card", { title: part(f, 1), text: part(f, 2), linkText: ui.readMore, href: "#" })))]),
        want("newsletter", true) ? newsletter() : null,
        footer(),
      ];
      break;
    case "comingSoon":
      nodes = [n("section", {}, [n("column", { gap: 20 }, [n("badge", { text: brand, tone: "primary" }), n("heading", { text: ui.comingTitle, level: 1 }), n("text", { text: ui.comingText, size: "xl" }, [], { color: "var(--color-muted)" }), n("form", {}, [n("row", { gap: 8 }, [n("input", { label: "", name: "email", type: "email", placeholder: ui.emailPlaceholder, required: true }, [], { flex: "1", minWidth: "220px" }), n("button", { text: ui.join, submit: true })])], { width: "100%", maxWidth: "520px" })], { alignItems: "center", textAlign: "center", minHeight: "70vh", justifyContent: "center" })])];
      break;
    case "contact":
      nodes = [navbar(), contact(), n("section", { tone: "surface" }, [n("embed", { title: brand, height: 360 })]), footer()];
      break;
    case "pricing":
      nodes = [navbar(), n("hero", { eyebrow: brand, title: ui.pricing, subtitle: c.subtitle, primaryText: "", secondaryText: "", align: "center" }), pricing(), faq(), footer()];
      break;
    case "mobile":
      kind = "app";
      nodes = [n("section", {}, [n("column", { gap: 16 }, [n("row", { gap: 12, justify: "space-between" }, [n("heading", { text: brand, level: 2 }), n("avatar", { name: brand, size: 44 })]), ...lines(c.stats).slice(0, 2).map((s) => n("stat", { label: part(s, 1), value: part(s, 0) })), n("row", { gap: 8 }, [n("button", { text: c.cta, size: "sm" }), n("button", { text: ui.secondary, variant: "secondary", size: "sm" })]), ...lines(c.features).slice(0, 3).map((f) => n("card", { title: part(f, 1), text: part(f, 2), linkText: "" }))])], { paddingTop: "24px" })];
      tokens.maxWidth = "480px";
      tokens.radius = "18px";
      break;
    default:
      nodes = [
        navbar(),
        n("hero", { eyebrow: c.eyebrow, title: c.title, subtitle: c.subtitle, primaryText: c.cta, primaryHref: "#contact", secondaryText: ui.secondary, secondaryHref: "#features", align: "center" }),
        want("logos", spec.domain === "saas" || spec.domain === "finance") ? n("logos", { title: ui.logos, names: "Northwind\nGlobex\nInitech\nUmbrella\nHooli" }) : null,
        want("features", true) ? features() : null,
        want("stats", true) ? stats() : null,
        want("team", false) ? team() : null,
        want("gallery", spec.domain === "photography" || spec.domain === "restaurant" || spec.domain === "travel") ? gallery() : null,
        want("pricing", !!c.plans) ? pricing() : null,
        want("testimonials", true) ? testimonials() : null,
        want("faq", true) ? faq() : null,
        want("newsletter", false) ? newsletter() : null,
        want("contact", ["restaurant", "clinic", "law", "agency", "realestate", "photography", "travel"].includes(spec.domain)) ? contact() : null,
        want("cta", true) ? cta() : null,
        footer(),
      ];
  }
  return { name, title: `${brand} — ${c.title}`, brand, tokens, nodes: nodes.filter((x): x is BNode => !!x), kind };
}
