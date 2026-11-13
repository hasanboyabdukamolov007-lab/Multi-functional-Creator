import { useUi } from "../lib/ui";
import { IconClose } from "../ui/icons";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="grow">{t.text}</span>
          <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
