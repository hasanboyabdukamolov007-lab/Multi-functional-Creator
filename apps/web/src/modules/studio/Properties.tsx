import { useStudio } from "./store";
import { ENVIRONMENTS, MATERIAL_PRESETS, PRIMITIVE_DEFAULTS, type SceneObject, type Vec3 } from "./model";
import { useT } from "../../lib/i18n";

function Num({ value, onChange, step = 0.1, min, max }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return <input className="input input-sm" type="number" step={step} min={min} max={max} value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0} onChange={(e) => onChange(Number(e.target.value))} />;
}

function Vec({ value, onChange, step }: { value: Vec3; onChange: (v: Vec3) => void; step?: number }) {
  return (
    <div className="vec3">
      {[0, 1, 2].map((i) => (
        <Num key={i} step={step} value={value[i]} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)) as Vec3)} />
      ))}
    </div>
  );
}

function Slider({ value, onChange, min = 0, max = 1, step = 0.01 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <input type="range" className="grow" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="small muted" style={{ width: 34, textAlign: "right" }}>{value.toFixed(2)}</span>
    </div>
  );
}

function SceneSettingsPanel() {
  const t = useT();
  const s = useStudio((x) => x.doc.settings);
  const set = useStudio.getState().setSettings;
  return (
    <div style={{ padding: 12 }}>
      <div className="section-label">{t("studio.scene")}</div>
      <div className="prop-grid">
        <label>Background</label>
        <input className="color-input" type="color" value={s.background} onChange={(e) => set({ background: e.target.value })} />
        <label>Environment</label>
        <select className="select input-sm" value={s.environment} onChange={(e) => set({ environment: e.target.value as never })}>
          {ENVIRONMENTS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <label>Env intensity</label>
        <Slider value={s.envIntensity} max={3} onChange={(v) => set({ envIntensity: v })} />
        <label>Grid</label>
        <input type="checkbox" checked={s.showGrid} onChange={(e) => set({ showGrid: e.target.checked })} />
        <label>Axes</label>
        <input type="checkbox" checked={s.showAxes} onChange={(e) => set({ showAxes: e.target.checked })} />
        <label>Shadows</label>
        <input type="checkbox" checked={s.shadows} onChange={(e) => set({ shadows: e.target.checked })} />
        <label>Fog</label>
        <input type="checkbox" checked={s.fog} onChange={(e) => set({ fog: e.target.checked })} />
        <label>Duration (s)</label>
        <Num value={s.duration} step={0.5} min={0.5} onChange={(v) => set({ duration: Math.max(0.5, v) })} />
        <label>Loop</label>
        <input type="checkbox" checked={s.loop} onChange={(e) => set({ loop: e.target.checked })} />
      </div>
      <p className="hint" style={{ marginTop: 12 }}>{t("studio.noSelection")}</p>
    </div>
  );
}

export function Properties() {
  const t = useT();
  const obj = useStudio((s) => s.selected());
  if (!obj) return <SceneSettingsPanel />;
  const up = (p: Partial<SceneObject>, key?: string) => useStudio.getState().update(obj.id, p, key ?? `${obj.id}:${Object.keys(p).join(",")}`);
  const g = obj.geometry;
  return (
    <div style={{ padding: 12 }}>
      <input className="input" value={obj.name} onChange={(e) => up({ name: e.target.value })} aria-label="Name" />
      <div className="section-label">{t("studio.transform")}</div>
      <div className="prop-grid">
        <label>Position</label>
        <Vec value={obj.position} onChange={(v) => up({ position: v })} />
        <label>Rotation °</label>
        <Vec value={obj.rotation} step={5} onChange={(v) => up({ rotation: v })} />
        <label>Scale</label>
        <Vec value={obj.scale} onChange={(v) => up({ scale: v })} />
        <label>Visible</label>
        <input type="checkbox" checked={obj.visible} onChange={(e) => up({ visible: e.target.checked })} />
        {obj.kind === "mesh" && (
          <>
            <label>Cast shadow</label>
            <input type="checkbox" checked={obj.castShadow} onChange={(e) => up({ castShadow: e.target.checked })} />
            <label>Receive shadow</label>
            <input type="checkbox" checked={obj.receiveShadow} onChange={(e) => up({ receiveShadow: e.target.checked })} />
          </>
        )}
      </div>

      {g && g.kind !== "model" && (
        <>
          <div className="section-label">{t("studio.geometry")}</div>
          <div className="prop-grid">
            {g.kind === "primitive" &&
              Object.keys(PRIMITIVE_DEFAULTS[g.type]).map((k) => (
                <div key={k} style={{ display: "contents" }}>
                  <label>{k}</label>
                  <Num value={g.params[k] ?? PRIMITIVE_DEFAULTS[g.type][k]} step={/segments|detail|^p$|^q$/i.test(k) ? 1 : 0.05} onChange={(v) => up({ geometry: { ...g, params: { ...g.params, [k]: v } } })} />
                </div>
              ))}
            {g.kind === "extrude" && (
              <>
                <label>Depth</label>
                <Num value={g.depth} step={0.05} onChange={(v) => up({ geometry: { ...g, depth: v } })} />
                <label>Bevel</label>
                <input type="checkbox" checked={g.bevel} onChange={(e) => up({ geometry: { ...g, bevel: e.target.checked } })} />
                <label>Bevel size</label>
                <Num value={g.bevelSize} step={0.01} onChange={(v) => up({ geometry: { ...g, bevelSize: v } })} />
                <label>Bevel thickness</label>
                <Num value={g.bevelThickness} step={0.01} onChange={(v) => up({ geometry: { ...g, bevelThickness: v } })} />
                <label>Bevel segments</label>
                <Num value={g.bevelSegments} step={1} onChange={(v) => up({ geometry: { ...g, bevelSegments: v } })} />
              </>
            )}
            <label>Subdivision</label>
            <select className="select input-sm" value={g.subdivision} onChange={(e) => up({ geometry: { ...g, subdivision: Number(e.target.value) } })}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "Off" : `Level ${n}`}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {obj.material && (
        <>
          <div className="section-label">{t("studio.material")}</div>
          <select className="select input-sm" style={{ marginBottom: 8 }} value="" onChange={(e) => e.target.value && up({ material: { ...obj.material!, ...MATERIAL_PRESETS[e.target.value].m } })}>
            <option value="">Apply preset…</option>
            {Object.entries(MATERIAL_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name}
              </option>
            ))}
          </select>
          <div className="prop-grid">
            <label>Color</label>
            <input className="color-input" type="color" value={obj.material.color} onChange={(e) => up({ material: { ...obj.material!, color: e.target.value } })} />
            <label>Metalness</label>
            <Slider value={obj.material.metalness} onChange={(v) => up({ material: { ...obj.material!, metalness: v } })} />
            <label>Roughness</label>
            <Slider value={obj.material.roughness} onChange={(v) => up({ material: { ...obj.material!, roughness: v } })} />
            <label>Clearcoat</label>
            <Slider value={obj.material.clearcoat} onChange={(v) => up({ material: { ...obj.material!, clearcoat: v } })} />
            <label>Transmission</label>
            <Slider value={obj.material.transmission} onChange={(v) => up({ material: { ...obj.material!, transmission: v } })} />
            <label>Opacity</label>
            <Slider value={obj.material.opacity} onChange={(v) => up({ material: { ...obj.material!, opacity: v } })} />
            <label>Emissive</label>
            <input className="color-input" type="color" value={obj.material.emissive} onChange={(e) => up({ material: { ...obj.material!, emissive: e.target.value } })} />
            <label>Glow</label>
            <Slider value={obj.material.emissiveIntensity} max={5} onChange={(v) => up({ material: { ...obj.material!, emissiveIntensity: v } })} />
            <label>Wireframe</label>
            <input type="checkbox" checked={obj.material.wireframe} onChange={(e) => up({ material: { ...obj.material!, wireframe: e.target.checked } })} />
            <label>Flat shading</label>
            <input type="checkbox" checked={obj.material.flatShading} onChange={(e) => up({ material: { ...obj.material!, flatShading: e.target.checked } })} />
          </div>
        </>
      )}

      {obj.light && (
        <>
          <div className="section-label">{t("studio.light")}</div>
          <div className="prop-grid">
            <label>Color</label>
            <input className="color-input" type="color" value={obj.light.color} onChange={(e) => up({ light: { ...obj.light!, color: e.target.value } })} />
            {obj.light.type === "hemisphere" && (
              <>
                <label>Ground color</label>
                <input className="color-input" type="color" value={obj.light.groundColor} onChange={(e) => up({ light: { ...obj.light!, groundColor: e.target.value } })} />
              </>
            )}
            <label>Intensity</label>
            <Num value={obj.light.intensity} step={0.1} min={0} onChange={(v) => up({ light: { ...obj.light!, intensity: v } })} />
            {obj.light.type === "spot" && (
              <>
                <label>Angle °</label>
                <Num value={obj.light.angle} step={1} min={1} max={89} onChange={(v) => up({ light: { ...obj.light!, angle: v } })} />
                <label>Penumbra</label>
                <Slider value={obj.light.penumbra} onChange={(v) => up({ light: { ...obj.light!, penumbra: v } })} />
              </>
            )}
            {(obj.light.type === "directional" || obj.light.type === "spot" || obj.light.type === "point") && (
              <>
                <label>Cast shadow</label>
                <input type="checkbox" checked={obj.castShadow} onChange={(e) => up({ castShadow: e.target.checked })} />
              </>
            )}
          </div>
        </>
      )}

      {obj.camera && (
        <>
          <div className="section-label">Camera</div>
          <div className="prop-grid">
            <label>FOV °</label>
            <Num value={obj.camera.fov} step={1} min={10} max={120} onChange={(v) => up({ camera: { fov: v } })} />
          </div>
        </>
      )}
    </div>
  );
}
