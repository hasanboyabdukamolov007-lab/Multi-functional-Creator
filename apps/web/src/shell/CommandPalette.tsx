import { Command } from "cmdk";
import { useMemo, useState } from "react";
import { getCtx, prettyShortcut, registry, runFunction, useRegistryVersion } from "../lib/registry";
import { useUi, toast } from "../lib/ui";
import { t as tt, useT } from "../lib/i18n";
import { IconCommand } from "../ui/icons";

export function functionTitle(f: { title: string; titleKey?: string; titleArgs?: Record<string, string> }) {
  if (!f.titleKey) return f.title;
  const args = f.titleArgs ? Object.fromEntries(Object.entries(f.titleArgs).map(([k, v]) => [k, tt(v)])) : undefined;
  return tt(f.titleKey, args);
}

export function CommandPalette() {
  const t = useT();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const [query, setQuery] = useState("");
  useRegistryVersion();

  const results = useMemo(() => (open ? registry.search(query, 80) : []), [open, query]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof results>();
    for (const f of results) m.set(f.category, [...(m.get(f.category) ?? []), f]);
    return [...m.entries()];
  }, [results]);

  if (!open) return null;
  const ctx = getCtx();
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <Command className="palette" shouldFilter={false} label="Command palette" onKeyDown={(e) => e.key === "Escape" && close()}>
        <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder={t("shell.palette")} />
        <Command.List>
          <Command.Empty>{t("shell.noResults")}</Command.Empty>
          {groups.map(([cat, fns]) => (
            <Command.Group key={cat} heading={cat}>
              {fns.map((f) => {
                const enabled = registry.isEnabled(f.id, ctx);
                return (
                  <Command.Item
                    key={f.id}
                    value={f.id}
                    disabled={enabled !== true}
                    onSelect={() => {
                      close();
                      runFunction(f.id).catch((e: Error) => toast(e.message, "error"));
                    }}
                  >
                    <span className="grow ellipsis">{functionTitle(f)}</span>
                    {enabled !== true && <span className="small muted">{enabled}</span>}
                    {f.shortcut && <kbd>{prettyShortcut(f.shortcut)}</kbd>}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
        <div className="palette-footer">
          <span className="row" style={{ gap: 6 }}>
            <IconCommand size={13} /> {t("shell.paletteHint", { n: registry.size })}
          </span>
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd> <kbd>Esc</kbd>
          </span>
        </div>
      </Command>
    </div>
  );
}
