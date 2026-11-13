import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, GizmoHelper, GizmoViewport, Grid, Lightformer, OrbitControls, Stats, TransformControls } from "@react-three/drei";
import { useShallow } from "zustand/react/shallow";
import { useStudio } from "./store";
import { buildGeometry } from "./geometry";
import { sampleTrack } from "./animation";
import { dragging, loadAsset, objectRefs, sceneRoot } from "./io";
import type { EnvironmentPreset, GeometrySpec, MaterialSpec, SceneObject } from "./model";

const D2R = Math.PI / 180;
const toRad = (v: [number, number, number]) => v.map((x) => x * D2R) as [number, number, number];

function useRegister(id: string, ref: React.RefObject<THREE.Object3D | null>) {
  useEffect(() => {
    if (ref.current) objectRefs.set(id, ref.current);
    return () => {
      objectRefs.delete(id);
    };
  });
}

function Geometry({ spec }: { spec: GeometrySpec }) {
  const key = JSON.stringify(spec);
  const geo = useMemo(() => buildGeometry(spec), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geo.dispose(), [geo]);
  return <primitive object={geo} attach="geometry" />;
}

function Material({ m, doubleSided }: { m: MaterialSpec; doubleSided: boolean }) {
  return (
    <meshPhysicalMaterial
      key={m.flatShading ? "flat" : "smooth"}
      color={m.color}
      metalness={m.metalness}
      roughness={m.roughness}
      emissive={m.emissive}
      emissiveIntensity={m.emissiveIntensity}
      transparent={m.opacity < 1}
      opacity={m.opacity}
      transmission={m.transmission}
      thickness={m.transmission > 0 ? 0.6 : 0}
      clearcoat={m.clearcoat}
      wireframe={m.wireframe}
      flatShading={m.flatShading}
      side={doubleSided ? THREE.DoubleSide : THREE.FrontSide}
    />
  );
}

function ModelInstance({ assetId }: { assetId: string }) {
  const asset = useStudio((s) => s.assets[assetId]);
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    let alive = true;
    if (asset) loadAsset(assetId, asset).then((o) => alive && setObj(o.clone(true))).catch(() => setObj(null));
    return () => {
      alive = false;
    };
  }, [assetId, asset]);
  if (!asset) return null;
  return obj ? <primitive object={obj} /> : null;
}

function SceneNode({ obj }: { obj: SceneObject }) {
  const childIds = useStudio(useShallow((s) => s.doc.objects.filter((o) => o.parentId === obj.id).map((o) => o.id)));
  const select = useStudio((s) => s.select);
  const ref = useRef<THREE.Object3D>(null);
  useRegister(obj.id, ref);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(obj.id);
  };
  const common = { name: obj.name, position: obj.position, rotation: toRad(obj.rotation), scale: obj.scale, visible: obj.visible, userData: { id: obj.id } };
  const children = childIds.map((id) => <ChildNode key={id} id={id} />);

  if (obj.kind === "mesh" && obj.geometry?.kind === "model") {
    return (
      <group ref={ref as React.RefObject<THREE.Group>} {...common} onClick={onClick}>
        <Suspense fallback={null}>
          <ModelInstance assetId={obj.geometry.assetId} />
        </Suspense>
        {children}
      </group>
    );
  }
  if (obj.kind === "mesh" && obj.geometry && obj.material) {
    const flat = obj.geometry.kind === "primitive" && ["plane", "circle", "ring"].includes(obj.geometry.type);
    return (
      <mesh ref={ref as React.RefObject<THREE.Mesh>} {...common} castShadow={obj.castShadow} receiveShadow={obj.receiveShadow} onClick={onClick}>
        <Geometry spec={obj.geometry} />
        <Material m={obj.material} doubleSided={flat} />
        {children}
      </mesh>
    );
  }
  if (obj.kind === "light" && obj.light) {
    const l = obj.light;
    return (
      <group ref={ref as React.RefObject<THREE.Group>} {...common}>
        {l.type === "ambient" && <ambientLight color={l.color} intensity={l.intensity} />}
        {l.type === "hemisphere" && <hemisphereLight args={[l.color, l.groundColor, l.intensity]} />}
        {l.type === "directional" && <directionalLight color={l.color} intensity={l.intensity} castShadow={obj.castShadow} shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-bias={-0.0004} />}
        {l.type === "point" && <pointLight color={l.color} intensity={l.intensity} distance={l.distance} castShadow={obj.castShadow} />}
        {l.type === "spot" && <spotLight color={l.color} intensity={l.intensity} distance={l.distance} angle={l.angle * D2R} penumbra={l.penumbra} castShadow={obj.castShadow} shadow-mapSize={[1024, 1024]} />}
        <mesh userData={{ editorOnly: true }} onClick={onClick}>
          <sphereGeometry args={[0.12, 16, 12]} />
          <meshBasicMaterial color={l.color} wireframe />
        </mesh>
        {children}
      </group>
    );
  }
  if (obj.kind === "camera") {
    return (
      <group ref={ref as React.RefObject<THREE.Group>} {...common}>
        <mesh userData={{ editorOnly: true }} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
          <coneGeometry args={[0.25, 0.45, 4]} />
          <meshBasicMaterial color="#ffd400" wireframe />
        </mesh>
        {children}
      </group>
    );
  }
  return (
    <group ref={ref as React.RefObject<THREE.Group>} {...common} onClick={onClick}>
      {children}
    </group>
  );
}

function ChildNode({ id }: { id: string }) {
  const obj = useStudio((s) => s.doc.objects.find((o) => o.id === id));
  return obj ? <SceneNode obj={obj} /> : null;
}

function SceneContent() {
  const rootIds = useStudio(useShallow((s) => s.doc.objects.filter((o) => !o.parentId || !s.doc.objects.some((p) => p.id === o.parentId)).map((o) => o.id)));
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    sceneRoot.current = group.current;
    return () => {
      sceneRoot.current = null;
    };
  }, []);
  return (
    <group ref={group} name="Scene">
      {rootIds.map((id) => (
        <ChildNode key={id} id={id} />
      ))}
    </group>
  );
}

function SelectionGizmo() {
  const { selectedId, gizmo, space, snap, playing, doc } = useStudio(useShallow((s) => ({ selectedId: s.selectedId, gizmo: s.gizmo, space: s.space, snap: s.snap, playing: s.playing, doc: s.doc })));
  const [target, setTarget] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    setTarget(selectedId ? objectRefs.get(selectedId) ?? null : null);
  }, [selectedId, doc]);
  if (!target || playing || !selectedId) return null;
  const commit = () => {
    const st = useStudio.getState();
    const id = st.selectedId;
    if (!id) return;
    const r = target.rotation;
    st.update(id, {
      position: [target.position.x, target.position.y, target.position.z].map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
      rotation: [r.x, r.y, r.z].map((v) => Math.round((v / D2R) * 100) / 100) as [number, number, number],
      scale: [target.scale.x, target.scale.y, target.scale.z].map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
    });
  };
  return (
    <TransformControls
      object={target}
      mode={gizmo}
      space={space}
      translationSnap={snap ? 0.25 : null}
      rotationSnap={snap ? 15 * D2R : null}
      scaleSnap={snap ? 0.1 : null}
      onMouseDown={() => (dragging.id = selectedId)}
      onMouseUp={() => {
        dragging.id = null;
        commit();
      }}
    />
  );
}

function Animator() {
  useFrame((_, delta) => {
    const st = useStudio.getState();
    const { duration, loop } = st.doc.settings;
    if (st.playing) {
      let t = st.time + Math.min(delta, 0.1);
      if (t >= duration) {
        if (loop) t = t % Math.max(duration, 0.001);
        else {
          t = duration;
          st.setPlaying(false);
        }
      }
      st.setTime(t);
    }
    for (const tr of st.doc.tracks) {
      if (tr.objectId === dragging.id) continue;
      const o = objectRefs.get(tr.objectId);
      const v = sampleTrack(tr, st.time);
      if (!o || !v) continue;
      if (tr.property === "position") o.position.set(v[0], v[1], v[2]);
      else if (tr.property === "rotation") o.rotation.set(v[0] * D2R, v[1] * D2R, v[2] * D2R);
      else if (tr.property === "scale") o.scale.set(v[0], v[1], v[2]);
      else if (tr.property === "opacity")
        o.traverse((c) => {
          const m = (c as THREE.Mesh).material as THREE.Material | undefined;
          if (m && !c.userData.editorOnly) {
            m.transparent = v[0] < 1;
            m.opacity = v[0];
          }
        });
    }
  });
  return null;
}

function CameraRig() {
  const req = useStudio((s) => s.cameraRequest);
  const { camera, controls } = useThree();
  useEffect(() => {
    if (!req) return;
    const ctl = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (req.frameSelected) {
      const id = useStudio.getState().selectedId;
      const obj = id ? objectRefs.get(id) : sceneRoot.current;
      if (!obj) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) box.setFromCenterAndSize(obj.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(1, 1, 1));
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      const dir = camera.position.clone().sub(ctl?.target ?? new THREE.Vector3()).normalize();
      camera.position.copy(center.clone().add(dir.multiplyScalar(Math.max(1.5, size * 1.4))));
      ctl?.target.copy(center);
    } else {
      if (req.position) camera.position.set(...req.position);
      if (req.target) ctl?.target.set(...req.target);
    }
    camera.lookAt(ctl?.target ?? new THREE.Vector3());
    ctl?.update();
  }, [req, camera, controls]);
  return null;
}

function SceneEnvironment({ preset, intensity }: { preset: EnvironmentPreset; intensity: number }) {
  if (preset === "none") return null;
  return (
    <Environment resolution={256} environmentIntensity={intensity} frames={1}>
      {preset === "studio" && (
        <>
          <Lightformer form="rect" intensity={4} position={[0, 5, -5]} scale={[10, 3, 1]} />
          <Lightformer form="rect" intensity={2} position={[-5, 2, 1]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} />
          <Lightformer form="rect" intensity={2} position={[5, 2, 1]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
          <Lightformer form="circle" intensity={3} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={4} />
        </>
      )}
      {preset === "sunset" && (
        <>
          <color attach="background" args={["#2a1424"]} />
          <Lightformer form="rect" intensity={6} color="#ff9a4d" position={[0, 1, -8]} scale={[20, 3, 1]} />
          <Lightformer form="rect" intensity={1.5} color="#7a5cff" position={[0, 6, 4]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
        </>
      )}
      {preset === "night" && (
        <>
          <color attach="background" args={["#05070f"]} />
          <Lightformer form="circle" intensity={2} color="#8fb6ff" position={[3, 6, -4]} scale={2} />
          <Lightformer form="rect" intensity={0.6} color="#3550a0" position={[0, 4, 6]} scale={[10, 4, 1]} />
        </>
      )}
      {preset === "warehouse" && (
        <>
          {[-4, 0, 4].map((x) => (
            <Lightformer key={x} form="rect" intensity={3} position={[x, 6, 0]} rotation-x={Math.PI / 2} scale={[1, 10, 1]} />
          ))}
          <Lightformer form="rect" intensity={1} color="#ffe0b8" position={[0, 2, -8]} scale={[16, 4, 1]} />
        </>
      )}
    </Environment>
  );
}

export function Viewport() {
  const settings = useStudio((s) => s.doc.settings);
  const showStats = useStudio((s) => s.showStats);
  const select = useStudio((s) => s.select);
  return (
    <div className="studio-viewport" style={{ position: "absolute", inset: 0 }}>
      <Canvas shadows={settings.shadows} dpr={[1, 2]} camera={{ position: [5, 4, 7], fov: 45, near: 0.05, far: 500 }} gl={{ preserveDrawingBuffer: true, antialias: true }} onPointerMissed={(e) => e.type === "click" && select(null)}>
        <color attach="background" args={[settings.background]} />
        {settings.fog && <fog attach="fog" args={[settings.background, 8, 40]} />}
        <SceneEnvironment preset={settings.environment} intensity={settings.envIntensity} />
        <SceneContent />
        <SelectionGizmo />
        {settings.showGrid && <Grid infiniteGrid cellSize={0.5} sectionSize={2.5} cellColor="#3a3f52" sectionColor="#5b6280" fadeDistance={45} position={[0, 0.001, 0]} />}
        {settings.showAxes && <axesHelper args={[3]} />}
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <CameraRig />
        <Animator />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.9} />
        </GizmoHelper>
        {showStats && <Stats className="studio-stats" />}
      </Canvas>
    </div>
  );
}
