/**
 * The brain's long-term memory: classifier weights, learned aliases, metrics, experiment results,
 * style learned from projects and learner mastery. Saved on the device and synced to the workspace,
 * so the whole team's Forge keeps getting better.
 */
import { create } from "zustand";
import { api } from "../../../lib/api";
import { useSession } from "../../../lib/session";
import { emptyNB, prune, type NBState } from "./classifier";
import type { Aliases } from "./knowledge";

export interface Metric {
  at: string;
  fnAcc: number;
  kbAcc: number;
  tests: number;
  learned: number;
}
export interface Example {
  text: string;
  label: string;
  source: "user" | "confirm" | "self" | "import";
  at: string;
}
export interface BrainData {
  v: 1;
  updatedAt: string;
  nb: NBState;
  seedKey: string;
  aliases: Aliases;
  examples: Example[];
  feedback: { up: number; down: number };
  metrics: Metric[];
  totals: { fnTests: number; kbTests: number; learnedFromTests: number; experiments: number; projectsLearned: number; answers: number; fixes: number; lessons: number; quizzes: number };
  arms: Record<string, { a: number; b: number; best?: string; bestScore?: number }>;
  bestPalettes: Array<{ primary: string; dark: boolean; score: number }>;
  style: { components: Record<string, number>; primaries: Record<string, number>; radius: Record<string, number>; fonts: Record<string, number>; sections: Record<string, number>; seen: Record<string, string>; at: string | null };
  mastery: Record<string, { seen: number; correct: number; at: string }>;
  gaps: Array<{ text: string; at: string }>;
  paused: boolean;
}

export const emptyBrain = (): BrainData => ({
  v: 1,
  updatedAt: new Date(0).toISOString(),
  nb: emptyNB(),
  seedKey: "",
  aliases: {},
  examples: [],
  feedback: { up: 0, down: 0 },
  metrics: [],
  totals: { fnTests: 0, kbTests: 0, learnedFromTests: 0, experiments: 0, projectsLearned: 0, answers: 0, fixes: 0, lessons: 0, quizzes: 0 },
  arms: {},
  bestPalettes: [],
  style: { components: {}, primaries: {}, radius: {}, fonts: {}, sections: {}, seen: {}, at: null },
  mastery: {},
  gaps: [],
  paused: false,
});

const keyFor = (ws: string | null) => `mfc.brain.${ws ?? "local"}`;

function read(ws: string | null): BrainData {
  try {
    const raw = localStorage.getItem(keyFor(ws));
    if (!raw) return emptyBrain();
    const d = JSON.parse(raw) as BrainData;
    return d.v === 1 ? { ...emptyBrain(), ...d, totals: { ...emptyBrain().totals, ...d.totals } } : emptyBrain();
  } catch {
    return emptyBrain();
  }
}

interface BrainStore {
  data: BrainData;
  ws: string | null;
  rev: number;
  load: (ws: string | null) => Promise<void>;
  mutate: (fn: (d: BrainData) => void) => void;
  reset: () => void;
  exportJson: () => string;
  importJson: (json: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function persist(d: BrainData, ws: string | null) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(keyFor(ws), JSON.stringify(d));
    } catch {
      // Quota: shrink the model and try once more.
      prune(d.nb, 250);
      d.examples = d.examples.slice(-200);
      try {
        localStorage.setItem(keyFor(ws), JSON.stringify(d));
      } catch {
        /* keep in memory */
      }
    }
  }, 800);
  if (!ws) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void api.put(`/api/w/${ws}/forge/brain`, { data: d }).catch(() => undefined);
  }, 20_000);
}

export const useBrain = create<BrainStore>((set, get) => ({
  data: emptyBrain(),
  ws: null,
  rev: 0,
  load: async (ws) => {
    const local = read(ws);
    set({ data: local, ws, rev: get().rev + 1 });
    if (!ws) return;
    try {
      const r = await api.get<{ data: BrainData | null }>(`/api/w/${ws}/forge/brain`);
      // Team memory wins when it's newer than this device's copy.
      if (r.data && r.data.v === 1 && r.data.updatedAt > local.updatedAt && useSession.getState().workspaceId === ws) {
        const merged = { ...emptyBrain(), ...r.data, totals: { ...emptyBrain().totals, ...r.data.totals }, paused: local.paused };
        set({ data: merged, rev: get().rev + 1 });
        persist(merged, ws);
      }
    } catch {
      /* offline: keep the local copy */
    }
  },
  mutate: (fn) => {
    const d = get().data;
    fn(d);
    d.updatedAt = new Date().toISOString();
    d.examples = d.examples.slice(-500);
    d.metrics = d.metrics.slice(-240);
    d.gaps = d.gaps.slice(-100);
    set({ data: d, rev: get().rev + 1 });
    persist(d, get().ws);
  },
  reset: () => {
    const d = emptyBrain();
    set({ data: d, rev: get().rev + 1 });
    persist(d, get().ws);
  },
  exportJson: () => JSON.stringify(get().data),
  importJson: (json) => {
    const d = JSON.parse(json) as BrainData;
    if (d.v !== 1 || !d.nb) throw new Error("Not a Forge brain file");
    const merged = { ...emptyBrain(), ...d, totals: { ...emptyBrain().totals, ...d.totals }, updatedAt: new Date().toISOString() };
    set({ data: merged, rev: get().rev + 1 });
    persist(merged, get().ws);
  },
}));

export const brain = () => useBrain.getState().data;
