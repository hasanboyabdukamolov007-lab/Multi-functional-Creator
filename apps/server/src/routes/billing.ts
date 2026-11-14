import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PLANS, PLAN_IDS, limitsFor } from "@mfc/core";
import { parse, requirePerm, HttpError, badRequest } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { billingEnabled, handleStripeEvent, priceInfo, stripe, usageOf, verifyStripeSignature, type StripeEvent } from "../lib/billing.js";

interface WsBilling {
  name: string;
  plan: string;
  plan_status: string | null;
  plan_renews_at: string | null;
  plan_cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

/** /api/w/:workspaceId/billing — plan, usage, checkout and the customer portal. */
export const billingRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app.deps;
  const load = async (id: string) => {
    const ws = await db.one<WsBilling>(
      `SELECT name, plan, plan_status, plan_renews_at, plan_cancel_at_period_end, stripe_customer_id, stripe_subscription_id FROM workspaces WHERE id = $1`,
      [id],
    );
    if (!ws) throw new HttpError(404, "Workspace not found", "not_found");
    return ws;
  };

  app.get("/", async (req) => {
    const a = requirePerm(req, "projects.read");
    const ws = await load(a.workspaceId);
    const enabled = billingEnabled(config);
    const prices = { pro: config.billing.prices.pro, team: config.billing.prices.team };
    const plans = await Promise.all(
      PLAN_IDS.map(async (id) => ({
        id,
        name: PLANS[id].name,
        limits: PLANS[id].limits,
        features: PLANS[id].features,
        price: id === "free" ? { amount: 0, currency: "usd", interval: "month" } : enabled ? await priceInfo(config, prices[id]) : null,
        available: id === "free" || (enabled && !!prices[id]),
      })),
    );
    return {
      enabled,
      plan: enabled ? ws.plan : "unlimited",
      status: ws.plan_status,
      renewsAt: ws.plan_renews_at,
      cancelAtPeriodEnd: ws.plan_cancel_at_period_end,
      hasSubscription: !!ws.stripe_subscription_id,
      hasCustomer: !!ws.stripe_customer_id,
      usage: await usageOf(db, a.workspaceId),
      limits: limitsFor(ws.plan, enabled),
      plans,
    };
  });

  app.post("/checkout", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "billing.manage");
    const { plan } = parse(z.object({ plan: z.enum(["pro", "team"]) }), req.body);
    if (!billingEnabled(config)) throw new HttpError(400, "Billing is not enabled on this server", "billing_disabled");
    const price = config.billing.prices[plan];
    if (!price) throw badRequest(`No Stripe price is configured for the ${PLANS[plan].name} plan (set STRIPE_PRICE_${plan.toUpperCase()})`);
    const ws = await load(a.workspaceId);
    const back = `${config.publicUrl}/settings?tab=billing`;
    // Already subscribed: plan changes, card updates and cancellation happen in Stripe's portal.
    if (ws.stripe_subscription_id && ws.stripe_customer_id) {
      const portal = await stripe<{ url: string }>(config, "POST", "/billing_portal/sessions", { customer: ws.stripe_customer_id, return_url: back });
      return { url: portal.url, portal: true };
    }
    const session = await stripe<{ url: string; id: string }>(config, "POST", "/checkout/sessions", {
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      success_url: `${back}&checkout=success`,
      cancel_url: `${back}&checkout=cancel`,
      client_reference_id: a.workspaceId,
      ...(ws.stripe_customer_id ? { customer: ws.stripe_customer_id } : { customer_email: req.user!.email }),
      allow_promotion_codes: true,
      metadata: { workspace_id: a.workspaceId, plan },
      subscription_data: { metadata: { workspace_id: a.workspaceId, plan }, ...(config.billing.trialDays > 0 ? { trial_period_days: config.billing.trialDays } : {}) },
    });
    await audit(db, req, "billing.checkout", { meta: { plan } });
    return { url: session.url, portal: false };
  });

  app.post("/portal", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "billing.manage");
    const ws = await load(a.workspaceId);
    if (!ws.stripe_customer_id) throw badRequest("This workspace has no billing account yet — choose a plan first");
    const portal = await stripe<{ url: string }>(config, "POST", "/billing_portal/sessions", { customer: ws.stripe_customer_id, return_url: `${config.publicUrl}/settings?tab=billing` });
    await audit(db, req, "billing.portal", {});
    return { url: portal.url };
  });
};

/** POST /api/billing/webhook — called by Stripe; authenticated by the signature, not cookies. */
export const billingWebhookRoutes: FastifyPluginAsync = async (app) => {
  const { config } = app.deps;
  // The signature covers the exact bytes Stripe sent, so keep the raw body (scoped to this plugin).
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
  app.post("/webhook", async (req, reply) => {
    if (!config.billing.webhookSecret) throw new HttpError(503, "Set STRIPE_WEBHOOK_SECRET to receive Stripe events", "billing_disabled");
    const raw = typeof req.body === "string" ? req.body : "";
    if (!verifyStripeSignature(raw, req.headers["stripe-signature"] as string | undefined, config.billing.webhookSecret)) {
      return reply.status(400).send({ error: "Invalid signature" });
    }
    let event: StripeEvent;
    try {
      event = JSON.parse(raw) as StripeEvent;
    } catch {
      return reply.status(400).send({ error: "Invalid JSON" });
    }
    const r = await handleStripeEvent(app.deps, event);
    return { received: true, ...r };
  });
};
