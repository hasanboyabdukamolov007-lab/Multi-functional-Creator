import { useState } from "react";
import { useUi } from "../lib/ui";
import { useT } from "../lib/i18n";
import { registry } from "../lib/registry";
import { IconBot, IconBuilder, IconCommand, IconStudio, IconVault } from "../ui/icons";

const STEPS = [
  { key: "onboard.1", Icon: IconCommand },
  { key: "onboard.2", Icon: IconBuilder },
  { key: "onboard.3", Icon: IconStudio },
  { key: "onboard.4", Icon: IconVault },
  { key: "onboard.5", Icon: IconBot },
];

export function Onboarding() {
  const t = useT();
  const open = useUi((s) => s.onboardingOpen);
  const setOpen = useUi((s) => s.setOnboarding);
  const [i, setI] = useState(0);
  if (!open) return null;
  const step = STEPS[i];
  const close = () => {
    setOpen(false);
    setI(0);
  };
  return (
    <div className="overlay overlay-center" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="modal" style={{ textAlign: "center", padding: 32 }}>
        <div className="brand-mark" style={{ width: 56, height: 56, borderRadius: 16, margin: "0 auto 16px" }}>
          <step.Icon size={28} />
        </div>
        <div id="onboard-title" className="modal-title" style={{ fontSize: 20 }}>
          {t(`${step.key}.title`)}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          {t(`${step.key}.body`, { n: Math.floor(registry.size / 50) * 50 })}
        </p>
        <div className="row" style={{ justifyContent: "center", gap: 6, margin: "20px 0" }}>
          {STEPS.map((_, j) => (
            <span key={j} style={{ width: j === i ? 18 : 6, height: 6, borderRadius: 3, background: j === i ? "var(--mfc-accent)" : "var(--mfc-border)", transition: "width .2s" }} />
          ))}
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button className="btn btn-ghost" onClick={close}>
            {t("common.skip")}
          </button>
          <div className="row">
            {i > 0 && (
              <button className="btn" onClick={() => setI(i - 1)}>
                {t("common.back")}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => (i === STEPS.length - 1 ? close() : setI(i + 1))}>
              {i === STEPS.length - 1 ? t("common.done") : t("common.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
