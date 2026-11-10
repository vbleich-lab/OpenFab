// 3Dconnexion SpaceMouse support over WebHID (Chrome, Edge and the desktop app).
// The device sends 6 axes (3 translation, 3 rotation) and buttons as HID reports:
//   report 1: tx, ty, tz (int16 LE), newer devices add rx, ry, rz in the same report
//   report 2: rx, ry, rz
//   report 3: button bitmask
import * as THREE from 'three';

const VENDOR_3DCONNEXION = 0x256f;
const VENDOR_LOGITECH = 0x046d; // older SpaceNavigator / SpacePilot models
const FILTERS = [
  { vendorId: VENDOR_3DCONNEXION },
  { vendorId: VENDOR_LOGITECH, usagePage: 0x01, usage: 0x08 },
  { usagePage: 0x01, usage: 0x08 }, // any multi-axis controller
];
const isMultiAxis = d => d.collections?.some(c => c.usagePage === 0x01 && c.usage === 0x08);
const isSpaceMouse = d => d.vendorId === VENDOR_3DCONNEXION || isMultiAxis(d);

// Buttons of the larger models (SpaceMouse Pro / Enterprise): fixed view keys
const PRO_BUTTONS = { 2: 'top', 4: 'right', 5: 'front', 8: 'rollcw', 22: 'escape' };

export class SpaceMouse {
  // opts(): current settings; hooks: { status(msg), action(name), canRotate() }
  constructor(vp, opts, hooks) {
    this.vp = vp;
    this.opts = opts;
    this.hooks = hooks;
    this.devices = new Set();
    this.t = [0, 0, 0];
    this.r = [0, 0, 0];
    this.buttons = 0;
    this.lastReport = 0;
    this.onReport = e => this.report(e);
    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.tick(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get supported() { return typeof navigator !== 'undefined' && 'hid' in navigator; }
  get connected() { return this.devices.size > 0; }
  get name() { return [...this.devices][0]?.productName || ''; }

  // devices the user already allowed (or that the desktop app allows) connect on start
  async autoConnect() {
    if (!this.supported) return;
    navigator.hid.addEventListener('connect', e => { if (isSpaceMouse(e.device) && this.opts().spaceMouse !== false) this.open(e.device); });
    navigator.hid.addEventListener('disconnect', e => {
      if (!this.devices.delete(e.device)) return;
      this.t = [0, 0, 0]; this.r = [0, 0, 0];
      if (!this.connected) this.hooks.status('SpaceMouse getrennt');
    });
    if (this.opts().spaceMouse === false) return;
    try {
      for (const d of await navigator.hid.getDevices()) if (isSpaceMouse(d)) await this.open(d);
    } catch { /* not allowed in this context */ }
  }

  // asks the browser for the device (needs a click, shows the browser's device list)
  async request() {
    if (!this.supported) throw new Error('Dieser Browser unterstützt keine SpaceMouse (WebHID). Bitte Chrome, Edge oder die Desktop-App verwenden.');
    const list = await navigator.hid.requestDevice({ filters: FILTERS });
    for (const d of list) if (isSpaceMouse(d)) await this.open(d);
    if (!this.connected) throw new Error('Keine SpaceMouse ausgewählt.');
  }

  async open(d) {
    if (this.devices.has(d)) return;
    // a device can expose several HID interfaces; only the multi-axis one sends motion
    if (d.collections?.length && !isMultiAxis(d) && d.vendorId !== VENDOR_3DCONNEXION) return;
    try { if (!d.opened) await d.open(); } catch (err) { this.hooks.status('SpaceMouse konnte nicht geöffnet werden: ' + (err.message || err)); return; }
    d.addEventListener('inputreport', this.onReport);
    this.devices.add(d);
    this.hooks.status(`SpaceMouse verbunden: ${d.productName || 'Gerät'}`);
  }

  async disconnect() {
    for (const d of this.devices) {
      d.removeEventListener('inputreport', this.onReport);
      try { await d.close(); } catch { /* already closed */ }
      try { await d.forget?.(); } catch { /* not supported */ }
    }
    this.devices.clear();
    this.t = [0, 0, 0]; this.r = [0, 0, 0];
  }

  report(e) {
    const v = e.data;
    const n = i => v.getInt16(i, true) / 350; // full deflection ≈ ±350
    if (e.reportId === 1 && v.byteLength >= 6) {
      this.t = [n(0), n(2), n(4)];
      if (v.byteLength >= 12) this.r = [n(6), n(8), n(10)];
      this.lastReport = performance.now();
    } else if (e.reportId === 2 && v.byteLength >= 6) {
      this.r = [n(0), n(2), n(4)];
      this.lastReport = performance.now();
    } else if (e.reportId === 3) {
      let mask = 0;
      for (let i = 0; i < Math.min(4, v.byteLength); i++) mask |= v.getUint8(i) << (8 * i);
      const pressed = mask & ~this.buttons;
      this.buttons = mask;
      for (let bit = 0; bit < 32; bit++) if (pressed & (1 << bit)) this.button(bit);
    }
  }

  button(bit) {
    const o = this.opts();
    const action = bit === 0 ? o.smButton1 : bit === 1 ? o.smButton2 : PRO_BUTTONS[bit];
    if (action && action !== 'none') this.hooks.action(action);
  }

  // the six axes after calibration (rest offset removed, per-axis gain and direction), not yet shaped
  calibrated() {
    const o = this.opts();
    const off = o.smOffsets || [], g = o.smGain || [], inv = o.smInv || [];
    return [...this.t, ...this.r].map((v, i) => (v - (+off[i] || 0)) * (+g[i] || 1) * (inv[i] ? -1 : 1));
  }

  // shaped, dead-zoned axis values in [-1, 1]
  axes() {
    const o = this.opts();
    const dz = Math.min(0.5, Math.max(0, +(o.smDeadzone ?? 0.04)));
    const shape = x => { const a = Math.min(1, Math.abs(x)); return a < dz ? 0 : Math.sign(x) * ((a - dz) / (1 - dz)) ** 1.6; };
    const c = this.calibrated();
    let t = c.slice(0, 3).map(shape), r = c.slice(3).map(shape);
    if (o.smDominant) {
      // only the strongest axis moves the view (easier for beginners)
      const all = [...t, ...r].map(Math.abs);
      const k = all.indexOf(Math.max(...all));
      t = t.map((x, i) => (i === k ? x : 0));
      r = r.map((x, i) => (i + 3 === k ? x : 0));
    }
    return { t, r };
  }

  tick(dt) {
    if (!this.connected || this.opts().spaceMouse === false || this.paused) return;
    // safety: stop if the device went silent while deflected
    if (performance.now() - this.lastReport > 600) return;
    const { t, r } = this.axes();
    if (!t.some(Boolean) && !r.some(Boolean)) return;
    this.move(t, r, dt);
  }

  // Object mode (default): the model follows the cap.
  move([tx, ty, tz], [rx, ry, rz], dt) {
    const o = this.opts();
    const cam = this.vp.camera, ctl = this.vp.controls, target = ctl.target;
    const speed = +o.smSpeed || 1;
    const sp = o.smInvertPan ? -1 : 1, sr = o.smInvertRot ? -1 : 1, sz = o.smInvertZoom ? -1 : 1;
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    let off = cam.position.clone().sub(target);
    const dist = off.length();
    // pan: cap right -> model right (camera moves left); cap down -> model down
    const pan = right.clone().multiplyScalar(-tx).add(camUp.clone().multiplyScalar(tz)).multiplyScalar(sp * dist * 1.1 * speed * dt);
    target.add(pan);
    // zoom: pull the cap toward you -> model comes closer
    const f = Math.exp(-ty * sz * 1.6 * speed * dt);
    off.multiplyScalar(Math.min(4, Math.max(0.25, f)));
    if (off.length() < 1) off.setLength(1);
    // rotate around the target (skipped in a sketch, where the view stays flat)
    if (this.hooks.canRotate() && this.vp.orbitMode === 'free') {
      // free orbit: turn about the screen axes and roll about the viewing direction (cap twist / tilt / roll)
      const k = 2.4 * speed * dt * sr;
      const view = off.clone().normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(camUp, -rz * k)
        .multiply(new THREE.Quaternion().setFromAxisAngle(right, -rx * k))
        .multiply(new THREE.Quaternion().setFromAxisAngle(view, ry * k));
      off.applyQuaternion(q);
      cam.up.copy(camUp.clone().applyQuaternion(q)).normalize();
    } else if (this.hooks.canRotate()) {
      const k = 2.4 * speed * dt * sr;
      const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -rz * k);
      off.applyQuaternion(qz);
      const tilt = new THREE.Quaternion().setFromAxisAngle(right.clone().applyQuaternion(qz), -rx * k);
      const tilted = off.clone().applyQuaternion(tilt);
      // do not tip over the poles (the view would flip)
      if (Math.abs(tilted.clone().normalize().z) < 0.995) off = tilted;
      // ry (rolling the cap sideways) is ignored: the view keeps Z up like the usual default
      void ry;
    }
    cam.position.copy(target).add(off);
    cam.lookAt(target);
    ctl.update();
  }
}
