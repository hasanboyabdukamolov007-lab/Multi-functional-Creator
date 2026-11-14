import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { parse, requirePerm, HttpError, badRequest } from "../lib/http.js";
import { guardedFetch } from "../lib/netGuard.js";
import { addVersion, createSecret, readValue } from "../lib/secretsStore.js";
import { audit } from "../lib/audit.js";

const Token = z.string().trim().regex(/^\d{5,15}:[\w-]{30,60}$/, "That doesn't look like a bot token from @BotFather");

interface Chat {
  id: number | string;
  type: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/**
 * /api/w/:workspaceId/telegram — connect a Telegram bot without hunting for chat ids:
 * check the token, list the chats that have written to the bot, then save the token in the vault
 * and create an alert channel for the chosen chat.
 */
export const telegramRoutes: FastifyPluginAsync = async (app) => {
  const { db, ring, config } = app.deps;

  const tg = async (token: string, method: string, body?: unknown) => {
    const r = await guardedFetch(
      `${config.providers.telegram}/bot${token}/${method}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) },
      { allowPrivate: config.allowPrivateNetwork, timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 },
    );
    const j = JSON.parse(r.body.toString("utf8") || "{}") as { ok?: boolean; result?: unknown; description?: string };
    if (!j.ok) {
      if (r.status === 401 || r.status === 404) throw badRequest("Telegram doesn't recognise this bot token — copy it again from @BotFather");
      if (r.status === 409) throw badRequest("This bot has a webhook set, so chats can't be listed. Remove the webhook or enter the chat id by hand.");
      throw new HttpError(502, `Telegram: ${j.description ?? r.status}`, "telegram_error");
    }
    return j.result;
  };

  app.post("/chats", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    requirePerm(req, "notifications.manage");
    const { token } = parse(z.object({ token: Token }), req.body);
    const me = (await tg(token, "getMe")) as { username: string; first_name: string };
    const updates = ((await tg(token, "getUpdates", { limit: 100, allowed_updates: ["message", "channel_post", "my_chat_member"] })) ?? []) as Array<Record<string, { chat?: Chat }>>;
    const chats = new Map<string, { id: string; type: string; name: string }>();
    for (const u of updates) {
      for (const key of ["message", "channel_post", "my_chat_member", "edited_message"]) {
        const c = u[key]?.chat;
        if (!c) continue;
        const name = c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || String(c.id));
        chats.set(String(c.id), { id: String(c.id), type: c.type, name: c.username && c.type === "private" ? `${name} (@${c.username})` : name });
      }
    }
    return { bot: me.username, botName: me.first_name, chats: [...chats.values()].reverse() };
  });

  app.post("/connect", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "notifications.manage");
    const b = parse(z.object({ token: Token, chatId: z.string().trim().regex(/^-?\d{1,20}$|^@[\w]{4,}$/, "Chat id is a number like -100123… or @channelname"), name: z.string().trim().max(80).optional() }), req.body);
    const me = (await tg(b.token, "getMe")) as { username: string };
    // The test message proves the bot can write to that chat before anything is saved.
    await tg(b.token, "sendMessage", { chat_id: b.chatId, text: "✅ Multi-functional Creator ulandi. Buyurtmalar va ogohlantirishlar shu yerga keladi." });
    const secretName = `TELEGRAM_BOT_${me.username.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`.slice(0, 64);
    const existing = await db.one<{ id: string }>(`SELECT id FROM secrets WHERE workspace_id = $1 AND name = $2 AND project_id IS NULL AND environment = 'production'`, [a.workspaceId, secretName]);
    const secretId = existing ? existing.id : await createSecret(db, ring, { workspaceId: a.workspaceId, projectId: null, environment: "production", name: secretName, value: b.token, description: `Telegram bot @${me.username}`, userId: req.user!.id });
    if (existing) await addVersion(db, ring, existing.id, b.token, req.user!.id);
    const id = crypto.randomUUID();
    const name = b.name || `Telegram @${me.username}`;
    await db.query(`INSERT INTO notification_channels (id, workspace_id, name, kind, config, secret_id, events, enabled) VALUES ($1,$2,$3,'telegram',$4,$5,$6,true)`, [
      id,
      a.workspaceId,
      name,
      JSON.stringify({ chatId: b.chatId }),
      secretId,
      ["monitor.down", "monitor.up", "deploy.failed", "workflow.failed", "test"],
    ]);
    await audit(db, req, "telegram.connect", { meta: { bot: me.username } });
    return { channelId: id, name, bot: me.username };
  });

  /** Put a "web app" button in the bot's menu that opens the deployed Mini App (Telegram requires https). */
  app.post("/menu-button", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "notifications.manage");
    const b = parse(z.object({ channelId: z.string().uuid(), url: z.string().trim().url().max(500), text: z.string().trim().min(1).max(30).default("Buyurtma") }), req.body);
    if (!b.url.startsWith("https://")) throw badRequest("Telegram opens Mini Apps only over https:// — deploy the site first and use its https address");
    const ch = await db.one<{ secret_id: string | null }>(`SELECT secret_id FROM notification_channels WHERE id = $1 AND workspace_id = $2 AND kind = 'telegram'`, [b.channelId, a.workspaceId]);
    if (!ch?.secret_id) throw badRequest("Pick a connected Telegram bot");
    const token = await readValue(db, ring, ch.secret_id);
    const me = (await tg(token, "getMe")) as { username: string };
    await tg(token, "setChatMenuButton", { menu_button: { type: "web_app", text: b.text, web_app: { url: b.url } } });
    await audit(db, req, "telegram.menu_button", { meta: { bot: me.username, url: b.url } });
    return { ok: true, bot: me.username, link: `https://t.me/${me.username}` };
  });
};
