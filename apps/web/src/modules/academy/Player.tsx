import { useCallback, useEffect, useRef, useState } from "react";
import type { Lesson, Scene } from "./course";
import { LessonVisual } from "./visuals";
import type { Lang } from "../copilot/brain/knowledge";
import { canSpeak, speak, stopSpeaking } from "../../lib/speech";
import { load, save } from "../../lib/storage";
import { runFunction } from "../../lib/registry";
import { recordAnswer } from "../copilot/brain";
import * as I from "../../ui/icons";

const words = (s: string) => s.split(/(\s+)/);
const baseSeconds = (s: Scene) => (s.kind === "code" ? Math.min(14, 4 + s.code.length / 45) : s.kind === "quiz" ? 9999 : Math.max(3.5, s.say.split(/\s+/).length * 0.42 + 1.2));
/** Narration language: knowledge points and code are written in English; framing text follows the UI language. */
const voiceLang = (s: Scene, lang: Lang): Lang => (s.kind === "point" || s.kind === "pitfalls" || s.kind === "quiz" ? "en" : s.kind === "concept" ? s.sayLang : lang);

function Words({ text, speed }: { text: string; speed: number }) {
  let i = 0;
  return (
    <p className="scene-text">
      {words(text).map((w, k) => (/\s+/.test(w) ? w : <span key={k} className="word" style={{ animationDelay: `${(i++ * 0.07) / speed}s` }}>{w}</span>))}
    </p>
  );
}

function SceneView({ scene, lang, t, progress, speed, onAnswer, answered }: { scene: Scene; lang: Lang; t: (k: string) => string; progress: number; speed: number; onAnswer: (i: number) => void; answered: number | null }) {
  switch (scene.kind) {
    case "title":
      return (
        <div className="scene">
          <div className="scene-kicker">{scene.subtitle}</div>
          <div className="scene-title">{scene.title}</div>
          <LessonVisual kind="bullets" />
        </div>
      );
    case "concept":
      return (
        <div className="scene">
          <LessonVisual kind={scene.visual} />
          <Words text={scene.text} speed={speed} />
        </div>
      );
    case "point":
      return (
        <div className="scene">
          <div className="scene-kicker">{t("academy.keyIdea")} {scene.index} / {scene.total}</div>
          <LessonVisual kind={scene.visual} step={scene.index} />
          <Words text={scene.text} speed={speed} />
        </div>
      );
    case "code": {
      const shown = scene.code.slice(0, Math.max(1, Math.floor(scene.code.length * Math.min(1, progress * 1.25))));
      return (
        <div className="scene">
          <div className="scene-kicker">{scene.lang}</div>
          <pre className="scene-code">{shown}{progress < 0.8 && <span className="caret" />}</pre>
        </div>
      );
    }
    case "pitfalls":
      return (
        <div className="scene">
          <div className="scene-kicker">⚠ {t("academy.pitfalls")}</div>
          {scene.items.map((p, i) => <p key={i} className="scene-text" style={{ animation: `scene-in .5s ${i * 0.35}s both` }}>✗ {p}</p>)}
        </div>
      );
    case "quiz":
      return (
        <div className="scene">
          <div className="scene-kicker">✎ {t("academy.check")}</div>
          <p className="scene-text"><strong>{scene.q.q}</strong></p>
          <div className="quiz-scene">
            {scene.q.options.map((o, i) => (
              <button key={i} disabled={answered !== null} className={answered === null ? "" : i === scene.q.answer ? "correct" : i === answered ? "wrong" : ""} onClick={() => onAnswer(i)}>
                {String.fromCharCode(65 + i)}. {o}
              </button>
            ))}
          </div>
          {answered !== null && <p className="scene-text" style={{ fontSize: 15 }}>{answered === scene.q.answer ? "✅" : "❌"} {scene.q.why}</p>}
        </div>
      );
    case "try":
      return (
        <div className="scene">
          <div className="scene-kicker">▶ {t("academy.tryIt")}</div>
          <button className="btn btn-primary" style={{ fontSize: 16, height: 44 }} onClick={() => void runFunction(scene.fn)}>{scene.label}</button>
          <p className="scene-text" style={{ fontSize: 14, opacity: 0.8 }}>{t("academy.tryHint")}</p>
        </div>
      );
    case "outro":
      return (
        <div className="scene">
          <div style={{ fontSize: 54 }}>🎉</div>
          <div className="scene-title" style={{ fontSize: "clamp(20px, 3.4vw, 36px)" }}>{scene.title}</div>
          {scene.next && <p className="scene-text">{t("academy.upNext")}: <strong>{scene.next}</strong></p>}
        </div>
      );
  }
}

export function Player({ lesson, lang, t, onComplete, onNext, autoplay = false }: { lesson: Lesson; lang: Lang; t: (k: string, v?: Record<string, string | number>) => string; onComplete: (score: { correct: number; total: number }) => void; onNext?: () => void; autoplay?: boolean }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(() => load("mfc.academy.speed", 1));
  const [voice, setVoice] = useState(() => load("mfc.academy.voice", canSpeak()));
  const [captions, setCaptions] = useState(() => load("mfc.academy.captions", true));
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const box = useRef<HTMLDivElement>(null);
  const spoken = useRef(-1);
  const speechDone = useRef(true);
  const scene = lesson.scenes[i];
  const total = lesson.scenes.length;

  const go = useCallback(
    (n: number) => {
      stopSpeaking();
      spoken.current = -1;
      speechDone.current = true;
      setProgress(0);
      if (n >= total) {
        setPlaying(false);
        const quizzes = lesson.scenes.map((s, k) => [s, k] as const).filter(([s]) => s.kind === "quiz");
        onComplete({ correct: quizzes.filter(([s, k]) => s.kind === "quiz" && answers[k] === s.q.answer).length, total: quizzes.length });
        return;
      }
      setI(Math.max(0, n));
    },
    [total, lesson, answers, onComplete],
  );

  // Reset when the lesson changes.
  useEffect(() => {
    setI(0);
    setAnswers({});
    setProgress(0);
    setPlaying(autoplay);
    stopSpeaking();
  }, [lesson.id, autoplay]);
  useEffect(() => () => void stopSpeaking(), []);

  // Narrate each scene once.
  useEffect(() => {
    if (!playing || !voice || spoken.current === i) return;
    spoken.current = i;
    speechDone.current = false;
    void speak(scene.say, voiceLang(scene, lang), { rate: Math.min(1.6, speed) }).then(() => (speechDone.current = true));
  }, [i, playing, voice, scene, lang, speed]);

  // Scene clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const dur = baseSeconds(scene) / speed;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setProgress((p) => {
        const next = Math.min(1, p + dt / dur);
        const waitingForQuiz = scene.kind === "quiz" && answers[i] === undefined;
        if (next >= 1 && !waitingForQuiz && (!voice || speechDone.current)) {
          setTimeout(() => go(i + 1), 0);
          return 1;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, i, scene, speed, voice, go, answers]);

  const answer = (k: number) => {
    if (scene.kind !== "quiz" || answers[i] !== undefined) return;
    setAnswers({ ...answers, [i]: k });
    recordAnswer(lesson.entryId ?? lesson.id, k === scene.q.answer);
    // Give time to read the explanation, then continue.
    setProgress(0);
    if (playing) setTimeout(() => go(i + 1), 4500 / speed);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "k") (e.preventDefault(), setPlaying(!playing));
    else if (e.key === "ArrowRight") go(i + 1);
    else if (e.key === "ArrowLeft") go(i - 1);
    else if (e.key === "f") void (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen());
    else if (e.key === "c") setCaptions(!captions);
    else if (e.key === "m") setVoice(!voice);
  };

  return (
    <div ref={box} className="player" tabIndex={0} onKeyDown={onKey} aria-label={`${lesson.title} — ${t("academy.player")}`} role="region">
      <div className="player-stage" onClick={(e) => e.target === e.currentTarget && setPlaying(!playing)}>
        <SceneView key={`${lesson.id}-${i}`} scene={scene} lang={lang} t={t} progress={progress} speed={speed} onAnswer={answer} answered={answers[i] ?? null} />
      </div>
      {captions && playing && (scene.kind === "title" || scene.kind === "code" || scene.kind === "try" || scene.kind === "outro") && <div className="player-captions" aria-live="polite">{scene.say}</div>}
      <div className="player-bar">
        <button className="icon-btn" aria-label={t("academy.prev")} onClick={() => go(i - 1)} disabled={i === 0}><I.IconChevronRight size={16} style={{ transform: "rotate(180deg)" }} /></button>
        <button className="icon-btn" aria-label={playing ? t("academy.pause") : t("academy.play")} onClick={() => setPlaying(!playing)}>{playing ? <I.IconPause size={18} /> : <I.IconPlay size={18} />}</button>
        <button className="icon-btn" aria-label={t("academy.next")} onClick={() => (i === total - 1 && onNext ? onNext() : go(i + 1))}><I.IconChevronRight size={16} /></button>
        <div className="player-progress" role="slider" aria-label={t("academy.progress")} aria-valuemin={1} aria-valuemax={total} aria-valuenow={i + 1}>
          {lesson.scenes.map((_, k) => (
            <span key={k} className={k < i ? "done" : k === i ? "active" : ""} onClick={() => go(k)} title={`${k + 1}/${total}`}>
              {k === i && <i style={{ width: `${progress * 100}%` }} />}
            </span>
          ))}
        </div>
        <span className="small" style={{ opacity: 0.8, minWidth: 40, textAlign: "right" }}>{i + 1}/{total}</span>
        <select className="player-select" value={speed} onChange={(e) => (setSpeed(Number(e.target.value)), save("mfc.academy.speed", Number(e.target.value)))} aria-label={t("academy.speed")}>
          {[0.75, 1, 1.25, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        {canSpeak() && <button className={`icon-btn ${voice ? "active" : ""}`} aria-pressed={voice} aria-label={t("academy.narration")} title={t("academy.narration")} onClick={() => (setVoice(!voice), save("mfc.academy.voice", !voice), stopSpeaking())}><I.IconVolume size={16} /></button>}
        <button className={`icon-btn ${captions ? "active" : ""}`} aria-pressed={captions} aria-label={t("academy.captions")} title={t("academy.captions")} onClick={() => (setCaptions(!captions), save("mfc.academy.captions", !captions))}><span style={{ fontSize: 11, fontWeight: 700 }}>CC</span></button>
        <button className="icon-btn" aria-label={t("academy.fullscreen")} onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen())}><I.IconMaximize size={15} /></button>
      </div>
    </div>
  );
}
