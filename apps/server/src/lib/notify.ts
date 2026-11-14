/**
 * Notification channels: email, Telegram, Slack, Discord and signed webhooks.
 * Channel secrets (bot tokens, webhook URLs, signing keys) live in the vault.
 */
import crypto from "node:crypto";
import type { Db } from "../db.js";
import type { Config } from "../config.js";
import type { Mailer } from "./mailer.js";
import type { MasterKeyRing } from "./vaultCrypto.js";
import { guardedFetch } from "./netGuard.js";
import { readValue } from "./secretsStore.js";
import { pushToUser } from "./push.js";

export const CHANNEL_KINDS = ["email", "telegram", "slack", "discord", "webhook", "push"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export const EVENTS = ["monitor.down", "monitor.up", "deploy.ready", "deploy.failed", "workflow.failed", "errors.spike", "test"] as const;
export type NotifyEvent = (typeof EVENTS)[number];

export interface NotifyDeps {
  db: Db;
  ring: MasterKeyRing;
  mailer: Mailer;
  config: Config;
}
export interface Message {
  title: string;
  text: string;
  url?: string;
  level?: "info" | "success" | "warning" | "error";
}
interface ChannelRow {
  id: string;
  kind: ChannelKind;
  name: string;
  config: Record<string, string>;
  secret_id: string | null;
}

const ICON = { info: "ℹ️", success: "✅", warning: "⚠️", error: "🔴" };

export async function sendToChannel(deps: NotifyDeps, ch: ChannelRow, event: NotifyEvent, m: Message): Promise<void> {
  const secret = ch.secret_id ? await readValue(deps.db, deps.ring, ch.secret_id) : "";
  const icon = ICON[m.level ?? "info"];
  const opts = { allowPrivate: deps.config.allowPrivateNetwork, timeoutMs: 15_000, maxBytes: 64 * 1024 };
  const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
    const r = await guardedFetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }, opts);
    if (r.status >= 400) throw new Error(`${ch.kind} answered ${r.status}: ${r.body.toString("utf8").slice(0, 160)}`);
  };
  switch (ch.kind) {
    case "email": {
      const to = (ch.config.to ?? "").split(/[,;\s]+/).filter((x) => /.+@.+\..+/.test(x));
      if (!to.length) throw new Error("No valid recipient");
      for (const addr of to) await deps.mailer.send(addr, `${icon} ${m.title}`, `${m.text}${m.url ? `\n\n${m.url}` : ""}\n\n— Multi-functional Creator (${event})`);
      return;
    }
    case "telegram":
      if (!secret || !ch.config.chatId) throw new Error("Set the bot token (vault) and chat id");
      return post(`${deps.config.providers.telegram}/bot${secret}/sendMessage`, { chat_id: ch.config.chatId, text: `${icon} *${m.title}*\n${m.text}${m.url ? `\n${m.url}` : ""}`, parse_mode: "Markdown", disable_web_page_preview: true });
    case "slack":
      if (!secret) throw new Error("Store the Slack incoming-webhook URL in the vault");
      return post(secret, { text: `${icon} *${m.title}*\n${m.text}${m.url ? `\n<${m.url}|Open>` : ""}` });
    case "discord":
      if (!secret) throw new Error("Store the Discord webhook URL in the vault");
      return post(secret, { content: `${icon} **${m.title}**\n${m.text}${m.url ? `\n${m.url}` : ""}`.slice(0, 1900) });
    case "push": {
      // Every member's signed-in phones and installed apps (or only owners/admins).
      const roles = ch.config.audience === "admins" ? ["owner", "admin"] : ["owner", "admin", "editor", "viewer"];
      const members = await deps.db.query<{ user_id: string }>(`SELECT user_id FROM memberships WHERE workspace_id = $1 AND role = ANY($2::text[])`, [ch.config.workspaceId, roles]);
      const n = (await Promise.all(members.map((u) => pushToUser(deps, u.user_id, { title: `${icon} ${m.title}`, body: m.text, link: m.url?.startsWith(deps.config.publicUrl) ? m.url.slice(deps.config.publicUrl.length) || "/" : "/monitoring", tag: event })))).reduce((a, b) => a + b, 0);
      if (!n && event === "test") throw new Error("No devices have push enabled yet — turn it on in Settings → Devices or in the mobile app");
      return;
    }
    case "webhook": {
      if (!ch.config.url) throw new Error("Set the webhook URL");
      const payload = { event, ...m, sentAt: new Date().toISOString() };
      const sig = crypto.createHmac("sha256", secret || "unsigned").update(JSON.stringify(payload)).digest("hex");
      return post(ch.config.url, payload, { "x-mfc-signature": `sha256=${sig}`, "x-mfc-event": event });
    }
  }
}

/** Fan an event out to every enabled channel subscribed to it. Never throws. */
export async function notify(deps: NotifyDeps, workspaceId: string, event: NotifyEvent, m: Message): Promise<number> {
  const rows = (await deps.db.query<ChannelRow>(`SELECT id, kind, name, config, secret_id FROM notification_channels WHERE workspace_id = $1 AND enabled = true AND $2 = ANY(events)`, [workspaceId, event])).map((r) => ({ ...r, config: { ...r.config, workspaceId } }));
  let sent = 0;
  await Promise.all(
    rows.map(async (ch) => {
      try {
        await sendToChannel(deps, ch, event, m);
        sent++;
      } catch (e) {
        console.warn(`[notify] ${ch.kind} channel "${ch.name}" failed: ${(e as Error).message}`);
      }
    }),
  );
  return sent;
}
