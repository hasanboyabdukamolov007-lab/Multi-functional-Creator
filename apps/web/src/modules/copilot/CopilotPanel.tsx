import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCopilot, EFFORTS, type Effort, type ForgeMsg, type ToolRun } from "./agent";
import { STARTERS } from "./starters";
import { useT, useI18n } from "../../lib/i18n";
import { load, save } from "../../lib/storage";
import { toast } from "../../lib/ui";
import { runFunction } from "../../lib/registry";
import * as I from "../../ui/icons";
import { canListen, canSpeak, listen, speak, stopSpeaking } from "../../lib/speech";
import { learnConfirmed, rate, recordAnswer } from "./brain";

type Block = { type: string; text?: string; thinking?: string; name?: string; id?: string; input?: unknown; content?: unknown; tool_use_id?: string; from?: { model?: string }; to?: { model?: string } };

const Md = memo(function Md({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  if (typeof o.id === "string" && Object.keys(o).length <= 2) return `${o.id}${o.args ? ` ${JSON.stringify(o.args).slice(0, 60)}` : ""}`;
  if (typeof o.query === "string") return `“${o.query}”`;
  if (Array.isArray(o.objects)) return `${o.objects.length} object(s)`;
  if (o.root) return "full page";
  if (o.node && typeof o.node === "object") return String((o.node as { type?: string }).type ?? "node");
  const s = JSON.stringify(o);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function ToolCard({ name, input, run }: { name: string; input: unknown; run?: ToolRun }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const icon = !run || run.status === "running" ? <I.IconSpinner size={13} className="spin" /> : run.status === "ok" ? <I.IconCheck size={13} style={{ color: "var(--mfc-success)" }} /> : <I.IconWarning size={13} style={{ color: "var(--mfc-danger)" }} />;
  return (
    <div className="card" style={{ padding: "6px 10px", fontSize: 12 }}>
      <button className="row" style={{ background: "none", border: 0, padding: 0, width: "100%", cursor: "pointer", color: "inherit", gap: 6 }} onClick={() => setOpen(!open)}>
        {icon}
        <I.IconTool size={13} className="muted" />
        <span className="mono">{t("copilot.usedTool", { tool: name })}</span>
        <span className="muted ellipsis grow" style={{ textAlign: "left" }}>{summarizeInput(input)}</span>
        {open ? <I.IconChevronDown size={13} /> : <I.IconChevronRight size={13} />}
      </button>
      {open && (
        <pre className="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "6px 0 0", maxHeight: 220, overflow: "auto", fontSize: 11 }}>
          {JSON.stringify(input, null, 2)}
          {run?.result ? `\n\n→ ${run.result}` : ""}
        </pre>
      )}
    </div>
  );
}

function Thinking({ text, live }: { text: string; live?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!text && !live) return null;
  return (
    <div className="small muted">
      <button className="row" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit", gap: 4 }} onClick={() => setOpen(!open)}>
        <I.IconBrain size={13} /> {t("copilot.thinking")} {live && <I.IconSpinner size={12} className="spin" />} {text && (open ? <I.IconChevronDown size={12} /> : <I.IconChevronRight size={12} />)}
      </button>
      {open && text && <div style={{ borderLeft: "2px solid var(--mfc-border)", paddingLeft: 8, marginTop: 4, whiteSpace: "pre-wrap" }}>{text}</div>}
    </div>
  );
}

function AssistantBlocks({ blocks, toolRuns }: { blocks: Block[]; toolRuns: Record<string, ToolRun> }) {
  const t = useT();
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "text" && b.text) return <Md key={i} text={b.text} />;
        if (b.type === "thinking") return <Thinking key={i} text={b.thinking ?? ""} />;
        if (b.type === "tool_use") return <ToolCard key={i} name={b.name ?? "tool"} input={b.input} run={toolRuns[b.id ?? ""]} />;
        if (b.type === "server_tool_use") return <div key={i} className="small muted row" style={{ gap: 6 }}><I.IconGlobe size={13} /> {b.name === "web_fetch" ? `Fetching ${(b.input as { url?: string })?.url ?? ""}` : `${t("copilot.searching")}: ${(b.input as { query?: string })?.query ?? ""}`}</div>;
        if (b.type === "web_search_tool_result" && Array.isArray(b.content))
          return (
            <div key={i} className="small" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(b.content as Array<{ url: string; title: string }>).slice(0, 6).map((r) => (
                <a key={r.url} className="badge" href={r.url} target="_blank" rel="noopener noreferrer" title={r.url} style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</a>
              ))}
            </div>
          );
        if (b.type === "fallback") return <div key={i} className="small muted">↪ {b.from?.model} → {b.to?.model}</div>;
        return null;
      })}
    </>
  );
}

function QuizBlock({ msg, index }: { msg: ForgeMsg; index: number }) {
  const c = useCopilot();
  const locale = useI18n((s) => s.locale);
  const answers = msg.answers ?? {};
  if (!msg.quiz) return null;
  const done = Object.keys(answers).length;
  const score = msg.quiz.questions.filter((q, i) => answers[i] === q.answer).length;
  return (
    <div className="col" style={{ gap: 10 }}>
      {msg.quiz.questions.map((q, i) => {
        const chosen = answers[i];
        return (
          <div key={i} className="card col" style={{ gap: 6, padding: 10 }}>
            <strong className="small">{i + 1}. {q.q}</strong>
            {q.options.map((o, j) => {
              const state = chosen === undefined ? "" : j === q.answer ? "correct" : j === chosen ? "wrong" : "";
              return (
                <button
                  key={j}
                  className={`quiz-option ${state}`}
                  disabled={chosen !== undefined}
                  onClick={() => {
                    c.patchForge(index, { answers: { ...answers, [i]: j } });
                    recordAnswer(q.entry, j === q.answer);
                  }}
                >
                  {String.fromCharCode(65 + j)}. {o}
                </button>
              );
            })}
            {chosen !== undefined && <div className="small muted">{chosen === q.answer ? "✅ " : "❌ "}{q.why}</div>}
          </div>
        );
      })}
      {done === msg.quiz.questions.length && (
        <div className="badge badge-accent" style={{ alignSelf: "flex-start" }}>
          {locale === "uz" ? `Natija: ${score}/${done}` : locale === "ru" ? `Результат: ${score}/${done}` : `Score: ${score}/${done}`}
        </div>
      )}
    </div>
  );
}

function BrainExtras({ msg, index }: { msg: ForgeMsg; index: number }) {
  const c = useCopilot();
  const t = useT();
  return (
    <>
      <QuizBlock msg={msg} index={index} />
      {msg.actions?.length ? (
        <div className="row wrap" style={{ gap: 6 }}>
          {msg.actions.map((a, i) => (
            <button
              key={i}
              className="btn btn-sm"
              style={{ height: "auto", minHeight: 28, whiteSpace: "normal", textAlign: "left" }}
              onClick={() => {
                if (a.fn) {
                  void runFunction(a.fn)
                    .then(() => a.learnText && learnConfirmed(a.learnText, a.fn!))
                    .catch((e: Error) => toast(e.message, "error"));
                } else if (a.ask) void c.send(a.ask);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      {msg.rate && (
        <div className="row small muted" style={{ gap: 4 }}>
          <button className={`icon-btn ${msg.rated === "up" ? "active" : ""}`} style={{ width: 26, height: 26 }} disabled={!!msg.rated} title={t("copilot.helpful")} aria-label={t("copilot.helpful")} onClick={() => (rate(msg.rate!, true), c.patchForge(index, { rated: "up" }))}>👍</button>
          <button className={`icon-btn ${msg.rated === "down" ? "active" : ""}`} style={{ width: 26, height: 26 }} disabled={!!msg.rated} title={t("copilot.notHelpful")} aria-label={t("copilot.notHelpful")} onClick={() => (rate(msg.rate!, false), c.patchForge(index, { rated: "down" }))}>👎</button>
          {msg.rated && <span>{t("copilot.learned")}</span>}
        </div>
      )}
    </>
  );
}

function ForgeSteps({ msg, running, index }: { msg: ForgeMsg; running: boolean; index: number }) {
  // The first paragraph is the summary line ("Done. Here's what I did:"); it belongs above the steps.
  const hasSteps = (msg.steps ?? []).length > 0;
  const [head, ...rest] = msg.text.split("\n\n");
  return (
    <div className="col" style={{ gap: 8 }}>
      {hasSteps && head && <Md text={head} />}
      {(msg.steps ?? []).map((st, i) => (
        <div key={i} className="card row" style={{ padding: "6px 10px", fontSize: 12, gap: 6 }}>
          {st.status === "ok" ? <I.IconCheck size={13} style={{ color: "var(--mfc-success)" }} /> : <I.IconWarning size={13} style={{ color: "var(--mfc-danger)" }} />}
          <span className="grow">{st.label}</span>
          {st.detail && <span className="muted ellipsis" style={{ maxWidth: 180 }} title={st.detail}>{st.detail}</span>}
        </div>
      ))}
      {(hasSteps ? rest.join("\n\n") : msg.text) ? <Md text={hasSteps ? rest.join("\n\n") : msg.text} /> : running && !hasSteps ? <div className="row small muted"><I.IconSpinner size={13} className="spin" /> Working…</div> : null}
      {!running && <BrainExtras msg={msg} index={index} />}
    </div>
  );
}

export default function CopilotPanel() {
  const t = useT();
  const c = useCopilot();
  const [input, setInput] = useState("");
  const [listening, setListening] = useState<null | (() => void)>(null);
  const [voiceOut, setVoiceOut] = useState(() => load("mfc.copilot.voice", false));
  const locale = useI18n((s) => s.locale);
  const spoken = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void c.loadStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [c.messages, c.live, c.simple]);
  useEffect(() => {
    area.current?.focus();
  }, []);

  const submit = (override?: string) => {
    const text = override ?? input;
    if (!text.trim()) return;
    setInput("");
    void c.send(text);
  };
  const mic = () => {
    if (listening) return listening();
    const stop = listen(
      locale,
      (text, final) => {
        setInput(text);
        if (final) submit(text);
      },
      (err) => {
        setListening(null);
        if (err && err !== "no-speech" && err !== "aborted") toast(err === "unsupported" ? t("copilot.voiceUnsupported") : err, "warning");
      },
    );
    setListening(() => stop);
  };
  // Read Forge's finished answers aloud when voice output is on.
  useEffect(() => {
    if (!voiceOut || c.running) return;
    const last = c.forge[c.forge.length - 1];
    if (!last || last.role !== "forge" || c.forge.length === spoken.current) return;
    spoken.current = c.forge.length;
    const text = [last.text, ...(last.steps ?? []).map((st) => (st as { title?: string }).title ?? "")].filter(Boolean).join(". ");
    void speak(text, locale);
  }, [c.forge, c.running, voiceOut, locale]);
  const forge = c.provider === "forge";
  const builtin = c.provider === "claude";
  const unconfigured = builtin && c.status && !c.status.builtIn.configured;
  const models = c.status?.models ?? [];
  const model = c.model ?? c.status?.settings.defaultModel ?? "claude-opus-5-5";
  const effort = c.effort ?? c.status?.settings.defaultEffort ?? "high";
  const empty = forge ? c.forge.length === 0 : builtin ? c.messages.length === 0 : c.simple.length === 0;

  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <div className="panel-header" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13, color: "var(--mfc-text)", gap: 8 }}>
        <I.IconSparkles size={16} style={{ color: "var(--mfc-accent)" }} />
        <span className="grow">{t("copilot.title")}</span>
        <button className="icon-btn" title={t("copilot.newChat")} onClick={c.reset}><I.IconPlus size={15} /></button>
      </div>
      <div className="row" style={{ padding: "6px 10px", gap: 6, borderBottom: "1px solid var(--mfc-border)", flexWrap: "wrap" }}>
        <select className="select input-sm" style={{ flex: "1 1 120px" }} value={c.provider} onChange={(e) => c.setProvider(e.target.value)} aria-label={t("copilot.provider")}>
          <option value="forge">{t("copilot.forge")}</option>
          {c.status?.claudeEnabled && <option value="claude">{t("copilot.claudeAddon")}</option>}
          {c.status?.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.model}
            </option>
          ))}
        </select>
        {builtin && (
          <>
            <select className="select input-sm" style={{ flex: "1 1 120px" }} value={model} onChange={(e) => c.setModel(e.target.value)} aria-label={t("copilot.model")} title={models.find((m) => m.id === model)?.description}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <select className="select input-sm" style={{ width: 90 }} value={effort} onChange={(e) => c.setEffort(e.target.value as Effort)} aria-label={t("copilot.effort")} title={t("copilot.effort")}>
              {EFFORTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div ref={scroller} className="grow" style={{ overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        {unconfigured && (
          <div className="card col" style={{ gap: 8, borderColor: "color-mix(in srgb, var(--mfc-warning) 50%, var(--mfc-border))" }}>
            <div className="row"><I.IconWarning size={16} style={{ color: "var(--mfc-warning)" }} /> <strong>{t("copilot.notConfigured")}</strong></div>
            <button className="btn btn-primary btn-sm" onClick={() => runFunction("vault.copilot-key")}><I.IconVault size={14} /> {t("copilot.configure")}</button>
          </div>
        )}
        {empty && (
          <div className="col" style={{ gap: 10 }}>
            {forge && <div className="badge badge-success" style={{ whiteSpace: "normal", padding: "6px 10px" }}><I.IconShield size={12} /> {t("copilot.forgeLocal")}</div>}
            <p className="muted">{t("copilot.empty")}</p>
            <div className="col" style={{ gap: 6 }}>
              {STARTERS.slice(0, 6).map((s) => (
                <button key={s.id} className="btn btn-sm" style={{ justifyContent: "flex-start", height: "auto", padding: "8px 10px", whiteSpace: "normal", textAlign: "left" }} onClick={() => setInput(s.prompt)}>
                  <I.IconWand size={13} /> {s.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {forge &&
          c.forge.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="card" style={{ padding: "8px 12px", alignSelf: "flex-end", maxWidth: "90%", background: "var(--mfc-accent-soft)", whiteSpace: "pre-wrap" }}>{m.text}</div>
            ) : (
              <ForgeSteps key={i} index={i} msg={m} running={c.running && i === c.forge.length - 1} />
            ),
          )}
        {forge ? null : builtin
          ? c.messages.map((m, i) => {
              if (m.role === "user") {
                if (typeof m.content === "string") return <div key={i} className="card" style={{ padding: "8px 12px", alignSelf: "flex-end", maxWidth: "90%", background: "var(--mfc-accent-soft)" }}>{m.content}</div>;
                const texts = (m.content as Block[]).filter((b) => b.type === "text" && !b.text?.startsWith("<panel_context>"));
                if (!texts.length) return null; // tool results are shown on their tool cards
                return <div key={i} className="card" style={{ padding: "8px 12px", alignSelf: "flex-end", maxWidth: "90%", background: "var(--mfc-accent-soft)", whiteSpace: "pre-wrap" }}>{texts.map((b) => b.text).join("\n")}</div>;
              }
              return (
                <div key={i} className="col" style={{ gap: 8 }}>
                  <AssistantBlocks blocks={(typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content) as Block[]} toolRuns={c.toolRuns} />
                </div>
              );
            })
          : c.simple.map((m, i) => (
              <div key={i} className={m.role === "user" ? "card" : ""} style={m.role === "user" ? { padding: "8px 12px", alignSelf: "flex-end", maxWidth: "90%", background: "var(--mfc-accent-soft)" } : undefined}>
                {m.role === "user" ? m.content : <Md text={m.content || "…"} />}
              </div>
            ))}

        {c.live && (
          <div className="col" style={{ gap: 8 }}>
            {c.live.map((b, i) =>
              b.type === "thinking" ? <Thinking key={i} text={b.text} live /> : b.type === "text" ? <Md key={i} text={b.text} /> : b.type === "tool_use" ? <ToolCard key={i} name={b.name ?? "tool"} input={(() => { try { return JSON.parse(b.text || "{}"); } catch { return { streaming: b.text.slice(-120) }; } })()} /> : b.type === "server_tool_use" ? <div key={i} className="small muted row" style={{ gap: 6 }}><I.IconGlobe size={13} /> {t("copilot.searching")}…</div> : null,
            )}
            {c.live.length === 0 && <div className="row small muted"><I.IconSpinner size={13} className="spin" /> {t("copilot.thinking")}…</div>}
          </div>
        )}
        {c.running && !c.live && builtin && <div className="row small muted"><I.IconSpinner size={13} className="spin" /> Working…</div>}
        {c.error && c.error !== "unconfigured" && <div className="badge badge-danger" style={{ whiteSpace: "normal", padding: "8px 10px" }}>{c.error === "refusal" ? t("copilot.refusal") : c.error}</div>}
      </div>

      <div style={{ padding: 10, borderTop: "1px solid var(--mfc-border)" }}>
        <div className="card" style={{ padding: 6, display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea
            ref={area}
            className="textarea"
            style={{ border: 0, minHeight: 44, maxHeight: 200, background: "transparent", boxShadow: "none" }}
            rows={2}
            value={input}
            placeholder={t("copilot.placeholder")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {c.running ? (
            <button className="btn btn-danger" onClick={c.stop} title={t("copilot.stop")}><I.IconCircleStop size={15} /></button>
          ) : (
            <>
              {canListen() && (
                <button className={`btn ${listening ? "btn-danger" : "btn-ghost"}`} onClick={mic} title={t("copilot.voice")} aria-label={t("copilot.voice")} aria-pressed={!!listening}>
                  <I.IconMic size={15} />
                </button>
              )}
              <button className="btn btn-primary" onClick={() => submit()} disabled={!input.trim()} title={t("copilot.send")}><I.IconSend size={15} /></button>
            </>
          )}
        </div>
        {forge && canSpeak() && (
          <label className="row small muted" style={{ gap: 6, marginTop: 6 }}>
            <input type="checkbox" checked={voiceOut} onChange={(e) => { setVoiceOut(e.target.checked); save("mfc.copilot.voice", e.target.checked); if (!e.target.checked) stopSpeaking(); spoken.current = c.forge.length; }} />
            <I.IconVolume size={13} /> {t("copilot.readAloud")}
          </label>
        )}
        {builtin && c.usage.output > 0 && (
          <div className="small muted" style={{ marginTop: 4, textAlign: "right" }}>
            {c.usage.input.toLocaleString()} in · {c.usage.cacheRead.toLocaleString()} cached · {c.usage.output.toLocaleString()} out
          </div>
        )}
      </div>
    </div>
  );
}
