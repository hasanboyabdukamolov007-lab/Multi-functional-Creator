import { createElement, memo, useCallback, useRef, useState, type ReactNode } from "react";
import { useBuilder, DEVICE_WIDTH } from "./store";
import { defFor } from "./catalog";
import { reactAttrName, specWithNode } from "./exporters";
import { isSlot, type Spec } from "./spec";
import { SITE_CSS, tokenVars } from "./siteCss";
import { findNode, type BNode } from "./model";
import { toast } from "../../lib/ui";
import { useT } from "../../lib/i18n";

type DropHint = { id: string; where: "inside" | "before" | "after" } | null;
export const DRAG_MIME = "application/x-mfc-component";
export const MOVE_MIME = "application/x-mfc-node";

function toReactProps(spec: Spec): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec.attrs ?? {})) {
    if (v === undefined || v === false || v === "") continue;
    let name = reactAttrName(k, spec.tag);
    if (spec.tag === "input" && k === "value" && (spec.attrs?.type === "range" || !spec.attrs?.type)) name = "defaultValue";
    props[name] = v;
  }
  if (spec.style) props.style = Object.fromEntries(Object.entries(spec.style).filter(([, v]) => v !== undefined && v !== ""));
  if (spec.tag === "input" || spec.tag === "textarea" || spec.tag === "select") props.tabIndex = -1;
  return props;
}

function renderSpec(spec: Spec, node: BNode, root: boolean, key?: number): ReactNode {
  const props = toReactProps(spec);
  if (root) {
    const def = defFor(node.type);
    props["data-node-id"] = node.id;
    props.className = [props.className, "mfc-node", def.container ? "mfc-container" : ""].filter(Boolean).join(" ");
  }
  if (key !== undefined) props.key = key;
  if (spec.rawHtml !== undefined) {
    return createElement(spec.tag, props, <iframe title="Custom HTML preview" sandbox="" srcDoc={`<style>body{font-family:system-ui;margin:0}</style>${spec.rawHtml}`} style={{ width: "100%", border: 0, minHeight: 60, pointerEvents: "none" }} />);
  }
  const kids: ReactNode[] = [];
  (spec.children ?? []).forEach((c, i) => {
    if (typeof c === "string") kids.push(c);
    else if (isSlot(c)) {
      if (node.children.length) for (const ch of node.children) kids.push(<NodeView key={ch.id} node={ch} />);
      else kids.push(<EmptySlot key="__empty" />);
    } else kids.push(renderSpec(c, node, false, i));
  });
  return createElement(spec.tag, props, ...(kids.length ? kids : []));
}

function EmptySlot() {
  const t = useT();
  return <div className="mfc-empty-slot">{t("builder.dropHere")}</div>;
}

const NodeView = memo(function NodeView({ node }: { node: BNode }) {
  return <>{renderSpec(specWithNode(node), node, true)}</>;
});

export function Canvas() {
  const page = useBuilder((s) => s.page());
  const tokens = useBuilder((s) => s.doc.tokens);
  const selectedId = useBuilder((s) => s.selectedId);
  const device = useBuilder((s) => s.device);
  const zoom = useBuilder((s) => s.zoom);
  const outlines = useBuilder((s) => s.outlines);
  const [hint, setHint] = useState<DropHint>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  const nodeEl = (target: EventTarget | null) => (target as HTMLElement | null)?.closest?.("[data-node-id]") as HTMLElement | null;

  const onClick = (e: React.MouseEvent) => {
    if (editing) return;
    const el = nodeEl(e.target);
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label, summary, form")) e.preventDefault();
    useBuilder.getState().select(el?.dataset.nodeId ?? null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const el = nodeEl(e.target);
    if (!el) return;
    const id = el.dataset.nodeId!;
    const node = findNode(useBuilder.getState().page().root, id)?.node;
    const def = node && defFor(node.type);
    if (!node || !def?.textProp) return;
    // Edit the innermost text-bearing element in place.
    const target = (e.target as HTMLElement).closest("[data-node-id]") === el ? (e.target as HTMLElement) : el;
    target.contentEditable = "true";
    target.focus();
    setEditing(id);
    const finish = () => {
      target.contentEditable = "false";
      target.removeEventListener("blur", finish);
      setEditing(null);
      const text = target.innerText.trim();
      if (text !== String(node.props[def.textProp!] ?? "")) useBuilder.getState().update(id, { props: { [def.textProp!]: text } });
    };
    target.addEventListener("blur", finish);
    target.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        target.blur();
      }
      if (ev.key === "Escape") target.blur();
    });
  };

  const computeHint = useCallback((e: React.DragEvent): DropHint => {
    const el = nodeEl(e.target);
    if (!el) return { id: useBuilder.getState().page().root.id, where: "inside" };
    const id = el.dataset.nodeId!;
    const node = findNode(useBuilder.getState().page().root, id)?.node;
    if (!node) return null;
    const rect = el.getBoundingClientRect();
    const y = (e.clientY - rect.top) / Math.max(1, rect.height);
    const isContainer = defFor(node.type).container;
    if (node.type === "page") return { id, where: "inside" };
    if (isContainer && y > 0.2 && y < 0.8) return { id, where: "inside" };
    return { id, where: y < 0.5 ? "before" : "after" };
  }, []);

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME) && !e.dataTransfer.types.includes(MOVE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(MOVE_MIME) ? "move" : "copy";
    const h = computeHint(e);
    setHint((prev) => (prev?.id === h?.id && prev?.where === h?.where ? prev : h));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const h = computeHint(e);
    setHint(null);
    if (!h) return;
    const st = useBuilder.getState();
    const root = st.page().root;
    const target = findNode(root, h.id);
    if (!target) return;
    const parentId = h.where === "inside" ? h.id : target.parent?.id ?? root.id;
    const index = h.where === "inside" ? target.node.children.length : h.where === "before" ? target.index : target.index + 1;
    try {
      const type = e.dataTransfer.getData(DRAG_MIME);
      const moveId = e.dataTransfer.getData(MOVE_MIME);
      if (type) st.insert(type, { parentId, index });
      else if (moveId) st.moveTo(moveId, parentId, index);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const width = DEVICE_WIDTH[device];
  const vars = tokenVars(tokens) as React.CSSProperties;
  const hintCss = hint
    ? hint.where === "inside"
      ? `[data-node-id="${hint.id}"] { outline: 2px dashed var(--mfc-accent) !important; outline-offset: -2px; background-color: color-mix(in srgb, var(--mfc-accent) 6%, transparent); }`
      : `[data-node-id="${hint.id}"] { box-shadow: 0 ${hint.where === "before" ? "-3px" : "3px"} 0 0 var(--mfc-accent) !important; }`
    : "";

  return (
    <div className="canvas-scroll" onDragLeave={(e) => e.currentTarget === e.target && setHint(null)}>
      <style>{SITE_CSS}</style>
      <style>{`
        .canvas-frame .mfc-node { cursor: default; }
        .canvas-frame .mfc-node:hover { outline: 1px solid color-mix(in srgb, var(--mfc-accent) 60%, transparent); outline-offset: -1px; }
        ${selectedId ? `.canvas-frame [data-node-id="${selectedId}"] { outline: 2px solid var(--mfc-accent) !important; outline-offset: -2px; }` : ""}
        ${outlines ? `.canvas-frame .mfc-container { outline: 1px dashed color-mix(in srgb, var(--mfc-muted) 60%, transparent); outline-offset: -1px; }` : ""}
        .canvas-frame [contenteditable="true"] { outline: 2px solid var(--mfc-warning) !important; cursor: text; }
        .mfc-empty-slot { padding: 28px; border: 2px dashed color-mix(in srgb, var(--color-muted) 40%, transparent); border-radius: 10px; text-align: center; color: var(--color-muted); font-size: 14px; }
        ${hintCss}
      `}</style>
      <div
        ref={frame}
        className="canvas-frame site"
        style={{ ...vars, width: width ? `${width}px` : "100%", transform: zoom !== 1 ? `scale(${zoom})` : undefined, transformOrigin: "top center" }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onSubmit={(e) => e.preventDefault()}
      >
        <NodeView node={page.root} />
      </div>
    </div>
  );
}
