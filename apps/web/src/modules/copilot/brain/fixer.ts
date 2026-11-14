/**
 * Forge's code doctor: detects the language, finds real problems (syntax, security, accessibility,
 * performance, correctness), fixes the safe ones automatically and explains each with a lesson link.
 * Pure and deterministic — no eval, no network.
 */
import { scanForLeaks } from "@mfc/core";

export type CodeLang = "html" | "css" | "js" | "json" | "sql";
export interface Issue {
  severity: "error" | "warning" | "info";
  line?: number;
  message: string;
  fixed?: boolean;
  learn?: string; // knowledge-base entry id
}
export interface FixResult {
  lang: CodeLang;
  issues: Issue[];
  fixed: string;
  changed: boolean;
}

export function detectLang(code: string, hint?: string): CodeLang {
  const h = (hint ?? "").toLowerCase();
  if (/^(html|xml|svg)$/.test(h)) return "html";
  if (/^(css|scss)$/.test(h)) return "css";
  if (/^(js|javascript|ts|typescript|jsx|tsx)$/.test(h)) return "js";
  if (h === "json") return "json";
  if (/^(sql|psql|mysql)$/.test(h)) return "sql";
  const s = code.trim();
  if (/^[[{]/.test(s) && /[\]}]$/.test(s) && !/\b(function|const|let|=>)\b/.test(s)) return "json";
  if (/^\s*(select|insert|update|delete|create|alter|drop|with)\b/i.test(s)) return "sql";
  if (/^</.test(s)) return "html";
  if (/(?:^|\n)\s*(?:var|let|const|function|import|export|class|return|if\s*\(|for\s*\(|async\s)|=>|console\.|document\.|\bawait\b/.test(s)) return "js";
  if (/(?:^|\n)\s*[.#:*\[a-z@][^{}()=;\n]*\{\s*\n?\s*[a-z-]+\s*:/i.test(s)) return "css";
  if (/<\/?[a-z][\s\S]*>/i.test(s)) return "html";
  return "js";
}

const lineOf = (code: string, index: number) => code.slice(0, index).split("\n").length;

/** Bracket/quote balance for C-like code, skipping strings, comments and template literals. */
function balance(code: string, isCss = false): Issue[] {
  const stack: Array<{ ch: string; i: number }> = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const n = code[i + 1];
    if (c === "/" && n === "/" && !isCss) {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end < 0) return [{ severity: "error", line: lineOf(code, i), message: "Comment is never closed (missing */)" }];
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      const start = i;
      i++;
      while (i < code.length && code[i] !== q) {
        if (code[i] === "\\") i++;
        else if (code[i] === "\n" && q !== "`") break;
        i++;
      }
      if (code[i] !== q) return [{ severity: "error", line: lineOf(code, start), message: `String starting with ${q} is never closed` }];
      continue;
    }
    if ("([{".includes(c)) stack.push({ ch: c, i });
    else if (")]}".includes(c)) {
      const top = stack.pop();
      if (!top || top.ch !== pairs[c]) return [{ severity: "error", line: lineOf(code, i), message: top ? `“${c}” closes “${top.ch}” opened on line ${lineOf(code, top.i)}` : `Unexpected “${c}” with nothing to close` }];
    }
  }
  return stack.map((s) => ({ severity: "error" as const, line: lineOf(code, s.i), message: `“${s.ch}” opened here is never closed` }));
}

function secrets(code: string): Issue[] {
  return scanForLeaks(code).map((f) => ({ severity: "error", message: `Hard-coded secret detected (${f.title}). Move it to the Secrets Vault and read it from an environment variable.`, learn: "secrets" }));
}

// ------------------------------------------------------------------------------------------- JS
function fixJs(code: string): FixResult {
  const issues: Issue[] = [...balance(code), ...secrets(code)];
  let out = code;
  const each = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) fn(m);
  };
  each(/\bvar\s+/g, (m) => issues.push({ severity: "warning", line: lineOf(code, m.index), message: "`var` is function-scoped and hoisted — replaced with `let` (use `const` if it never changes).", fixed: true, learn: "js-closures" }));
  out = out.replace(/\bvar\s+/g, "let ");
  each(/[^=!<>]([!=])=(?!=)(?!\s*(?:null|undefined)\b)/g, (m) => issues.push({ severity: "warning", line: lineOf(code, m.index), message: `\`${m[1]}=\` converts types before comparing — replaced with \`${m[1]}==\`.`, fixed: true }));
  out = out.replace(/([^=!<>])([!=])=(?!=)(?!\s*(?:null|undefined)\b)/g, "$1$2==");
  each(/\beval\s*\(|new\s+Function\s*\(/g, (m) => issues.push({ severity: "error", line: lineOf(code, m.index), message: "eval / new Function runs arbitrary code — a code-injection risk. Parse data with JSON.parse or use a lookup table.", learn: "xss" }));
  each(/\.innerHTML\s*[+]?=\s*(?:`[^`]*\$\{|[^;\n]*\+)/g, (m) => issues.push({ severity: "error", line: lineOf(code, m.index), message: "innerHTML built from variables enables XSS. Use textContent or create elements; sanitise if HTML is required.", learn: "xss" }));
  each(/document\.write\s*\(/g, (m) => issues.push({ severity: "warning", line: lineOf(code, m.index), message: "document.write blocks parsing and can wipe the page — append elements instead." }));
  each(/localStorage\.setItem\(\s*['"`][^'"`]*(token|jwt|password|secret)[^'"`]*['"`]/gi, (m) => issues.push({ severity: "warning", line: lineOf(code, m.index), message: "Tokens in localStorage are readable by any injected script — prefer an httpOnly cookie.", learn: "auth" }));
  each(/for\s*\([^)]*\)\s*\{[^}]*\bawait\s+fetch/g, (m) => issues.push({ severity: "info", line: lineOf(code, m.index), message: "await inside a loop runs requests one by one — use Promise.all for independent requests.", learn: "js-async" }));
  each(/\.then\([^)]*\)(?![\s\S]{0,200}\.catch\()/g, (m) => issues.push({ severity: "info", line: lineOf(code, m.index), message: "Promise chain without .catch() — failures become unhandled rejections.", learn: "js-async" }));
  each(/console\.log\(/g, (m) => issues.push({ severity: "info", line: lineOf(code, m.index), message: "Leftover console.log — remove before shipping." }));
  each(/setTimeout\(\s*['"`]/g, (m) => issues.push({ severity: "warning", line: lineOf(code, m.index), message: "Passing a string to setTimeout is eval in disguise — pass a function.", learn: "xss" }));
  each(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*;?/g, (m) => !/,\s*\[/.test(m[0]) && issues.push({ severity: "warning", line: lineOf(code, m.index), message: "useEffect without a dependency array runs after every render.", learn: "react-hooks" }));
  each(/\.map\(\s*\(?(\w+)(?:,\s*(\w+))?\)?\s*=>\s*<\w+(?![^>]*\bkey=)/g, (m) => issues.push({ severity: "warning", line: lineOf(code, m.index), message: "List items rendered with .map() need a stable key prop.", learn: "react-basics" }));
  each(/\bkey=\{\s*(i|idx|index)\s*\}/g, (m) => issues.push({ severity: "info", line: lineOf(code, m.index), message: "Index keys break when the list reorders — use an id.", learn: "react-basics" }));
  return { lang: "js", issues, fixed: out, changed: out !== code };
}

// ------------------------------------------------------------------------------------------- HTML
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
function fixHtml(code: string): FixResult {
  const issues: Issue[] = [...secrets(code)];
  let out = code;
  if (/<html[\s>]/i.test(out) && !/^\s*<!doctype html>/i.test(out)) {
    out = `<!doctype html>\n${out.trimStart()}`;
    issues.push({ severity: "warning", line: 1, message: "Added <!doctype html> so browsers use standards mode.", fixed: true });
  }
  if (/<html(?![^>]*\blang=)/i.test(out)) {
    out = out.replace(/<html(?![^>]*\blang=)/i, '<html lang="en"');
    issues.push({ severity: "warning", message: "Added lang=\"en\" to <html> — screen readers need the page language (change it if needed).", fixed: true, learn: "a11y" });
  }
  if (/<head[\s>]/i.test(out) && !/name=["']viewport["']/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, '<head$1>\n  <meta name="viewport" content="width=device-width, initial-scale=1">');
    issues.push({ severity: "warning", message: "Added the viewport meta tag — without it phones show a zoomed-out desktop page.", fixed: true, learn: "responsive" });
  }
  let altCount = 0;
  out = out.replace(/<img\b(?![^>]*\balt=)([^>]*?)(\/?)>/gi, (_m, attrs: string, slash: string) => {
    altCount++;
    return `<img${attrs} alt=""${slash}>`;
  });
  if (altCount) issues.push({ severity: "error", message: `${altCount} image(s) had no alt text — added alt="" (describe meaningful images instead).`, fixed: true, learn: "a11y" });
  let relCount = 0;
  out = out.replace(/<a\b([^>]*\btarget=["']_blank["'])(?![^>]*\brel=)([^>]*)>/gi, (_m, a: string, b: string) => {
    relCount++;
    return `<a${a} rel="noopener noreferrer"${b}>`;
  });
  if (relCount) issues.push({ severity: "warning", message: `${relCount} link(s) opened a new tab without rel="noopener noreferrer" — added (prevents tab-nabbing).`, fixed: true, learn: "xss" });
  for (const m of code.matchAll(/\son(click|load|error|mouseover|submit)=/gi)) issues.push({ severity: "warning", line: lineOf(code, m.index ?? 0), message: `Inline on${m[1]} handler — move to addEventListener; inline handlers block a strict CSP.`, learn: "xss" });
  for (const m of code.matchAll(/<(center|font|marquee|blink|big|tt)\b/gi)) issues.push({ severity: "warning", line: lineOf(code, m.index ?? 0), message: `<${m[1]}> is obsolete — use CSS instead.`, learn: "css-specificity" });
  for (const m of code.matchAll(/<div[^>]*\bonclick=/gi)) issues.push({ severity: "error", line: lineOf(code, m.index ?? 0), message: "Clickable <div> isn't keyboard accessible — use <button>.", learn: "html-semantics" });
  const ids = new Map<string, number>();
  for (const m of code.matchAll(/\bid=["']([^"']+)["']/g)) ids.set(m[1], (ids.get(m[1]) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) issues.push({ severity: "error", message: `id="${id}" is used ${n} times — ids must be unique.`, learn: "html-semantics" });
  for (const m of code.matchAll(/<input\b(?![^>]*\b(aria-label|id|type=["'](hidden|submit|button)["']))[^>]*>/gi)) issues.push({ severity: "warning", line: lineOf(code, m.index ?? 0), message: "Input has no id (for a <label for>) or aria-label — screen readers can't name it.", learn: "a11y" });
  if ((code.match(/<h1\b/gi) ?? []).length > 1) issues.push({ severity: "info", message: "More than one <h1> — keep one main heading per page.", learn: "seo" });
  // Unclosed / mis-nested tags.
  const stack: Array<{ tag: string; i: number }> = [];
  const body = out.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length)).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (c) => " ".repeat(c.length));
  for (const m of body.matchAll(/<\/?([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
    const tag = m[1].toLowerCase();
    const closing = m[0].startsWith("</");
    if (VOID.has(tag) || m[2] === "/" || tag === "!doctype") continue;
    if (!closing) stack.push({ tag, i: m.index ?? 0 });
    else {
      const idx = stack.map((s) => s.tag).lastIndexOf(tag);
      if (idx < 0) issues.push({ severity: "error", line: lineOf(out, m.index ?? 0), message: `</${tag}> has no matching opening tag.` });
      else {
        for (const s of stack.slice(idx + 1)) if (!["p", "li", "td", "th", "tr", "option"].includes(s.tag)) issues.push({ severity: "error", line: lineOf(out, s.i), message: `<${s.tag}> is not closed before </${tag}>.` });
        stack.length = idx;
      }
    }
  }
  const unclosed = stack.filter((s) => !["p", "li", "td", "th", "tr", "option", "html", "body", "head"].includes(s.tag));
  if (unclosed.length) {
    out = `${out.trimEnd()}\n${unclosed.reverse().map((s) => `</${s.tag}>`).join("")}\n`;
    issues.push({ severity: "error", message: `Closed ${unclosed.length} unclosed tag(s) at the end: ${unclosed.map((s) => `<${s.tag}>`).join(", ")}.`, fixed: true });
  }
  return { lang: "html", issues, fixed: out, changed: out !== code };
}

// ------------------------------------------------------------------------------------------- CSS
function fixCss(code: string): FixResult {
  const issues: Issue[] = [...balance(code, true)];
  let out = code;
  const open = (out.match(/\{/g) ?? []).length;
  const close = (out.match(/\}/g) ?? []).length;
  if (open > close) {
    out = `${out.trimEnd()}\n${"}".repeat(open - close)}\n`;
    issues.push({ severity: "error", message: `Added ${open - close} missing closing brace(s).`, fixed: true });
  }
  // Missing semicolons between declarations on separate lines.
  let semi = 0;
  out = out.replace(/^(\s*[a-z-]+\s*:[^;{}\n]+?)(\s*)\n(?=\s*[a-z-]+\s*:)/gim, (_m, decl: string, sp: string) => {
    semi++;
    return `${decl};${sp}\n`;
  });
  if (semi) issues.push({ severity: "error", message: `Added ${semi} missing semicolon(s) — the declaration after each was being ignored.`, fixed: true });
  const prefixed = out.match(/-(webkit|moz|ms|o)-(border-radius|box-shadow|transition|transform|box-sizing|animation)\s*:[^;]+;?/g) ?? [];
  if (prefixed.length) {
    out = out.replace(/^\s*-(webkit|moz|ms|o)-(border-radius|box-shadow|transition|transform|box-sizing|animation)\s*:[^;]+;?\s*\n?/gm, "");
    issues.push({ severity: "info", message: `Removed ${prefixed.length} outdated vendor prefix(es) — all modern browsers support the standard properties.`, fixed: true });
  }
  const imp = (out.match(/!important/g) ?? []).length;
  if (imp > 2) issues.push({ severity: "warning", message: `${imp} × !important — fix specificity instead (layers, :where()).`, learn: "css-specificity" });
  if (/outline\s*:\s*(none|0)\b/.test(out) && !/:focus-visible/.test(out)) issues.push({ severity: "error", message: "outline: none removes the keyboard focus indicator — add a :focus-visible style.", learn: "a11y" });
  for (const m of out.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) if (Number(m[1]) < 12) issues.push({ severity: "warning", line: lineOf(out, m.index ?? 0), message: `font-size ${m[1]}px is hard to read — use at least 12px (16px for body text).`, learn: "typography" });
  if (/\bfloat\s*:\s*(left|right)/.test(out)) issues.push({ severity: "info", message: "float layouts are fragile — flexbox or grid is simpler.", learn: "flexbox" });
  for (const m of out.matchAll(/z-index\s*:\s*(\d{4,})/g)) issues.push({ severity: "info", line: lineOf(out, m.index ?? 0), message: `z-index ${m[1]} — use a small, documented scale (1–10).` });
  if (/\b(width|height)\s*:\s*\d{3,}px/.test(out) && !/@media/.test(out)) issues.push({ severity: "info", message: "Fixed pixel widths without media queries may overflow on phones — consider max-width or %.", learn: "responsive" });
  return { lang: "css", issues, fixed: out, changed: out !== code };
}

// ------------------------------------------------------------------------------------------- JSON
function fixJson(code: string): FixResult {
  const issues: Issue[] = [...secrets(code)];
  try {
    const v = JSON.parse(code);
    const pretty = JSON.stringify(v, null, 2);
    return { lang: "json", issues: [{ severity: "info", message: "Valid JSON — formatted with 2-space indentation." }, ...issues], fixed: pretty, changed: pretty !== code };
  } catch (e) {
    issues.push({ severity: "error", message: `Invalid JSON: ${(e as Error).message}` });
  }
  let s = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_m, inner: string) => `"${inner.replace(/"/g, '\\"')}"`)
    .replace(/\bundefined\b/g, "null")
    .replace(/:\s*(True|False)\b/g, (_m, b: string) => `: ${b.toLowerCase()}`);
  try {
    s = JSON.stringify(JSON.parse(s), null, 2);
    issues.push({ severity: "info", message: "Repaired: removed comments and trailing commas, quoted keys, converted single quotes.", fixed: true });
    return { lang: "json", issues, fixed: s, changed: true };
  } catch (e) {
    issues.push({ severity: "error", message: `Couldn't repair automatically: ${(e as Error).message}` });
    return { lang: "json", issues, fixed: code, changed: false };
  }
}

// ------------------------------------------------------------------------------------------- SQL
const SQL_KW = "select from where and or not in is null like ilike join left right inner outer full on group by order having limit offset insert into values update set delete create table index alter add drop primary key foreign references unique default as distinct union all case when then else end begin commit rollback returning with exists between asc desc cascade".split(" ");
function fixSql(code: string): FixResult {
  const issues: Issue[] = [...secrets(code)];
  const stmts = code.split(/;\s*/).map((x) => x.trim()).filter(Boolean);
  for (const st of stmts) {
    if (/^(update|delete)\b/i.test(st) && !/\bwhere\b/i.test(st)) issues.push({ severity: "error", message: `${st.split(/\s+/)[0].toUpperCase()} without WHERE changes every row — add a WHERE clause (run the matching SELECT first).`, learn: "sql-basics" });
    if (/^select\s+\*/i.test(st)) issues.push({ severity: "info", message: "SELECT * fetches every column — name the ones you need.", learn: "sql-basics" });
    if (/'\s*\+\s*\w|\$\{/.test(st)) issues.push({ severity: "error", message: "SQL built with string concatenation — use parameters ($1 / ?) to prevent injection.", learn: "sql-injection" });
    if (/\bwhere\b[^;]*\blike\s+'%/i.test(st)) issues.push({ severity: "info", message: "LIKE '%…' can't use a normal index — consider full-text search or a trigram index.", learn: "indexes" });
    if (/^create table/i.test(st) && !/primary key/i.test(st)) issues.push({ severity: "warning", message: "Table has no primary key.", learn: "normalization" });
    if (/\bnot in\s*\(\s*select/i.test(st)) issues.push({ severity: "warning", message: "NOT IN (SELECT …) returns nothing if the subquery contains NULL — use NOT EXISTS.", learn: "sql-basics" });
  }
  issues.push(...balance(code.replace(/--.*$/gm, ""), true));
  // Format: upper-case keywords outside strings, ensure a trailing semicolon.
  let out = code.replace(/('(?:[^']|'')*')|\b([a-z_]+)\b/gi, (m, str: string, word: string) => (str ? str : SQL_KW.includes(word.toLowerCase()) ? word.toUpperCase() : word));
  if (!/;\s*$/.test(out.trim())) out = `${out.trimEnd()};`;
  return { lang: "sql", issues, fixed: out, changed: out !== code };
}

export function fixCode(code: string, hint?: string): FixResult {
  const lang = detectLang(code, hint);
  const r = lang === "html" ? fixHtml(code) : lang === "css" ? fixCss(code) : lang === "json" ? fixJson(code) : lang === "sql" ? fixSql(code) : fixJs(code);
  const order = { error: 0, warning: 1, info: 2 };
  r.issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0));
  return r;
}

/** Pull a code block out of a chat message: ```lang fences, or everything after "fix this:". */
export function extractCode(text: string): { code: string; hint?: string } | null {
  const fenced = /```(\w+)?\n?([\s\S]*?)```/.exec(text);
  if (fenced) return { code: fenced[2].trim(), hint: fenced[1] };
  const after = /(?:fix|check|debug|review|lint|tuzat|tekshir|исправь|проверь|почини)[^:\n]*[:\n]\s*([\s\S]+)/i.exec(text);
  if (after && /[<>{};=()]/.test(after[1])) return { code: after[1].trim() };
  if (text.split("\n").length >= 3 && /[<>{};=]/.test(text)) return { code: text.trim() };
  return null;
}
