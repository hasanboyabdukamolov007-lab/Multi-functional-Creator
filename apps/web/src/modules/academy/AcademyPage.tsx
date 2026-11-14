import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { buildCourse, type Lesson } from "./course";
import { Player } from "./Player";
import { canRecord, recordLesson } from "./recorder";
import { useT, useI18n } from "../../lib/i18n";
import { load, save } from "../../lib/storage";
import { registry } from "../../lib/registry";
import { useBrain } from "../copilot/brain/memory";
import { useCopilot } from "../copilot/agent";
import { useUi, toast } from "../../lib/ui";
import { downloadBlob, slugify } from "../../lib/download";
import * as I from "../../ui/icons";

type Progress = Record<string, { hash: string; at: string; score?: string }>;

export default function AcademyPage() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const rev = useBrain((s) => s.rev);
  const mastery = useBrain((s) => s.data.mastery);
  const [params, setParams] = useSearchParams();
  const [progress, setProgress] = useState<Progress>(() => load("mfc.academy.progress", {}));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [rec, setRec] = useState<{ p: number; ac: AbortController } | null>(null);
  const player = useRef<HTMLDivElement>(null);
  // Rebuild when the language, the registry or Forge's learning changes — the course updates itself.
  const course = useMemo(() => buildCourse(locale), [locale, rev, registry.size]); // eslint-disable-line react-hooks/exhaustive-deps
  const lessons = useMemo(() => course.tracks.flatMap((tr) => tr.lessons), [course]);
  const current = lessons.find((l) => l.id === params.get("lesson")) ?? lessons.find((l) => !progress[l.id]) ?? lessons[0];
  const idx = lessons.indexOf(current);

  useEffect(() => {
    // Remember which functions existed, so the next visit can teach what's new.
    save("mfc.academy.knownFns", registry.list().map((f) => f.id));
  }, []);
  useEffect(() => {
    const prev = load<string | null>("mfc.academy.version", null);
    if (prev && prev !== course.version) toast(t("academy.courseUpdated"), "info");
    save("mfc.academy.version", course.version);
  }, [course.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (l: Lesson) => {
    setParams({ lesson: l.id });
    player.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const complete = (l: Lesson, score?: { correct: number; total: number }) => {
    const next = { ...progress, [l.id]: { hash: l.hash, at: new Date().toISOString(), score: score && score.total ? `${score.correct}/${score.total}` : undefined } };
    setProgress(next);
    save("mfc.academy.progress", next);
  };
  const doneCount = lessons.filter((l) => progress[l.id]).length;
  const updated = (l: Lesson) => progress[l.id] && progress[l.id].hash !== l.hash;
  const review = lessons.filter((l) => {
    const m = mastery[l.entryId ?? l.id];
    return m && m.seen > 0 && m.correct / m.seen < 0.7;
  });
  const needle = q.trim().toLowerCase();

  const exportVideo = async () => {
    const ac = new AbortController();
    setRec({ p: 0, ac });
    try {
      const blob = await recordLesson(current, (p) => setRec((r) => (r ? { ...r, p } : r)), ac.signal);
      downloadBlob(`${slugify(current.title)}.webm`, blob);
      toast(t("academy.exported"), "success");
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast((e as Error).message, "error");
    } finally {
      setRec(null);
    }
  };

  return (
    <div className="page">
      <div className="page-narrow col" style={{ gap: 18, maxWidth: 1240 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1 className="page-title">{t("academy.title")}</h1>
            <p className="page-subtitle">{t("academy.subtitle", { lessons: course.stats.lessons, minutes: course.stats.minutes })}</p>
          </div>
          <div className="col" style={{ gap: 6, minWidth: 220 }}>
            <div className="row small" style={{ justifyContent: "space-between" }}><span>{t("academy.progressLabel")}</span><strong>{doneCount}/{lessons.length}</strong></div>
            <div className="meter"><i style={{ width: `${(doneCount / Math.max(1, lessons.length)) * 100}%` }} /></div>
            <span className="small muted">{t("academy.version", { v: course.version.slice(0, 6), learned: course.stats.learned, topics: course.stats.topics })}</span>
          </div>
        </div>

        <div className="academy-grid">
          <section className="col" style={{ gap: 12, minWidth: 0 }} ref={player}>
            <Player lesson={current} lang={locale} t={t} onComplete={(score) => (complete(current, score), toast(t("academy.completed", { title: current.title }), "success"))} onNext={lessons[idx + 1] ? () => select(lessons[idx + 1]) : undefined} />
            <div className="card col" style={{ gap: 8 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <strong className="grow">{current.title}</strong>
                <span className="small muted">{Math.max(1, Math.round(current.seconds / 60))} min · {current.scenes.length} {t("academy.scenes")}</span>
              </div>
              <p className="muted">{current.summary}</p>
              <div className="row wrap" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => complete(current)} disabled={!!progress[current.id] && !updated(current)}><I.IconCheck size={13} /> {t("academy.markDone")}</button>
                {lessons[idx + 1] && <button className="btn btn-sm" onClick={() => select(lessons[idx + 1])}>{t("academy.nextLesson")} →</button>}
                <button className="btn btn-sm" onClick={() => { useUi.getState().setCopilot(true); void useCopilot.getState().send(locale === "uz" ? `${current.title} bo'yicha dars ber` : locale === "ru" ? `Научи: ${current.title}` : `Teach me ${current.title}`); }}><I.IconSparkles size={13} /> {t("academy.askForge")}</button>
                {canRecord() && (rec ? (
                  <button className="btn btn-sm btn-danger" onClick={() => rec.ac.abort()}><I.IconCircleStop size={13} /> {Math.round(rec.p * 100)}% · {t("common.cancel")}</button>
                ) : (
                  <button className="btn btn-sm" onClick={() => void exportVideo()} title={t("academy.exportHint")}><I.IconFilm size={13} /> {t("academy.exportVideo")}</button>
                ))}
              </div>
            </div>
          </section>

          <aside className="card col academy-side" style={{ gap: 8, padding: 10 }}>
            <input className="input input-sm" placeholder={t("academy.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("academy.search")} />
            {review.length > 0 && !needle && (
              <div className="col" style={{ gap: 2 }}>
                <div className="section-label" style={{ padding: "4px 6px" }}>🔁 {t("academy.review")}</div>
                {review.slice(0, 4).map((l) => (
                  <div key={`r-${l.id}`} className="lesson-row small" onClick={() => select(l)}>
                    <span className="lesson-check">↺</span><span className="grow ellipsis">{l.title}</span>
                  </div>
                ))}
              </div>
            )}
            {course.tracks.map((tr) => {
              const list = tr.lessons.filter((l) => !needle || l.title.toLowerCase().includes(needle) || l.summary.toLowerCase().includes(needle));
              if (!list.length) return null;
              const done = tr.lessons.filter((l) => progress[l.id]).length;
              const isOpen = needle ? true : open[tr.id] ?? (tr.lessons.includes(current) || tr.id === "whats-new");
              return (
                <div key={tr.id}>
                  <button className="lesson-row" style={{ width: "100%", border: 0, background: "none", color: "inherit" }} onClick={() => setOpen({ ...open, [tr.id]: !isOpen })} aria-expanded={isOpen}>
                    {isOpen ? <I.IconChevronDown size={14} /> : <I.IconChevronRight size={14} />}
                    <strong className="grow" style={{ textAlign: "left" }}>{tr.title}</strong>
                    <span className="small muted">{done}/{tr.lessons.length}</span>
                  </button>
                  {isOpen && list.map((l) => (
                    <div key={l.id} className={`lesson-row small ${l.id === current.id ? "active" : ""}`} onClick={() => select(l)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && select(l)}>
                      <span className={`lesson-check ${progress[l.id] ? "done" : ""}`}>{progress[l.id] ? "✓" : ""}</span>
                      <span className="grow ellipsis">{l.title}</span>
                      {updated(l) && <span className="badge badge-accent">{t("academy.updated")}</span>}
                      {progress[l.id]?.score && <span className="small muted">{progress[l.id].score}</span>}
                      <span className="small muted">{Math.max(1, Math.round(l.seconds / 60))}′</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </aside>
        </div>
      </div>
    </div>
  );
}
