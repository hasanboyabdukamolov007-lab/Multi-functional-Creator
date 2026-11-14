/**
 * Uptime checks with incident tracking. Driven by the same scheduler as workflows (a long-running
 * server's interval, or /api/cron/tick on serverless hosts). Two consecutive failures open an incident,
 * the first success closes it; both notify the workspace's channels.
 */
import crypto from "node:crypto";
import type { NotifyDeps } from "./notify.js";
import { notify } from "./notify.js";
import { guardedFetch } from "./netGuard.js";

interface MonitorRow {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  method: string;
  interval_s: number;
  timeout_ms: number;
  expect_status: number | null;
  keyword: string | null;
  state: string;
  fail_streak: number;
}

export async function checkOnce(deps: NotifyDeps, m: MonitorRow): Promise<{ ok: boolean; status: number | null; ms: number; error: string | null }> {
  const started = Date.now();
  try {
    const r = await guardedFetch(m.url, { method: m.method || "GET", headers: { "user-agent": "MFC-Uptime/1.0 (+status checks)" } }, { allowPrivate: deps.config.allowPrivateNetwork, timeoutMs: Math.min(30_000, Math.max(2000, m.timeout_ms)), maxBytes: 512 * 1024 });
    const statusOk = m.expect_status ? r.status === m.expect_status : r.status < 400;
    const keywordOk = !m.keyword || r.body.toString("utf8").includes(m.keyword);
    const error = !statusOk ? `HTTP ${r.status}` : !keywordOk ? `Keyword “${m.keyword}” not found` : null;
    return { ok: statusOk && keywordOk, status: r.status, ms: r.ms, error };
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - started, error: (e as Error).message.slice(0, 300) };
  }
}

export async function recordCheck(deps: NotifyDeps, m: MonitorRow, r: { ok: boolean; status: number | null; ms: number; error: string | null }) {
  const { db } = deps;
  await db.query(`INSERT INTO monitor_checks (monitor_id, ok, status, ms, error) VALUES ($1,$2,$3,$4,$5)`, [m.id, r.ok, r.status, r.ms, r.error]);
  const streak = r.ok ? 0 : m.fail_streak + 1;
  let state = m.state;
  if (r.ok && m.state !== "up") {
    state = "up";
    if (m.state === "down") {
      await db.query(`UPDATE incidents SET resolved_at = now() WHERE monitor_id = $1 AND resolved_at IS NULL`, [m.id]);
      await notify(deps, m.workspace_id, "monitor.up", { title: `${m.name} is back up`, text: `${m.url} answered ${r.status} in ${r.ms} ms.`, url: m.url, level: "success" });
    }
  } else if (!r.ok && streak >= 2 && m.state !== "down") {
    state = "down";
    await db.query(`INSERT INTO incidents (id, workspace_id, monitor_id, title, cause) VALUES ($1,$2,$3,$4,$5)`, [crypto.randomUUID(), m.workspace_id, m.id, `${m.name} is down`, r.error]);
    await notify(deps, m.workspace_id, "monitor.down", { title: `${m.name} is down`, text: `${m.url}: ${r.error}`, url: m.url, level: "error" });
  } else if (!r.ok && m.state === "unknown") state = "degraded";
  await db.query(`UPDATE monitors SET state = $2, fail_streak = $3, last_checked_at = now(), next_check_at = now() + make_interval(secs => interval_s) WHERE id = $1`, [m.id, state, streak]);
  return state;
}

let lastPrune = 0;
/** Run every monitor that is due (bounded per call so a tick stays short). */
export async function runDueChecks(deps: NotifyDeps, limit = 30): Promise<number> {
  const due = await deps.db.query<MonitorRow>(
    `SELECT id, workspace_id, name, url, method, interval_s, timeout_ms, expect_status, keyword, state, fail_streak FROM monitors WHERE enabled AND next_check_at <= now() ORDER BY next_check_at LIMIT $1`,
    [limit],
  );
  // Claim them first so overlapping ticks don't double-check.
  if (due.length) await deps.db.query(`UPDATE monitors SET next_check_at = now() + make_interval(secs => interval_s) WHERE id = ANY($1::uuid[])`, [due.map((d) => d.id)]);
  for (let i = 0; i < due.length; i += 6) {
    await Promise.all(due.slice(i, i + 6).map(async (m) => recordCheck(deps, m, await checkOnce(deps, m))));
  }
  if (Date.now() - lastPrune > 6 * 3600_000) {
    lastPrune = Date.now();
    await deps.db.query(`DELETE FROM monitor_checks WHERE at < now() - interval '90 days'`);
    await deps.db.query(`DELETE FROM analytics_events WHERE ts < now() - interval '400 days'`);
  }
  return due.length;
}

/** Daily uptime bars + totals for one monitor. */
export async function uptimeSummary(deps: Pick<NotifyDeps, "db">, monitorId: string, days = 30) {
  const daily = await deps.db.query<{ day: string; total: string; ok: string; avg_ms: string | null }>(
    `SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day, count(*) AS total, count(*) FILTER (WHERE ok) AS ok, avg(ms) FILTER (WHERE ok) AS avg_ms
     FROM monitor_checks WHERE monitor_id = $1 AND at >= now() - make_interval(days => $2) GROUP BY 1 ORDER BY 1`,
    [monitorId, days],
  );
  const total = daily.reduce((a, d) => a + Number(d.total), 0);
  const ok = daily.reduce((a, d) => a + Number(d.ok), 0);
  return { uptime: total ? ok / total : null, checks: total, daily: daily.map((d) => ({ day: d.day, uptime: Number(d.ok) / Number(d.total), avgMs: d.avg_ms ? Math.round(Number(d.avg_ms)) : null })) };
}
