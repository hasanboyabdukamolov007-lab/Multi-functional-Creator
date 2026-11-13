import { useLocation } from "react-router-dom";
import { moduleForPath } from "..";
import { useT } from "../../lib/i18n";
import { IconCheck } from "../../ui/icons";

export default function PlannedPage() {
  const t = useT();
  const mod = moduleForPath(useLocation().pathname);
  const Icon = mod.icon;
  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <div>
            <div className="row" style={{ gap: 12 }}>
              <Icon size={26} />
              <h1 className="page-title">{t(mod.labelKey)}</h1>
              <span className="badge badge-accent">{t("planned.title", { n: mod.phase })}</span>
            </div>
            <p className="page-subtitle">{t("planned.body", { n: mod.phase })}</p>
          </div>
        </div>
        <div className="card">
          <div className="col">
            {mod.plannedFeatures?.map((f) => (
              <div key={f} className="row">
                <IconCheck size={16} className="muted" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
