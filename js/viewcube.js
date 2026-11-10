// ViewCube: a small labelled cube that mirrors the main camera orientation.
// Faces, edges and corners can be clicked (26 directions); arrows around
// the cube turn the view by 90° and roll it.
import * as THREE from 'three';
import { t as tr } from './i18n.js';

// BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z. The cube is built Y-up and
// rotated +90° about X so its +Y face becomes world +Z (Z-up like the model).
const FACES = [
  { label: 'RECHTS', n: [1, 0, 0] },
  { label: 'LINKS', n: [-1, 0, 0] },
  { label: 'OBEN', n: [0, 0, 1] },
  { label: 'UNTEN', n: [0, 0, -1] },
  { label: 'VORNE', n: [0, -1, 0] },
  { label: 'HINTEN', n: [0, 1, 0] },
];
const EDGE = 0.62; // outer band of each face = edge / corner region

function faceTexture(label, dark) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = dark ? '#3a434d' : '#f4f6f8';
  g.fillRect(0, 0, 128, 128);
  // the edge / corner bands, slightly darker
  const b = Math.round(((1 - EDGE) / 2) * 128);
  g.fillStyle = dark ? 'rgba(0,0,0,.12)' : 'rgba(0,0,0,.05)';
  g.fillRect(0, 0, 128, b); g.fillRect(0, 128 - b, 128, b); g.fillRect(0, b, b, 128 - 2 * b); g.fillRect(128 - b, b, b, 128 - 2 * b);
  g.strokeStyle = dark ? '#5d6976' : '#b5bec7';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 124, 124);
  g.fillStyle = dark ? '#e3e9ef' : '#3a4651';
  g.font = '600 22px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(tr(label), 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const AX = [0, 1, 2];
export class ViewCube {
  constructor(canvas, viewport, onPick) {
    this.canvas = canvas;
    this.vp = viewport;
    this.onPick = onPick;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth || 120, canvas.clientHeight || 120, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    this.camera.up.set(0, 0, 1);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1));
    this.hoverKey = '';
    this.dark = false;
    this.mats = FACES.map(f => new THREE.MeshBasicMaterial({ map: faceTexture(f.label, false) }));
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), this.mats);
    this.cube.rotation.x = Math.PI / 2;
    this.scene.add(this.cube);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.cube.geometry), new THREE.LineBasicMaterial({ color: 0x7b8794 }));
    edges.rotation.x = Math.PI / 2;
    this.scene.add(edges);
    this.edges = edges;
    // hover highlight (world-aligned quads on the hovered face cells)
    this.hl = new THREE.Group();
    this.hlMat = new THREE.MeshBasicMaterial({ color: 0x1e88ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false });
    this.scene.add(this.hl);
    // small axis tripod at the front-left-bottom corner
    const axis = (to, color) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.02, -1.02, -1.02), new THREE.Vector3(...to)]), new THREE.LineBasicMaterial({ color }));
    this.scene.add(axis([0.6, -1.02, -1.02], 0xd64545), axis([-1.02, 0.6, -1.02], 0x2f9e44), axis([-1.02, -1.02, 0.6], 0x1c6fd1));
    this.ray = new THREE.Raycaster();
    canvas.addEventListener('pointermove', e => this.pointer(e, false));
    canvas.addEventListener('pointerleave', () => this.setHover(null));
    canvas.addEventListener('click', e => this.pointer(e, true));
  }

  setTheme(dark) {
    this.dark = dark;
    this.mats.forEach((m, i) => { m.map.dispose(); m.map = faceTexture(FACES[i].label, dark); m.needsUpdate = true; });
    this.edges.material.color.set(dark ? 0x5d6976 : 0x9aa5b1);
  }

  // region under the mouse as a direction with components in {-1, 0, 1} (world, Z up)
  regionAt(hit) {
    const p = hit.point; // world coordinates (the cube is centred at the origin, size 2)
    const v = [p.x, p.y, p.z];
    const faceAxis = AX.reduce((a, i) => (Math.abs(v[i]) > Math.abs(v[a]) ? i : a), 0);
    return AX.map(i => (i === faceAxis || Math.abs(v[i]) > EDGE ? Math.sign(v[i]) : 0));
  }

  setHover(n) {
    const key = n ? n.join(',') : '';
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    for (const c of [...this.hl.children]) { this.hl.remove(c); c.geometry.dispose(); }
    this.canvas.style.cursor = n ? 'pointer' : 'default';
    if (!n) return;
    // every face whose normal is part of the region shows the matching 3×3 cell
    const lo = [-1, -EDGE, EDGE], hi = [-EDGE, EDGE, 1];
    for (let a = 0; a < 3; a++) {
      if (!n[a]) continue;
      const [b, c] = AX.filter(i => i !== a);
      const cb = n[b] + 1, cc = n[c] + 1;
      const w = hi[cb] - lo[cb], hgt = hi[cc] - lo[cc];
      const g = new THREE.PlaneGeometry(w, hgt);
      // plane lies in local XY; map local x→axis b, y→axis c, z→axis a
      const e = i => new THREE.Vector3(...AX.map(k => (k === i ? 1 : 0)));
      const m = new THREE.Matrix4().makeBasis(e(b), e(c), e(a).multiplyScalar(1));
      const ctr = new THREE.Vector3(...AX.map(k => (k === a ? n[a] * 1.012 : k === b ? (lo[cb] + hi[cb]) / 2 : (lo[cc] + hi[cc]) / 2)));
      g.applyMatrix4(m).translate(ctr.x, ctr.y, ctr.z);
      const q = new THREE.Mesh(g, this.hlMat);
      q.renderOrder = 5;
      this.hl.add(q);
    }
  }

  pointer(e, pick) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObject(this.cube)[0];
    const n = hit ? this.regionAt(hit) : null;
    this.setHover(n);
    if (pick && n) this.onPick(new THREE.Vector3(...n).normalize());
  }

  update() {
    const cam = this.vp.camera;
    const dir = cam.position.clone().sub(this.vp.controls.target).normalize();
    this.camera.position.copy(dir.multiplyScalar(7.5));
    this.camera.up.copy(cam.up);
    this.camera.lookAt(0, 0, 0);
    // keep the cube's screen orientation identical to the main view (top views: azimuth)
    this.camera.quaternion.copy(cam.quaternion);
    this.renderer.render(this.scene, this.camera);
  }
}
