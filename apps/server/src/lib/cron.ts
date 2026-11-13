/** Minimal 5-field cron (minute hour day-of-month month day-of-week), evaluated in UTC. */
const RANGES: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
const MACROS: Record<string, string> = { "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *" };

export interface Cron {
  fields: Array<Set<number>>;
  domStar: boolean;
  dowStar: boolean;
}

export function parseCron(expr: string): Cron {
  const src = MACROS[expr.trim()] ?? expr.trim();
  const parts = src.split(/\s+/);
  if (parts.length !== 5) throw new Error("A schedule needs 5 fields: minute hour day month weekday (e.g. */15 * * * *)");
  const fields = parts.map((p, i) => {
    const [lo, hi] = RANGES[i];
    const set = new Set<number>();
    for (const item of p.split(",")) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
      if (!m) throw new Error(`Invalid cron field "${item}"`);
      const step = m[4] ? Number(m[4]) : 1;
      const start = m[1] === "*" ? lo : Number(m[2]);
      const end = m[1] === "*" ? hi : m[3] !== undefined ? Number(m[3]) : m[4] ? hi : start;
      if (step < 1 || start < lo || end > hi + (i === 4 ? 1 : 0) || start > end) throw new Error(`Cron field "${item}" is out of range ${lo}-${hi}`);
      for (let v = start; v <= end; v += step) set.add(i === 4 && v === 7 ? 0 : v);
    }
    return set;
  });
  return { fields, domStar: parts[2] === "*", dowStar: parts[4] === "*" };
}

export function cronMatches(c: Cron, d: Date): boolean {
  const [min, hour, dom, mon, dow] = c.fields;
  if (!min.has(d.getUTCMinutes()) || !hour.has(d.getUTCHours()) || !mon.has(d.getUTCMonth() + 1)) return false;
  const domOk = dom.has(d.getUTCDate());
  const dowOk = dow.has(d.getUTCDay());
  // Standard cron: when both day fields are restricted, either may match.
  if (!c.domStar && !c.dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

/** Most recent matching minute at or before `now` (within the look-back window), or null. */
export function lastOccurrence(expr: string, now: Date, lookbackMinutes = 24 * 60): Date | null {
  const c = parseCron(expr);
  const t = new Date(now);
  t.setUTCSeconds(0, 0);
  for (let i = 0; i <= lookbackMinutes; i++) {
    if (cronMatches(c, t)) return new Date(t);
    t.setUTCMinutes(t.getUTCMinutes() - 1);
  }
  return null;
}

export function nextOccurrence(expr: string, from: Date, horizonMinutes = 366 * 24 * 60): Date | null {
  const c = parseCron(expr);
  const t = new Date(from);
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  for (let i = 0; i < horizonMinutes; i++) {
    if (cronMatches(c, t)) return new Date(t);
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return null;
}
