import { useState, type ComponentType, type ReactNode } from "react";

export interface MobilePane {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  badge?: string | number | null;
  content: ReactNode;
}

/**
 * Phone/tablet layout for multi-panel editors: one pane at a time with a thumb-reachable tab bar.
 * Every pane stays mounted (hidden), so canvases, scroll positions and editors keep their state.
 */
export function MobileTabs({ panes, initial, value, onChange }: { panes: MobilePane[]; initial?: string; value?: string; onChange?: (id: string) => void }) {
  const [own, setOwn] = useState(initial ?? panes[0]?.id);
  const active = value ?? own;
  const set = (id: string) => (onChange ? onChange(id) : setOwn(id));
  return (
    <div className="mobile-tabs">
      <div className="mobile-panes">
        {panes.map((p) => (
          <div key={p.id} className="mobile-pane" hidden={p.id !== active} role="tabpanel" aria-label={p.label}>
            {p.content}
          </div>
        ))}
      </div>
      <nav className="mobile-tabbar" role="tablist">
        {panes.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === active} className={p.id === active ? "active" : ""} onClick={() => set(p.id)}>
            <p.icon size={18} />
            <span>{p.label}</span>
            {p.badge ? <span className="mobile-badge">{p.badge}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
