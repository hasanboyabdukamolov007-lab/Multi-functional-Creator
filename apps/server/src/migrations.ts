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
  {
    id: 3,
    name: "project-versions-and-session-ids",
    sql: `ALTER TABLE projects ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS id text;
UPDATE sessions SET id = substr(token_hash, 1, 16) WHERE id IS NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now()`,
  },
  {
    id: 4,
    name: "data-api-workflows",
    sql: `CREATE TABLE IF NOT EXISTS data_connections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('postgres','mysql','mongodb')),
  secret_id uuid NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saved_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  method text NOT NULL,
  url text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text NOT NULL DEFAULT '',
  environment text NOT NULL DEFAULT 'development',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  graph jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'production',
  webhook_token text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  scheduled_for timestamptz,
  status text NOT NULL,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_schedule ON workflow_runs (workflow_id, scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS workflow_runs_recent ON workflow_runs (workflow_id, started_at DESC)`,
  },
  {
    id: 5,
    name: "forge-brain",
    sql: `CREATE TABLE IF NOT EXISTS forge_brain (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 6,
    name: "deploy-monitoring-notifications",
    sql: `CREATE TABLE IF NOT EXISTS deploy_targets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  environment text NOT NULL DEFAULT 'production',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS deployments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  target_id uuid REFERENCES deploy_targets(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  status text NOT NULL,
  url text,
  provider_id text,
  files_count int NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  bundle bytea,
  log jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  redeploy_of uuid,
  created_by uuid REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS deployments_recent ON deployments (workspace_id, started_at DESC);
CREATE TABLE IF NOT EXISTS notification_channels (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL,
  events text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS monitors (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  interval_s int NOT NULL DEFAULT 300,
  timeout_ms int NOT NULL DEFAULT 10000,
  expect_status int,
  keyword text,
  public boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  state text NOT NULL DEFAULT 'unknown',
  fail_streak int NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS monitors_due ON monitors (next_check_at) WHERE enabled;
CREATE TABLE IF NOT EXISTS monitor_checks (
  id bigserial PRIMARY KEY,
  monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  status int,
  ms int,
  error text
);
CREATE INDEX IF NOT EXISTS monitor_checks_recent ON monitor_checks (monitor_id, at DESC);
CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  monitor_id uuid REFERENCES monitors(id) ON DELETE CASCADE,
  title text NOT NULL,
  cause text,
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS incidents_recent ON incidents (workspace_id, started_at DESC);
CREATE TABLE IF NOT EXISTS status_pages (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS analytics_sites (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  key text UNIQUE NOT NULL,
  domains text[] NOT NULL DEFAULT '{}',
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS analytics_events (
  id bigserial PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  name text,
  path text,
  referrer text,
  device text,
  browser text,
  country text,
  visitor text,
  value double precision,
  meta jsonb
);
CREATE INDEX IF NOT EXISTS analytics_events_site_ts ON analytics_events (site_id, ts DESC);
CREATE INDEX IF NOT EXISTS analytics_events_type ON analytics_events (site_id, type, ts DESC)`,
  },
];
