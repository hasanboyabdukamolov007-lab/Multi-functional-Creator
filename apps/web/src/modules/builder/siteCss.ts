import type { SiteTokens } from "./model";
import { EXTRA_CSS } from "./catalog2";

/** CSS variables for the site's design tokens. */
export function tokenVars(t: SiteTokens): Record<string, string> {
  return {
    "--color-primary": t.primary,
    "--color-primary-text": t.primaryText,
    "--color-bg": t.bg,
    "--color-surface": t.surface,
    "--color-text": t.text,
    "--color-muted": t.muted,
    "--color-border": t.border,
    "--radius": t.radius,
    "--font": t.font,
    "--font-heading": t.headingFont,
    "--max-width": t.maxWidth,
    ...(t.buttonRadius ? { "--button-radius": t.buttonRadius } : {}),
  };
}

/** Stylesheet shared by the canvas and every export. Everything is scoped under `.site`. */
export const SITE_CSS = `
.site { --shadow-sm: 0 1px 2px rgb(0 0 0 / .06); --shadow-md: 0 6px 20px -6px rgb(0 0 0 / .15); --shadow-lg: 0 18px 50px -12px rgb(0 0 0 / .25);
  background: var(--color-bg); color: var(--color-text); font-family: var(--font); font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
.site *, .site *::before, .site *::after { box-sizing: border-box; }
.site h1, .site h2, .site h3, .site h4, .site h5, .site h6 { font-family: var(--font-heading); line-height: 1.15; margin: 0; letter-spacing: -0.02em; color: inherit; }
.site h1, .site .h1 { font-size: clamp(2.2rem, 5vw, 3.6rem); font-weight: 800; }
.site h2, .site .h2 { font-size: clamp(1.7rem, 3.4vw, 2.4rem); font-weight: 750; }
.site h3 { font-size: 1.25rem; font-weight: 650; }
.site h4 { font-size: 1.1rem; font-weight: 600; } .site h5 { font-size: 1rem; font-weight: 600; } .site h6 { font-size: .9rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.site p { margin: 0; }
.site a { color: var(--color-primary); }
.site img { max-width: 100%; display: block; }
.site .page-root { min-height: 100%; }
.site .container { width: 100%; max-width: var(--max-width); margin: 0 auto; padding: 0 20px; }
.site .narrow { max-width: 760px; }
.site .section { padding: clamp(48px, 8vw, 96px) 0; }
.site .tone-surface { background: var(--color-surface); }
.site .tone-primary { background: var(--color-primary); color: var(--color-primary-text); }
.site .tone-primary .muted { color: inherit; opacity: .85; }
.site .tone-dark { background: #0d0f16; color: #f2f4f8; }
.site .tone-dark .muted { color: #a3a9b8; }
.site .row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
.site .stack { display: flex; flex-direction: column; gap: 12px; }
.site .grid { display: grid; gap: 24px; }
.site .center { text-align: center; align-items: center; }
.site .muted { color: var(--color-muted); }
.site .upper { text-transform: uppercase; letter-spacing: .08em; }
.site .text-sm { font-size: .875rem; } .site .text-base { font-size: 1rem; } .site .text-lg { font-size: 1.125rem; } .site .text-xl { font-size: 1.3rem; }
.site .box { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 24px; }
.site .divider { border: 0; height: 1px; background: var(--color-border); margin: 24px 0; }
.site .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 18px; border-radius: var(--button-radius, calc(var(--radius) * .75)); font-weight: 600; font-size: .95rem; line-height: 1.2;
  border: 1px solid transparent; cursor: pointer; text-decoration: none; transition: transform .08s ease, filter .12s ease, background .12s; font-family: inherit; }
.site .btn:hover { filter: brightness(1.06); } .site .btn:active { transform: translateY(1px); }
.site .btn-primary { background: var(--color-primary); color: var(--color-primary-text); }
.site .btn-secondary { background: transparent; color: var(--color-text); border-color: var(--color-border); }
.site .btn-ghost { background: transparent; color: var(--color-primary); }
.site .btn-danger { background: #dc2f3c; color: #fff; }
.site .btn-light { background: #fff; color: #11131a; }
.site .btn-sm { padding: 7px 12px; font-size: .85rem; } .site .btn-lg { padding: 14px 24px; font-size: 1.05rem; }
.site .btn-block { width: 100%; }
.site .link { font-weight: 600; text-decoration: none; } .site .link:hover { text-decoration: underline; }
.site .badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font-size: .78rem; font-weight: 600; width: fit-content; }
.site .badge-primary { background: color-mix(in srgb, var(--color-primary) 14%, transparent); color: var(--color-primary); }
.site .badge-neutral { background: var(--color-surface); color: var(--color-muted); border: 1px solid var(--color-border); }
.site .badge-success { background: #e3f7ec; color: #12753f; } .site .badge-warning { background: #fff3dc; color: #8a5300; } .site .badge-danger { background: #fde6e8; color: #b0212c; }
.site .quote { border-left: 3px solid var(--color-primary); padding: 4px 0 4px 18px; margin: 0; font-size: 1.15rem; }
.site .quote cite { display: block; margin-top: 8px; font-size: .9rem; color: var(--color-muted); font-style: normal; }
.site .code { background: #0f1117; color: #e6e8ef; padding: 16px; border-radius: var(--radius); overflow: auto; font-size: .875rem; margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.site .list { margin: 0; padding-left: 1.2em; } .site .list li + li { margin-top: 6px; }
.site .list.checks { list-style: none; padding: 0; } .site .list.checks li::before { content: "✓"; color: var(--color-primary); font-weight: 700; margin-right: 8px; }
.site .img.rounded, .site .embed { border-radius: var(--radius); }
.site .embed { width: 100%; border: 1px solid var(--color-border); display: block; }
.site .icon { display: inline-flex; color: var(--color-primary); }
.site .icon-boxed { width: 48px; height: 48px; align-items: center; justify-content: center; border-radius: calc(var(--radius) * .8); background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
.site .avatar { display: inline-grid; place-items: center; border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 18%, var(--color-surface)); color: var(--color-primary); font-weight: 700; font-size: .9rem; object-fit: cover; flex-shrink: 0; }
.site .field { display: flex; flex-direction: column; gap: 6px; }
.site .field-label { font-size: .875rem; font-weight: 600; }
.site .input { width: 100%; padding: 10px 12px; border-radius: calc(var(--radius) * .6); border: 1px solid var(--color-border); background: var(--color-bg); color: inherit; font: inherit; }
.site .input:focus { outline: 2px solid color-mix(in srgb, var(--color-primary) 45%, transparent); border-color: var(--color-primary); }
.site .check { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.site .check input { accent-color: var(--color-primary); width: 18px; height: 18px; }
.site .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.site .switch-track { width: 40px; height: 22px; border-radius: 999px; background: var(--color-border); position: relative; transition: background .15s; flex-shrink: 0; }
.site .switch-track::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: var(--shadow-sm); }
.site .switch input:checked + .switch-track { background: var(--color-primary); } .site .switch input:checked + .switch-track::after { transform: translateX(18px); }
.site .switch input:focus-visible + .switch-track { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.site .fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.site .range { width: 100%; accent-color: var(--color-primary); }
.site .table-wrap { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius); }
.site .table { width: 100%; border-collapse: collapse; font-size: .925rem; }
.site .table th { text-align: left; padding: 12px 14px; background: var(--color-surface); font-weight: 600; border-bottom: 1px solid var(--color-border); }
.site .table td { padding: 12px 14px; border-bottom: 1px solid var(--color-border); }
.site .table tr:last-child td { border-bottom: 0; }
.site .table.striped tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--color-surface) 60%, transparent); }
.site .stat-label { font-size: .85rem; color: var(--color-muted); font-weight: 500; }
.site .stat-value { font-size: 1.9rem; font-weight: 750; letter-spacing: -0.02em; } .site .stat-value.big { font-size: 2.4rem; color: var(--color-primary); }
.site .stat-delta { font-size: .85rem; font-weight: 600; } .site .trend-up { color: #12753f; } .site .trend-down { color: #b0212c; } .site .trend-flat { color: var(--color-muted); }
.site .progress { height: 8px; border-radius: 999px; background: var(--color-border); overflow: hidden; }
.site .progress > span { display: block; height: 100%; background: var(--color-primary); border-radius: inherit; }
.site .chart { margin: 0; display: flex; flex-direction: column; gap: 12px; }
.site .card { display: flex; flex-direction: column; gap: 10px; }
.site .navbar { background: color-mix(in srgb, var(--color-bg) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--color-border); padding: 14px 0; z-index: 10; }
.site .navbar.sticky { position: sticky; top: 0; }
.site .brand { font-weight: 800; font-size: 1.15rem; color: var(--color-text); text-decoration: none; }
.site .nav-links a { color: var(--color-muted); text-decoration: none; font-weight: 500; } .site .nav-links a:hover { color: var(--color-text); }
.site .footer { border-top: 1px solid var(--color-border); padding: 28px 0; }
.site .footer a { text-decoration: none; }
.site .breadcrumb ol { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; font-size: .9rem; }
.site .breadcrumb li + li::before { content: "/"; margin-right: 8px; color: var(--color-muted); }
.site .breadcrumb a { color: var(--color-muted); text-decoration: none; }
.site .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-border); }
.site .tab { background: none; border: 0; padding: 10px 14px; font: inherit; color: var(--color-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; }
.site .tab.active { color: var(--color-text); border-bottom-color: var(--color-primary); font-weight: 600; }
.site .hero { text-align: center; } .site .hero .stack { align-items: center; } .site .hero-sub { max-width: 640px; } .site .hero-actions { justify-content: center; }
.site .hero.align-left { text-align: left; } .site .hero.align-left .stack { align-items: flex-start; } .site .hero.align-left .hero-actions { justify-content: flex-start; }
.site .hero-title { max-width: 900px; background: linear-gradient(120deg, var(--color-text) 30%, var(--color-primary)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.site .plan { display: flex; flex-direction: column; gap: 16px; }
.site .plan.featured { border: 2px solid var(--color-primary); box-shadow: var(--shadow-lg); }
.site .plan-price { font-size: 2.4rem; font-weight: 800; letter-spacing: -0.03em; }
.site .testimonial { margin: 0; display: flex; flex-direction: column; gap: 16px; }
.site .testimonial blockquote { margin: 0; }
.site .faq summary { cursor: pointer; font-weight: 600; list-style: none; } .site .faq summary::-webkit-details-marker { display: none; }
.site .faq summary::after { content: "+"; float: right; color: var(--color-muted); } .site .faq[open] summary::after { content: "–"; }
.site .faq p { margin-top: 10px; }
.site .cta { background: linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #ff4f9a)); color: #fff; border-radius: calc(var(--radius) * 1.6); padding: clamp(32px, 6vw, 64px); }
.site .logo-name { font-size: 1.3rem; font-weight: 800; color: var(--color-muted); opacity: .75; letter-spacing: -0.02em; }
.site .appshell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.site .appshell-side { background: var(--color-surface); border-right: 1px solid var(--color-border); padding: 20px 14px; display: flex; flex-direction: column; gap: 20px; }
.site .side-link { padding: 9px 12px; border-radius: calc(var(--radius) * .6); color: var(--color-muted); text-decoration: none; font-weight: 500; }
.site .side-link.active, .site .side-link:hover { background: color-mix(in srgb, var(--color-primary) 12%, transparent); color: var(--color-primary); }
.site .appshell-main { padding: 28px; min-width: 0; }
@media (max-width: 760px) { .site .appshell { grid-template-columns: 1fr; } .site .appshell-side { border-right: 0; border-bottom: 1px solid var(--color-border); } .site .nav-links { display: none; } }
.site .alert { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border-radius: var(--radius); border: 1px solid; }
.site .alert-info { background: #eaf2ff; border-color: #bcd4ff; color: #173d7a; } .site .alert-success { background: #e6f7ee; border-color: #b4e5c9; color: #12573a; }
.site .alert-warning { background: #fff5e0; border-color: #ffd98f; color: #7a4a00; } .site .alert-danger { background: #fde8ea; border-color: #f6b5bc; color: #8e1a25; }
.site .empty { padding: 40px 24px; }
.site .spinner { display: inline-block; border-radius: 50%; border: 3px solid var(--color-border); border-top-color: var(--color-primary); animation: site-spin .8s linear infinite; }
@keyframes site-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .site * { animation: none !important; transition: none !important; } }
` + EXTRA_CSS;
