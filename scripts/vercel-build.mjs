// Builds the app into Vercel's Build Output API layout (.vercel/output):
//   static/          the web app (served from Vercel's CDN)
//   functions/api.func  the Fastify API bundled into one ESM file (streaming enabled for the copilot)
//   config.json      routing: /api/* → function, files → CDN, everything else → index.html (SPA)
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const out = ".vercel/output";

run("pnpm --filter @mfc/core build");
run("pnpm --filter @mfc/web build");

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/static`, { recursive: true });
cpSync("apps/web/dist", `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ["apps/server/src/vercel.ts"],
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
console.log("Vercel output written to .vercel/output");
