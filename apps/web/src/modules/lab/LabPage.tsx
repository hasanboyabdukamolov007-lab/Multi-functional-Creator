import { useMemo, useState } from "react";
import { useBrain } from "../copilot/brain/memory";
import { experimentRound, houseStyle, mineProjects, selfTestRound } from "../copilot/brain/trainer";
import { CAT_LABEL, KB, explain, type KCat } from "../copilot/brain/knowledge";
import { useT, useI18n } from "../../lib/i18n";
import { registry, runFunction } from "../../lib/registry";
import { functionTitle } from "../../shell/CommandPalette";
import { toast } from "../../lib/ui";
import { downloadText, pickFile } from "../../lib/download";
import { confirmDialog } from "../../ui/dialog";
import { learnConfirmed, syncRegistryKnowledge } from "../copilot/brain";
import { LearningChart } from "./LearningChart";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as I from "../../ui/icons";

export default function LabPage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const { data, mutate, reset, exportJson, importJson } = useBrain();
  useBrain((s) => s.rev);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<KCat | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [teachFor, setTeachFor] = useState<string | null>(null);
  const [teachFn, setTeachFn] = useState("");
  const hs = houseStyle();
  useMemo(() => syncRegistryKnowledge(), []);
  const latest = data.metrics.slice(-10);
  const avg = (k: "fnAcc" | "kbAcc") => (latest.length ? Math.round((latest.reduce((a, m) => a + m[k], 0) / latest.length) * 100) : null);
  const first = data.metrics.slice(0, 10);
  const firstAvg = (k: "fnAcc" | "kbAcc") => (first.length ? Math.round((first.reduce((a, m) => a + m[k], 0) / first.length) * 100) : null);
  const fns = useMemo(() => registry.list().filter((f) => !f.id.startsWith("copilot.")).map((f) => ({ id: f.id, title: functionTitle(f) })).sort((a, b) => a.title.localeCompare(b.title)), []);

  const train = async (rounds: number) => {
    setBusy(true);
    const before = avg("fnAcc");
    for (let i = 0; i < rounds; i++) {
      selfTestRound(Date.now() + i * 7919, 40, 16);
      if (i % 3 === 0) experimentRound(Date.now() + i * 104729, 2);
      await new Promise((r) => setTimeout(r, 0));
    }
    setBusy(false);
    toast(t("lab.trained", { n: rounds, before: before ?? 0, after: avg("fnAcc") ?? 0 }), "success");
  };

  const tiles: Array<[string, string | number, typeof I.IconHome]> = [
    [t("lab.fnAcc"), avg("fnAcc") === null ? "—" : `${avg("fnAcc")}%`, I.IconGauge],
    [t("lab.kbAcc"), avg("kbAcc") === null ? "—" : `${avg("kbAcc")}%`, I.IconBook],
    [t("lab.tests"), (data.totals.fnTests + data.totals.kbTests).toLocaleString(), I.IconLab],
    [t("lab.learned"), (data.totals.learnedFromTests + data.examples.filter((e) => e.source !== "self").length).toLocaleString(), I.IconBrain],
    [t("lab.experiments"), data.totals.experiments.toLocaleString(), I.IconPalette],
    [t("lab.projects"), data.totals.projectsLearned.toLocaleString(), I.IconFolder],
    [t("lab.knowledge"), KB.length, I.IconAcademy],
    [t("lab.feedback"), `👍 ${data.feedback.up} · 👎 ${data.feedback.down}`, I.IconComment],
  ];
  const entries = KB.filter((e) => cat === "all" || e.cat === cat);

  return (
    <div className="page">
      <div className="page-narrow col" style={{ gap: 20 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">{t("lab.title")}</h1>
            <p className="page-subtitle">{t("lab.subtitle")}</p>
          </div>
          <div className="row wrap">
            <label className="row small" style={{ gap: 6 }}>
              <input type="checkbox" checked={!data.paused} onChange={(e) => mutate((d) => void (d.paused = !e.target.checked))} /> {t("lab.continuous")}
            </label>
            <button className="btn btn-primary" disabled={busy} onClick={() => void train(25)}>{busy ? <I.IconSpinner size={14} className="spin" /> : <I.IconLab size={14} />} {t("lab.trainNow")}</button>
          </div>
        </div>

        <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 170px), 1fr))", gap: 10 }}>
          {tiles.map(([label, value, Icon]) => (
            <div key={label} className="card stat-tile">
              <div className="row small muted" style={{ gap: 6 }}><Icon size={14} /> {label}</div>
              <div className="stat-value">{value}</div>
            </div>
          ))}
        </div>

        <div className="card col" style={{ gap: 10 }}>
          <div className="row">
            <strong className="grow">{t("lab.progress")}</strong>
            {firstAvg("fnAcc") !== null && data.metrics.length > 20 && <span className="small muted">{t("lab.sinceStart", { from: firstAvg("fnAcc") ?? 0, to: avg("fnAcc") ?? 0 })}</span>}
          </div>
          <LearningChart metrics={data.metrics} labels={{ fn: t("lab.fnAcc"), kb: t("lab.kbAcc"), round: t("lab.round"), empty: t("lab.noRounds") }} />
          <p className="hint">{t("lab.how")}</p>
        </div>

        <div className="grid-auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))" }}>
          <div className="card col" style={{ gap: 10 }}>
            <strong>{t("lab.palettes")}</strong>
            {data.bestPalettes.length === 0 ? <div className="hint">{t("lab.noExperiments")}</div> : (
              <div className="row wrap" style={{ gap: 8 }}>
                {data.bestPalettes.map((p) => (
                  <span key={p.primary + p.dark} className="col small" style={{ alignItems: "center", gap: 2 }} title={`${p.primary} · ${p.dark ? "dark" : "light"} · ${Math.round(p.score * 100)}`}>
                    <span className="swatch" style={{ background: p.primary, outline: p.dark ? "3px solid #0c0e14" : "3px solid #ffffff", outlineOffset: -6 }} />
                    <span className="muted">{Math.round(p.score * 100)}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="hint">{t("lab.palettesHint")}</p>
          </div>
          <div className="card col" style={{ gap: 10 }}>
            <div className="row"><strong className="grow">{t("lab.houseStyle")}</strong><button className="btn btn-sm" onClick={() => void mineProjects().then((n) => toast(t("lab.mined", { n }), "success"))}><I.IconRotate size={13} /> {t("lab.study")}</button></div>
            {hs.primary || hs.radius || hs.favouriteSections.length ? (
              <div className="col small" style={{ gap: 6 }}>
                {hs.primary && <div className="row" style={{ gap: 8 }}><span className="swatch" style={{ background: hs.primary }} /> {t("lab.primary")}: <code>{hs.primary}</code></div>}
                {hs.radius && <div>{t("lab.radius")}: <code>{hs.radius}</code></div>}
                {hs.favouriteSections.length > 0 && <div>{t("lab.sections")}: {hs.favouriteSections.join(" → ")}</div>}
              </div>
            ) : <div className="hint">{t("lab.noStyle")}</div>}
          </div>
        </div>

        <div className="card col" style={{ gap: 8 }}>
          <strong>{t("lab.gaps")}</strong>
          <p className="hint">{t("lab.gapsHint")}</p>
          {data.gaps.length === 0 && <div className="hint">—</div>}
          {[...data.gaps].reverse().slice(0, 15).map((g, i) => (
            <div key={i} className="row wrap small" style={{ gap: 6 }}>
              <span className="grow">“{g.text.slice(0, 120)}”</span>
              {teachFor === g.text ? (
                <>
                  <select className="select input-sm" style={{ width: 240 }} value={teachFn} onChange={(e) => setTeachFn(e.target.value)} aria-label={t("lab.meant")}>
                    <option value="">{t("lab.meant")}</option>
                    {fns.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
                  </select>
                  <button className="btn btn-sm btn-primary" disabled={!teachFn} onClick={() => { learnConfirmed(g.text, teachFn); mutate((d) => void (d.gaps = d.gaps.filter((x) => x.text !== g.text))); setTeachFor(null); toast(t("copilot.learned"), "success"); }}>{t("common.save")}</button>
                </>
              ) : (
                <>
                  <button className="btn btn-sm" onClick={() => (setTeachFor(g.text), setTeachFn(""))}>{t("lab.teach")}</button>
                  <button className="icon-btn" aria-label={t("common.delete")} onClick={() => mutate((d) => void (d.gaps = d.gaps.filter((x) => x.text !== g.text)))}><I.IconClose size={13} /></button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="card col" style={{ gap: 10 }}>
          <div className="row wrap"><strong className="grow">{t("lab.kb")} ({KB.length})</strong>
            <select className="select input-sm" style={{ width: 220 }} value={cat} onChange={(e) => setCat(e.target.value as KCat | "all")} aria-label={t("lab.kb")}>
              <option value="all">{t("home.allKinds")}</option>
              {(Object.keys(CAT_LABEL) as KCat[]).map((c) => <option key={c} value={c}>{CAT_LABEL[c][locale]}</option>)}
            </select>
          </div>
          <div className="col" style={{ gap: 4 }}>
            {entries.map((e) => (
              <div key={e.id}>
                <div className="list-item" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  {open === e.id ? <I.IconChevronDown size={13} /> : <I.IconChevronRight size={13} />}
                  <span className="grow">{e.title[locale]}</span>
                  <span className="badge">{CAT_LABEL[e.cat][locale]}</span>
                </div>
                {open === e.id && (
                  <div className="md card" style={{ margin: "6px 0 10px 18px" }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{explain(e, locale)}</ReactMarkdown>
                    {e.tryFn && registry.get(e.tryFn) && <button className="btn btn-sm" onClick={() => void runFunction(e.tryFn!)}>▶ {functionTitle(registry.get(e.tryFn)!)}</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="row wrap">
          <button className="btn" onClick={() => downloadText("forge-brain.json", exportJson(), "application/json")}><I.IconDownload size={14} /> {t("lab.export")}</button>
          <button className="btn" onClick={() => void pickFile(".json,application/json").then(async (f) => { if (!f) return; try { importJson(await f.text()); toast(t("lab.imported"), "success"); } catch (e) { toast((e as Error).message, "error"); } })}><I.IconUpload size={14} /> {t("lab.import")}</button>
          <div className="grow" />
          <button className="btn btn-danger" onClick={() => void confirmDialog(t("lab.resetConfirm"), { danger: true }).then((ok) => { if (ok) reset(); })}><I.IconTrash size={14} /> {t("lab.reset")}</button>
        </div>
      </div>
    </div>
  );
}
