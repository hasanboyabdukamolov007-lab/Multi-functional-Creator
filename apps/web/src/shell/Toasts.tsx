import { useNavigate } from "react-router-dom";
import { useUi } from "../lib/ui";
import { useT } from "../lib/i18n";
import { IconClose } from "../ui/icons";

export function Toasts() {
  const t = useT();
  const navigate = useNavigate();
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.kind}`}>
          <span className="grow">{x.text}</span>
          {x.action && (
            <button className="btn btn-sm btn-primary" onClick={() => (dismiss(x.id), navigate(x.action!.href))}>
              {t(x.action.labelKey)}
            </button>
          )}
          <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => dismiss(x.id)} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
