import { strToU8, zipSync } from "fflate";
import type { BPage, BuilderDoc } from "./model";
import { nodeJsx, pageHtml, siteCss } from "./exporters";
import { expoProject } from "./rnExport";

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
const routeOf = (p: BPage) => p.path.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9/_-]+/g, "-");

/** Every page as static HTML (`/about` → `about/index.html`) sharing one stylesheet. */
export function staticSite(doc: BuilderDoc, name: string): Record<string, string> {
  const files: Record<string, string> = { "site.css": siteCss(doc) };
  for (const p of doc.pages) {
    const route = routeOf(p);
    const depth = route ? route.split("/").length : 0;
    files[route ? `${route}/index.html` : "index.html"] = pageHtml(doc, p, { cssHref: `${"../".repeat(depth)}site.css` });
  }
  files["404.html"] = files["index.html"] ?? Object.values(files).find((f) => f.startsWith("<!doctype")) ?? "";
  files["README.md"] = `# ${name}\n\nStatic site exported from Multi-functional Creator. Upload this folder to any static host (Vercel, Netlify, GitHub Pages, S3, Nginx), or preview locally:\n\n\`\`\`bash\nnpx serve .\n\`\`\`\n`;
  return files;
}

const componentName = (p: BPage) => (p.name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase()) || "Home") + "Page";

/** A Next.js (App Router, TypeScript) project with one route per page. */
export function nextProject(doc: BuilderDoc, name: string): Record<string, string> {
  const slug = slugOf(name);
  const home = doc.pages.find((p) => !routeOf(p)) ?? doc.pages[0];
  const files: Record<string, string> = {};
  files["package.json"] = JSON.stringify({ name: slug, version: "1.0.0", private: true, scripts: { dev: "next dev", build: "next build", start: "next start", typecheck: "tsc --noEmit" }, dependencies: { next: "^16.0.0", react: "^19.2.0", "react-dom": "^19.2.0" }, devDependencies: { "@types/node": "^22.0.0", "@types/react": "^19.2.0", "@types/react-dom": "^19.2.0", typescript: "^5.9.0" } }, null, 2) + "\n";
  files["tsconfig.json"] = JSON.stringify({ compilerOptions: { target: "ES2022", lib: ["dom", "dom.iterable", "esnext"], allowJs: false, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", incremental: true, plugins: [{ name: "next" }] }, include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules"] }, null, 2) + "\n";
  files["next-env.d.ts"] = `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`;
  files["next.config.mjs"] = `/** @type {import('next').NextConfig} */\nconst nextConfig = { reactStrictMode: true };\nexport default nextConfig;\n`;
  files[".gitignore"] = "node_modules/\n.next/\nout/\n";
  files["app/globals.css"] = siteCss(doc);
  files["app/layout.tsx"] = `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: ${JSON.stringify(home.title || name)},
  description: ${JSON.stringify(home.description ?? "")},
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang=${JSON.stringify(home.lang ?? "en")}>
      <body className="site">{children}</body>
    </html>
  );
}
`;
  for (const p of doc.pages) {
    const route = routeOf(p);
    files[route ? `app/${route}/page.tsx` : "app/page.tsx"] = `import type { Metadata } from "next";

export const metadata: Metadata = {
  title: ${JSON.stringify(p.title || p.name)},
  description: ${JSON.stringify(p.description ?? "")},${p.ogImage ? `\n  openGraph: { images: [${JSON.stringify(p.ogImage)}] },` : ""}
};

export default function ${componentName(p)}() {
  return (
${nodeJsx(p.root, 2)}
  );
}
`;
  }
  files["README.md"] = `# ${name}\n\nNext.js (App Router) project exported from Multi-functional Creator — one route per page, styles in \`app/globals.css\`.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nDeploy to Vercel with \`vercel\` or from the panel's Deploy module.\n`;
  return files;
}

export { expoProject };

export function zip(files: Record<string, string>, root: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) entries[`${root}/${path}`] = strToU8(content);
  return zipSync(entries, { level: 6 });
}
