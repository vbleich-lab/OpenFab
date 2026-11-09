// Top-down height field of the model and drop-cutter queries for 3-axis toolpaths.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export function buildHeightmap(bodies, stock, res) {
  // MeshBVH reorders the index buffer, so work on copies of the render geometry.
  const bvhs = bodies.map(b => new MeshBVH(b.geometry.clone()));
  const minX = stock.minX, minY = stock.minY;
  const nx = Math.max(2, Math.round((stock.maxX - minX) / res) + 1);
  const ny = Math.max(2, Math.round((stock.maxY - minY) / res) + 1);
  const h = new Float32Array(nx * ny).fill(-Infinity);
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  const top = stock.top + 50;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      ray.origin.set(minX + i * res, minY + j * res, top);
      let best = -Infinity;
      for (const bvh of bvhs) {
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
        if (hit && hit.point.z > best) best = hit.point.z;
      }
      h[j * nx + i] = best;
    }
  }
  // step edges (wall tops): the real edge lies somewhere between a sample and its lower neighbour. Find it with
  // extra rays (bisection) and keep the last point on the upper surface as an extra sample of that cell, so a
  // cutter next to the wall keeps clear of it instead of dropping beside it up to one grid step too early.
  const at = (x, y) => {
    ray.origin.set(x, y, top);
    let best = -Infinity;
    for (const bvh of bvhs) { const hit = bvh.raycastFirst(ray, THREE.DoubleSide); if (hit && hit.point.z > best) best = hit.point.z; }
    return best;
  };
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const vStart = new Int32Array(nx * ny + 1), vPts = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, z = h[k];
    vStart[k] = vPts.length / 3;
    if (z === -Infinity) continue;
    const x0 = minX + i * res, y0 = minY + j * res;
    const found = [null, null, null, null]; // edge distance (in cells) found towards +x, -x, +y, -y
    dirs.forEach(([di, dj], q) => {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) return;
      const zn = h[jj * nx + ii];
      if (!(z - zn > res)) return; // no step towards this neighbour
      const thr = zn === -Infinity ? -Infinity : (z + zn) / 2;
      let a = 0, b = 1, za = z;
      for (let it = 0; it < 6; it++) {
        const m = (a + b) / 2, zm = at(x0 + di * res * m, y0 + dj * res * m);
        if (zm > thr) { a = m; za = zm; } else b = m;
      }
      if (q < 4) found[q] = { a, thr };
      if (a > 0) vPts.push(x0 + di * res * a, y0 + dj * res * a, za);
    });
    // convex corners: with an edge both along x and along y the corner itself lies near (edge x, edge y), which
    // none of the rays above reaches – search along the ray towards that point
    for (const [qx, qy] of [[0, 2], [0, 3], [1, 2], [1, 3]]) {
      const fx = found[qx], fy = found[qy];
      if (!fx || !fy) continue;
      const ex = dirs[qx][0] * res * fx.a, ey = dirs[qy][1] * res * fy.a;
      if (Math.hypot(ex, ey) < 1e-9) continue;
      const thr = Math.max(fx.thr, fy.thr);
      if (at(x0 + ex * 1.6, y0 + ey * 1.6) > thr) continue; // still on top there: no corner
      let a = 0, b = 1.6, za = z;
      for (let it = 0; it < 7; it++) {
        const m = (a + b) / 2, zm = at(x0 + ex * m, y0 + ey * m);
        if (zm > thr) { a = m; za = zm; } else b = m;
      }
      if (a > 0) vPts.push(x0 + ex * a, y0 + ey * a, za);
    }
  }
  vStart[nx * ny] = vPts.length / 3;
  // summed-area table of the edge samples per cell: a window without any is skipped in one look-up
  const vSum = new Int32Array((nx + 1) * (ny + 1));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    vSum[(j + 1) * (nx + 1) + i + 1] = vStart[k + 1] - vStart[k] + vSum[j * (nx + 1) + i + 1] + vSum[(j + 1) * (nx + 1) + i] - vSum[j * (nx + 1) + i];
  }
  return { minX, minY, nx, ny, res, h, vStart, vPts: new Float32Array(vPts), vSum };
}

// Lowest tool-tip Z at (x, y) without gouging the model.
export function dropCutter(hm, x, y, tool, floor) {
  const r = tool.dia / 2;
  const { minX, minY, nx, ny, res, h } = hm;
  const i0 = Math.max(0, Math.floor((x - r - minX) / res)), i1 = Math.min(nx - 1, Math.ceil((x + r - minX) / res));
  const j0 = Math.max(0, Math.floor((y - r - minY) / res)), j1 = Math.min(ny - 1, Math.ceil((y + r - minY) / res));
  const rr = r * r;
  const half = ((tool.angle || 90) / 2) * (Math.PI / 180);
  const tipR = (tool.tip || 0) / 2;
  let best = -Infinity;
  const at = (z, d2) => {
    if (tool.profile) {
      const pr = tool.profile, f = (Math.sqrt(d2) / r) * (pr.length - 1), k = Math.min(pr.length - 2, Math.floor(f)), w = f - k;
      return z - (pr[k][1] * (1 - w) + pr[k + 1][1] * w);
    }
    if (tool.type === 'ball') return z + Math.sqrt(rr - d2) - r;
    if (tool.type === 'chamfer' || tool.type === 'drill') return z - Math.max(0, Math.sqrt(d2) - tipR) / Math.tan(half);
    return z;
  };
  // extra samples on step edges (they lie within one grid step of their cell)
  if (hm.vPts) {
    const { vStart, vPts } = hm;
    const I0 = Math.max(0, Math.floor((x - r - res - minX) / res)), I1 = Math.min(nx - 1, Math.ceil((x + r + res - minX) / res));
    const J0 = Math.max(0, Math.floor((y - r - res - minY) / res)), J1 = Math.min(ny - 1, Math.ceil((y + r + res - minY) / res));
    const W = nx + 1, S = hm.vSum;
    const any = !S || (I0 <= I1 && J0 <= J1 && S[(J1 + 1) * W + I1 + 1] - S[J0 * W + I1 + 1] - S[(J1 + 1) * W + I0] + S[J0 * W + I0] > 0);
    if (any) for (let j = J0; j <= J1; j++) for (let i = I0; i <= I1; i++) {
      const k = j * nx + i;
      for (let v = vStart[k], ve = vStart[k + 1]; v < ve; v++) {
        const dx = vPts[v * 3] - x, dy = vPts[v * 3 + 1] - y, d2 = dx * dx + dy * dy;
        if (d2 > rr) continue;
        const c = at(vPts[v * 3 + 2], d2);
        if (c > best) best = c;
      }
    }
  }
  for (let j = j0; j <= j1; j++) {
    const dy = minY + j * res - y;
    for (let i = i0; i <= i1; i++) {
      const dx = minX + i * res - x;
      const d2 = dx * dx + dy * dy;
      if (d2 > rr) continue;
      const z = h[j * nx + i];
      if (z === -Infinity) continue;
      let c = z;
      if (tool.profile) {
        // form tool: height of the cutting edge above the tip at this radius
        const pr = tool.profile, f = (Math.sqrt(d2) / r) * (pr.length - 1), k = Math.min(pr.length - 2, Math.floor(f)), w = f - k;
        c = z - (pr[k][1] * (1 - w) + pr[k + 1][1] * w);
      } else if (tool.type === 'ball') c = z + Math.sqrt(rr - d2) - r;
      else if (tool.type === 'chamfer' || tool.type === 'drill') c = z - Math.max(0, Math.sqrt(d2) - tipR) / Math.tan(half);
      if (c > best) best = c;
    }
  }
  // flat end: the rim can rest on a slope between the grid points (a slope rising inside the circle is missed by
  // the point samples). Sample the rim on the bilinear surface, where the four cells around it are one continuous
  // surface – real steps are covered by the edge samples above.
  if (!tool.profile && tool.type !== 'ball' && tool.type !== 'chamfer' && tool.type !== 'drill' && r > 0) {
    const n = Math.max(16, Math.ceil((2 * Math.PI * r) / (res * 0.5))), lim = 2 * res;
    for (let q = 0; q < n; q++) {
      const a = (q / n) * 2 * Math.PI, fi = (x + r * Math.cos(a) - minX) / res, fj = (y + r * Math.sin(a) - minY) / res;
      const i = Math.floor(fi), j = Math.floor(fj);
      if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) continue;
      const k = j * nx + i, h00 = h[k], h10 = h[k + 1], h01 = h[k + nx], h11 = h[k + nx + 1];
      const lo = Math.min(h00, h10, h01, h11), hi = Math.max(h00, h10, h01, h11);
      if (lo === -Infinity || hi - lo > lim || hi <= best) continue;
      const u = fi - i, v = fj - j;
      const c = (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
      if (c > best) best = c;
    }
  }
  return Math.max(best, floor);
}
