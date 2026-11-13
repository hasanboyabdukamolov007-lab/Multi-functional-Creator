/**
 * Leak scanner — finds hard-coded credentials in source text before it is exported or deployed.
 * Rules are ordered from most specific to most generic; a span matched by one rule is not
 * reported again by a later, more generic rule.
 */

export type LeakSeverity = "critical" | "high" | "medium";

export interface LeakRule {
  id: string;
  title: string;
  severity: LeakSeverity;
  pattern: RegExp;
  /** Index of the capture group that holds the secret itself (0 = whole match). */
  group?: number;
}

export interface LeakFinding {
  ruleId: string;
  title: string;
  severity: LeakSeverity;
  line: number;
  column: number;
  /** Redacted preview — never contains the full secret. */
  preview: string;
}

export const LEAK_RULES: LeakRule[] = [
  { id: "private-key", title: "Private key block", severity: "critical", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: "anthropic-key", title: "Anthropic API key", severity: "critical", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "openai-key", title: "OpenAI API key", severity: "critical", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { id: "aws-access-key", title: "AWS access key ID", severity: "critical", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g },
  { id: "github-token", title: "GitHub token", severity: "critical", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g },
  { id: "gitlab-token", title: "GitLab token", severity: "critical", pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { id: "stripe-key", title: "Stripe secret key", severity: "critical", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { id: "slack-token", title: "Slack token", severity: "high", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: "slack-webhook", title: "Slack webhook URL", severity: "high", pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/g },
  { id: "google-api-key", title: "Google API key", severity: "high", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "telegram-bot-token", title: "Telegram bot token", severity: "high", pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g },
  { id: "sendgrid-key", title: "SendGrid API key", severity: "high", pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { id: "twilio-key", title: "Twilio API key", severity: "high", pattern: /\bSK[0-9a-fA-F]{32}\b/g },
  { id: "npm-token", title: "npm access token", severity: "high", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: "vercel-token", title: "Vercel token", severity: "high", pattern: /\bvercel_[A-Za-z0-9]{24,}/g },
  { id: "jwt", title: "JSON Web Token", severity: "medium", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { id: "db-url-password", title: "Database URL with password", severity: "high", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/"'`]+:([^@\s"'`]{3,})@/g, group: 1 },
  {
    id: "generic-assignment",
    title: "Hard-coded secret assignment",
    severity: "medium",
    pattern: /\b[A-Za-z0-9_]*(?:secret|token|passwd|password|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_]*\s*[:=]\s*["'`]([^"'`\s]{12,})["'`]/gi,
    group: 1,
  },
];

const PLACEHOLDER = /^(?:x+|\*+|\.+|<[^>]+>|\$\{[^}]+\}|your[_-].*|changeme|example.*|placeholder.*|process\.env\..*|import\.meta\.env\..*|test|dummy.*|redacted)$/i;

export function redact(secret: string): string {
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 4)}${"•".repeat(Math.min(12, secret.length - 6))}${secret.slice(-2)}`;
}

function lineCol(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: index - last };
}

export function scanForLeaks(text: string, rules: LeakRule[] = LEAK_RULES): LeakFinding[] {
  const findings: LeakFinding[] = [];
  const claimed: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => claimed.some(([a, b]) => s < b && e > a);

  for (const rule of rules) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const secret = rule.group ? m[rule.group] ?? m[0] : m[0];
      const offset = rule.group && m[rule.group] ? m.index + m[0].indexOf(m[rule.group]) : m.index;
      if (overlaps(m.index, m.index + m[0].length)) continue;
      if (rule.id === "generic-assignment" && PLACEHOLDER.test(secret)) continue;
      claimed.push([m.index, m.index + m[0].length]);
      const { line, column } = lineCol(text, offset);
      findings.push({ ruleId: rule.id, title: rule.title, severity: rule.severity, line, column, preview: rule.id === "private-key" ? secret : redact(secret) });
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
