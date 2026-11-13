import * as THREE from "three";
import { LoopSubdivision } from "three-subdivide";
import type { GeometrySpec, ShapeType } from "./model";

function shapeFor(type: ShapeType): THREE.Shape {
  const s = new THREE.Shape();
  switch (type) {
    case "star": {
      const spikes = 5, outer = 0.8, inner = 0.36;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 ? inner : outer;
        const a = (i / (spikes * 2)) * Math.PI * 2 + Math.PI / 2;
        i === 0 ? s.moveTo(Math.cos(a) * r, Math.sin(a) * r) : s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      s.closePath();
      return s;
    }
    case "heart": {
      s.moveTo(0, -0.7);
      s.bezierCurveTo(-0.15, -0.55, -0.8, -0.2, -0.8, 0.2);
      s.bezierCurveTo(-0.8, 0.55, -0.5, 0.75, -0.25, 0.75);
      s.bezierCurveTo(-0.08, 0.75, 0, 0.62, 0, 0.5);
      s.bezierCurveTo(0, 0.62, 0.08, 0.75, 0.25, 0.75);
      s.bezierCurveTo(0.5, 0.75, 0.8, 0.55, 0.8, 0.2);
      s.bezierCurveTo(0.8, -0.2, 0.15, -0.55, 0, -0.7);
      return s;
    }
    case "hexagon": {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        i === 0 ? s.moveTo(Math.cos(a) * 0.8, Math.sin(a) * 0.8) : s.lineTo(Math.cos(a) * 0.8, Math.sin(a) * 0.8);
      }
      s.closePath();
      return s;
    }
    case "roundedRect": {
      const w = 1.4, h = 0.9, r = 0.2, x = -w / 2, y = -h / 2;
      s.moveTo(x + r, y);
      s.lineTo(x + w - r, y);
      s.quadraticCurveTo(x + w, y, x + w, y + r);
      s.lineTo(x + w, y + h - r);
      s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h);
      s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r);
      s.quadraticCurveTo(x, y, x + r, y);
      return s;
    }
    case "arrow": {
      s.moveTo(-0.8, -0.2);
      s.lineTo(0.2, -0.2);
      s.lineTo(0.2, -0.5);
      s.lineTo(0.8, 0);
      s.lineTo(0.2, 0.5);
      s.lineTo(0.2, 0.2);
      s.lineTo(-0.8, 0.2);
      s.closePath();
      return s;
    }
    case "gear": {
      const teeth = 12, outer = 0.8, inner = 0.64;
      for (let i = 0; i < teeth * 4; i++) {
        const r = i % 4 < 2 ? outer : inner;
        const a = (i / (teeth * 4)) * Math.PI * 2;
        i === 0 ? s.moveTo(Math.cos(a) * r, Math.sin(a) * r) : s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      s.closePath();
      const hole = new THREE.Path();
      hole.absarc(0, 0, 0.22, 0, Math.PI * 2, true);
      s.holes.push(hole);
      return s;
    }
  }
}

const P = (p: Record<string, number>, k: string, d: number) => (Number.isFinite(p[k]) ? p[k] : d);

export function buildGeometry(spec: GeometrySpec): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (spec.kind === "extrude") {
    g = new THREE.ExtrudeGeometry(shapeFor(spec.shape), {
      depth: Math.max(0.001, spec.depth),
      bevelEnabled: spec.bevel,
      bevelSize: spec.bevelSize,
      bevelThickness: spec.bevelThickness,
      bevelSegments: Math.max(1, Math.round(spec.bevelSegments)),
      curveSegments: 24,
    });
    g.center();
  } else if (spec.kind === "primitive") {
    const p = spec.params;
    switch (spec.type) {
      case "box": {
        const s = Math.max(1, Math.round(P(p, "segments", 1)));
        g = new THREE.BoxGeometry(P(p, "width", 1), P(p, "height", 1), P(p, "depth", 1), s, s, s);
        break;
      }
      case "sphere": g = new THREE.SphereGeometry(P(p, "radius", 0.6), Math.round(P(p, "widthSegments", 48)), Math.round(P(p, "heightSegments", 32))); break;
      case "cylinder": g = new THREE.CylinderGeometry(P(p, "radiusTop", 0.5), P(p, "radiusBottom", 0.5), P(p, "height", 1.2), Math.round(P(p, "radialSegments", 48))); break;
      case "cone": g = new THREE.ConeGeometry(P(p, "radius", 0.6), P(p, "height", 1.2), Math.round(P(p, "radialSegments", 48))); break;
      case "torus": g = new THREE.TorusGeometry(P(p, "radius", 0.6), P(p, "tube", 0.22), Math.round(P(p, "radialSegments", 32)), Math.round(P(p, "tubularSegments", 96))); break;
      case "torusKnot": g = new THREE.TorusKnotGeometry(P(p, "radius", 0.5), P(p, "tube", 0.16), Math.round(P(p, "tubularSegments", 160)), Math.round(P(p, "radialSegments", 24)), Math.round(P(p, "p", 2)), Math.round(P(p, "q", 3))); break;
      case "plane": {
        const s = Math.max(1, Math.round(P(p, "segments", 1)));
        g = new THREE.PlaneGeometry(P(p, "width", 2), P(p, "height", 2), s, s);
        break;
      }
      case "circle": g = new THREE.CircleGeometry(P(p, "radius", 0.8), Math.round(P(p, "segments", 64))); break;
      case "ring": g = new THREE.RingGeometry(P(p, "innerRadius", 0.4), P(p, "outerRadius", 0.8), Math.round(P(p, "segments", 64))); break;
      case "icosahedron": g = new THREE.IcosahedronGeometry(P(p, "radius", 0.7), Math.round(P(p, "detail", 0))); break;
      case "dodecahedron": g = new THREE.DodecahedronGeometry(P(p, "radius", 0.7), Math.round(P(p, "detail", 0))); break;
      case "octahedron": g = new THREE.OctahedronGeometry(P(p, "radius", 0.7), Math.round(P(p, "detail", 0))); break;
      case "tetrahedron": g = new THREE.TetrahedronGeometry(P(p, "radius", 0.8), Math.round(P(p, "detail", 0))); break;
      case "capsule": g = new THREE.CapsuleGeometry(P(p, "radius", 0.35), P(p, "length", 0.8), Math.round(P(p, "capSegments", 12)), Math.round(P(p, "radialSegments", 32))); break;
      default: g = new THREE.BoxGeometry(1, 1, 1);
    }
  } else {
    g = new THREE.BoxGeometry(1, 1, 1);
  }
  const level = "subdivision" in spec ? Math.max(0, Math.min(3, Math.round(spec.subdivision))) : 0;
  if (level > 0) {
    const sub = LoopSubdivision.modify(g, level, { split: true, uvSmooth: false, preserveEdges: false, maxTriangles: 400_000 });
    g.dispose();
    g = sub;
  }
  g.computeVertexNormals();
  return g;
}

export function triangleCount(g: THREE.BufferGeometry) {
  return Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
}
