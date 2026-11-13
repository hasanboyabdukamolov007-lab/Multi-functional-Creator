import * as THREE from "three";
import type { Asset } from "./model";
import { downloadBlob, downloadText, slugify } from "../../lib/download";

/** Live three.js objects by scene object id (filled by the viewport). */
export const objectRefs = new Map<string, THREE.Object3D>();
/** Root group that contains only scene content (no editor helpers). */
export const sceneRoot: { current: THREE.Group | null } = { current: null };
/** Id of the object currently being dragged by the gizmo (animation is not applied to it). */
export const dragging: { id: string | null } = { id: null };

export const MAX_MODEL_BYTES = 15 * 1024 * 1024;
const FORMATS: Record<string, Asset["format"]> = { gltf: "gltf", glb: "glb", obj: "obj", fbx: "fbx", stl: "stl" };

const cache = new Map<string, Promise<THREE.Object3D>>();

async function bufferOf(dataUrl: string): Promise<ArrayBuffer> {
  return (await fetch(dataUrl)).arrayBuffer();
}

export function loadAsset(id: string, asset: Asset): Promise<THREE.Object3D> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const buf = await bufferOf(asset.dataUrl);
      switch (asset.format) {
        case "gltf":
        case "glb": {
          const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
          const gltf = await new GLTFLoader().parseAsync(buf, "");
          return gltf.scene;
        }
        case "obj": {
          const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
          return new OBJLoader().parse(new TextDecoder().decode(buf));
        }
        case "fbx": {
          const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
          return new FBXLoader().parse(buf, "");
        }
        case "stl": {
          const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
          const geo = new STLLoader().parse(buf);
          geo.computeVertexNormals();
          return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#b9bfcc", roughness: 0.5, metalness: 0.1 }));
        }
      }
    })().then((obj) => {
      // Normalise size so imports land at a sensible scale (~2 units) and sit on the floor.
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      const s = 2 / size;
      const wrapper = new THREE.Group();
      obj.scale.multiplyScalar(s);
      obj.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(s));
      obj.position.y += (box.getSize(new THREE.Vector3()).y * s) / 2;
      obj.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      wrapper.add(obj);
      return wrapper;
    });
    cache.set(id, p);
  }
  return p;
}

export async function readModelFile(file: File): Promise<Asset> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const format = FORMATS[ext];
  if (!format) throw new Error(`Unsupported format .${ext} — use GLB, GLTF (embedded), OBJ, FBX or STL`);
  if (file.size > MAX_MODEL_BYTES) throw new Error(`Model is ${(file.size / 1048576).toFixed(1)} MB; the limit is 15 MB until the asset manager ships`);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return { name: file.name.replace(/\.[^.]+$/, ""), format, dataUrl };
}

function cleanClone(): THREE.Object3D {
  if (!sceneRoot.current) throw new Error("Open the 3D Studio to export");
  const clone = sceneRoot.current.clone(true);
  const doomed: THREE.Object3D[] = [];
  clone.traverse((o) => {
    if (o.userData.editorOnly) doomed.push(o);
  });
  doomed.forEach((o) => o.removeFromParent());
  return clone;
}

export async function exportScene(format: "gltf" | "glb" | "obj" | "stl", name: string) {
  const root = cleanClone();
  const base = slugify(name);
  if (format === "gltf" || format === "glb") {
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const result = await new GLTFExporter().parseAsync(root, { binary: format === "glb", onlyVisible: true });
    if (format === "glb") downloadBlob(`${base}.glb`, new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }));
    else downloadText(`${base}.gltf`, JSON.stringify(result, null, 2), "model/gltf+json");
  } else if (format === "obj") {
    const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js");
    downloadText(`${base}.obj`, new OBJExporter().parse(root), "text/plain");
  } else {
    const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
    const out = new STLExporter().parse(root, { binary: true }) as DataView;
    downloadBlob(`${base}.stl`, new Blob([out.buffer as ArrayBuffer], { type: "model/stl" }));
  }
}

export function snapshotPng(name: string) {
  const canvas = document.querySelector<HTMLCanvasElement>(".studio-viewport canvas");
  if (!canvas) throw new Error("Viewport not visible");
  canvas.toBlob((b) => b && downloadBlob(`${slugify(name)}.png`, b), "image/png");
}
