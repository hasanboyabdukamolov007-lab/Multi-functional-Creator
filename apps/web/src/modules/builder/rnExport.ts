import type { BNode, BuilderDoc, BPage, SiteTokens } from "./model";
import { specWithNode } from "./exporters";
import { isSlot, type Child, type Spec } from "./spec";

/**
 * Builder page → React Native (Expo Router) screen. Web layouts don't map 1:1 to native, so this is a
 * faithful approximation: structure, text, images, buttons, inputs and the design tokens carry over;
 * web-only pieces (iframes, video, SVG charts, custom HTML) become labelled placeholders.
 */

const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "strong", "em", "b", "i", "small", "label", "cite", "blockquote", "figcaption", "legend", "summary", "dt", "dd", "mark", "code", "pre", "kbd", "th", "td", "li", "a", "time"]);
const HEADINGS: Record<string, string> = { h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6" };
const CLASS_STYLES = new Set(["section", "container", "row", "stack", "grid", "box", "center", "muted", "btn", "btnPrimary", "btnSecondary", "btnGhost", "btnDanger", "btnLight", "btnBlock", "badge", "navbar", "footer", "card", "stat", "statValue", "statLabel", "quote", "code", "divider", "hero", "heroTitle", "eyebrow", "lead", "link", "plan", "planPrice", "alert", "toneSurface", "tonePrimary", "toneDark", "textSm", "textLg", "textXl", "upper", "brand", "field", "fieldLabel", "check", "list", "tableWrap", "table", "kanban", "split", "appshell", "appshellSide", "appshellMain", "sideLink", "testimonial", "faq", "cta", "logoName", "avatar", "iconBoxed"]);

/** Classes that only carry text styling (invalid on a View). */
const TEXT_CLASSES = new Set(["muted", "link", "textSm", "textLg", "textXl", "upper", "brand", "eyebrow", "lead", "statValue", "statLabel", "planPrice", "heroTitle", "logoName", "fieldLabel"]);
const TEXT_PROPS = new Set(["color", "fontSize", "fontWeight", "textAlign", "textTransform", "letterSpacing", "lineHeight"]);
/** Elements that never become Text, even when they only contain text. */
const NEVER_TEXT = new Set(["section", "main", "header", "footer", "nav", "form", "fieldset", "ul", "ol", "table", "thead", "tbody", "tr", "figure", "aside", "article", "details", "dl", "button", "select", "textarea", "input", "img", "svg", "iframe", "video", "audio"]);

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const str = (s: string) => `{${JSON.stringify(s)}}`;

function classStyles(spec: Spec, kind: "view" | "text"): string[] {
  const cls = String(spec.attrs?.class ?? "").split(/\s+/).filter(Boolean).map(camel);
  return cls.filter((c) => CLASS_STYLES.has(c) && (kind === "text" || !TEXT_CLASSES.has(c))).map((c) => `s.${c}`);
}

function tokenValue(v: string, t: SiteTokens): string | null {
  const m = /^var\(--color-([a-z-]+)\)$/.exec(v.trim());
  if (m) {
    const key = camel(m[1]) as keyof SiteTokens;
    const map: Record<string, keyof SiteTokens> = { primary: "primary", primaryText: "primaryText", bg: "bg", surface: "surface", text: "text", muted: "muted", border: "border" };
    return map[key] ? (t[map[key]] as string) : null;
  }
  return v;
}

function size(v: string): number | string | null {
  const s = v.trim();
  if (/^-?\d+(\.\d+)?px$/.test(s)) return Number(s.slice(0, -2));
  if (/^-?\d+(\.\d+)?rem$/.test(s)) return Math.round(Number(s.slice(0, -3)) * 16);
  if (/^-?\d+(\.\d+)?%$/.test(s)) return s;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === "auto") return "auto";
  return null;
}

const BOX_KEYS = ["padding", "margin"];
/** Convert a web inline style to a React Native style object (unsupported properties are dropped). */
export function rnStyle(style: Record<string, unknown> | undefined, t: SiteTokens): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, raw] of Object.entries(style ?? {})) {
    if (raw === undefined || raw === null || raw === "") continue;
    const v = typeof raw === "number" ? String(raw) : tokenValue(String(raw), t);
    if (v === null || /calc\(|clamp\(|gradient|var\(/.test(v)) continue;
    if (BOX_KEYS.includes(k)) {
      const parts = v.split(/\s+/).map(size);
      if (parts.some((p) => p === null)) continue;
      const [a, b = a, c = a, d = b] = parts as Array<number | string>;
      Object.assign(out, { [`${k}Top`]: a, [`${k}Right`]: b, [`${k}Bottom`]: c, [`${k}Left`]: d });
      continue;
    }
    switch (k) {
      case "background":
      case "backgroundColor":
        if (/^(#|rgb|hsl|[a-z]+$)/i.test(v) && v !== "none") out.backgroundColor = v === "transparent" ? "transparent" : v;
        break;
      case "color":
      case "borderColor":
      case "textAlign":
      case "flexDirection":
      case "flexWrap":
      case "alignItems":
      case "justifyContent":
      case "alignSelf":
      case "textTransform":
        out[k] = v.replace(/^flex-/, "flex-");
        break;
      case "fontWeight":
        out.fontWeight = v;
        break;
      case "opacity":
      case "flex":
        if (!Number.isNaN(Number(v))) out[k] = Number(v);
        break;
      case "display":
        if (v === "none") out.display = "none";
        if (v === "flex" || v === "grid") out.flexDirection = out.flexDirection ?? "row";
        break;
      default:
        if (["width", "height", "minHeight", "maxWidth", "minWidth", "gap", "fontSize", "borderRadius", "borderWidth", "letterSpacing", "lineHeight", "top", "left", "right", "bottom"].includes(k)) {
          const n = size(v);
          if (n !== null && !(k === "lineHeight" && typeof n === "number" && n < 4)) out[k] = n;
        }
    }
  }
  return out;
}

const textOf = (c: Child[]): string =>
  c.map((x) => (typeof x === "string" ? x : isSlot(x) ? "" : textOf(x.children ?? []))).join(" ").replace(/\s+/g, " ").trim();

/** Text-only content (text tags, or e.g. <div class="stat-value">48k</div>) renders as <Text>. */
function isTextual(spec: Spec): boolean {
  if (spec.rawHtml !== undefined || NEVER_TEXT.has(spec.tag)) return false;
  if (/\bbtn\b/.test(String(spec.attrs?.class ?? ""))) return false;
  const kids = spec.children ?? [];
  if (!TEXT_TAGS.has(spec.tag) && !kids.some((c) => typeof c === "string")) return false;
  return kids.length > 0 && kids.every((c) => typeof c === "string" || (!isSlot(c) && isTextual(c)));
}

function styleProp(spec: Spec, t: SiteTokens, extra: string[] = [], kind: "view" | "text" = "view"): string {
  const inline = rnStyle(spec.style as Record<string, unknown>, t);
  if (kind === "view") for (const k of Object.keys(inline)) if (TEXT_PROPS.has(k)) delete inline[k];
  const parts = [...extra, ...classStyles(spec, kind), ...(Object.keys(inline).length ? [JSON.stringify(inline)] : [])];
  return parts.length ? ` style={[${parts.join(", ")}]}` : "";
}

function navigate(href: string): string {
  if (/^https?:\/\//.test(href)) return `() => Linking.openURL(${JSON.stringify(href)})`;
  if (href.startsWith("/")) return `() => router.push(${JSON.stringify(href)})`;
  return "() => {}";
}

function emitText(spec: Spec, t: SiteTokens, pad: string, nested = false): string {
  const extra = [HEADINGS[spec.tag] ? `s.${HEADINGS[spec.tag]}` : nested ? "" : "s.text", spec.tag === "strong" || spec.tag === "b" || spec.tag === "th" ? "s.bold" : "", spec.tag === "a" ? "s.link" : ""].filter(Boolean);
  const press = spec.tag === "a" ? ` onPress={${navigate(String(spec.attrs?.href ?? ""))}}` : "";
  const role = HEADINGS[spec.tag] ? ` accessibilityRole="header"` : spec.tag === "a" ? ` accessibilityRole="link"` : "";
  const inner = (spec.children ?? []).map((c) => (typeof c === "string" ? str(c) : !isSlot(c) ? emitText(c, t, "", true) : "")).join("");
  return `${pad}<Text${styleProp(spec, t, extra, "text")}${role}${press}>${inner}</Text>`;
}

function placeholder(label: string, pad: string): string {
  return `${pad}<View style={s.placeholder}><Text style={s.placeholderText}>${str(label)}</Text></View>`;
}

function emit(spec: Spec, kids: BNode[], t: SiteTokens, depth: number): string {
  const pad = "  ".repeat(depth);
  const cls = String(spec.attrs?.class ?? "");
  if (spec.rawHtml !== undefined) return placeholder("Custom HTML is shown on the web version", pad);
  if (spec.tag === "svg") return "";
  if (spec.tag === "iframe") return placeholder(String(spec.attrs?.title ?? "Embedded content"), pad);
  if (spec.tag === "video" || spec.tag === "audio") return placeholder(spec.tag === "video" ? "Video" : "Audio", pad);
  if (spec.tag === "hr") return `${pad}<View style={s.divider} />`;
  if (spec.tag === "img") {
    const src = String(spec.attrs?.src ?? "");
    if (!src || src.startsWith("data:")) return `${pad}<View style={[s.img, s.placeholder]} accessibilityLabel=${JSON.stringify(String(spec.attrs?.alt ?? "Image"))} />`;
    return `${pad}<Image source={{ uri: ${JSON.stringify(src)} }}${styleProp(spec, t, ["s.img"])} accessibilityLabel=${JSON.stringify(String(spec.attrs?.alt ?? ""))} resizeMode="cover" />`;
  }
  if ((spec.tag === "a" || spec.tag === "button") && /\bbtn\b/.test(cls)) {
    const label = textOf(spec.children ?? []);
    const primary = /btn-primary|btn-danger/.test(cls);
    return `${pad}<Pressable${styleProp(spec, t)} accessibilityRole="button" onPress={${navigate(String(spec.attrs?.href ?? ""))}}>\n${pad}  <Text style={${primary ? "s.btnTextPrimary" : "s.btnText"}}>${str(label)}</Text>\n${pad}</Pressable>`;
  }
  if (spec.tag === "input") {
    const type = String(spec.attrs?.type ?? "text");
    if (type === "checkbox" || type === "radio") return `${pad}<Switch value={${spec.attrs?.checked ? "true" : "false"}} trackColor={{ true: theme.primary, false: theme.border }} />`;
    if (type === "range" || type === "file" || type === "color" || type === "date") return placeholder(`${type} input`, pad);
    const kb = type === "email" ? ` keyboardType="email-address" autoCapitalize="none"` : type === "number" || type === "tel" ? ` keyboardType="${type === "tel" ? "phone-pad" : "numeric"}"` : "";
    return `${pad}<TextInput style={s.input} placeholder=${JSON.stringify(String(spec.attrs?.placeholder ?? ""))} placeholderTextColor={theme.muted}${type === "password" ? " secureTextEntry" : ""}${kb} />`;
  }
  if (spec.tag === "textarea") return `${pad}<TextInput style={[s.input, s.textarea]} multiline placeholder=${JSON.stringify(String(spec.attrs?.placeholder ?? ""))} placeholderTextColor={theme.muted} />`;
  if (spec.tag === "select") {
    const first = (spec.children ?? []).find((c) => typeof c !== "string" && !isSlot(c)) as Spec | undefined;
    return `${pad}<View style={s.input}><Text style={s.text}>${str(first ? textOf(first.children ?? []) : "Select…")}</Text></View>`;
  }
  if (isTextual(spec)) return emitText(spec, t, pad);
  // Containers
  const extra = spec.tag === "tr" ? ["s.tableRow"] : spec.tag === "ul" || spec.tag === "ol" ? ["s.list"] : [];
  const children: string[] = [];
  for (const c of spec.children ?? []) {
    if (typeof c === "string") {
      if (c.trim()) children.push(`${pad}  <Text style={s.text}>${str(c)}</Text>`);
    } else if (isSlot(c)) {
      for (const k of kids) children.push(emitNode(k, t, depth + 1));
    } else {
      const out = emit(c, kids, t, depth + 1);
      if (out) children.push(out);
    }
  }
  return children.length ? `${pad}<View${styleProp(spec, t, extra)}>\n${children.join("\n")}\n${pad}</View>` : `${pad}<View${styleProp(spec, t, extra)} />`;
}

export function emitNode(node: BNode, t: SiteTokens, depth: number): string {
  return emit(specWithNode(node), node.children, t, depth);
}

export function stylesFile(t: SiteTokens): string {
  const r = parseInt(String(t.radius), 10) || 12;
  return `import { StyleSheet } from "react-native";

export const theme = ${JSON.stringify({ primary: t.primary, primaryText: t.primaryText, bg: t.bg, surface: t.surface, text: t.text, muted: t.muted, border: t.border, radius: r }, null, 2)} as const;

export const s = StyleSheet.create({
  screen: { backgroundColor: theme.bg, paddingBottom: 48 },
  text: { color: theme.text, fontSize: 16, lineHeight: 24 },
  bold: { fontWeight: "700" },
  h1: { color: theme.text, fontSize: 34, fontWeight: "800", lineHeight: 40 },
  h2: { color: theme.text, fontSize: 26, fontWeight: "700", lineHeight: 32 },
  h3: { color: theme.text, fontSize: 20, fontWeight: "700" },
  h4: { color: theme.text, fontSize: 18, fontWeight: "600" },
  h5: { color: theme.text, fontSize: 16, fontWeight: "600" },
  h6: { color: theme.muted, fontSize: 13, fontWeight: "600", textTransform: "uppercase" },
  muted: { color: theme.muted },
  link: { color: theme.primary, fontWeight: "600" },
  section: { paddingVertical: 32, paddingHorizontal: 16, gap: 16 },
  container: { width: "100%", gap: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  stack: { gap: 12 },
  grid: { gap: 16 },
  split: { gap: 20 },
  center: { alignItems: "center" },
  box: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 18, gap: 10 },
  card: { gap: 10 },
  btn: { borderRadius: theme.radius * 0.75, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center", borderWidth: 1, borderColor: "transparent" },
  btnPrimary: { backgroundColor: theme.primary },
  btnSecondary: { borderColor: theme.border, backgroundColor: "transparent" },
  btnGhost: { backgroundColor: "transparent" },
  btnDanger: { backgroundColor: "#dc2f3c" },
  btnLight: { backgroundColor: "#ffffff" },
  btnBlock: { alignSelf: "stretch" },
  btnText: { color: theme.text, fontWeight: "600", fontSize: 16 },
  btnTextPrimary: { color: theme.primaryText, fontWeight: "600", fontSize: 16 },
  badge: { alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: theme.surface },
  navbar: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderColor: theme.border, gap: 8 },
  footer: { paddingVertical: 24, paddingHorizontal: 16, borderTopWidth: 1, borderColor: theme.border, gap: 8 },
  brand: { fontSize: 18, fontWeight: "800", color: theme.text },
  hero: { paddingVertical: 40, paddingHorizontal: 16, gap: 16, alignItems: "center" },
  heroTitle: { fontSize: 34, fontWeight: "800", textAlign: "center", color: theme.text },
  eyebrow: { color: theme.primary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5, fontSize: 12 },
  lead: { fontSize: 19, color: theme.muted, lineHeight: 28 },
  stat: { gap: 4 },
  statValue: { fontSize: 28, fontWeight: "800", color: theme.text },
  statLabel: { fontSize: 13, color: theme.muted },
  quote: { borderLeftWidth: 3, borderColor: theme.primary, paddingLeft: 14 },
  code: { backgroundColor: "#0f1117", borderRadius: theme.radius, padding: 14 },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 16 },
  plan: { gap: 12 },
  planPrice: { fontSize: 32, fontWeight: "800", color: theme.text },
  alert: { borderRadius: theme.radius, padding: 14, borderWidth: 1, borderColor: theme.border, gap: 2 },
  toneSurface: { backgroundColor: theme.surface },
  tonePrimary: { backgroundColor: theme.primary },
  toneDark: { backgroundColor: "#0d0f16" },
  textSm: { fontSize: 14 },
  textLg: { fontSize: 18 },
  textXl: { fontSize: 21 },
  upper: { textTransform: "uppercase", letterSpacing: 1 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: theme.text },
  check: { flexDirection: "row", alignItems: "center", gap: 10 },
  list: { gap: 6 },
  tableWrap: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius, overflow: "hidden" },
  table: { gap: 0 },
  tableRow: { flexDirection: "row", gap: 12, paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: theme.border },
  kanban: { backgroundColor: theme.surface, borderRadius: theme.radius, padding: 12, gap: 10 },
  appshell: { gap: 16 },
  appshellSide: { backgroundColor: theme.surface, padding: 14, gap: 8 },
  appshellMain: { padding: 16, gap: 16 },
  sideLink: { paddingVertical: 8 },
  testimonial: { gap: 12 },
  faq: { gap: 8 },
  cta: { backgroundColor: theme.primary, borderRadius: theme.radius * 1.5, padding: 28, gap: 12, alignItems: "center" },
  logoName: { fontSize: 18, fontWeight: "800", color: theme.muted },
  avatar: { width: 44, height: 44, borderRadius: 999, backgroundColor: theme.surface, alignItems: "center", justifyContent: "center" },
  iconBoxed: { width: 44, height: 44, borderRadius: theme.radius * 0.8, backgroundColor: theme.surface },
  img: { width: "100%", aspectRatio: 16 / 10, borderRadius: theme.radius, backgroundColor: theme.surface },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius * 0.6, paddingVertical: 10, paddingHorizontal: 12, color: theme.text, backgroundColor: theme.bg, fontSize: 16 },
  textarea: { minHeight: 110, textAlignVertical: "top" },
  placeholder: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 16, alignItems: "center", justifyContent: "center" },
  placeholderText: { color: theme.muted, fontSize: 14 },
});
`;
}

export function screenFile(page: BPage, t: SiteTokens, stylesImport: string): string {
  const name = (page.name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase()) || "Home") + "Screen";
  const body = page.root.children.map((n) => emitNode(n, t, 3)).filter(Boolean).join("\n");
  return `import { Image, Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { s, theme } from "${stylesImport}";

void Image; void Linking; void Pressable; void Switch; void TextInput; void router; void theme;

export default function ${/^[A-Z]/.test(name) ? name : `P${name}`}() {
  return (
    <ScrollView style={{ backgroundColor: theme.bg }} contentContainerStyle={s.screen}>
${body || "      <Text style={s.text}>Empty page</Text>"}
    </ScrollView>
  );
}
`;
}

export function expoProject(doc: BuilderDoc, appName: string): Record<string, string> {
  const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
  const files: Record<string, string> = {};
  files["package.json"] = JSON.stringify({ name: slug, version: "1.0.0", private: true, main: "expo-router/entry", scripts: { start: "expo start", android: "expo start --android", ios: "expo start --ios", web: "expo start --web", typecheck: "tsc --noEmit" }, dependencies: { expo: "~58.0.0", "expo-router": "~58.0.0", "expo-linking": "~58.0.0", "expo-status-bar": "~58.0.0", react: "*", "react-native": "*", "react-native-safe-area-context": "*", "react-native-screens": "*" }, devDependencies: { "@types/react": "*", typescript: "~5.9.0" } }, null, 2) + "\n";
  files["app.json"] = JSON.stringify({ expo: { name: appName, slug, scheme: slug, version: "1.0.0", orientation: "portrait", userInterfaceStyle: "automatic", plugins: ["expo-router"], ios: { supportsTablet: true }, android: { adaptiveIcon: { backgroundColor: doc.tokens.primary } } } }, null, 2) + "\n";
  files["tsconfig.json"] = JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: { strict: true } }, null, 2) + "\n";
  files["theme/styles.ts"] = stylesFile(doc.tokens);
  files["app/_layout.tsx"] = `import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { theme } from "../theme/styles";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: theme.bg }, headerTintColor: theme.text, contentStyle: { backgroundColor: theme.bg } }}>
${doc.pages.map((p) => `        <Stack.Screen name=${JSON.stringify(routeName(p))} options={{ title: ${JSON.stringify(p.title || p.name)} }} />`).join("\n")}
      </Stack>
    </>
  );
}
`;
  for (const p of doc.pages) {
    const route = routeName(p);
    const depth = route.split("/").length;
    files[`app/${route}.tsx`] = screenFile(p, doc.tokens, `${"../".repeat(depth)}theme/styles`);
  }
  files["README.md"] = `# ${appName} (React Native / Expo)

Generated from the Multi-functional Creator builder. Screens use Expo Router (\`app/\`), and colors come from \`theme/styles.ts\`.

\`\`\`bash
npm install
npx expo install --fix   # aligns React Native package versions with your Expo SDK
npx expo start           # scan the QR code with Expo Go, or press i / a for simulators
\`\`\`

Native layouts differ from the web: text, images, buttons, inputs and colors carry over, while web-only content (embeds, video, SVG charts, custom HTML) is shown as labelled placeholders to replace with native components. Build store binaries with \`eas build\` (or the panel's Deploy module).
`;
  return files;
}

export function routeName(p: BPage): string {
  const path = p.path.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9/_-]+/g, "-");
  return path || "index";
}
