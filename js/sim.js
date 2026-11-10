// Heightmap-based material removal simulation for 2.5D/3-axis flat tools.
import * as THREE from 'three';
import { stockTopAt, stockBotAt, STOCK_MATERIALS } from './cam.js';
import { shaftDia, fluteLen } from './tooldraw.js';

// cutting length when the tool library has none: drills are long, mills ~3×Ø
export const defaultFluteLen = t => (t.type === 'drill' ? 8 : 3) * t.dia;
// holder defaults: Ø = 2×tool + 10 mm, stick-out = cutting length + 2×Ø
export const defaultHolderDia = t => 2 * t.dia + 10;
export const defaultStickout = t => (+t.fluteLen || defaultFluteLen(t)) + 2 * t.dia;

export class StockSim {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
    // comparison with the finished part ("Vergleich"): green = at size, blue = material left, red = cut too deep
    this.cmpMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.0, side: THREE.DoubleSide });
    this.part = null;
    this.cmpTol = 0.1;
    this.stock = null;
  }

  build(stock) {
    this.dispose();
    this.stock = stock;
    const mc = STOCK_MATERIALS[stock.material]?.[1] ?? (stock.materialColor ? parseInt(String(stock.materialColor).replace('#', ''), 16) : 0xc9a86a);
    this.mat.color.setHex(mc);
    this.mat.metalness = /alu|steel|stainless|cast|brass|copper|titanium/.test(stock.material || '') ? 0.35 : 0.05;
    const w = stock.maxX - stock.minX, d = stock.maxY - stock.minY;
    const res = Math.max(0.15, Math.max(w, d) / 360);
    const nx = (this.nx = Math.max(2, Math.round(w / res) + 1));
    const ny = (this.ny = Math.max(2, Math.round(d / res) + 1));
    this.dx = w / (nx - 1);
    this.dy = d / (ny - 1);
    this.h = new Float32Array(nx * ny);
    // lower end of the material per cell (stock from a previous setup can have air under a skin)
    this.layered = !!stock.shape?.hm?.hb;
    this.b = new Float32Array(nx * ny).fill(stock.bottom);
    if (this.layered) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) this.b[j * nx + i] = stockBotAt(stock, stock.minX + i * this.dx, stock.minY + j * this.dy);

    const pos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = (j * nx + i) * 3;
        pos[k] = stock.minX + i * this.dx;
        pos[k + 1] = stock.minY + j * this.dy;
      }
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let q = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, dd = c + 1;
        idx.set([a, b, dd, a, dd, c], q);
        q += 6;
      }
    }
    this.top = new THREE.BufferGeometry();
    this.top.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.top.setIndex(new THREE.BufferAttribute(idx, 1));

    const ring = [];
    for (let i = 0; i < nx; i++) ring.push(i);
    for (let j = 1; j < ny; j++) ring.push(j * nx + nx - 1);
    for (let i = nx - 2; i >= 0; i--) ring.push((ny - 1) * nx + i);
    for (let j = ny - 2; j >= 1; j--) ring.push(j * nx);
    this.ring = ring;
    const wpos = new Float32Array(ring.length * 6);
    // walls follow the stock shape (round stock: no material at the box border)
    ring.forEach((g, k) => {
      const zt = Math.max(this.b[g], stockTopAt(stock, pos[g * 3], pos[g * 3 + 1]));
      wpos.set([pos[g * 3], pos[g * 3 + 1], zt, pos[g * 3], pos[g * 3 + 1], this.b[g]], k * 6);
    });
    const widx = [];
    for (let k = 0; k < ring.length; k++) {
      const a = 2 * k, b = a + 1, c = 2 * ((k + 1) % ring.length), dd = c + 1;
      widx.push(a, b, dd, a, dd, c);
    }
    this.walls = new THREE.BufferGeometry();
    this.walls.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
    this.walls.setIndex(widx);

    let bottom;
    if (this.layered) {
      // the underside follows the lower end of the material
      const bpos = pos.slice();
      for (let k = 0; k < nx * ny; k++) bpos[k * 3 + 2] = this.b[k];
      bottom = new THREE.BufferGeometry();
      bottom.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
      bottom.setIndex(new THREE.BufferAttribute(idx, 1));
      bottom.computeVertexNormals();
    } else {
      bottom = new THREE.PlaneGeometry(w, d);
      bottom.translate(stock.minX + w / 2, stock.minY + d / 2, stock.bottom);
    }
    this.top.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * ny * 3).fill(1), 3));
    this.topMesh = new THREE.Mesh(this.top, this.part ? this.cmpMat : this.mat);
    this.bottomGeo = this.layered ? bottom : null;
    this.fullIdx = idx;
    this.emptyCount = -1;
    this.group.add(this.topMesh, new THREE.Mesh(this.walls, this.mat), new THREE.Mesh(bottom, this.mat));
    this.reset();
  }

  reset() {
    if (!this.stock) return;
    if (!this.stock.shape) this.h.fill(this.stock.top);
    else for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) this.h[j * this.nx + i] = Math.max(this.stock.bottom, stockTopAt(this.stock, this.stock.minX + i * this.dx, this.stock.minY + j * this.dy));
    this.dirty = true;
    this.update();
  }

  // Tool tip at (x, y, z); profile(d) is the cutter height above the tip at radius d.
  stamp(x, y, z, tool) {
    const r = tool.dia / 2;
    const half = ((tool.angle || 90) / 2) * (Math.PI / 180);
    const tipR = (tool.tip || 0) / 2;
    const kind = tool.type;
    const { minX, minY } = this.stock;
    const i0 = Math.max(0, Math.floor((x - r - minX) / this.dx));
    const i1 = Math.min(this.nx - 1, Math.ceil((x + r - minX) / this.dx));
    const j0 = Math.max(0, Math.floor((y - r - minY) / this.dy));
    const j1 = Math.min(this.ny - 1, Math.ceil((y + r - minY) / this.dy));
    const rr = r * r;
    // material above the cutting length touches the shank -> collision
    const shankZ = z + (+tool.fluteLen || defaultFluteLen(tool));
    let removed = 0, shankHit = false;
    for (let j = j0; j <= j1; j++) {
      const ddy = minY + j * this.dy - y;
      const ddy2 = ddy * ddy;
      if (ddy2 > rr) continue;
      const row = j * this.nx;
      for (let i = i0; i <= i1; i++) {
        const ddx = minX + i * this.dx - x;
        const d2 = ddx * ddx + ddy2;
        if (d2 > rr) continue;
        let zc = z;
        if (kind === 'ball') zc = z + r - Math.sqrt(rr - d2);
        else if (kind === 'chamfer' || kind === 'drill') zc = z + Math.max(0, Math.sqrt(d2) - tipR) / Math.tan(half);
        const hv = this.h[row + i];
        if (hv > shankZ + 0.01 && hv > this.b[row + i]) shankHit = true;
        if (hv > zc) {
          removed += Math.max(0, hv - Math.max(zc, this.b[row + i]));
          this.h[row + i] = zc;
          this.dirty = true;
        }
      }
    }
    return { removed, shankHit };
  }

  // Removes material along a segment; reports removed volume (per cell area) and
  // the first position where the shank touched material.
  cut(a, b, tool, t0, t1) {
    const p = t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    const p0 = p(t0), p1 = p(t1);
    const res = { removed: 0, shankAt: null };
    if (Math.min(p0.z, p1.z) >= this.stock.top) return res;
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const n = Math.max(1, Math.ceil(len / (Math.min(this.dx, this.dy) * 0.7)));
    // shank wider than the cutter (Ø3 mill on a Ø6 shank): its own disc above the cutting length, like the NC check
    const sR = shaftDia(tool) / 2, fl = fluteLen(tool), wide = sR > tool.dia / 2 + 1e-6;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const q = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t, z: p0.z + (p1.z - p0.z) * t };
      const r = this.stamp(q.x, q.y, q.z, tool);
      res.removed += r.removed;
      if (r.shankHit && !res.shankAt) res.shankAt = q;
      if (wide && !res.shankAt && this.discHit(q, sR, q.z + fl)) res.shankAt = q;
    }
    // the wider holder is checked at the segment ends only (cheap, and moves are short)
    for (const q of [p0, p1]) if (!res.holderAt && this.holderHit(q, tool)) res.holderAt = q;
    return res;
  }

  holderHit(q, tool) {
    return this.discHit(q, (+tool.holderDia || defaultHolderDia(tool)) / 2, q.z + (+tool.stickout || defaultStickout(tool)));
  }

  // material above zH within radius R around (q.x, q.y)?
  discHit(q, R, zH) {
    if (zH >= this.stock.top) return false;
    const { minX, minY } = this.stock;
    const i0 = Math.max(0, Math.floor((q.x - R - minX) / this.dx)), i1 = Math.min(this.nx - 1, Math.ceil((q.x + R - minX) / this.dx));
    const j0 = Math.max(0, Math.floor((q.y - R - minY) / this.dy)), j1 = Math.min(this.ny - 1, Math.ceil((q.y + R - minY) / this.dy));
    const RR = R * R;
    for (let j = j0; j <= j1; j++) {
      const dy = minY + j * this.dy - q.y;
      for (let i = i0; i <= i1; i++) {
        const dx = minX + i * this.dx - q.x;
        if (dx * dx + dy * dy <= RR && this.h[j * this.nx + i] > zH + 0.01 && this.h[j * this.nx + i] > this.b[j * this.nx + i]) return true;
      }
    }
    return false;
  }

  // part heights on the same grid (null = comparison off); cells without part count against the stock bottom
  setCompare(part) {
    this.part = part && part.length === this.h?.length ? part : null;
    // target band per cell: next to a wall (height step between neighbours) the cell may lie on either side
    // of it on this grid, so anything between the lower and the upper level counts as "at size"
    if (this.part) {
      const nx = this.nx, ny = this.ny, bot = this.stock.bottom, n = this.h.length;
      const T = new Float32Array(n);
      for (let k = 0; k < n; k++) T[k] = Number.isFinite(this.part[k]) ? Math.max(bot, this.part[k]) : bot;
      this.lo = new Float32Array(n);
      this.hi = new Float32Array(n);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let lo = Infinity, hi = -Infinity;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const t = T[jj * nx + ii];
          if (t < lo) lo = t;
          if (t > hi) hi = t;
        }
        const k = j * nx + i;
        this.lo[k] = lo; this.hi[k] = Math.max(T[k], hi === -Infinity ? T[k] : hi);
        if (lo === Infinity) this.lo[k] = T[k];
      }
      this.T = T;
    }
    if (this.topMesh) this.topMesh.material = this.part ? this.cmpMat : this.mat;
    this.dirty = true;
    this.update();
  }

  // share of the area: at size / material left / too deep, and the deepest gouge
  compareStats() {
    if (!this.part) return null;
    let ok = 0, left = 0, gouge = 0, worst = 0;
    const bot = this.stock.bottom;
    for (let k = 0; k < this.h.length; k++) {
      // layered stock (previous setup): an empty column is right where there is no part, too deep where there is
      if (this.layered && !(this.h[k] > this.b[k] + 1e-3)) {
        if (this.T[k] <= bot + this.cmpTol) ok++; else { gouge++; worst = Math.min(worst, this.b[k] - this.lo[k]); }
        continue;
      }
      const z = Math.max(bot, this.h[k]);
      if (z < this.lo[k] - this.cmpTol) { gouge++; worst = Math.min(worst, z - this.lo[k]); } else if (z > this.hi[k] + this.cmpTol) left++; else ok++;
    }
    const n = this.h.length;
    return { ok: ok / n, left: left / n, gouge: gouge / n, worst };
  }

  update() {
    if (!this.dirty || !this.stock) return;
    this.dirty = false;
    const bot = this.stock.bottom;
    const pos = this.top.attributes.position.array;
    for (let k = 0; k < this.h.length; k++) pos[k * 3 + 2] = Math.max(this.b[k], this.h[k]);
    if (this.part) {
      const col = this.top.attributes.color.array, tol = this.cmpTol;
      for (let k = 0; k < this.h.length; k++) {
        const z = Math.max(bot, this.h[k]);
        let r, g, b;
        if (this.layered && !(this.h[k] > this.b[k] + 1e-3)) { if (this.T[k] <= bot + tol) { r = 0.25; g = 0.72; b = 0.32; } else { r = 0.88; g = 0.2; b = 0.2; } }
        else if (z < this.lo[k] - tol) { r = 0.88; g = 0.2; b = 0.2; } // too deep
        else if (z <= this.hi[k] + tol) { r = 0.25; g = 0.72; b = 0.32; } // at size
        else { const t = Math.min(1, (z - this.hi[k]) / 3); r = 0.55 - 0.45 * t; g = 0.72 - 0.42 * t; b = 0.95; } // material left: lighter = little, darker = a lot
        col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
      }
      this.top.attributes.color.needsUpdate = true;
    }
    // layered stock: columns without material (cut through, or air from the previous setup) are left out
    if (this.layered) {
      let empty = 0;
      for (let k = 0; k < this.h.length; k++) if (!(this.h[k] > this.b[k] + 1e-3)) empty++;
      if (empty !== this.emptyCount) {
        this.emptyCount = empty;
        const nx = this.nx, full = this.fullIdx, keep = [];
        const has = k => this.h[k] > this.b[k] + 1e-3;
        for (let q = 0; q < full.length; q += 6) {
          const a = full[q], b = full[q + 1], dd = full[q + 2], c = full[q + 5];
          if (has(a) || has(b) || has(c) || has(dd)) keep.push(full[q], full[q + 1], full[q + 2], full[q + 3], full[q + 4], full[q + 5]);
        }
        const ix = new THREE.BufferAttribute(new Uint32Array(keep), 1);
        this.top.setIndex(ix);
        this.bottomGeo.setIndex(ix);
      }
    }
    this.top.attributes.position.needsUpdate = true;
    this.top.computeVertexNormals();
    const wpos = this.walls.attributes.position.array;
    this.ring.forEach((g, k) => { wpos[k * 6 + 2] = Math.max(this.b[g], this.h[g]); });
    this.walls.attributes.position.needsUpdate = true;
    this.walls.computeVertexNormals();
  }

  dispose() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.geometry.dispose();
    }
    this.stock = null;
  }
}
