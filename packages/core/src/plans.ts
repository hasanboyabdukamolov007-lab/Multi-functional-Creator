/**
 * SaaS plans. Limits only apply when billing is enabled on the server (STRIPE_SECRET_KEY set);
 * a self-hosted install without billing is unlimited.
 */
export const PLAN_IDS = ["free", "pro", "team"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const LIMIT_KEYS = ["projects", "members", "storageMb", "monitors", "deployTargets", "plugins"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
/** null = unlimited */
export type Limits = Record<LimitKey, number | null>;

export interface Plan {
  id: PlanId;
  /** Display name (not translated: product names). */
  name: string;
  limits: Limits;
  /** Feature flags shown on the plan card. */
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    limits: { projects: 3, members: 2, storageMb: 250, monitors: 2, deployTargets: 1, plugins: 2 },
    features: ["forge", "vault", "builder", "studio", "export"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    limits: { projects: 50, members: 10, storageMb: 10_240, monitors: 25, deployTargets: 10, plugins: 25 },
    features: ["forge", "vault", "builder", "studio", "export", "deploy", "monitoring", "collab", "ai"],
  },
  team: {
    id: "team",
    name: "Team",
    limits: { projects: null, members: 50, storageMb: 102_400, monitors: 200, deployTargets: 50, plugins: null },
    features: ["forge", "vault", "builder", "studio", "export", "deploy", "monitoring", "collab", "ai", "sso", "priority"],
  },
};

export const UNLIMITED: Limits = { projects: null, members: null, storageMb: null, monitors: null, deployTargets: null, plugins: null };

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

/** Limits that apply to a workspace: unlimited when billing is off. Unknown plans fall back to Free. */
export function limitsFor(plan: string | null | undefined, billingEnabled: boolean): Limits {
  if (!billingEnabled) return UNLIMITED;
  return PLANS[isPlanId(plan) ? plan : "free"].limits;
}

/** True when adding `adding` more of something would stay within the limit. */
export function withinLimit(limit: number | null, used: number, adding = 1): boolean {
  return limit === null || used + adding <= limit;
}
