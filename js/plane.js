// Sketch planes: origin o, in-plane x axis, normal n (y = n × x).
import * as THREE from 'three';

export const BASE_PLANES = {
  XY: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 0, 1] },
  XZ: { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] },
  YZ: { o: [0, 0, 0], x: [0, 1, 0], n: [1, 0, 0] },
};

export function sketchPlane(sk) {
  if (sk.plane) return sk.plane;
  return { o: [0, 0, +sk.z || 0], x: [1, 0, 0], n: [0, 0, 1] }; // legacy XY sketches
}

export function basis(sk) {
  const p = sketchPlane(sk);
  const o = new THREE.Vector3(...p.o), x = new THREE.Vector3(...p.x).normalize(), n = new THREE.Vector3(...p.n).normalize();
  const y = new THREE.Vector3().crossVectors(n, x).normalize();
  return { o, x, y, n };
}

export function planeMatrix(sk) {
  const { o, x, y, n } = basis(sk);
  return new THREE.Matrix4().makeBasis(x, y, n).setPosition(o);
}

export const toWorld = (b, u, v, w = 0) => b.o.clone().addScaledVector(b.x, u).addScaledVector(b.y, v).addScaledVector(b.n, w);
export const toLocal = (b, p) => { const d = p.clone().sub(b.o); return [d.dot(b.x), d.dot(b.y)]; };

// A sketch is usable for 2.5D CAM when its plane is parallel to XY.
export function isHorizontal(sk) {
  const n = sketchPlane(sk).n;
  return Math.abs(Math.abs(n[2]) - 1) < 1e-6;
}

export function planeFromFace(point, normal) {
  const n = normal.clone().normalize();
  const x = Math.abs(n.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1).cross(n).normalize();
  const o = n.clone().multiplyScalar(n.dot(point));
  const r = v => v.toArray().map(c => +c.toFixed(6) + 0);
  return { o: r(o), x: r(x), n: r(n) };
}

export function planeLabel(sk) {
  const p = sketchPlane(sk);
  const n = p.n.map(v => Math.round(v * 1000) / 1000);
  const off = +new THREE.Vector3(...p.o).dot(new THREE.Vector3(...p.n)).toFixed(3);
  if (n[2] === 1) return `XY, Z=${off}`;
  if (n[2] === -1) return `XY (unten), Z=${-off}`;
  if (n[1] === -1) return `XZ, Y=${-off}`;
  if (n[1] === 1) return `XZ (hinten), Y=${off}`;
  if (n[0] === 1) return `YZ, X=${off}`;
  if (n[0] === -1) return `YZ (links), X=${-off}`;
  return 'Fläche';
}

// Signed offset of the plane along its normal; editing it moves the plane.
export const planeOffset = sk => { const p = sketchPlane(sk); return p.o[0] * p.n[0] + p.o[1] * p.n[1] + p.o[2] * p.n[2]; };
export function withOffset(plane, off) {
  const n = plane.n;
  return { ...plane, o: n.map(c => +(c * off).toFixed(6) + 0) };
}

// ---------- construction planes (Fusion: Versatzebene, Ebene unter Winkel, Mittelebene) ----------
// A reference is a base plane name, a construction plane feature id or a sketch id.
export function planeRef(ref, features, depth = 0) {
  if (BASE_PLANES[ref]) return BASE_PLANES[ref];
  const f = features.find(x => x.id === ref);
  if (!f || depth > 20) return null;
  if (f.type === 'sketch') return sketchPlane(f);
  if (f.type === 'plane') return constructionPlane(f, features, depth + 1);
  return null;
}

const v3 = a => new THREE.Vector3(...a.map(Number));
const out = v => v.toArray().map(c => +c.toFixed(6) + 0);

export function constructionPlane(f, features, depth = 0) {
  if (f.kind === '3pt') {
    // plane through three points: origin at the first, x towards the second
    const P = (f.pts || []).filter(q => Array.isArray(q) && q.length === 3).map(v3);
    if (P.length < 3) return null;
    const u = P[1].clone().sub(P[0]), w = P[2].clone().sub(P[0]);
    const n3 = new THREE.Vector3().crossVectors(u, w);
    if (u.lengthSq() < 1e-12 || n3.lengthSq() < 1e-12) return null; // points coincide or lie on one line
    return { o: out(P[0]), x: out(u.normalize()), n: out(n3.normalize()) };
  }
  const A = planeRef(f.base || 'XY', features, depth);
  if (!A) return null;
  const o = v3(A.o), x = v3(A.x).normalize(), n = v3(A.n).normalize();
  if (f.kind === 'tangent') {
    // tangent to a cylinder: like a plane at an angle through the cylinder axis, moved out by the radius
    const P = (f.pts || []).filter(q => Array.isArray(q) && q.length === 3).map(v3);
    if (P.length < 2 || !(+f.r > 0)) return null;
    const ad = P[1].clone().sub(P[0]);
    if (ad.lengthSq() < 1e-12) return null;
    ad.normalize();
    let n0 = n.clone().addScaledVector(ad, -n.dot(ad));
    if (n0.lengthSq() < 1e-9) n0 = new THREE.Vector3().crossVectors(ad, Math.abs(ad.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
    n0.normalize().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(ad, (+f.angle || 0) * Math.PI / 180));
    return { o: out(P[0].clone().addScaledVector(n0, +f.r)), x: out(ad), n: out(n0) };
  }
  if (f.kind === 'angle' && f.axisRef) {
    // rotate the reference plane about a construction axis (Fusion: plane at an angle to a line)
    const ax = axisRef(f.axisRef, features, depth + 1);
    if (!ax) return null;
    // like Fusion the plane contains the axis: start from the reference plane's orientation, tilted so the
    // axis lies in it, then turn it about the axis by the angle
    const ao = v3(ax.o), ad = v3(ax.d).normalize();
    let n0 = n.clone().addScaledVector(ad, -n.dot(ad));
    if (n0.lengthSq() < 1e-9) n0 = new THREE.Vector3().crossVectors(ad, Math.abs(ad.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
    n0.normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(ad, (+f.angle || 0) * Math.PI / 180);
    return { o: out(ao), x: out(ad.clone()), n: out(n0.applyQuaternion(q)) };
  }
  if (f.kind === 'angle') {
    const y = new THREE.Vector3().crossVectors(n, x);
    const axis = f.axis === 'y' ? y : x;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, (+f.angle || 0) * Math.PI / 180);
    return { o: out(o), x: out(x.clone().applyQuaternion(q)), n: out(n.clone().applyQuaternion(q)) };
  }
  if (f.kind === 'mid') {
    const B = planeRef(f.base2 || 'XY', features, depth);
    if (!B) return null;
    const nb = v3(B.n).normalize();
    const d = v3(B.o).sub(o).dot(n) / 2;
    // parallel planes: halfway between; otherwise the bisecting plane through the midpoint
    if (Math.abs(Math.abs(nb.dot(n)) - 1) < 1e-6) return { o: out(o.clone().addScaledVector(n, d)), x: out(x), n: out(n) };
    const nm = n.clone().add(nb.dot(n) < 0 ? nb.clone().negate() : nb).normalize();
    const xm = new THREE.Vector3().crossVectors(nm, new THREE.Vector3().crossVectors(x, nm)).normalize();
    return { o: out(o.clone().add(v3(B.o)).multiplyScalar(0.5)), x: out(xm.lengthSq() > 0.5 ? xm : x), n: out(nm) };
  }
  return { o: out(o.clone().addScaledVector(n, +f.offset || 0)), x: out(x), n: out(n) };
}

// ---------- construction axes (Fusion: Achse durch zwei Punkte / Zylinder / Schnitt zweier Ebenen) ----------
// An axis is { o: point on it, d: unit direction }. References: 'X', 'Y', 'Z' (origin axes) or an axis feature id.
export const BASE_AXES = {
  X: { o: [0, 0, 0], d: [1, 0, 0] },
  Y: { o: [0, 0, 0], d: [0, 1, 0] },
  Z: { o: [0, 0, 0], d: [0, 0, 1] },
};
export function axisRef(ref, features, depth = 0) {
  if (BASE_AXES[ref]) return BASE_AXES[ref];
  const f = features.find(x => x.id === ref);
  if (!f || f.type !== 'axis' || depth > 20) return null;
  return constructionAxis(f, features, depth + 1);
}
export function constructionAxis(f, features, depth = 0) {
  if (f.kind === 'planes') {
    const A = planeRef(f.base || 'XY', features, depth), B = planeRef(f.base2 || 'XZ', features, depth);
    if (!A || !B) return null;
    const na = v3(A.n).normalize(), nb = v3(B.n).normalize();
    const d = new THREE.Vector3().crossVectors(na, nb);
    if (d.lengthSq() < 1e-12) return null; // parallel planes
    const da = na.dot(v3(A.o)), db = nb.dot(v3(B.o));
    const p = new THREE.Vector3().crossVectors(nb, d).multiplyScalar(da).add(new THREE.Vector3().crossVectors(d, na).multiplyScalar(db)).divideScalar(d.lengthSq());
    return { o: out(p), d: out(d.normalize()) };
  }
  // two points (also the stored ends of an axis through a cylinder)
  const P = (f.pts || []).filter(q => Array.isArray(q) && q.length === 3).map(v3);
  if (P.length < 2) return null;
  const d = P[1].clone().sub(P[0]);
  if (d.lengthSq() < 1e-12) return null;
  const len = d.length();
  return { o: out(P[0]), d: out(d.normalize()), len };
}
