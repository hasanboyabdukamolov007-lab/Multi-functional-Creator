import { registry, type AppFunction } from "../../lib/registry";
import { useUi } from "../../lib/ui";
import { useCopilot, EFFORTS } from "./agent";
import { STARTERS } from "./starters";

const MODEL_IDS: Array<[string, string]> = [
  ["claude-opus-5-5", "Claude Opus 5.5 (default)"],
  ["claude-fable-5-2", "Claude Fable 5.2 (most capable)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (fast)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (fastest)"],
];

export function registerCopilotFunctions() {
  const open = () => useUi.getState().setCopilot(true);
  const fns: AppFunction[] = [
    { id: "copilot.open", title: "Ask Forge (open copilot)", category: "Copilot", keywords: ["ai", "assistant", "chat", "claude"], ai: false, run: open },
    { id: "copilot.new-chat", title: "New copilot chat", category: "Copilot", ai: false, run: () => (useCopilot.getState().reset(), open()) },
    { id: "copilot.stop", title: "Stop the copilot", category: "Copilot", ai: false, when: () => (useCopilot.getState().running ? true : "Not running"), run: () => useCopilot.getState().stop() },
  ];
  for (const e of EFFORTS) fns.push({ id: `copilot.effort.${e}`, title: `Copilot effort: ${e}`, category: "Copilot", ai: false, run: () => useCopilot.getState().setEffort(e) });
  for (const [id, label] of MODEL_IDS) fns.push({ id: `copilot.model.${id}`, title: `Copilot model: ${label}`, category: "Copilot", ai: false, run: () => useCopilot.getState().setModel(id) });
  for (const s of STARTERS)
    fns.push({
      id: `copilot.ask.${s.id}`,
      title: `Ask Forge: ${s.title}`,
      category: "Copilot",
      keywords: ["ai", "generate"],
      ai: false,
      run: () => {
        open();
        void useCopilot.getState().send(s.prompt);
      },
    });
  registry.register(fns);
}
