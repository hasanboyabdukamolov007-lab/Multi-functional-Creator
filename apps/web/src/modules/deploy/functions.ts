import { registry, type AppFunction } from "../../lib/registry";
import { useBuilder } from "../builder/store";
import { deployApi } from "./deployApi";

export function registerDeployFunctions() {
  const fns: AppFunction[] = [
    { id: "deploy.open", title: "Deploy a project (Vercel, Netlify, GitHub, S3, SSH)", category: "Deploy", keywords: ["publish", "hosting", "go live", "release", "joylash", "деплой", "опубликовать"], run: (_a, ctx) => ctx.navigate(`/deploy${useBuilder.getState().projectId ? `?project=${useBuilder.getState().projectId}` : ""}`) },
    { id: "deploy.current", title: "Deploy the open builder project", category: "Deploy", keywords: ["publish this", "go live"], when: () => (useBuilder.getState().projectId ? true : "Open a builder project first"), run: (_a, ctx) => ctx.navigate(`/deploy?project=${useBuilder.getState().projectId}`) },
    { id: "deploy.targets", title: "Manage deploy targets", category: "Deploy", keywords: ["vercel", "netlify", "github pages", "s3", "r2", "ssh", "server"], ai: false, run: (_a, ctx) => ctx.navigate("/deploy?tab=targets") },
    { id: "deploy.history", title: "Show deployment history (redeploy / roll back)", category: "Deploy", keywords: ["rollback", "versions", "history"], run: async (_a, ctx) => { ctx.navigate("/deploy?tab=history"); return (await deployApi.deployments()).slice(0, 10).map((d) => ({ name: d.name, status: d.status, url: d.url, at: d.started_at })); } },
    { id: "monitoring.uptime", title: "Open uptime monitors and incidents", category: "Monitoring", keywords: ["uptime", "down", "status", "incidents"], run: (_a, ctx) => ctx.navigate("/monitoring?tab=uptime") },
    { id: "monitoring.analytics", title: "Open site analytics, Web Vitals and errors", category: "Monitoring", keywords: ["visitors", "pageviews", "traffic", "vitals", "errors", "analitika", "аналитика"], run: (_a, ctx) => ctx.navigate("/monitoring?tab=analytics") },
    { id: "monitoring.alerts", title: "Set up alerts (Telegram, Slack, Discord, email, webhook)", category: "Monitoring", keywords: ["notifications", "telegram", "slack", "discord", "alert", "xabar", "уведомления"], run: (_a, ctx) => ctx.navigate("/monitoring?tab=alerts") },
  ];
  registry.register(fns);
}
