import "../../lib/monaco";
import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { scanForLeaks } from "@mfc/core";
import { useBuilder } from "./store";
import { pageHtml, pageReact, siteCss } from "./exporters";
import { useTheme } from "../../lib/theme";
import { monacoTheme } from "../../lib/monaco";
import { useT } from "../../lib/i18n";
import { downloadText, slugify } from "../../lib/download";
import { IconDownload, IconShield, IconWarning, IconClose } from "../../ui/icons";

type Tab = "json" | "react" | "html" | "css";

export default function CodePanel() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("json");
  const doc = useBuilder((s) => s.doc);
  const page = useBuilder((s) => s.page());
  const scheme = useTheme((s) => (s.draft ?? s.active().tokens).scheme);
  const [error, setError] = useState<string | null>(null);
  const editingRef = useRef(false);

  const docJson = useMemo(() => JSON.stringify(page.root, null, 2), [page.root]);
  const [jsonText, setJsonText] = useState(docJson);
  // Canvas → code: refresh editor text when the document changes from elsewhere.
  useEffect(() => {
    if (!editingRef.current) setJsonText(docJson);
  }, [docJson]);

  // Code → canvas: apply valid JSON edits after a short pause.
  useEffect(() => {
    if (!editingRef.current) return;
    const h = setTimeout(() => {
      try {
        const parsed = JSON.parse(jsonText);
        useBuilder.getState().replacePageRoot(parsed);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        editingRef.current = false;
      }
    }, 600);
    return () => clearTimeout(h);
  }, [jsonText]);

  const outputs = useMemo(() => ({ react: pageReact(page), html: pageHtml(doc, page), css: siteCss(doc) }), [doc, page]);
  const current = tab === "json" ? jsonText : outputs[tab];
  const leaks = useMemo(() => (tab === "json" ? scanForLeaks(jsonText) : scanForLeaks(outputs[tab])), [tab, jsonText, outputs]);
  const lang = tab === "json" ? "json" : tab === "react" ? "javascript" : tab;
  const file = tab === "json" ? `${slugify(page.name)}.page.json` : tab === "react" ? `${slugify(page.name)}.jsx` : tab === "html" ? `${slugify(page.name)}.html` : "site.css";

  return (
    <div className="panel">
      <div className="tabs" style={{ alignItems: "center" }}>
        {(["json", "react", "html", "css"] as Tab[]).map((k) => (
          <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
            {t(k === "json" ? "builder.codeJson" : k === "react" ? "builder.codeReact" : k === "html" ? "builder.codeHtml" : "builder.codeCss")}
          </button>
        ))}
        <div className="grow" />
        <span className={`badge ${leaks.length ? "badge-danger" : "badge-success"}`} title={leaks.map((l) => `L${l.line}: ${l.title} ${l.preview}`).join("\n")}>
          {leaks.length ? <IconWarning size={12} /> : <IconShield size={12} />} {leaks.length ? t("builder.leaks", { n: leaks.length }) : t("builder.noLeaks")}
        </span>
        <button className="icon-btn" title={t("common.export")} onClick={() => downloadText(file, current)}>
          <IconDownload size={15} />
        </button>
        <button className="icon-btn" title={t("common.close")} onClick={() => useBuilder.getState().setCodeOpen(false)}>
          <IconClose size={15} />
        </button>
      </div>
      {error && tab === "json" && <div className="badge badge-danger" style={{ margin: 6, whiteSpace: "normal" }}>{t("builder.jsonInvalid", { error })}</div>}
      <div className="grow" style={{ minHeight: 0 }}>
        <Editor
          height="100%"
          language={lang}
          theme={monacoTheme(scheme)}
          value={current}
          onChange={(v) => {
            if (tab !== "json") return;
            editingRef.current = true;
            setJsonText(v ?? "");
          }}
          options={{ readOnly: tab !== "json", minimap: { enabled: false }, fontSize: 12, wordWrap: "on", scrollBeyondLastLine: false, tabSize: 2, automaticLayout: true }}
        />
      </div>
    </div>
  );
}
