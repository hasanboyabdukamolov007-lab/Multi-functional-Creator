import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { HttpError } from "../lib/http.js";
import { runWorkflow, tickSchedules, triggerOf, type WorkflowRow } from "../lib/workflows.js";
import { runDueChecks, uptimeSummary } from "../lib/monitoring.js";

/** The tracking snippet sites embed: pageviews (incl. SPA navigations), Core Web Vitals, JS errors, custom events. No cookies. */
export const COLLECT_JS = `(function(){var s=document.currentScript;var k=s&&s.dataset.site;if(!k)return;var ep=new URL(s.src).origin+"/api/collect";
if(navigator.doNotTrack==="1"&&s.dataset.respectDnt!=="false"){window.mfc=function(){};return;}
function send(t,d){d=d||{};d.k=k;d.t=t;d.p=location.pathname;var r=document.referrer;d.r=r&&r.indexOf(location.origin)!==0?r:"";var b=JSON.stringify(d);
try{if(navigator.sendBeacon&&navigator.sendBeacon(ep,b))return;}catch(e){}fetch(ep,{method:"POST",body:b,keepalive:true,mode:"no-cors"}).catch(function(){});}
send("pageview");var last=location.pathname;function nav(){if(location.pathname!==last){last=location.pathname;send("pageview");}}
var ps=history.pushState;history.pushState=function(){ps.apply(this,arguments);setTimeout(nav,0)};addEventListener("popstate",nav);
try{var lcp=0,cls=0,inp=0,sent=false;
new PerformanceObserver(function(l){var e=l.getEntries();lcp=e[e.length-1].startTime}).observe({type:"largest-contentful-paint",buffered:true});
new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput)cls+=e.value})}).observe({type:"layout-shift",buffered:true});
new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.interactionId)inp=Math.max(inp,e.duration)})}).observe({type:"event",buffered:true,durationThreshold:40});
new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(e.name==="first-contentful-paint")send("vital",{n:"FCP",v:e.startTime})})}).observe({type:"paint",buffered:true});
var nv=performance.getEntriesByType("navigation")[0];if(nv)send("vital",{n:"TTFB",v:nv.responseStart});
function flush(){if(sent)return;sent=true;if(lcp)send("vital",{n:"LCP",v:lcp});send("vital",{n:"CLS",v:cls});if(inp)send("vital",{n:"INP",v:inp});}
addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")flush()});addEventListener("pagehide",flush);}catch(e){}
var n=0;function err(m,st){if(n++>10)return;send("error",{n:String(m||"Error").slice(0,300),m:{stack:String(st||"").slice(0,2000)}})}
addEventListener("error",function(e){if(e.message)err(e.message,e.error&&e.error.stack)});
addEventListener("unhandledrejection",function(e){var r=e.reason;err(r&&r.message||r,r&&r.stack)});
window.mfc=function(name,props){send("event",{n:String(name).slice(0,80),m:props||{}})};})();`;

const device = (ua: string) => (/ipad|tablet|(android(?!.*mobile))/i.test(ua) ? "tablet" : /mobi|iphone|android/i.test(ua) ? "mobile" : "desktop");
const browser = (ua: string) => (/edg\//i.test(ua) ? "Edge" : /opr\//i.test(ua) ? "Opera" : /samsungbrowser/i.test(ua) ? "Samsung" : /firefox|fxios/i.test(ua) ? "Firefox" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : /bot|crawl|spider/i.test(ua) ? "Bot" : "Other");
const VITALS = new Set(["LCP", "CLS", "INP", "FCP", "TTFB"]);

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Unauthenticated endpoints: workflow webhooks, the scheduler tick, analytics collection and public status pages. */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app.deps;

  app.post("/hooks/:id/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { id, token } = req.params as { id: string; token: string };
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Not found");
    const w = await db.one<WorkflowRow & { webhook_token: string }>(`SELECT id, workspace_id, name, graph, enabled, environment, updated_at, webhook_token FROM workflows WHERE id = $1`, [id]);
    if (!w || !safeEqual(w.webhook_token, token)) throw new HttpError(404, "Not found");
    if (!w.enabled || triggerOf(w.graph)?.config?.mode !== "webhook") throw new HttpError(409, "This workflow isn't enabled for webhooks");
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => /^(content-type|user-agent|x-[\w-]+)$/i.test(k) && !/signature|token|auth/i.test(k)).map(([k, v]) => [k, String(v)]));
    const run = await runWorkflow(app.deps, w, { kind: "webhook", body: req.body ?? null, query: req.query as Record<string, unknown>, headers });
    return { ok: run?.status === "succeeded", runId: run?.id, status: run?.status };
  });

  const tick = async (req: { headers: Record<string, unknown>; query: unknown }) => {
    const auth = String(req.headers.authorization ?? "");
    const key = auth.startsWith("Bearer ") ? auth.slice(7) : String((req.query as { key?: string }).key ?? "");
    if (!config.cronSecret || !safeEqual(key, config.cronSecret)) throw new HttpError(401, "Invalid or missing CRON_SECRET");
    return { ok: true, ran: await tickSchedules(app.deps), checks: await runDueChecks(app.deps) };
  };

  // ---------------------------------------------------------------- analytics collection (public, cookieless)
  app.get("/collect.js", async (_req, reply) => {
    reply.header("content-type", "text/javascript; charset=utf-8").header("cache-control", "public, max-age=3600").header("cross-origin-resource-policy", "cross-origin").header("access-control-allow-origin", "*");
    return COLLECT_JS;
  });
  const sites = new Map<string, { id: string; domains: string[]; at: number }>();
  app.post("/collect", { bodyLimit: 16 * 1024, config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    let d: { k?: string; t?: string; p?: string; r?: string; n?: string; v?: number; m?: Record<string, unknown> };
    try {
      d = typeof req.body === "string" ? JSON.parse(req.body) : (req.body as typeof d);
    } catch {
      return reply.status(400).send();
    }
    if (!d?.k || !["pageview", "vital", "error", "event"].includes(d.t ?? "")) return reply.status(400).send();
    let site = sites.get(d.k);
    if (!site || Date.now() - site.at > 60_000) {
      const row = await db.one<{ id: string; domains: string[] }>(`SELECT id, domains FROM analytics_sites WHERE key = $1`, [d.k]);
      if (!row) return reply.status(404).send();
      site = { ...row, at: Date.now() };
      sites.set(d.k, site);
    }
    const origin = String(req.headers.origin ?? req.headers.referer ?? "");
    if (site.domains.length && origin) {
      const host = (() => { try { return new URL(origin).hostname; } catch { return ""; } })();
      if (!site.domains.some((dm) => host === dm || host.endsWith(`.${dm}`))) return reply.status(403).send();
    }
    const ua = String(req.headers["user-agent"] ?? "");
    if (/bot|crawl|spider|headless/i.test(ua)) return reply.status(204).send();
    // Visitor = salted daily hash of IP + user agent: counts unique visitors without cookies or storing IPs.
    const day = new Date().toISOString().slice(0, 10);
    const visitor = crypto.createHash("sha256").update(`${day}|${site.id}|${req.ip}|${ua}|${config.vaultMasterKey?.slice(0, 16) ?? "mfc"}`).digest("base64url").slice(0, 22);
    const country = String(req.headers["x-vercel-ip-country"] ?? req.headers["cf-ipcountry"] ?? "").slice(0, 2) || null;
    const type = d.t!;
    const name = type === "vital" ? (VITALS.has(String(d.n)) ? String(d.n) : null) : d.n ? String(d.n).slice(0, 300) : null;
    if (type === "vital" && !name) return reply.status(400).send();
    let ref: string | null = null;
    if (d.r) try { ref = new URL(String(d.r)).hostname; } catch { ref = null; }
    await db.query(
      `INSERT INTO analytics_events (site_id, type, name, path, referrer, device, browser, country, visitor, value, meta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [site.id, type, name, String(d.p ?? "/").slice(0, 300), ref, device(ua), browser(ua), country, visitor, typeof d.v === "number" && Number.isFinite(d.v) ? d.v : null, d.m ? JSON.stringify(d.m).slice(0, 4000) : null],
    );
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------- public status page
  app.get("/status/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    const page = await db.one<{ workspace_id: string; title: string; description: string }>(`SELECT workspace_id, title, description FROM status_pages WHERE slug = $1 AND enabled`, [slug.toLowerCase()]);
    if (!page) throw new HttpError(404, "Status page not found");
    const monitors = await db.query<{ id: string; name: string; state: string; last_checked_at: string | null }>(`SELECT id, name, state, last_checked_at FROM monitors WHERE workspace_id = $1 AND public AND enabled ORDER BY created_at`, [page.workspace_id]);
    const out = [];
    for (const m of monitors) out.push({ name: m.name, state: m.state, lastChecked: m.last_checked_at, ...(await uptimeSummary(app.deps, m.id, 90)) });
    const incidents = await db.query(`SELECT i.title, i.cause, i.started_at, i.resolved_at FROM incidents i JOIN monitors m ON m.id = i.monitor_id WHERE i.workspace_id = $1 AND m.public AND i.started_at > now() - interval '30 days' ORDER BY i.started_at DESC LIMIT 20`, [page.workspace_id]);
    const overall = out.some((m) => m.state === "down") ? "outage" : out.some((m) => m.state === "degraded") ? "degraded" : "operational";
    return { title: page.title, description: page.description, overall, monitors: out, incidents };
  });
  app.get("/cron/tick", tick);
  app.post("/cron/tick", tick);
};
