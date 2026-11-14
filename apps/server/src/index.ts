import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp(config);

let closing = false;
const shutdown = async (sig: string) => {
  if (closing) return;
  closing = true;
  app.log.info(`${sig} received, finishing in-flight requests`);
  // Never hang a deploy: force exit if connections don't drain in 10 s.
  setTimeout(() => process.exit(1), 10_000).unref();
  await app.close().catch((e) => app.log.error(e));
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => app.log.error({ err: e }, "unhandled rejection"));

await app.listen({ host: config.host, port: config.port });
app.log.info(`Multi-functional Creator API on http://${config.host}:${config.port} (db: ${app.deps.db.kind})`);
