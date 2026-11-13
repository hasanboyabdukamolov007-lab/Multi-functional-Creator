import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { useT } from "../../lib/i18n";
import * as I from "../../ui/icons";

const TABS = {
  tester: { icon: I.IconSend, C: lazy(() => import("./ApiTester")) },
  browser: { icon: I.IconData, C: lazy(() => import("./DataBrowser")) },
  schema: { icon: I.IconGrid, C: lazy(() => import("./SchemaDesigner")) },
  api: { icon: I.IconCode, C: lazy(() => import("./ApiGenerator")) },
  workflows: { icon: I.IconWand, C: lazy(() => import("./Workflows")) },
} as const;
export type DataTab = keyof typeof TABS;

export default function DataPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: DataTab = raw && raw in TABS ? (raw as DataTab) : "tester";
  const { C } = TABS[tab];
  return (
    <div className="col" style={{ height: "100%", gap: 0 }}>
      <div className="tabs" role="tablist" aria-label={t("nav.data")}>
        {(Object.keys(TABS) as DataTab[]).map((k) => {
          const Icon = TABS[k].icon;
          return (
            <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setParams({ tab: k })}>
              <Icon size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              {t(`data.tab.${k}`)}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Suspense fallback={<div className="muted" style={{ padding: 20 }}>{t("common.loading")}</div>}>
          <C />
        </Suspense>
      </div>
    </div>
  );
}
