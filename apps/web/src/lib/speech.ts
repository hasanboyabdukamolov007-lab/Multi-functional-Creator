/** Voice in / voice out with the browser's built-in speech engines (no server, no AI model). */
import type { Locale } from "./i18n";

const LANG: Record<Locale, string> = { en: "en-US", uz: "uz-UZ", ru: "ru-RU" };

type Rec = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const Ctor = (): (new () => Rec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canListen = () => typeof window !== "undefined" && !!Ctor();
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Start dictation; calls onText with the running transcript. Returns a stop function. */
export function listen(locale: Locale, onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void): () => void {
  const C = Ctor();
  if (!C) {
    onEnd("unsupported");
    return () => undefined;
  }
  const r = new C();
  r.lang = LANG[locale];
  r.interimResults = true;
  r.continuous = false;
  r.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      final = e.results[i].isFinal;
    }
    onText(text, final);
  };
  r.onerror = (e) => onEnd(e.error);
  r.onend = () => onEnd();
  r.start();
  return () => r.stop();
}

/** Speak text in the chosen language; resolves when finished (or immediately when unsupported). */
export function speak(text: string, locale: Locale, opts: { rate?: number; pitch?: number } = {}): Promise<void> {
  if (!canSpeak() || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text.replace(/[`*_#>]/g, "").slice(0, 2000));
    u.lang = LANG[locale];
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(locale));
    if (voice) u.voice = voice;
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
export const stopSpeaking = () => canSpeak() && speechSynthesis.cancel();
