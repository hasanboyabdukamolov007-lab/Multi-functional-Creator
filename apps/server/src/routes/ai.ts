import crypto from "node:crypto";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaToolUnion, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { parse, requirePerm, badRequest, notFound, HttpError } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { readValue } from "../lib/secretsStore.js";
import { COPILOT_SYSTEM_PROMPT } from "../ai/systemPrompt.js";
import { DEFAULT_EFFORT, DEFAULT_MODEL, MODELS, modelInfo } from "../ai/models.js";
import type { Db } from "../db.js";
import type { MasterKeyRing } from "../lib/vaultCrypto.js";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const ClientTool = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: z.string().max(4000),
  input_schema: z.record(z.string(), z.unknown()),
});

const TurnBody = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.unknown() })).min(1).max(400),
  tools: z.array(ClientTool).max(64).default([]),
  model: z.string().optional(),
  effort: z.enum(EFFORTS).optional(),
});

const SettingsBody = z.object({
  defaultModel: z.string().optional(),
  defaultEffort: z.enum(EFFORTS).optional(),
  webTools: z.boolean().optional(),
  keySecretId: z.string().uuid().nullable().optional(),
  claudeEnabled: z.boolean().optional(),
});

const ProviderBody = z.object({
  name: z.string().trim().min(1).max(60),
  baseUrl: z.string().url().refine((u) => /^https?:\/\//.test(u), "must be http(s)"),
  model: z.string().trim().min(1).max(120),
  keySecretId: z.string().uuid().nullable().optional(),
});

const ProviderChatBody = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(200_000) })).min(1).max(200),
});

interface AiSettingsRow {
  claude_enabled: boolean;
  default_model: string;
  default_effort: string;
  web_tools: boolean;
  key_secret_id: string | null;
}

async function getSettings(db: Db, workspaceId: string): Promise<AiSettingsRow> {
  return (
    (await db.one<AiSettingsRow>(`SELECT claude_enabled, default_model, default_effort, web_tools, key_secret_id FROM ai_settings WHERE workspace_id = $1`, [workspaceId])) ?? {
      claude_enabled: false,
      default_model: DEFAULT_MODEL,
      default_effort: DEFAULT_EFFORT,
      web_tools: true,
      key_secret_id: null,
    }
  );
}

/** Find the Anthropic key: an explicitly chosen vault secret, else a workspace secret named ANTHROPIC_API_KEY, else the server env. */
async function resolveAnthropicKey(db: Db, ring: MasterKeyRing, workspaceId: string, envKey?: string): Promise<{ key?: string; source: "vault" | "server" | null; secretName?: string }> {
  const s = await getSettings(db, workspaceId);
  let secretId = s.key_secret_id;
  if (!secretId) {
    const row = await db.one<{ id: string }>(
      `SELECT id FROM secrets WHERE workspace_id = $1 AND name = 'ANTHROPIC_API_KEY' AND project_id IS NULL
       ORDER BY CASE environment WHEN 'production' THEN 0 WHEN 'staging' THEN 1 ELSE 2 END LIMIT 1`,
      [workspaceId],
    );
    secretId = row?.id ?? null;
  }
  if (secretId) {
    const meta = await db.one<{ name: string }>(`SELECT name FROM secrets WHERE id = $1 AND workspace_id = $2`, [secretId, workspaceId]);
    if (meta) return { key: await readValue(db, ring, secretId), source: "vault", secretName: meta.name };
  }
  if (envKey) return { key: envKey, source: "server" };
  return { source: null };
}

function sse(reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 15000);
  return {
    send,
    end: () => {
      clearInterval(ping);
      reply.raw.end();
    },
  };
}

function describeApiError(err: unknown): { message: string; status?: number } {
  if (err instanceof Anthropic.AuthenticationError) return { status: 401, message: "The Anthropic API key was rejected. Update ANTHROPIC_API_KEY in the Secrets Vault." };
  if (err instanceof Anthropic.PermissionDeniedError) return { status: 403, message: "This API key does not have access to the selected model." };
  if (err instanceof Anthropic.NotFoundError) return { status: 404, message: "The selected model is not available for this API key." };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: "Rate limited by the AI provider — wait a moment and try again." };
  if (err instanceof Anthropic.BadRequestError) return { status: 400, message: `The AI request was rejected: ${err.message}` };
  if (err instanceof Anthropic.APIError) return { status: err.status, message: `AI provider error${err.status ? ` (${err.status})` : ""}: ${err.message}` };
  if (err instanceof Error) return { message: err.message };
  return { message: "Unknown AI error" };
}

export const aiRoutes: FastifyPluginAsync = async (app) => {
  const { db, ring, config } = app.deps;

  app.get("/status", async (req) => {
    const a = requirePerm(req, "ai.use");
    const s = await getSettings(db, a.workspaceId);
    const key = await resolveAnthropicKey(db, ring, a.workspaceId, config.anthropicApiKey);
    const providers = await db.query(`SELECT id, name, kind, base_url, model, key_secret_id, created_at FROM ai_providers WHERE workspace_id = $1 ORDER BY created_at`, [a.workspaceId]);
    return {
      // Forge (the built-in engine) runs in the browser and needs nothing from the server.
      // Claude is an optional add-on that an admin must switch on.
      claudeEnabled: s.claude_enabled,
      builtIn: { configured: key.source !== null, keySource: key.source, keySecretName: key.secretName ?? null },
      settings: { defaultModel: s.default_model, defaultEffort: s.default_effort, webTools: s.web_tools, keySecretId: s.key_secret_id },
      models: MODELS.map(({ id, label, description, efforts }) => ({ id, label, description, efforts })),
      providers,
    };
  });

  app.put("/settings", async (req) => {
    const a = requirePerm(req, "ai.configure");
    const body = parse(SettingsBody, req.body);
    if (body.defaultModel && !modelInfo(body.defaultModel)) throw badRequest("Unknown model");
    if (body.keySecretId) {
      const s = await db.one(`SELECT 1 FROM secrets WHERE id = $1 AND workspace_id = $2`, [body.keySecretId, a.workspaceId]);
      if (!s) throw badRequest("Unknown secret");
    }
    await db.query(
      `INSERT INTO ai_settings (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING`,
      [a.workspaceId],
    );
    await db.query(
      `UPDATE ai_settings SET default_model = coalesce($2, default_model), default_effort = coalesce($3, default_effort), web_tools = coalesce($4, web_tools),
        key_secret_id = CASE WHEN $5::boolean THEN $6::uuid ELSE key_secret_id END, claude_enabled = coalesce($7, claude_enabled), updated_at = now() WHERE workspace_id = $1`,
      [a.workspaceId, body.defaultModel ?? null, body.defaultEffort ?? null, body.webTools ?? null, body.keySecretId !== undefined, body.keySecretId ?? null, body.claudeEnabled ?? null],
    );
    await audit(db, req, "ai.settings", { meta: body });
    return { ok: true };
  });

  /**
   * One model turn, streamed as SSE. The browser owns the agent loop: it executes client tool
   * calls against the live workspace, appends the results, and calls this endpoint again.
   * The conversation is append-only on the client, so thinking blocks stay valid across turns.
   */
  app.post("/turn", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const a = requirePerm(req, "ai.use");
    const body = parse(TurnBody, req.body);
    const settings = await getSettings(db, a.workspaceId);
    if (!settings.claude_enabled) throw new HttpError(412, "The Claude add-on is turned off. An admin can enable it in Settings → AI copilot; Forge works without it.", "claude_disabled");
    const model = modelInfo(body.model ?? settings.default_model) ?? modelInfo(DEFAULT_MODEL)!;
    const effort = (body.effort ?? settings.default_effort) as (typeof EFFORTS)[number];
    const key = await resolveAnthropicKey(db, ring, a.workspaceId, config.anthropicApiKey);
    if (!key.key) throw new HttpError(412, "The built-in copilot needs an Anthropic API key. Add a secret named ANTHROPIC_API_KEY in the Secrets Vault.", "ai_unconfigured");

    const client = new Anthropic({ apiKey: key.key });
    const tools: BetaToolUnion[] = body.tools.map(
      (t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as BetaTool["input_schema"], eager_input_streaming: true }) satisfies BetaTool,
    );
    if (settings.web_tools) {
      tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 8 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 });
    }

    const out = sse(reply);
    const stream = client.beta.messages.stream({
      model: model.id,
      max_tokens: 64000,
      ...(model.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: model.fallbacks } : {}),
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: COPILOT_SYSTEM_PROMPT }],
      tools,
      messages: body.messages as BetaMessageParam[],
    });
    req.raw.on("close", () => {
      if (!reply.raw.writableEnded) stream.abort();
    });

    try {
      for await (const event of stream) {
        if (event.type === "content_block_start" || event.type === "content_block_delta" || event.type === "content_block_stop" || event.type === "message_delta") {
          out.send({ type: "event", event });
        }
      }
      const message = await stream.finalMessage();
      out.send({ type: "final", message });
      await audit(db, req, "ai.turn", {
        meta: { model: message.model, effort, stop: message.stop_reason, input: message.usage.input_tokens, output: message.usage.output_tokens, cacheRead: message.usage.cache_read_input_tokens },
      });
    } catch (err) {
      if (!stream.aborted) {
        const e = describeApiError(err);
        app.log.warn({ err }, "ai turn failed");
        out.send({ type: "error", ...e });
      }
    } finally {
      out.end();
    }
  });

  // ---- Optional add-on providers (none by default) -------------------------------------------
  app.post("/providers", async (req) => {
    const a = requirePerm(req, "ai.configure");
    const body = parse(ProviderBody, req.body);
    if (body.keySecretId) {
      const s = await db.one(`SELECT 1 FROM secrets WHERE id = $1 AND workspace_id = $2`, [body.keySecretId, a.workspaceId]);
      if (!s) throw badRequest("Unknown secret");
    }
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO ai_providers (id, workspace_id, name, kind, base_url, model, key_secret_id) VALUES ($1,$2,$3,'openai-compatible',$4,$5,$6)`, [
      id,
      a.workspaceId,
      body.name,
      body.baseUrl.replace(/\/$/, ""),
      body.model,
      body.keySecretId ?? null,
    ]);
    await audit(db, req, "ai.provider.add", { targetType: "ai_provider", targetId: id, meta: { name: body.name, baseUrl: body.baseUrl, model: body.model } });
    return { id };
  });

  app.delete("/providers/:id", async (req) => {
    const a = requirePerm(req, "ai.configure");
    const { id } = req.params as { id: string };
    const row = await db.one(`DELETE FROM ai_providers WHERE id = $1 AND workspace_id = $2 RETURNING name`, [id, a.workspaceId]);
    if (!row) throw notFound("Provider not found");
    await audit(db, req, "ai.provider.remove", { targetType: "ai_provider", targetId: id });
    return { ok: true };
  });

  /** Plain streaming chat with an add-on OpenAI-compatible provider (no workspace tools). */
  app.post("/providers/:id/chat", async (req, reply) => {
    const a = requirePerm(req, "ai.use");
    const { id } = req.params as { id: string };
    const body = parse(ProviderChatBody, req.body);
    const p = await db.one<{ base_url: string; model: string; key_secret_id: string | null; name: string }>(
      `SELECT base_url, model, key_secret_id, name FROM ai_providers WHERE id = $1 AND workspace_id = $2`,
      [id, a.workspaceId],
    );
    if (!p) throw notFound("Provider not found");
    const apiKey = p.key_secret_id ? await readValue(db, ring, p.key_secret_id) : undefined;
    const ac = new AbortController();
    req.raw.on("close", () => ac.abort());
    const out = sse(reply);
    try {
      const res = await fetch(`${p.base_url}/chat/completions`, {
        method: "POST",
        signal: ac.signal,
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model: p.model, stream: true, messages: [{ role: "system", content: "You are a helpful assistant inside a creator control panel." }, ...body.messages] }),
      });
      if (!res.ok || !res.body) {
        out.send({ type: "error", status: res.status, message: `${p.name} returned ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const text = j.choices?.[0]?.delta?.content;
            if (text) out.send({ type: "text", text });
          } catch {
            /* ignore keep-alives and partial lines */
          }
        }
      }
      out.send({ type: "done" });
    } catch (err) {
      if (!ac.signal.aborted) out.send({ type: "error", message: err instanceof Error ? err.message : "Provider request failed" });
    } finally {
      out.end();
    }
  });
};
