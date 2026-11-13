import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ENVIRONMENTS, isValidEnvKey, parseDotenv, scanForLeaks, serializeDotenv } from "@mfc/core";
import { parse, requirePerm, notFound, badRequest } from "../lib/http.js";
import { audit } from "../lib/audit.js";
import { addVersion, createSecret, getSecretMeta, listSecrets, readValue, resolveForDeploy } from "../lib/secretsStore.js";

const MAX_VALUE = 64 * 1024;
const Env = z.enum(ENVIRONMENTS);
const Name = z.string().trim().min(1).max(128).refine(isValidEnvKey, "must look like an environment variable name (A-Z, 0-9, _)");
const ProjectId = z.string().uuid().nullable().optional();
const Value = z.string().min(1).max(MAX_VALUE);
const ExpiresAt = z.string().datetime({ offset: true }).nullable().optional();
const RotationDays = z.number().int().min(1).max(3650).nullable().optional();

const CreateBody = z.object({ name: Name, value: Value, environment: Env, projectId: ProjectId, description: z.string().max(500).optional(), expiresAt: ExpiresAt, rotationDays: RotationDays });
const PatchBody = z.object({ description: z.string().max(500).optional(), expiresAt: ExpiresAt, rotationDays: RotationDays });
const ImportBody = z.object({ environment: Env, projectId: ProjectId, content: z.string().max(512 * 1024), overwrite: z.boolean().default(false) });
const ExportBody = z.object({ environment: Env, projectId: ProjectId });
const ScanBody = z.object({ text: z.string().max(2 * 1024 * 1024) });

export const secretRoutes: FastifyPluginAsync = async (app) => {
  const { db, ring } = app.deps;

  const assertProject = async (workspaceId: string, projectId?: string | null) => {
    if (!projectId) return;
    const p = await db.one(`SELECT 1 FROM projects WHERE id = $1 AND workspace_id = $2`, [projectId, workspaceId]);
    if (!p) throw badRequest("Unknown project");
  };
  const loadOwned = async (workspaceId: string, id: string) => {
    const s = await getSecretMeta(db, workspaceId, id);
    if (!s) throw notFound("Secret not found");
    return s;
  };

  app.get("/", async (req) => {
    const a = requirePerm(req, "secrets.read_meta");
    const q = req.query as { projectId?: string; environment?: string; alerts?: string };
    const environment = q.environment ? parse(Env, q.environment) : undefined;
    const secrets = await listSecrets(db, a.workspaceId, { projectId: q.projectId === undefined ? undefined : q.projectId === "workspace" ? null : q.projectId, environment, onlyAlerts: q.alerts === "1" });
    return { secrets };
  });

  app.post("/", async (req) => {
    const a = requirePerm(req, "secrets.write");
    const body = parse(CreateBody, req.body);
    await assertProject(a.workspaceId, body.projectId);
    const dup = await db.one(
      `SELECT 1 FROM secrets WHERE workspace_id = $1 AND coalesce(project_id::text,'') = coalesce($2::text,'') AND environment = $3 AND name = $4`,
      [a.workspaceId, body.projectId ?? null, body.environment, body.name],
    );
    if (dup) throw badRequest(`${body.name} already exists in ${body.environment}. Rotate it to store a new value.`);
    const id = await db.tx((t) => createSecret(t, ring, { ...body, projectId: body.projectId ?? null, workspaceId: a.workspaceId, userId: req.user!.id }));
    await audit(db, req, "secret.create", { targetType: "secret", targetId: id, meta: { name: body.name, environment: body.environment, projectId: body.projectId ?? null } });
    return { secret: await getSecretMeta(db, a.workspaceId, id) };
  });

  app.patch("/:id", async (req) => {
    const a = requirePerm(req, "secrets.write");
    const { id } = req.params as { id: string };
    const s = await loadOwned(a.workspaceId, id);
    const body = parse(PatchBody, req.body);
    await db.query(
      `UPDATE secrets SET description = coalesce($2, description),
        expires_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE expires_at END,
        rotation_days = CASE WHEN $5::boolean THEN $6::int ELSE rotation_days END,
        updated_at = now() WHERE id = $1`,
      [id, body.description ?? null, body.expiresAt !== undefined, body.expiresAt ?? null, body.rotationDays !== undefined, body.rotationDays ?? null],
    );
    await audit(db, req, "secret.update", { targetType: "secret", targetId: id, meta: { name: s.name } });
    return { secret: await getSecretMeta(db, a.workspaceId, id) };
  });

  app.put("/:id/value", async (req) => {
    const a = requirePerm(req, "secrets.write");
    const { id } = req.params as { id: string };
    const s = await loadOwned(a.workspaceId, id);
    const { value } = parse(z.object({ value: Value }), req.body);
    const version = await db.tx((t) => addVersion(t, ring, id, value, req.user!.id));
    await audit(db, req, "secret.rotate", { targetType: "secret", targetId: id, meta: { name: s.name, version } });
    return { secret: await getSecretMeta(db, a.workspaceId, id) };
  });

  app.post("/:id/reveal", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "secrets.reveal");
    const { id } = req.params as { id: string };
    const { version } = parse(z.object({ version: z.number().int().positive().optional() }), req.body ?? {});
    const s = await loadOwned(a.workspaceId, id);
    const value = await readValue(db, ring, id, version);
    await audit(db, req, "secret.reveal", { targetType: "secret", targetId: id, meta: { name: s.name, environment: s.environment, version: version ?? s.current_version } });
    return { value, version: version ?? s.current_version };
  });

  app.get("/:id/versions", async (req) => {
    const a = requirePerm(req, "secrets.read_meta");
    const { id } = req.params as { id: string };
    await loadOwned(a.workspaceId, id);
    const versions = await db.query(
      `SELECT v.version, v.key_id, v.created_at, u.email AS created_by FROM secret_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.secret_id = $1 ORDER BY v.version DESC`,
      [id],
    );
    return { versions };
  });

  app.post("/:id/rollback", async (req) => {
    const a = requirePerm(req, "secrets.write");
    const { id } = req.params as { id: string };
    const { version } = parse(z.object({ version: z.number().int().positive() }), req.body);
    const s = await loadOwned(a.workspaceId, id);
    if (version >= s.current_version) throw badRequest("Pick an older version to roll back to");
    const newVersion = await db.tx(async (t) => addVersion(t, ring, id, await readValue(t, ring, id, version), req.user!.id));
    await audit(db, req, "secret.rollback", { targetType: "secret", targetId: id, meta: { name: s.name, to: version, newVersion } });
    return { secret: await getSecretMeta(db, a.workspaceId, id) };
  });

  app.delete("/:id", async (req) => {
    const a = requirePerm(req, "secrets.write");
    const { id } = req.params as { id: string };
    const s = await loadOwned(a.workspaceId, id);
    await db.query(`DELETE FROM secrets WHERE id = $1`, [id]);
    await audit(db, req, "secret.delete", { targetType: "secret", targetId: id, meta: { name: s.name, environment: s.environment } });
    return { ok: true };
  });

  app.post("/import", async (req) => {
    const a = requirePerm(req, "secrets.write");
    const body = parse(ImportBody, req.body);
    await assertProject(a.workspaceId, body.projectId);
    const { entries, errors } = parseDotenv(body.content);
    const tooBig = entries.filter((e) => e.value.length > MAX_VALUE).map((e) => e.key);
    const result = { created: [] as string[], rotated: [] as string[], skipped: [] as string[], errors: [...errors, ...tooBig.map((k) => `${k}: value too large`)] };
    await db.tx(async (t) => {
      for (const e of entries) {
        if (tooBig.includes(e.key)) continue;
        if (e.value === "") {
          result.skipped.push(e.key);
          continue;
        }
        const existing = await t.one<{ id: string }>(
          `SELECT id FROM secrets WHERE workspace_id = $1 AND coalesce(project_id::text,'') = coalesce($2::text,'') AND environment = $3 AND name = $4`,
          [a.workspaceId, body.projectId ?? null, body.environment, e.key],
        );
        if (existing) {
          if (!body.overwrite) {
            result.skipped.push(e.key);
            continue;
          }
          if ((await readValue(t, ring, existing.id)) === e.value) {
            result.skipped.push(e.key);
            continue;
          }
          await addVersion(t, ring, existing.id, e.value, req.user!.id);
          result.rotated.push(e.key);
        } else {
          await createSecret(t, ring, { workspaceId: a.workspaceId, projectId: body.projectId ?? null, environment: body.environment, name: e.key, value: e.value, userId: req.user!.id });
          result.created.push(e.key);
        }
      }
    });
    await audit(db, req, "secret.import", { meta: { environment: body.environment, projectId: body.projectId ?? null, created: result.created, rotated: result.rotated } });
    return result;
  });

  app.post("/export", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const a = requirePerm(req, "secrets.export");
    const body = parse(ExportBody, req.body);
    const resolved = await resolveForDeploy(db, ring, a.workspaceId, body.projectId ?? null, body.environment, true);
    await audit(db, req, "secret.export", { meta: { environment: body.environment, projectId: body.projectId ?? null, names: resolved.map((r) => r.name) } });
    return {
      filename: `.env.${body.environment}`,
      content: serializeDotenv(
        resolved.map((r) => ({ key: r.name, value: r.value! })),
        `Exported from Multi-functional Creator (${body.environment}) at ${new Date().toISOString()}\nContains secrets. Do not commit this file.`,
      ),
    };
  });

  /** What would be injected at deploy time — names and sources only, never values. */
  app.get("/resolve", async (req) => {
    const a = requirePerm(req, "secrets.read_meta");
    const q = req.query as { projectId?: string; environment?: string };
    const environment = parse(Env, q.environment);
    const vars = await resolveForDeploy(db, ring, a.workspaceId, q.projectId || null, environment, false);
    return { variables: vars.map(({ name, source, id }) => ({ name, source, id })) };
  });

  app.post("/scan", async (req) => {
    requirePerm(req, "projects.read");
    const { text } = parse(ScanBody, req.body);
    return { findings: scanForLeaks(text) };
  });
};
