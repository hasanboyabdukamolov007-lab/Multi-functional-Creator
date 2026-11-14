import { create } from "zustand";
import type { BetaContentBlock, BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaRawMessageStreamEvent, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { api, ApiError, postSSE } from "../../lib/api";
import { ws, useSession } from "../../lib/session";
import { load, remove, save } from "../../lib/storage";
import { executeTool, panelContext, toolDefinitions } from "./tools";
import { runForge, type StepResult } from "./engine/engine";
import type { BrainAction, BrainQuiz } from "./brain";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ForgeMsg {
  role: "user" | "forge";
  text: string;
  steps?: StepResult[];
  actions?: BrainAction[];
  quiz?: BrainQuiz;
  rate?: { text: string; label?: string; entry?: string };
  rated?: "up" | "down";
  answers?: Record<number, number>;
}

export interface AiStatus {
  claudeEnabled: boolean;
  builtIn: { configured: boolean; keySource: "vault" | "server" | null; keySecretName: string | null };
  settings: { defaultModel: string; defaultEffort: Effort; webTools: boolean; keySecretId: string | null };
  models: Array<{ id: string; label: string; description: string; efforts: string[] }>;
  providers: Array<{ id: string; name: string; kind: string; base_url: string; model: string }>;
}

/** Block being streamed right now (before the final message arrives). */
export interface LiveBlock {
  type: string;
  text: string;
  name?: string;
}

export interface ToolRun {
  status: "running" | "ok" | "error";
  result?: string;
}

type ServerEvent = { type: "event"; event: BetaRawMessageStreamEvent } | { type: "final"; message: BetaMessage } | { type: "error"; message: string; status?: number };

interface SimpleMsg {
  role: "user" | "assistant";
  content: string;
}

interface CopilotState {
  status: AiStatus | null;
  messages: BetaMessageParam[];
  live: LiveBlock[] | null;
  toolRuns: Record<string, ToolRun>;
  running: boolean;
  error: string | null;
  model: string | null;
  effort: Effort | null;
  /** "forge" (built-in engine, default), "claude" (optional add-on) or an add-on provider id. */
  provider: string;
  forge: ForgeMsg[];
  simple: SimpleMsg[];
  abort: AbortController | null;
  usage: { input: number; output: number; cacheRead: number };

  loadStatus: () => Promise<void>;
  send: (text: string) => Promise<void>;
  patchForge: (index: number, patch: Partial<ForgeMsg>) => void;
  stop: () => void;
  reset: () => void;
  setModel: (m: string) => void;
  setEffort: (e: Effort) => void;
  setProvider: (p: string) => void;
}

const MAX_STEPS = 40;
const storeKey = () => `mfc.copilot.${useSession.getState().workspaceId ?? "none"}`;

function persist(s: Pick<CopilotState, "messages" | "toolRuns" | "simple" | "forge">) {
  const data = { messages: s.messages, toolRuns: s.toolRuns, simple: s.simple, forge: s.forge.slice(-100) };
  if (JSON.stringify(data).length > 3_000_000) return; // keep localStorage usage sane; history stays in memory
  save(storeKey(), data);
}

export const useCopilot = create<CopilotState>((set, get) => {
  const restored = load<Partial<Pick<CopilotState, "messages" | "toolRuns" | "simple" | "forge">>>(storeKey(), {});

  /** Stream one model turn; returns the final assistant message. */
  async function turn(signal: AbortSignal): Promise<BetaMessage> {
    const live: LiveBlock[] = [];
    set({ live: [] });
    let final: BetaMessage | null = null;
    for await (const ev of postSSE<ServerEvent>(ws("/ai/turn"), { messages: get().messages, tools: toolDefinitions(), model: get().model ?? undefined, effort: get().effort ?? undefined }, signal)) {
      if (ev.type === "error") throw new ApiError(ev.status ?? 500, ev.message);
      if (ev.type === "final") {
        final = ev.message;
        continue;
      }
      const e = ev.event;
      if (e.type === "content_block_start") {
        const b = e.content_block as { type: string; name?: string; text?: string };
        live[e.index] = { type: b.type, text: b.text ?? "", name: b.name };
      } else if (e.type === "content_block_delta") {
        const blk = live[e.index];
        if (!blk) continue;
        const d = e.delta as { type: string; text?: string; thinking?: string; partial_json?: string };
        if (d.type === "text_delta") blk.text += d.text ?? "";
        else if (d.type === "thinking_delta") blk.text += d.thinking ?? "";
        else if (d.type === "input_json_delta") blk.text += d.partial_json ?? "";
      } else continue;
      set({ live: [...live] });
    }
    if (!final) throw new Error("The response ended unexpectedly");
    const u = final.usage;
    const prev = get().usage;
    set({ usage: { input: prev.input + (u.input_tokens ?? 0), output: prev.output + (u.output_tokens ?? 0), cacheRead: prev.cacheRead + (u.cache_read_input_tokens ?? 0) } });
    return final;
  }

  async function sendBuiltIn(text: string) {
    const ac = new AbortController();
    set({
      running: true,
      error: null,
      abort: ac,
      messages: [...get().messages, { role: "user", content: [{ type: "text", text }, { type: "text", text: panelContext() }] }],
    });
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const msg = await turn(ac.signal);
        // Append the assistant turn exactly as returned (thinking blocks must stay unchanged).
        set({ messages: [...get().messages, { role: "assistant", content: msg.content as unknown as BetaContentBlockParam[] }], live: null });
        persist(get());

        if (msg.stop_reason === "pause_turn") continue;
        const toolUses = (msg.content as BetaContentBlock[]).filter((b): b is Extract<BetaContentBlock, { type: "tool_use" }> => b.type === "tool_use");
        if (msg.stop_reason !== "tool_use") {
          // A refusal or max_tokens can cut a tool call off mid-input: never run those, but answer
          // them so the conversation stays valid for the next message.
          if (toolUses.length) {
            const why = msg.stop_reason === "max_tokens" ? "Not executed: the response hit the output limit before the tool input was complete." : "Not executed: the response was stopped.";
            set({ messages: [...get().messages, { role: "user", content: toolUses.map((b) => ({ type: "tool_result" as const, tool_use_id: b.id, content: why, is_error: true })) }] });
          }
          if (msg.stop_reason === "refusal") set({ error: "refusal" });
          else if (msg.stop_reason === "max_tokens") set({ error: "The answer hit the output limit. Send \"continue\" to resume." });
          break;
        }
        if (!toolUses.length) break;

        const results: BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          set({ toolRuns: { ...get().toolRuns, [tu.id]: { status: "running" } } });
          const r = await executeTool(tu.name, tu.input);
          set({ toolRuns: { ...get().toolRuns, [tu.id]: { status: r.isError ? "error" : "ok", result: r.content.slice(0, 2000) } } });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
        }
        // All results for one assistant turn go back in a single user message.
        set({ messages: [...get().messages, { role: "user", content: results }] });
        persist(get());
        if (ac.signal.aborted) break;
        if (step === MAX_STEPS - 1) set({ error: `Stopped after ${MAX_STEPS} steps. Send "continue" to keep going.` });
      }
    } catch (e) {
      if (!ac.signal.aborted) set({ error: e instanceof ApiError && e.code === "ai_unconfigured" ? "unconfigured" : (e as Error).message });
      // If we stopped after an assistant tool_use turn, close it with error results so the history stays valid.
      const last = get().messages[get().messages.length - 1];
      if (last?.role === "assistant" && Array.isArray(last.content)) {
        const pending = (last.content as Array<{ type: string; id?: string }>).filter((b) => b.type === "tool_use");
        if (pending.length) set({ messages: [...get().messages, { role: "user", content: pending.map((b) => ({ type: "tool_result" as const, tool_use_id: b.id!, content: "Interrupted by the user", is_error: true })) }] });
      }
    } finally {
      set({ running: false, live: null, abort: null });
      persist(get());
    }
  }

  async function sendForge(text: string) {
    set({ forge: [...get().forge, { role: "user", text }, { role: "forge", text: "", steps: [] }], running: true, error: null });
    const updateLast = (patch: Partial<ForgeMsg>) => {
      const f = [...get().forge];
      f[f.length - 1] = { ...f[f.length - 1], ...patch };
      set({ forge: f });
    };
    try {
      const reply = await runForge(text, (steps) => updateLast({ steps }));
      updateLast({ text: reply.text, steps: reply.steps, actions: reply.actions, quiz: reply.quiz, rate: reply.rate ?? { text } });
    } catch (e) {
      updateLast({ text: (e as Error).message });
    } finally {
      set({ running: false });
      persist(get());
    }
  }

  async function sendSimple(text: string) {
    const ac = new AbortController();
    const history = [...get().simple, { role: "user" as const, content: text }];
    set({ simple: [...history, { role: "assistant", content: "" }], running: true, error: null, abort: ac });
    try {
      for await (const ev of postSSE<{ type: string; text?: string; message?: string }>(ws(`/ai/providers/${get().provider}/chat`), { messages: history }, ac.signal)) {
        if (ev.type === "error") throw new Error(ev.message);
        if (ev.type === "text") {
          const s = [...get().simple];
          s[s.length - 1] = { role: "assistant", content: s[s.length - 1].content + (ev.text ?? "") };
          set({ simple: s });
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) set({ error: (e as Error).message });
    } finally {
      set({ running: false, abort: null });
      persist(get());
    }
  }

  return {
    status: null,
    messages: restored.messages ?? [],
    live: null,
    toolRuns: restored.toolRuns ?? {},
    running: false,
    error: null,
    model: load<string | null>("mfc.copilot.model", null),
    effort: load<Effort | null>("mfc.copilot.effort", null),
    provider: ((p: string) => (p === "builtin" ? "forge" : p))(load("mfc.copilot.provider", "forge")),
    forge: restored.forge ?? [],
    simple: restored.simple ?? [],
    abort: null,
    usage: { input: 0, output: 0, cacheRead: 0 },

    loadStatus: async () => {
      try {
        const status = await api.get<AiStatus>(ws("/ai/status"));
        const cur = get().provider;
        const valid = cur === "forge" || (cur === "claude" && status.claudeEnabled) || status.providers.some((p) => p.id === cur);
        const provider = valid ? cur : "forge";
        set({ status, provider });
      } catch {
        set({ status: null });
      }
    },
    patchForge: (index, patch) => {
      const f = [...get().forge];
      if (!f[index]) return;
      f[index] = { ...f[index], ...patch };
      set({ forge: f });
      persist(get());
    },
    send: async (text) => {
      if (get().running || !text.trim()) return;
      const p = get().provider;
      if (p === "forge") await sendForge(text.trim());
      else if (p === "claude") await sendBuiltIn(text.trim());
      else await sendSimple(text.trim());
    },
    stop: () => get().abort?.abort(),
    reset: () => {
      get().abort?.abort();
      remove(storeKey());
      set({ messages: [], toolRuns: {}, simple: [], forge: [], error: null, live: null, usage: { input: 0, output: 0, cacheRead: 0 } });
    },
    setModel: (model) => {
      save("mfc.copilot.model", model);
      set({ model });
    },
    setEffort: (effort) => {
      save("mfc.copilot.effort", effort);
      set({ effort });
    },
    setProvider: (provider) => {
      save("mfc.copilot.provider", provider);
      set({ provider, error: null });
    },
  };
});

// Switch conversation when the workspace changes.
useSession.subscribe((s, prev) => {
  if (s.workspaceId === prev.workspaceId) return;
  const restored = load<Partial<Pick<CopilotState, "messages" | "toolRuns" | "simple" | "forge">>>(storeKey(), {});
  useCopilot.setState({ messages: restored.messages ?? [], toolRuns: restored.toolRuns ?? {}, simple: restored.simple ?? [], status: null, error: null });
});
