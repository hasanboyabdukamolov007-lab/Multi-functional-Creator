export const MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [
  {
    id: 1,
    name: "initial",
    sql: `
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  locale text,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'team',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE magic_links (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX magic_links_email ON magic_links (email, created_at);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_ws ON projects (workspace_id, updated_at DESC);
CREATE TABLE secrets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('development','staging','production')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  current_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz,
  rotation_days integer,
  last_rotated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX secrets_scope_name ON secrets (workspace_id, (coalesce(project_id::text, '')), environment, name);
CREATE TABLE secret_versions (
  secret_id uuid NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
  version integer NOT NULL,
  key_id text NOT NULL,
  wrapped_dek text NOT NULL,
  ciphertext text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (secret_id, version)
);
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_ws ON audit_log (workspace_id, id DESC);
CREATE TABLE ai_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  default_model text NOT NULL DEFAULT 'claude-opus-5-5',
  default_effort text NOT NULL DEFAULT 'high',
  web_tools boolean NOT NULL DEFAULT true,
  key_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_providers (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('openai-compatible')),
  base_url text NOT NULL,
  model text NOT NULL,
  key_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 2,
    name: "ai-addons-opt-in",
    sql: `ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS claude_enabled boolean NOT NULL DEFAULT false`,
  },
];
