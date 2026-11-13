/** Minimal, predictable .env parser/serializer (dotenv-compatible for the common cases). */

export interface EnvEntry {
  key: string;
  value: string;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function parseDotenv(input: string): { entries: EnvEntry[]; errors: string[] } {
  const entries: EnvEntry[] = [];
  const errors: string[] = [];
  const lines = input.replace(/\r\n?/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) {
      errors.push(`Line ${i + 1}: expected KEY=value`);
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (!KEY_RE.test(key)) {
      errors.push(`Line ${i + 1}: invalid key "${key}"`);
      continue;
    }
    let rest = line.slice(eq + 1).trim();
    let value: string;
    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      // Allow multi-line quoted values.
      let buf = rest.slice(1);
      let closeIdx = findClosing(buf, quote);
      while (closeIdx === -1 && i + 1 < lines.length) {
        i++;
        buf += "\n" + lines[i];
        closeIdx = findClosing(buf, quote);
      }
      if (closeIdx === -1) {
        errors.push(`Line ${i + 1}: unterminated quoted value for ${key}`);
        continue;
      }
      value = buf.slice(0, closeIdx);
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      }
    } else {
      const hash = rest.search(/\s#/);
      if (hash !== -1) rest = rest.slice(0, hash);
      value = rest.trim();
    }
    const existing = entries.findIndex((e) => e.key === key);
    if (existing !== -1) entries.splice(existing, 1);
    entries.push({ key, value });
  }
  return { entries, errors };
}

function findClosing(s: string, quote: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && quote === '"') {
      i++;
      continue;
    }
    if (s[i] === quote) return i;
  }
  return -1;
}

export function serializeDotenv(entries: EnvEntry[], header?: string): string {
  const out: string[] = [];
  if (header) out.push(...header.split("\n").map((l) => `# ${l}`), "");
  for (const { key, value } of entries) {
    const needsQuotes = value === "" || /[\s#"'\\]/.test(value) || value.includes("\n");
    const v = needsQuotes ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"` : value;
    out.push(`${key}=${v}`);
  }
  return out.join("\n") + "\n";
}

export function isValidEnvKey(key: string): boolean {
  return KEY_RE.test(key);
}
