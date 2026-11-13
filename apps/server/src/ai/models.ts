import type { BetaFallbacksParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export interface ModelInfo {
  id: string;
  label: string;
  description: string;
  efforts: readonly string[];
  /** Server-side refusal fallback setting for this model, if supported. */
  fallbacks?: BetaFallbacksParam;
}

const ALL_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", description: "Default. Expert-level reasoning, coding and design.", efforts: ALL_EFFORTS, fallbacks: "default" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2", description: "Most capable — for the hardest, longest tasks. Slower and pricier.", efforts: ALL_EFFORTS, fallbacks: "default" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", description: "Fast and capable for everyday building.", efforts: ALL_EFFORTS, fallbacks: "default" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", description: "Fastest and cheapest, for quick edits.", efforts: ALL_EFFORTS },
];

export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_EFFORT = "high";

export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}
