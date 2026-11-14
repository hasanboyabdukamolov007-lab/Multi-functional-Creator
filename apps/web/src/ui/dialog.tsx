import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { t } from "../lib/i18n";

/**
 * In-app replacements for window.prompt / window.confirm.
 * Native dialogs are blocked in some installed PWAs (iOS standalone), look out of place, and freeze the page.
 */
type Req =
  | { kind: "prompt"; title: string; value: string; placeholder?: string; multiline?: boolean; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; body?: string; danger?: boolean; ok?: string; resolve: (v: boolean) => void };

const useDialogs = create<{ queue: Req[] }>(() => ({ queue: [] }));
const push = (r: Req) => useDialogs.setState((s) => ({ queue: [...s.queue, r] }));
const pop = () => useDialogs.setState((s) => ({ queue: s.queue.slice(1) }));

export function ask(title: string, value = "", opts: { placeholder?: string; multiline?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => push({ kind: "prompt", title, value, ...opts, resolve }));
}
export function confirmDialog(title: string, opts: { body?: string; danger?: boolean; ok?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => push({ kind: "confirm", title, ...opts, resolve }));
}

export function DialogHost() {
  const req = useDialogs((s) => s.queue[0]);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (req?.kind === "prompt") {
      setValue(req.value);
      setTimeout(() => input.current?.select(), 0);
    }
  }, [req]);
  if (!req) return null;
  const close = (ok: boolean) => {
    if (req.kind === "prompt") req.resolve(ok ? value : null);
    else req.resolve(ok);
    pop();
  };
  return (
    <div className="overlay overlay-center" style={{ zIndex: 300 }} onMouseDown={(e) => e.target === e.currentTarget && close(false)} onKeyDown={(e) => e.key === "Escape" && close(false)}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="mfc-dialog-title" style={{ width: "min(440px, calc(100vw - 24px))" }} onSubmit={(e) => (e.preventDefault(), close(true))}>
        <div className="modal-title" id="mfc-dialog-title">{req.title}</div>
        {req.kind === "confirm" && req.body && <p className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{req.body}</p>}
        {req.kind === "prompt" &&
          (req.multiline ? (
            <textarea ref={input} className="textarea" style={{ marginTop: 12 }} rows={5} value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input ref={input} className="input" style={{ marginTop: 12 }} value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />
          ))}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => close(false)}>{t("common.cancel")}</button>
          <button className={`btn ${req.kind === "confirm" && req.danger ? "btn-danger" : "btn-primary"}`} autoFocus={req.kind === "confirm"}>
            {req.kind === "confirm" ? req.ok ?? t("common.confirmOk") : t("common.ok")}
          </button>
        </div>
      </form>
    </div>
  );
}
