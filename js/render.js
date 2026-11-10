// RENDERN workspace (Render): scene settings (environment, exposure, background, ground with
// shadow and reflection) and an in-canvas render that gets smoother frame by frame: every frame the camera is
// shifted by a fraction of a pixel and the key light moves a little, the frames are averaged — this gives
// clean edges and soft shadows.
import * as THREE from 'three';

export const ENVIRONMENTS = {
  studio: 'Fotostudio hell',
  dark: 'Fotostudio dunkel',
  warm: 'Werkstatt (warm)',
  sky: 'Himmel',
  neutral: 'Neutral grau',
};
export const RENDER_DEFAULTS = { env: 'studio', exposure: 1, background: 'studio', bgColor: '#e9edf1', ground: true, shadows: true, reflection: 0.12, lightAz: 35, lightEl: 55, samples: 128, dof: 0 };

// Studio backdrop per environment: a soft vertical gradient behind the part (top, middle, bottom of the picture)
// and the colour of the floor spot under it. The floor fades out towards its rim, so no horizon line shows.
const BACKDROPS = {
  studio: { top: '#aeb7c0', mid: '#dfe4e9', bot: '#f4f6f8', floor: 0xffffff },
  dark: { top: '#08090b', mid: '#1b1f24', bot: '#343a41', floor: 0x4a5159 },
  warm: { top: '#4a3d31', mid: '#a8937b', bot: '#dccdb9', floor: 0xefe3d2 },
  neutral: { top: '#5d656d', mid: '#9aa2aa', bot: '#c6ccd2', floor: 0xdde2e7 },
  sky: null, // the sky itself is the backdrop
};
function backdropTexture(b) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, b.top); gr.addColorStop(0.55, b.mid); gr.addColorStop(1, b.bot);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// soft dark spot under the part: it sits on the floor instead of floating above it
function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.38)'); gr.addColorStop(0.8, 'rgba(0,0,0,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
// opaque in the middle, gone at the rim
function fadeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#fff'); gr.addColorStop(0.7, '#555'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// a light room for each environment, rendered into an environment map
function envScene(kind) {
  const room = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const P = {
    studio: { wall: 0x9ba3ab, floor: 0x5f676f, k: [7, 4, 3, 1.6, 4.5] },
    dark: { wall: 0x202429, floor: 0x15181b, k: [9, 4.5, 3.5, 0.6, 6] },
    warm: { wall: 0x9b8a76, floor: 0x5a4c3e, k: [4.5, 2.6, 1.8, 1.6, 2.5], tint: 0xffe2b8 },
    neutral: { wall: 0x8a939c, floor: 0x4d555d, k: [5.5, 3.2, 2.4, 2.0, 3.8] },
  }[kind];
  if (kind === 'sky') {
    // gradient sky dome with a bright sun
    const g = new THREE.SphereGeometry(20, 32, 16);
    const col = [], pos = g.attributes.position;
    const top = new THREE.Color(0x3d7fd6), hor = new THREE.Color(0xdbe8f5), gnd = new THREE.Color(0x6b665d);
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i) / 20;
      const c = z >= 0 ? hor.clone().lerp(top, Math.pow(z, 0.6)) : hor.clone().lerp(gnd, Math.min(1, -z * 4));
      col.push(c.r * 1.6, c.g * 1.6, c.b * 1.6);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    room.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(40, 38, 32) }));
    sun.position.set(-8, -9, 12);
    room.add(sun);
    return room;
  }
  const walls = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: P.wall, side: THREE.BackSide }));
  walls.scale.set(20, 20, 14);
  walls.position.z = 3;
  room.add(walls);
  const floor = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: P.floor }));
  floor.scale.set(20, 20, 0.2);
  floor.position.z = -3.8;
  room.add(floor);
  const tint = new THREE.Color(P.tint || 0xffffff);
  const panel = (w, h, x, y, z, rx, ry, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    room.add(m);
  };
  panel(9, 5, 0, 0, 9.5, 0, 0, P.k[0]);
  panel(5, 6, -9.5, -3, 3, 0, Math.PI / 2, P.k[1]);
  panel(5, 6, 9.5, 3, 3, 0, Math.PI / 2, P.k[2]);
  panel(10, 3, 0, -9.5, 4, Math.PI / 2, 0, P.k[3]);
  panel(6, 2, 0, 9.5, 6, Math.PI / 2, 0, P.k[4]);
  return room;
}

export class RenderStudio {
  constructor(vp) {
    this.vp = vp;
    this.active = false;
    this.envs = {};
    this.s = { ...RENDER_DEFAULTS };
    this.samples = 0;
    this.running = false;
    this.lastCam = new THREE.Matrix4();
    this.box = new THREE.Box3();
    this.onProgress = null;

    // ground: matte floor under the part, a shadow catcher and a mirrored copy of the part (reflection)
    this.stage = new THREE.Group();
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, transparent: true }));
    this.floor.renderOrder = -2;
    this.fade = null;
    this.backdrops = {};
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.5 }));
    this.catcher.receiveShadow = true;
    this.catcher.renderOrder = -1;
    this.mirror = new THREE.Group();
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, toneMapped: false }));
    this.contact.renderOrder = -1;
    this.stage.add(this.mirror, this.floor, this.catcher, this.contact);
    this.light = new THREE.DirectionalLight(0xffffff, 3.2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.02;
    this.stage.add(this.light, this.light.target);

    // accumulation
    const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.rtFrame = rt();
    this.rtA = rt();
    this.rtB = rt();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blendMat = new THREE.ShaderMaterial({
      uniforms: { prev: { value: null }, cur: { value: null }, w: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D prev, cur; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(prev, vUv), texture2D(cur, vUv), w); }',
      depthTest: false, depthWrite: false,
    });
    this.showMat = new THREE.MeshBasicMaterial({ map: null, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blendMat);
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
  }

  env(kind) {
    if (!this.envs[kind]) {
      const pm = new THREE.PMREMGenerator(this.vp.renderer);
      const room = envScene(kind);
      this.envs[kind] = pm.fromScene(room, 0.03).texture;
      pm.dispose();
      room.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    }
    return this.envs[kind];
  }

  // switch the viewport into render mode (or back)
  setActive(on) {
    if (on === this.active) return;
    const vp = this.vp, sc = vp.scene;
    this.active = on;
    if (on) {
      this.saved = { env: sc.environment, bg: sc.background, blur: sc.backgroundBlurriness, tm: vp.renderer.toneMapping, exp: vp.renderer.toneMappingExposure, shadow: vp.renderer.shadowMap.enabled };
      sc.add(this.stage);
      // the work lights (headlight, sky fill) are turned down: the environment and the key light light the scene
      this.dimmed = [];
      sc.traverse(o => { if (o.isLight && !this.stage.children.includes(o)) { this.dimmed.push([o, o.intensity]); o.intensity *= 0.2; } });
      vp.renderer.shadowMap.enabled = true;
      vp.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      vp.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      vp.renderHook = () => this.frame();
    } else {
      sc.remove(this.stage);
      for (const [o, i] of this.dimmed || []) o.intensity = i;
      sc.environment = this.saved.env;
      sc.background = this.saved.bg;
      sc.backgroundBlurriness = this.saved.blur;
      vp.renderer.toneMapping = this.saved.tm;
      vp.renderer.toneMappingExposure = this.saved.exp;
      vp.renderer.shadowMap.enabled = this.saved.shadow;
      vp.renderHook = null;
      this.running = false;
    }
    for (const g of [vp.grid, vp.axesGroup, vp.sketches, vp.paths, vp.overlay]) if (g) g.visible = !on;
    this.reset();
  }

  // settings + the part's bounding box (ground and light are placed around it)
  apply(settings, box) {
    this.s = { ...RENDER_DEFAULTS, ...(settings || {}) };
    if (box && !box.isEmpty()) this.box.copy(box);
    if (!this.active) return;
    const sc = this.vp.scene, s = this.s;
    sc.environment = this.env(s.env);
    // backdrop: studio gradient (default), the blurred environment, or one colour
    const drop = s.background === 'studio' ? BACKDROPS[s.env] : null;
    if (drop) { sc.background = (this.backdrops[s.env] ||= backdropTexture(drop)); sc.backgroundBlurriness = 0; }
    else if (s.background === 'color') { sc.background = new THREE.Color(s.bgColor); sc.backgroundBlurriness = 0; }
    else { sc.background = this.env(s.env); sc.backgroundBlurriness = 0.45; }
    // a little under the neutral exposure: the bright studio rooms would wash the part out
    this.vp.renderer.toneMappingExposure = (+s.exposure || 1) * 0.82;
    const b = this.box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 50)) : this.box;
    const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const R = Math.max(size.x, size.y, size.z, 1);
    const z0 = b.min.z - R * 0.002;
    // studio backdrop: a floor spot that fades out; otherwise a floor far beyond the view (its edge must not show)
    const W = drop ? R * 14 : R * 200;
    for (const m of [this.floor, this.catcher]) { m.scale.set(W, W, 1); m.position.set(c.x, c.y, z0); }
    const fm = this.floor.material, fadeMap = drop ? (this.fade ||= fadeTexture()) : null;
    if (fm.alphaMap !== fadeMap) { fm.alphaMap = fadeMap; fm.needsUpdate = true; }
    fm.depthWrite = !drop;
    this.catcher.position.z = z0 + R * 0.0005;
    this.contact.scale.set(size.x * 1.45 + R * 0.1, size.y * 1.45 + R * 0.1, 1);
    this.contact.position.set(c.x, c.y, z0 + R * 0.001);
    this.contact.visible = !!s.ground && !!s.shadows;
    this.floor.visible = this.catcher.visible = !!s.ground;
    this.mirror.visible = !!s.ground && +s.reflection > 0;
    // the floor takes the background colour so it fades into it; the reflection shows through it
    this.floor.material.color.set(drop ? drop.floor : s.background === 'color' ? s.bgColor : ({ dark: 0x1c2024, sky: 0x8d8a83, warm: 0x6e5f4f }[s.env] || 0xc9cfd5));
    this.floor.material.opacity = 1 - Math.min(0.9, +s.reflection || 0);
    this.light.castShadow = !!s.shadows;
    this.catcher.visible = !!s.ground && !!s.shadows;
    this.z0 = z0;
    this.center = c;
    this.radius = R;
    const sh = this.light.shadow.camera;
    sh.left = sh.bottom = -R * 1.2; sh.right = sh.top = R * 1.2; sh.near = 0.1; sh.far = R * 8;
    sh.updateProjectionMatrix();
    this.placeLight(0, 0);
    this.rebuildMirror();
    this.reset();
  }

  placeLight(jx, jy) {
    const s = this.s, c = this.center || new THREE.Vector3(), R = this.radius || 100;
    const az = THREE.MathUtils.degToRad((+s.lightAz || 0) + jx), el = THREE.MathUtils.degToRad(Math.min(89, Math.max(5, (+s.lightEl || 50) + jy)));
    this.light.position.set(c.x + Math.cos(el) * Math.cos(az) * R * 3, c.y + Math.cos(el) * Math.sin(az) * R * 3, c.z + Math.sin(el) * R * 3);
    this.light.target.position.copy(c);
    this.light.target.updateMatrixWorld();
  }

  // mirrored copies of the bodies below the floor (seen through the semi-transparent floor)
  rebuildMirror() {
    this.mirror.clear();
    if (!this.active || !this.s.ground || !(+this.s.reflection > 0)) return;
    const flip = new THREE.Matrix4().makeTranslation(0, 0, 2 * this.z0).multiply(new THREE.Matrix4().makeScale(1, 1, -1));
    this.vp.model.updateMatrixWorld(true);
    this.vp.model.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      o.castShadow = true;
      const m = new THREE.Mesh(o.geometry, o.material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(flip).multiply(o.matrixWorld);
      m.renderOrder = -3;
      this.mirror.add(m);
    });
  }

  // the model changed (rebuild) or a setting changed: start over
  reset() {
    this.samples = 0;
    this.onProgress?.(0, this.running);
  }
  start() { this.running = true; this.reset(); }
  stop() { this.running = false; this.onProgress?.(this.samples, false); }

  frame() {
    const vp = this.vp, r = vp.renderer, cam = vp.camera;
    vp.model.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // a camera move starts the accumulation again
    cam.updateMatrixWorld();
    const key = cam.matrixWorld.clone().multiply(cam.projectionMatrix);
    if (!key.equals(this.lastCam)) { this.lastCam.copy(key); this.samples = 0; }
    if (!this.running) {
      cam.clearViewOffset();
      this.placeLight(0, 0);
      r.setRenderTarget(null);
      r.render(vp.scene, cam);
      this.takeCapture();
      return;
    }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    for (const t of [this.rtFrame, this.rtA, this.rtB]) if (t.width !== size.x || t.height !== size.y) { t.setSize(size.x, size.y); this.samples = 0; }
    const max = Math.max(1, +this.s.samples || 128);
    if (this.samples < max) {
      // sub-pixel camera shift (smooth edges) and a slightly moved light (soft shadows)
      const n = this.samples;
      const jx = n ? (halton(n, 2) - 0.5) : 0, jy = n ? (halton(n, 3) - 0.5) : 0;
      cam.setViewOffset(size.x, size.y, jx, jy, size.x, size.y);
      this.placeLight(n ? (halton(n, 5) - 0.5) * 10 : 0, n ? (halton(n, 7) - 0.5) * 8 : 0);
      // depth of field: the camera moves within a small aperture but keeps looking at the focus point
      // (the orbit centre); what lies there stays sharp, nearer and farther things blur
      const ap = (+this.s.dof || 0) * 0.006 * (this.radius || 100);
      let saved = null;
      if (ap > 0 && n) {
        saved = { p: cam.position.clone(), q: cam.quaternion.clone() };
        const a = halton(n, 11) * Math.PI * 2, rr = Math.sqrt(halton(n, 13)) * ap;
        const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
        cam.position.addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr);
        cam.lookAt(vp.controls.target);
        cam.updateMatrixWorld();
      }
      r.setRenderTarget(this.rtFrame);
      r.render(vp.scene, cam);
      if (saved) { cam.position.copy(saved.p); cam.quaternion.copy(saved.q); cam.updateMatrixWorld(); }
      cam.clearViewOffset();
      this.quad.material = this.blendMat;
      this.blendMat.uniforms.prev.value = this.rtA.texture;
      this.blendMat.uniforms.cur.value = this.rtFrame.texture;
      this.blendMat.uniforms.w.value = 1 / (n + 1);
      r.setRenderTarget(this.rtB);
      r.render(this.quadScene, this.quadCam);
      [this.rtA, this.rtB] = [this.rtB, this.rtA];
      this.samples++;
      this.onProgress?.(this.samples, true);
      if (this.samples >= max) this.onProgress?.(this.samples, true, true);
    }
    // show the averaged image (tone mapping and sRGB are applied on the way to the screen)
    this.quad.material = this.showMat;
    this.showMat.map = this.rtA.texture;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
    this.takeCapture();
  }

  // the canvas has to be read right after drawing (in the same task), before the browser clears it
  takeCapture() {
    if (!this.capture) return;
    const cb = this.capture;
    this.capture = null;
    this.vp.renderer.domElement.toBlob(cb, 'image/png');
  }

  // PNG of what is shown (the in-canvas render if it runs, otherwise the plain view)
  snapshot(cb) { this.capture = cb; this.frame(); }
}

// low-discrepancy sequence for evenly spread jitter
function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}
