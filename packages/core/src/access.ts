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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: PERMISSIONS.filter((p) => p !== "workspace.manage"),
  editor: ["projects.write", "projects.read", "secrets.read_meta", "secrets.write", "secrets.reveal", "ai.use", "data.query", "http.send", "workflows.manage"],
  viewer: ["projects.read", "secrets.read_meta", "ai.use"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export function roleRank(role: Role): number {
  return ROLES.length - ROLES.indexOf(role);
}
