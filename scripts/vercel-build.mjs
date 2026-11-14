// Builds the app into Vercel's Build Output API layout (.vercel/output):
//   static/          the web app (served from Vercel's CDN)
//   functions/api.func  the Fastify API bundled into one ESM file (streaming enabled for the copilot)
//   config.json      routing: /api/* → function, files → CDN, everything else → index.html (SPA)
//
// Works whether the Vercel project's Root Directory is the repo root or apps/web: paths are resolved
// from this script's location, and the output goes to <working directory>/.vercel/output, which is
// where Vercel looks for it.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => execSync(cmd, { stdio: "inherit", cwd: repo });
const out = path.join(process.cwd(), ".vercel/output");
const at = (p) => path.join(repo, p);
// esbuild is a root devDependency; resolve it from the repo root so this works from any cwd.
const { build } = createRequire(at("package.json"))("esbuild");

run("pnpm --filter @mfc/core build");
run("pnpm --filter @mfc/web build");

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/static`, { recursive: true });
cpSync(at("apps/web/dist"), `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: [at("apps/server/src/vercel.ts")],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  // The embedded database is never used on Vercel (DATABASE_URL is required there).
  external: ["@electric-sql/pglite", "pg-native"],
  banner: {
    js: [
      'import { createRequire as __mfcCreateRequire } from "node:module";',
      'import { fileURLToPath as __mfcFileURLToPath } from "node:url";',
      'import { dirname as __mfcDirname } from "node:path";',
      "const require = __mfcCreateRequire(import.meta.url);",
      "const __filename = __mfcFileURLToPath(import.meta.url);",
      "const __dirname = __mfcDirname(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
});
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: "module" }));
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 300,
    },
    null,
    2,
  ),
);

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        { src: "^/sw\\.js$", headers: { "cache-control": "no-cache", "service-worker-allowed": "/" }, continue: true },
        { src: "^/manifest\\.webmanifest$", headers: { "content-type": "application/manifest+json" }, continue: true },
        { src: "^/api(/.*)?$", dest: "/api" },
        { handle: "filesystem" },
        { src: "^/assets/.*$", status: 404 },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel output written to ${out}`);
