// three.js scene, Z-up camera, orbit controls and picking helpers.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

const VIEWS = {
  top: [0, -0.001, 1],
  front: [0, -1, 0],
  right: [1, 0, 0],
  iso: [1, -1.2, 0.9],
};

// A small light studio rendered into an environment map: a grey room with bright softboxes
// above and to the sides. Only reflections use it (scene.environment), the background stays as is.
function studioEnvironment(renderer) {
  const room = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const walls = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x8a939c, side: THREE.BackSide }));
  walls.scale.set(20, 20, 14);
  walls.position.z = 3;
  room.add(walls);
  const floor = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x4d555d }));
  floor.scale.set(20, 20, 0.2);
  floor.position.z = -3.8;
  room.add(floor);
  const panel = (w, h, x, y, z, rx, ry, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    room.add(m);
  };
  panel(9, 5, 0, 0, 9.5, 0, 0, 5.5);                    // large softbox overhead
  panel(5, 6, -9.5, -3, 3, 0, Math.PI / 2, 3.2);        // left strip
  panel(5, 6, 9.5, 3, 3, 0, Math.PI / 2, 2.4);          // right strip
  panel(10, 3, 0, -9.5, 4, Math.PI / 2, 0, 2.0);        // front fill
  panel(6, 2, 0, 9.5, 6, Math.PI / 2, 0, 3.8);          // rim light behind
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(room, 0.03).texture;
  pm.dispose();
  room.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  return tex;
}

export class Viewport {
  constructor(container) {
    this.el = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true; // section analysis
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    // HTML labels (sketch dimensions, constraint glyphs) on top of the canvas
    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 50000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(180, -240, 200);
    this.scene.add(this.camera);
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(0.4, 0.7, 1);
    this.camera.add(key);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5d6b78, 0.75));
    // studio reflections: bodies mirror soft light panels (glossy, metallic look)
    this.scene.environment = studioEnvironment(this.renderer);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.18;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    // Fusion "Freie Orbitbewegung": the part turns in every direction (over the top, upside down).
    // OrbitControls keeps panning/zooming; its own rotation is switched off (rotateSpeed 0) and replaced here.
    this.orbitMode = 'free';
    this.orbitSpeed = 1;
    this.initFreeOrbit();

    this.grid = new THREE.GridHelper(600, 60, 0xb4bfca, 0xd5dce3);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.8;
    this.scene.add(this.grid);
    this.axesGroup = this.axes();
    this.scene.add(this.axesGroup);

    for (const name of ['model', 'sketches', 'paths', 'overlay', 'sim']) {
      this[name] = new THREE.Group();
      this.scene.add(this[name]);
    }

    this.raycaster = new THREE.Raycaster();
    this.onFrame = null;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.controls.update();
      if (this.onFrame) this.onFrame(dt);
      // the RENDERN workspace draws its own (accumulated) image
      if (this.renderHook) this.renderHook(); else this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // the rotate gesture of the current mouse layout (same rules as OrbitControls: a modifier swaps rotate and pan)
  isRotateGesture(e) {
    const mb = this.controls.mouseButtons, act = [mb.LEFT, mb.MIDDLE, mb.RIGHT][e.button];
    const mod = e.ctrlKey || e.metaKey || e.shiftKey;
    return act === THREE.MOUSE.ROTATE ? !mod : act === THREE.MOUSE.PAN ? mod : false;
  }

  initFreeOrbit() {
    let drag = null;
    const move = e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (!dx && !dy) return;
      this.orbitBy(dx, dy);
    };
    const up = () => { drag = null; removeEventListener('pointermove', move, true); removeEventListener('pointerup', up, true); };
    this.canvas.addEventListener('pointerdown', e => {
      if (this.orbitMode !== 'free' || this.controls.enableRotate === false || !this.isRotateGesture(e)) return;
      this.anim = null;
      drag = { x: e.clientX, y: e.clientY };
      addEventListener('pointermove', move, true);
      addEventListener('pointerup', up, true);
    });
  }

  // turn the camera around the target by a mouse movement, about the screen axes (no fixed "up")
  orbitBy(dx, dy) {
    const cam = this.camera, t = this.controls.target, h = this.el.clientHeight || 600, k = (2 * Math.PI * (this.orbitSpeed || 1)) / h;
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const upS = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(upS, -k * dx).multiply(new THREE.Quaternion().setFromAxisAngle(right, -k * dy));
    const off = cam.position.clone().sub(t).applyQuaternion(q);
    cam.up.copy(upS.applyQuaternion(q)).normalize();
    cam.position.copy(t).add(off);
    cam.lookAt(t);
  }

  setOrbitMode(mode) {
    this.orbitMode = mode === 'constrained' ? 'constrained' : 'free';
    this.controls.rotateSpeed = this.orbitMode === 'free' ? 0 : this.orbitSpeed;
    if (this.orbitMode === 'constrained' && Math.abs(this.camera.up.z - 1) > 1e-6) {
      // back to Z up (keep the viewing direction)
      const d = this.camera.position.clone().sub(this.controls.target).normalize();
      if (Math.abs(d.z) > 0.999) d.y -= 0.001 * Math.sign(d.z);
      this.camera.up.set(0, 0, 1);
      this.camera.position.copy(this.controls.target).addScaledVector(d.normalize(), this.camera.position.distanceTo(this.controls.target));
      this.camera.lookAt(this.controls.target);
    }
  }

  // screen-up for a standard view: Z, or +Y when looking straight down/up
  upFor(dir) { return Math.abs(dir.z) > 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1); }

  // Mouse button layouts of common CAD programs (-1 = button not used for navigation)
  setMouse(preset) {
    const M = THREE.MOUSE, N = -1;
    this.controls.mouseButtons = {
      openfab: { LEFT: M.ROTATE, MIDDLE: M.PAN, RIGHT: M.PAN },
      fusion: { LEFT: N, MIDDLE: M.PAN, RIGHT: N },       // Umschalt + Mitte = drehen
      inventor: { LEFT: N, MIDDLE: M.PAN, RIGHT: N },
      solidworks: { LEFT: N, MIDDLE: M.ROTATE, RIGHT: N }, // Strg + Mitte = verschieben
      tinkercad: { LEFT: N, MIDDLE: M.PAN, RIGHT: M.ROTATE },
    }[preset] || { LEFT: M.ROTATE, MIDDLE: M.PAN, RIGHT: M.PAN };
  }

  setNavigation({ invertZoom = false, zoomToCursor = true, orbitSpeed = 1, fov = 40 } = {}) {
    this.controls.zoomSpeed = invertZoom ? -1 : 1;
    this.controls.zoomToCursor = !!zoomToCursor;
    this.orbitSpeed = +orbitSpeed || 1;
    this.controls.rotateSpeed = this.orbitMode === 'free' ? 0 : this.orbitSpeed;
    if (+fov && this.camera.fov !== +fov) {
      // keep the model the same size on screen when the angle changes (orthogonal = tiny angle)
      const t = this.controls.target, off = this.camera.position.clone().sub(t);
      const k = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(+fov / 2));
      this.camera.position.copy(t).add(off.multiplyScalar(k));
      this.camera.fov = +fov;
      this.camera.near = +fov < 5 ? 5 : 0.5;
      this.camera.far = +fov < 5 ? 1e6 : 50000;
      this.camera.updateProjectionMatrix();
    }
  }

  axes() {
    const g = new THREE.Group();
    const mk = (to, color) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...to)]);
      g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
    };
    mk([40, 0, 0], 0xd64545);
    mk([0, 40, 0], 0x2f9e44);
    mk([0, 0, 40], 0x1c6fd1);
    return g;
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyInset();
  }

  // a panel covers the lower `px` pixels of the view: the picture is shifted up so its centre lies above it
  setInset(px) { this.inset = Math.max(0, px || 0); this.applyInset(); }
  applyInset() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (this.inset && w && h) this.camera.setViewOffset(w, h, 0, this.inset / 2, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  clear(group) {
    for (const c of [...group.children]) {
      group.remove(c);
      c.traverse(o => {
        if (o.geometry && !o.userData.cached) o.geometry.dispose();
        if (o.isCSS2DObject) o.element.remove();
      });
    }
  }

  setView(name, box) {
    const dir = new THREE.Vector3(...(VIEWS[name] || VIEWS.iso)).normalize();
    let center = this.controls.target.clone();
    let size = this.camera.position.distanceTo(center) / 2.4;
    if (box && !box.isEmpty()) {
      center = box.getCenter(new THREE.Vector3());
      size = Math.max(20, box.getSize(new THREE.Vector3()).length());
    }
    const dist = size * 1.6 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / 2;
    this.animateTo(center, center.clone().addScaledVector(dir, dist), 300, this.orbitMode === 'free' ? this.upFor(dir) : new THREE.Vector3(0, 0, 1));
  }

  // smooth camera move (direction turns on a sphere, target and distance blend)
  animateTo(target, pos, ms = 300, up = null) {
    const fromT = this.controls.target.clone(), fromP = this.camera.position.clone();
    const fromU = this.camera.up.clone(), toU = (up || this.camera.up).clone().normalize();
    const fromD = fromP.clone().sub(fromT), toD = pos.clone().sub(target);
    const l0 = fromD.length(), l1 = toD.length();
    fromD.normalize(); toD.normalize();
    const finish = () => { this.controls.target.copy(target); this.camera.up.copy(toU); this.camera.position.copy(pos); this.camera.lookAt(target); this.controls.update(); this.anim = null; };
    if (!(ms > 0) || l0 < 1e-9 || fromD.angleTo(toD) < 1e-4 && fromT.distanceTo(target) < 1e-6 && Math.abs(l0 - l1) < 1e-6 && fromU.angleTo(toU) < 1e-4) return finish();
    let axis = new THREE.Vector3().crossVectors(fromD, toD);
    if (axis.lengthSq() < 1e-12) axis = Math.abs(fromD.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    axis.normalize();
    const ang = fromD.angleTo(toD), t0 = performance.now(), id = {};
    this.anim = id;
    const step = () => {
      if (this.anim !== id) return;
      const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      if (k >= 1) return finish();
      const d = fromD.clone().applyAxisAngle(axis, ang * e);
      const tg = fromT.clone().lerp(target, e);
      // up turns along with the view (kept perpendicular to the viewing direction)
      const u = fromU.clone().lerp(toU, e);
      u.addScaledVector(d, -u.dot(d));
      if (u.lengthSq() > 1e-8) this.camera.up.copy(u.normalize());
      this.controls.target.copy(tg);
      this.camera.position.copy(tg).addScaledVector(d, l0 + (l1 - l0) * e);
      this.camera.lookAt(tg);
      this.controls.update();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // hidden window (no animation frames): still end up in the target view
    setTimeout(() => { if (this.anim === id) finish(); }, ms + 150);
  }

  ndc(evt) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((evt.clientX - r.left) / r.width) * 2 - 1, -((evt.clientY - r.top) / r.height) * 2 + 1);
  }

  raycastPlane(evt, z) {
    this.raycaster.setFromCamera(this.ndc(evt), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), p) ? p : null;
  }

  raycast(evt, objects, lineThresholdPx = 6) {
    this.raycaster.setFromCamera(this.ndc(evt), this.camera);
    this.raycaster.params.Line.threshold = this.worldPerPixel() * lineThresholdPx;
    return this.raycaster.intersectObjects(objects, false);
  }

  raycastPlaneN(evt, n, o) {
    this.raycaster.setFromCamera(this.ndc(evt), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, o), p) ? p : null;
  }

  // Look along -dir (camera placed on the +dir side).
  setViewDir(dir, box, exact = false) {
    const d = dir.clone().normalize();
    if (!exact && this.orbitMode !== 'free' && Math.abs(d.z) > 0.999) d.y -= 0.001 * Math.sign(d.z || 1);
    VIEWS.custom = d.toArray();
    this.setView('custom', box);
  }

  resetGrid() {
    this.grid.matrixAutoUpdate = true;
    this.grid.position.set(0, 0, 0);
    this.grid.rotation.set(Math.PI / 2, 0, 0);
    this.grid.updateMatrix();
  }

  setTheme(dark) {
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    const old = this.grid;
    this.grid = new THREE.GridHelper(600, 60, dark ? 0x3b4652 : 0xb4bfca, dark ? 0x2a333d : 0xd5dce3);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.9;
    if (old.matrixAutoUpdate === false) { this.grid.matrixAutoUpdate = false; this.grid.matrix.copy(old.matrix); }
    else this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
  }

  worldPerPixel() {
    const d = this.camera.position.distanceTo(this.controls.target);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.el.clientHeight;
  }

  screenPos(v) {
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.el.clientWidth, y: ((1 - p.y) / 2) * this.el.clientHeight };
  }
}
