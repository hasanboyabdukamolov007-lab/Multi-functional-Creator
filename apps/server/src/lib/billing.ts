/**
 * SaaS billing with Stripe (Checkout + Customer Portal + webhooks), using Stripe's REST API directly.
 * Billing is off unless STRIPE_SECRET_KEY is set; then plan limits apply to every workspace.
 */
import crypto from "node:crypto";
import { PLANS, isPlanId, limitsFor, withinLimit, type LimitKey, type PlanId } from "@mfc/core";
import type { Db } from "../db.js";
import type { Config } from "../config.js";
import type { MasterKeyRing } from "./vaultCrypto.js";
import type { Mailer } from "./mailer.js";
import { HttpError } from "./http.js";
import { notifyUser } from "./push.js";

export interface BillingDeps {
  db: Db;
  config: Config;
  ring: MasterKeyRing;
  mailer: Mailer;
}

export const billingEnabled = (c: Config) => !!c.billing.stripeKey;

// ---------- usage & limits ----------

export async function usageOf(db: Db, workspaceId: string): Promise<Record<LimitKey, number>> {
  const r = await db.one<{ projects: number; members: number; storage: string | number; monitors: number; targets: number; plugins: number }>(
    `SELECT
      (SELECT count(*)::int FROM projects WHERE workspace_id = $1) AS projects,
      (SELECT count(*)::int FROM memberships WHERE workspace_id = $1) AS members,
      (SELECT coalesce(sum(size), 0)::bigint FROM assets WHERE workspace_id = $1) AS storage,
      (SELECT count(*)::int FROM monitors WHERE workspace_id = $1) AS monitors,
      (SELECT count(*)::int FROM deploy_targets WHERE workspace_id = $1) AS targets,
      (SELECT count(*)::int FROM plugins WHERE workspace_id = $1) AS plugins`,
    [workspaceId],
  );
  return {
    projects: r?.projects ?? 0,
    members: r?.members ?? 0,
    storageMb: Math.round((Number(r?.storage ?? 0) / (1024 * 1024)) * 10) / 10,
    monitors: r?.monitors ?? 0,
    deployTargets: r?.targets ?? 0,
    plugins: r?.plugins ?? 0,
  };
}

const LABEL: Record<LimitKey, string> = { projects: "projects", members: "members", storageMb: "MB of storage", monitors: "uptime monitors", deployTargets: "deploy targets", plugins: "plugins" };

/**
 * Throw 402 when adding `adding` more of `key` would exceed the workspace's plan.
 * For storage, `adding` is in bytes. A no-op when billing is off.
 */
export async function assertLimit(deps: { db: Db; config: Config }, workspaceId: string, key: LimitKey, adding = 1): Promise<void> {
  if (!billingEnabled(deps.config)) return;
  const ws = await deps.db.one<{ plan: string }>(`SELECT plan FROM workspaces WHERE id = $1`, [workspaceId]);
  const limit = limitsFor(ws?.plan, true)[key];
  if (limit === null) return;
  const used = await usageOf(deps.db, workspaceId);
  const add = key === "storageMb" ? adding / (1024 * 1024) : adding;
  if (!withinLimit(limit, used[key], add)) {
    const plan = isPlanId(ws?.plan) ? PLANS[ws!.plan as PlanId].name : "Free";
    throw new HttpError(402, `The ${plan} plan includes up to ${limit} ${LABEL[key]}. Upgrade in Settings → Billing to add more.`, "plan_limit");
  }
}

// ---------- Stripe REST ----------

type Json = Record<string, unknown>;

/** Flatten nested params into Stripe's form encoding: a[b][0][c]=… */
export function stripeForm(params: Json, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? stripeForm(item as Json, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === "object") stripeForm(v as Json, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe<T = Json>(config: Config, method: "GET" | "POST", path: string, params?: Json): Promise<T> {
  if (!config.billing.stripeKey) throw new HttpError(400, "Billing is not enabled on this server", "billing_disabled");
  const res = await fetch(`${config.providers.stripe}/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${config.billing.stripeKey}`, ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? stripeForm(params).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string } };
  if (!res.ok) throw new HttpError(502, `Stripe: ${json.error?.message ?? `HTTP ${res.status}`}`, "stripe_error");
  return json as T;
}

/** Verify a Stripe-Signature header (v1 scheme: HMAC-SHA256 of "t.payload"), with a replay window. */
export function verifyStripeSignature(payload: string, header: string | undefined, secret: string, toleranceS = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceS) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), expected));
}

/** Build a header the way Stripe does (for tests and local webhook replays). */
export function signStripePayload(payload: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
}

// ---------- prices (cached) ----------

export interface PriceInfo {
  amount: number | null;
  currency: string;
  interval: string | null;
}
const priceCache = new Map<string, { at: number; info: PriceInfo | null }>();
export async function priceInfo(config: Config, priceId: string | undefined): Promise<PriceInfo | null> {
  if (!priceId) return null;
  const hit = priceCache.get(priceId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.info;
  let info: PriceInfo | null = null;
  try {
    const p = await stripe<{ unit_amount: number | null; currency: string; recurring?: { interval: string } | null }>(config, "GET", `/prices/${encodeURIComponent(priceId)}`);
    info = { amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval ?? null };
  } catch {
    info = null;
  }
  priceCache.set(priceId, { at: Date.now(), info });
  return info;
}

// ---------- subscriptions & webhooks ----------

interface Subscription {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
}

/** Statuses that keep paid features (past_due is Stripe's grace period while retrying the card). */
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export function planForSubscription(config: Config, sub: Subscription): PlanId {
  if (!PAID_STATUSES.has(sub.status)) return "free";
  const price = sub.items?.data?.[0]?.price?.id;
  if (price && price === config.billing.prices.team) return "team";
  if (price && price === config.billing.prices.pro) return "pro";
  const meta = sub.metadata?.plan;
  return isPlanId(meta) && meta !== "free" ? meta : "pro";
}

async function workspaceForSubscription(db: Db, sub: Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.workspace_id;
  if (fromMeta) {
    const ok = await db.one(`SELECT 1 FROM workspaces WHERE id = $1`, [fromMeta]).catch(() => null);
    if (ok) return fromMeta;
  }
  const row = await db.one<{ id: string }>(`SELECT id FROM workspaces WHERE stripe_customer_id = $1`, [sub.customer]);
  return row?.id ?? null;
}

export async function applySubscription(deps: BillingDeps, workspaceId: string, sub: Subscription, deleted = false): Promise<PlanId> {
  const plan = deleted ? "free" : planForSubscription(deps.config, sub);
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const live = !deleted && PAID_STATUSES.has(sub.status);
  await deps.db.query(
    `UPDATE workspaces SET plan = $2, plan_status = $3, stripe_customer_id = $4, stripe_subscription_id = $5,
       plan_renews_at = CASE WHEN $6::bigint IS NULL THEN NULL ELSE to_timestamp($6::bigint) END, plan_cancel_at_period_end = $7
     WHERE id = $1`,
    [workspaceId, plan, deleted ? "canceled" : sub.status, sub.customer, live ? sub.id : null, live ? periodEnd : null, live ? !!sub.cancel_at_period_end : false],
  );
  return plan;
}

async function notifyOwners(deps: BillingDeps, workspaceId: string, title: string, body: string) {
  const owners = await deps.db.query<{ user_id: string; email: string }>(`SELECT m.user_id, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.role = 'owner'`, [workspaceId]);
  for (const o of owners) {
    await notifyUser(deps, { userId: o.user_id, workspaceId, kind: "billing", title, body, link: "/settings?tab=billing" });
    void deps.mailer.send(o.email, title, `${body}\n\n${deps.config.publicUrl}/settings?tab=billing`).catch(() => undefined);
  }
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Json };
}

/** Apply one webhook event. Idempotent: an event id is processed at most once. */
export async function handleStripeEvent(deps: BillingDeps, event: StripeEvent): Promise<{ handled: boolean; duplicate?: boolean; workspaceId?: string | null; plan?: PlanId }> {
  const fresh = await deps.db.one(`INSERT INTO billing_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id`, [event.id, event.type]);
  if (!fresh) return { handled: false, duplicate: true };
  const obj = event.data.object;
  let workspaceId: string | null = null;
  let plan: PlanId | undefined;
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        workspaceId = (obj.client_reference_id as string) ?? (obj.metadata as Record<string, string> | undefined)?.workspace_id ?? null;
        if (!workspaceId) break;
        await deps.db.query(`UPDATE workspaces SET stripe_customer_id = coalesce($2, stripe_customer_id) WHERE id = $1`, [workspaceId, (obj.customer as string) ?? null]);
        if (obj.subscription) {
          const sub = await stripe<Subscription>(deps.config, "GET", `/subscriptions/${encodeURIComponent(String(obj.subscription))}`);
          plan = await applySubscription(deps, workspaceId, sub);
          await notifyOwners(deps, workspaceId, `You're on the ${PLANS[plan].name} plan`, "Thanks for subscribing — the new limits apply right away.");
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        let sub = obj as unknown as Subscription;
        workspaceId = await workspaceForSubscription(deps.db, sub);
        if (!workspaceId) break;
        const deleted = event.type === "customer.subscription.deleted";
        // Events can arrive out of order: re-read the subscription so we always store the latest state.
        if (!deleted) sub = await stripe<Subscription>(deps.config, "GET", `/subscriptions/${encodeURIComponent(sub.id)}`).catch(() => sub);
        plan = await applySubscription(deps, workspaceId, sub, deleted);
        if (deleted) await notifyOwners(deps, workspaceId, "Your subscription has ended", "The workspace is back on the Free plan. Nothing was deleted: everything keeps working, but adding more than the Free limits allow needs an upgrade.");
        break;
      }
      case "invoice.payment_failed": {
        const customer = obj.customer as string | undefined;
        const row = customer ? await deps.db.one<{ id: string }>(`SELECT id FROM workspaces WHERE stripe_customer_id = $1`, [customer]) : null;
        workspaceId = row?.id ?? null;
        if (workspaceId) await notifyOwners(deps, workspaceId, "Payment failed", "We couldn't charge your card. Update the payment method in Settings → Billing → Manage subscription to keep your plan.");
        break;
      }
      default:
        return { handled: false };
    }
  } catch (e) {
    // Let Stripe retry: forget the event id so the retry is processed.
    await deps.db.query(`DELETE FROM billing_events WHERE id = $1`, [event.id]);
    throw e;
  }
  if (workspaceId) await deps.db.query(`UPDATE billing_events SET workspace_id = $2 WHERE id = $1`, [event.id, workspaceId]).catch(() => undefined);
  return { handled: true, workspaceId, plan };
}
