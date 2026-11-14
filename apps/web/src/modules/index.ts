import type { ComponentType } from "react";
import { lazy } from "react";
import type { LucideIcon } from "lucide-react";
import * as I from "../ui/icons";

export interface ModuleDef {
  id: string;
  path: string;
  labelKey: string;
  icon: LucideIcon;
  group: "create" | "ship" | "ecosystem" | "admin";
  /** Phase in which the module ships; 1 = available now. */
  phase: number;
  keywords?: string[];
  component?: ComponentType;
  plannedFeatures?: string[];
}


export const MODULES: ModuleDef[] = [
  { id: "home", path: "/", labelKey: "nav.home", icon: I.IconHome, group: "create", phase: 1, component: lazy(() => import("./home/HomePage")) },
  { id: "builder", path: "/builder", labelKey: "nav.builder", icon: I.IconBuilder, group: "create", phase: 1, keywords: ["site", "page", "panel", "app", "drag", "drop"], component: lazy(() => import("./builder/BuilderPage")) },
  { id: "studio", path: "/studio", labelKey: "nav.studio", icon: I.IconStudio, group: "create", phase: 1, keywords: ["3d", "model", "animate", "three"], component: lazy(() => import("./studio/StudioPage")) },
  { id: "data", path: "/data", labelKey: "nav.data", icon: I.IconData, group: "create", phase: 1, keywords: ["api", "sql", "database", "postman", "workflow", "automation", "schema", "webhook", "cron"], component: lazy(() => import("./data/DataPage")) },
  { id: "academy", path: "/academy", labelKey: "nav.academy", icon: I.IconAcademy, group: "create", phase: 1, keywords: ["course", "learn", "tutorial", "video", "lessons", "training", "kurs", "dars", "курс", "уроки"], component: lazy(() => import("./academy/AcademyPage")) },
  { id: "lab", path: "/lab", labelKey: "nav.lab", icon: I.IconLab, group: "create", phase: 1, keywords: ["forge", "learning", "brain", "knowledge", "ai", "training", "experiments"], component: lazy(() => import("./lab/LabPage")) },
  { id: "motion", path: "/motion", labelKey: "nav.motion", icon: I.IconMotion, group: "create", phase: 1, keywords: ["animation", "keyframes", "easing", "bezier", "lottie", "gif", "webm", "hover", "scroll"], component: lazy(() => import("./motion/MotionPage")) },
  { id: "media", path: "/media", labelKey: "nav.media", icon: I.IconMedia, group: "create", phase: 1, keywords: ["image", "photo", "crop", "svg", "vector", "brand", "logo", "icons", "fonts", "assets", "webp"], component: lazy(() => import("./media/MediaPage")) },
  { id: "vault", path: "/vault", labelKey: "nav.vault", icon: I.IconVault, group: "ship", phase: 1, keywords: ["secrets", "keys", "tokens", "env"], component: lazy(() => import("./vault/VaultPage")) },
  { id: "deploy", path: "/deploy", labelKey: "nav.deploy", icon: I.IconDeploy, group: "ship", phase: 1, keywords: ["vercel", "netlify", "github", "s3", "ssh", "publish", "hosting", "release", "rollback"], component: lazy(() => import("./deploy/DeployPage")) },
  { id: "monitoring", path: "/monitoring", labelKey: "nav.monitoring", icon: I.IconMonitor, group: "ship", phase: 1, keywords: ["uptime", "analytics", "status", "errors", "vitals", "alerts", "telegram", "slack"], component: lazy(() => import("./monitoring/MonitoringPage")) },
  { id: "collab", path: "/collab", labelKey: "nav.collab", icon: I.IconCollab, group: "ecosystem", phase: 1, keywords: ["team", "comments", "mentions", "online", "activity", "versions", "branches"], component: lazy(() => import("./collab/CollabPage")) },
  { id: "marketplace", path: "/marketplace", labelKey: "nav.marketplace", icon: I.IconMarket, group: "ecosystem", phase: 1, keywords: ["templates", "share", "install", "community", "packs"], component: lazy(() => import("./market/MarketPage")) },
  { id: "plugins", path: "/plugins", labelKey: "nav.plugins", icon: I.IconPlugins, group: "ecosystem", phase: 1, keywords: ["extensions", "sdk", "addons", "plugin"], component: lazy(() => import("./plugins/PluginsPage")) },
  { id: "audit", path: "/audit", labelKey: "nav.audit", icon: I.IconAudit, group: "admin", phase: 1, keywords: ["log", "activity", "history"], component: lazy(() => import("./audit/AuditPage")) },
  { id: "settings", path: "/settings", labelKey: "nav.settings", icon: I.IconSettings, group: "admin", phase: 1, keywords: ["theme", "language", "members", "ai"], component: lazy(() => import("./settings/SettingsPage")) },
];

export function moduleForPath(pathname: string): ModuleDef {
  return [...MODULES].sort((a, b) => b.path.length - a.path.length).find((m) => (m.path === "/" ? pathname === "/" : pathname.startsWith(m.path))) ?? MODULES[0];
}
