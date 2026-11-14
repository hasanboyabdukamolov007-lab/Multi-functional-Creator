import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requireUser, notFound, badRequest } from "../lib/http.js";
import { getVapid, isExpoToken, pushToUser } from "../lib/push.js";
import { assertSafeUrl } from "../lib/netGuard.js";

const Register = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("webpush"),
    label: z.string().trim().max(120).optional(),
    subscription: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(16).max(40) }) }),
  }),
  z.object({ kind: z.literal("expo"), label: z.string().trim().max(120).optional(), token: z.string().max(200) }),
]);

/** /api/push — the signed-in user's push devices (installed PWA, browsers, the mobile app). */
export const pushRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app.deps;

  app.get("/vapid", async () => ({ publicKey: (await getVapid(app.deps)).publicKey }));

  app.get("/devices", async (req) => {
    const user = requireUser(req);
    const devices = await db.query(`SELECT id, kind, label, created_at, last_used_at FROM push_devices WHERE user_id = $1 ORDER BY created_at DESC`, [user.id]);
    return { devices };
  });

  app.post("/devices", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireUser(req);
    const b = parse(Register, req.body);
    let token: string;
    let subscription: string | null = null;
    if (b.kind === "webpush") {
      // Push endpoints are fetched by the server later, so they must be public https URLs.
      const url = assertSafeUrl(b.subscription.endpoint, config.allowPrivateNetwork);
      if (url.protocol !== "https:" && !config.allowPrivateNetwork) throw badRequest("Push endpoints must use https");
      token = b.subscription.endpoint;
      subscription = JSON.stringify(b.subscription);
    } else {
      if (!isExpoToken(b.token)) throw badRequest("Not an Expo push token");
      token = b.token;
    }
    // A device moves to whoever signs in on it last.
    const row = await db.one<{ id: string }>(
      `INSERT INTO push_devices (id, user_id, kind, token, subscription, label) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, subscription = excluded.subscription, label = coalesce(excluded.label, push_devices.label)
       RETURNING id`,
      [crypto.randomUUID(), user.id, b.kind, token, subscription, b.label ?? null],
    );
    return { id: row!.id };
  });

  app.delete("/devices/:id", async (req) => {
    const user = requireUser(req);
    const row = await db.one(`DELETE FROM push_devices WHERE id = $1 AND user_id = $2 RETURNING id`, [(req.params as { id: string }).id, user.id]);
    if (!row) throw notFound("Device not found");
    return { ok: true };
  });

  app.post("/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const user = requireUser(req);
    const sent = await pushToUser(app.deps, user.id, { title: "Test notification", body: "Push notifications work on this device.", link: "/settings?tab=devices", tag: "test" });
    return { ok: sent > 0, sent };
  });
};
