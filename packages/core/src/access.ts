export const ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ENVIRONMENTS = ["development", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const PERMISSIONS = [
  "workspace.manage",
  "members.manage",
  "projects.write",
  "projects.read",
  "secrets.read_meta",
  "secrets.write",
  "secrets.reveal",
  "secrets.export",
  "audit.read",
  "ai.use",
  "ai.configure",
  /** Add or remove database connections (the server will connect to those hosts). */
  "data.connect",
  /** Run queries through saved connections. */
  "data.query",
  /** Send requests through the API tester proxy. */
  "http.send",
  /** Create, edit and run workflows. */
  "workflows.manage",
  /** Add or change deploy targets (they hold provider tokens). */
  "deploy.targets",
  /** Deploy projects to configured targets, redeploy and roll back. */
  "deploy.run",
  /** Uptime monitors, analytics sites and the status page. */
  "monitoring.manage",
  /** Notification channels (email, Telegram, Slack, Discord, webhooks). */
  "notifications.manage",
  /** Comment and mention on projects. */
  "comments.write",
  /** Install, enable and remove plugins; publish to the marketplace. */
  "plugins.manage",
  /** Plans, payment methods and invoices. */
  "billing.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: PERMISSIONS.filter((p) => p !== "workspace.manage" && p !== "billing.manage"),
  editor: ["projects.write", "projects.read", "secrets.read_meta", "secrets.write", "secrets.reveal", "ai.use", "data.query", "http.send", "workflows.manage", "deploy.run", "monitoring.manage", "comments.write"],
  viewer: ["projects.read", "secrets.read_meta", "ai.use", "comments.write"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export function roleRank(role: Role): number {
  return ROLES.length - ROLES.indexOf(role);
}
