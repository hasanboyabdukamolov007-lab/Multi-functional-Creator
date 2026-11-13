import { useShallow } from "zustand/react/shallow";
import { useStudio } from "./store";
import type { SceneObject } from "./model";
import * as I from "../../ui/icons";

const ICON = { mesh: I.IconStudio, light: I.IconLight, camera: I.IconCamera, group: I.IconLayers };

function Row({ obj, depth }: { obj: SceneObject; depth: number }) {
  const selected = useStudio((s) => s.selectedId === obj.id);
  const children = useStudio(useShallow((s) => s.doc.objects.filter((o) => o.parentId === obj.id)));
  const animated = useStudio((s) => s.doc.tracks.some((t) => t.objectId === obj.id));
  const Icon = ICON[obj.kind];
  return (
    <>
      <div className={`list-item ${selected ? "selected" : ""}`} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => useStudio.getState().select(obj.id)}>
        <Icon size={14} className="muted" />
        <span className="grow ellipsis" style={{ opacity: obj.visible ? 1 : 0.45 }}>
          {obj.name}
        </span>
        {animated && <I.IconClock size={12} className="muted" />}
        <button className="icon-btn" style={{ width: 20, height: 20 }} title={obj.visible ? "Hide" : "Show"} onClick={(e) => (e.stopPropagation(), useStudio.getState().update(obj.id, { visible: !obj.visible }))}>
          {obj.visible ? <I.IconEye size={12} /> : <I.IconEyeOff size={12} />}
        </button>
      </div>
      {children.map((c) => (
        <Row key={c.id} obj={c} depth={depth + 1} />
      ))}
    </>
  );
}

export function Outliner() {
  const roots = useStudio(useShallow((s) => s.doc.objects.filter((o) => !o.parentId || !s.doc.objects.some((p) => p.id === o.parentId))));
  return (
    <div style={{ padding: 6 }}>
      {roots.map((o) => (
        <Row key={o.id} obj={o} depth={0} />
      ))}
    </div>
  );
}
