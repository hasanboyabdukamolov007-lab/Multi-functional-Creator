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

const Planned = lazy(() => import("./planned/PlannedPage"));

export const MODULES: ModuleDef[] = [
  { id: "home", path: "/", labelKey: "nav.home", icon: I.IconHome, group: "create", phase: 1, component: lazy(() => import("./home/HomePage")) },
  { id: "builder", path: "/builder", labelKey: "nav.builder", icon: I.IconBuilder, group: "create", phase: 1, keywords: ["site", "page", "panel", "app", "drag", "drop"], component: lazy(() => import("./builder/BuilderPage")) },
  { id: "studio", path: "/studio", labelKey: "nav.studio", icon: I.IconStudio, group: "create", phase: 1, keywords: ["3d", "model", "animate", "three"], component: lazy(() => import("./studio/StudioPage")) },
  { id: "data", path: "/data", labelKey: "nav.data", icon: I.IconData, group: "create", phase: 1, keywords: ["api", "sql", "database", "postman", "workflow", "automation", "schema", "webhook", "cron"], component: lazy(() => import("./data/DataPage")) },
  { id: "academy", path: "/academy", labelKey: "nav.academy", icon: I.IconAcademy, group: "create", phase: 1, keywords: ["course", "learn", "tutorial", "video", "lessons", "training", "kurs", "dars", "курс", "уроки"], component: lazy(() => import("./academy/AcademyPage")) },
  { id: "lab", path: "/lab", labelKey: "nav.lab", icon: I.IconLab, group: "create", phase: 1, keywords: ["forge", "learning", "brain", "knowledge", "ai", "training", "experiments"], component: lazy(() => import("./lab/LabPage")) },
  {
    id: "motion", path: "/motion", labelKey: "nav.motion", icon: I.IconMotion, group: "create", phase: 4, component: Planned,
    plannedFeatures: ["UI micro-interaction presets (hover, press, scroll, page transitions)", "After-Effects-style timeline with easing curve editor", "Lottie and animated SVG import / edit / export", "MP4, WebM and GIF rendering of animations and 3D scenes"],
  },
  {
    id: "media", path: "/media", labelKey: "nav.media", icon: I.IconMedia, group: "create", phase: 4, component: Planned,
    plannedFeatures: ["Image editor with crop, filters, background removal and AI images", "SVG / vector editor", "Brand kit: logos, palettes, fonts and spacing tokens across projects", "Icon & font manager", "Asset manager with WebP/AVIF optimisation and CDN links"],
  },
  { id: "vault", path: "/vault", labelKey: "nav.vault", icon: I.IconVault, group: "ship", phase: 1, keywords: ["secrets", "keys", "tokens", "env"], component: lazy(() => import("./vault/VaultPage")) },
  { id: "deploy", path: "/deploy", labelKey: "nav.deploy", icon: I.IconDeploy, group: "ship", phase: 1, keywords: ["vercel", "netlify", "github", "s3", "ssh", "publish", "hosting", "release", "rollback"], component: lazy(() => import("./deploy/DeployPage")) },
  { id: "monitoring", path: "/monitoring", labelKey: "nav.monitoring", icon: I.IconMonitor, group: "ship", phase: 1, keywords: ["uptime", "analytics", "status", "errors", "vitals", "alerts", "telegram", "slack"], component: lazy(() => import("./monitoring/MonitoringPage")) },
  {
    id: "collab", path: "/collab", labelKey: "nav.collab", icon: I.IconCollab, group: "ecosystem", phase: 5, component: Planned,
    plannedFeatures: ["Real-time co-editing with live cursors (Yjs CRDT)", "Comments and @mentions pinned to canvas or code", "Version history, branches and Git integration"],
  },
  {
    id: "marketplace", path: "/marketplace", labelKey: "nav.marketplace", icon: I.IconMarket, group: "ecosystem", phase: 5, component: Planned,
    plannedFeatures: ["Share and import components, templates and 3D assets across workspaces", "Publish packs to your team"],
  },
  {
    id: "plugins", path: "/plugins", labelKey: "nav.plugins", icon: I.IconPlugins, group: "ecosystem", phase: 5, component: Planned,
    plannedFeatures: ["Plugin SDK built on the same function registry the panel uses", "Install, enable and sandbox plugins per workspace"],
  },
  { id: "audit", path: "/audit", labelKey: "nav.audit", icon: I.IconAudit, group: "admin", phase: 1, keywords: ["log", "activity", "history"], component: lazy(() => import("./audit/AuditPage")) },
  { id: "settings", path: "/settings", labelKey: "nav.settings", icon: I.IconSettings, group: "admin", phase: 1, keywords: ["theme", "language", "members", "ai"], component: lazy(() => import("./settings/SettingsPage")) },
];

export function moduleForPath(pathname: string): ModuleDef {
  return [...MODULES].sort((a, b) => b.path.length - a.path.length).find((m) => (m.path === "/" ? pathname === "/" : pathname.startsWith(m.path))) ?? MODULES[0];
}
