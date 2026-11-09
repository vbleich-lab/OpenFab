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
  // per sample the mesh triangle it hit (body, face) and that triangle's normal (x, y; z > 0): dropCutter uses
  // them for exact contacts on sloped faces between the samples
  const tri = new Int32Array(nx * ny).fill(-1), triB = new Uint16Array(nx * ny), nrm = new Float32Array(nx * ny * 2);
  const geos = bvhs.map(b => ({ pos: b.geometry.attributes.position.array, idx: b.geometry.index.array }));
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  const top = stock.top + 50;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      ray.origin.set(minX + i * res, minY + j * res, top);
      let best = -Infinity, bb = -1, bf = -1;
      bvhs.forEach((bvh, b) => {
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
        if (hit && hit.point.z > best) { best = hit.point.z; bb = b; bf = hit.faceIndex; }
      });
      const k = j * nx + i;
      h[k] = best;
      if (bf >= 0) {
        const n = triNormal(geos[bb], bf);
        if (n) { tri[k] = bf; triB[k] = bb; nrm[2 * k] = n[0]; nrm[2 * k + 1] = n[1]; }
      }
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
  // every sloped triangle listed in each grid cell its outline covers: triangles smaller than the grid step are
  // found there even if no sample ray hit them
  const tOff = [0];
  geos.forEach(g => tOff.push(tOff[tOff.length - 1] + g.idx.length / 3));
  const nT = tOff[tOff.length - 1], tCnt = new Int32Array(nx * ny + 1), tBox = new Int32Array(nT * 4).fill(-1);
  geos.forEach((g, b) => {
    for (let f = 0; f < g.idx.length / 3; f++) {
      const v = triVerts(g, f);
      const ux = v[3] - v[0], uy = v[4] - v[1], wx = v[6] - v[0], wy = v[7] - v[1];
      if (Math.abs(ux) + Math.abs(uy) + Math.abs(wx) + Math.abs(wy) < 1e-12) continue; // degenerate in plan
      const i0 = Math.max(0, Math.floor((Math.min(v[0], v[3], v[6]) - minX) / res)), i1 = Math.min(nx - 1, Math.floor((Math.max(v[0], v[3], v[6]) - minX) / res));
      const j0 = Math.max(0, Math.floor((Math.min(v[1], v[4], v[7]) - minY) / res)), j1 = Math.min(ny - 1, Math.floor((Math.max(v[1], v[4], v[7]) - minY) / res));
      if (i1 < i0 || j1 < j0) continue;
      const t = (tOff[b] + f) * 4;
      tBox[t] = i0; tBox[t + 1] = i1; tBox[t + 2] = j0; tBox[t + 3] = j1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) tCnt[j * nx + i + 1]++;
    }
  });
  for (let k = 0; k < nx * ny; k++) tCnt[k + 1] += tCnt[k];
  const tList = new Int32Array(tCnt[nx * ny]), fill = tCnt.slice(0, nx * ny);
  for (let t = 0; t < nT; t++) {
    if (tBox[t * 4] < 0) continue;
    for (let j = tBox[t * 4 + 2]; j <= tBox[t * 4 + 3]; j++) for (let i = tBox[t * 4]; i <= tBox[t * 4 + 1]; i++) tList[fill[j * nx + i]++] = t;
  }
  const tv = new Float64Array(nT * 9), tz = new Float64Array(nT);
  geos.forEach((g, b) => {
    for (let f = 0; f < g.idx.length / 3; f++) {
      const v = triVerts(g, f), t = tOff[b] + f;
      tv.set(v, t * 9);
      tz[t] = Math.max(v[2], v[5], v[8]);
    }
  });
  // highest corner of all triangles listed per cell: a cell below the current tip height is skipped at once
  const cellTz = new Float64Array(nx * ny).fill(-Infinity);
  for (let k = 0; k < nx * ny; k++) for (let e = tCnt[k]; e < tCnt[k + 1]; e++) if (tz[tList[e]] > cellTz[k]) cellTz[k] = tz[tList[e]];
  const tris = { start: tCnt, list: tList, tv, tz, cellTz, stamp: new Uint32Array(nT), cellStamp: new Uint32Array(nx * ny), gen: 0 };
  return { minX, minY, nx, ny, res, h, vStart, vPts: new Float32Array(vPts), vSum, tri, triB, nrm, geos, tris };
}

// ---- exact contacts with single mesh triangles ----
function triVerts(g, f) {
  const I = g.idx, P = g.pos, a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
  return [P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]];
}
// unit normal pointing up (null for vertical or degenerate triangles)
function triNormal(g, f) {
  const v = triVerts(g, f);
  const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2], wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
  let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  const L = Math.hypot(nx, ny, nz);
  if (!(L > 1e-12)) return null;
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
  nz /= L;
  return nz < 0.02 ? null : [nx / L, ny / L, nz];
}
function inTri2(V, o, x, y) {
  const d1 = (x - V[o + 3]) * (V[o + 1] - V[o + 4]) - (V[o + 0] - V[o + 3]) * (y - V[o + 4]);
  const d2 = (x - V[o + 6]) * (V[o + 4] - V[o + 7]) - (V[o + 3] - V[o + 6]) * (y - V[o + 7]);
  const d3 = (x - V[o + 0]) * (V[o + 7] - V[o + 1]) - (V[o + 6] - V[o + 0]) * (y - V[o + 1]);
  const e = 1e-12;
  return !((d1 < -e || d2 < -e || d3 < -e) && (d1 > e || d2 > e || d3 > e));
}
// Lowest tip Z of a ball (radius r) or flat cutter at (x, y) touching triangle v: facet, edges and corners.
export function dropTri(V, o, x, y, r, ball) {
  let best = -Infinity;
  const rr = r * r;
  // facet
  const ux = V[o + 3] - V[o + 0], uy = V[o + 4] - V[o + 1], uz = V[o + 5] - V[o + 2], wx = V[o + 6] - V[o + 0], wy = V[o + 7] - V[o + 1], wz = V[o + 8] - V[o + 2];
  let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  const L = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (L > 1e-12) {
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nx /= L; ny /= L; nz /= L;
    if (nz > 1e-6) {
      const plane = (qx, qy) => V[o + 2] - (nx * (qx - V[o + 0]) + ny * (qy - V[o + 1])) / nz;
      if (ball) {
        const qx = x - r * nx, qy = y - r * ny;
        if (inTri2(V, o, qx, qy)) best = plane(qx, qy) + r * nz - r; // centre = contact + r * n
      } else {
        const lh = Math.sqrt(nx * nx + ny * ny);
        const qx = lh > 1e-9 ? x - (r * nx) / lh : x, qy = lh > 1e-9 ? y - (r * ny) / lh : y;
        if (inTri2(V, o, qx, qy)) best = plane(qx, qy);
      }
    }
  }
  for (let e = 0; e < 3; e++) {
    const a = e * 3, b = ((e + 1) % 3) * 3;
    const Px = V[o + a], Py = V[o + a + 1], Pz = V[o + a + 2];
    // corner
    const dx = Px - x, dy = Py - y, d2 = dx * dx + dy * dy;
    if (d2 <= rr) { const c = ball ? Pz + Math.sqrt(rr - d2) - r : Pz; if (c > best) best = c; }
    const Dx = V[o + b] - Px, Dy = V[o + b + 1] - Py, Dz = V[o + b + 2] - Pz, Lseg = Math.sqrt(Dx * Dx + Dy * Dy + Dz * Dz);
    if (!(Lseg > 1e-12)) continue;
    if (ball) {
      // centre (x, y, z) at distance r from the edge line: quadratic in z, contact inside the segment
      const ex = Dx / Lseg, ey = Dy / Lseg, ez = Dz / Lseg;
      const w0x = x - Px, w0y = y - Py, w0z = -Pz, wd = w0x * ex + w0y * ey + w0z * ez;
      const A = 1 - ez * ez;
      if (A < 1e-12) continue;
      const B = 2 * (w0z - wd * ez), C = w0x * w0x + w0y * w0y + w0z * w0z - wd * wd - rr;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const z = (-B + Math.sqrt(disc)) / (2 * A), t = wd + z * ez;
      if (t >= 0 && t <= Lseg) { const c = z - r; if (c > best) best = c; }
    } else {
      // flat: where the edge crosses the rim circle
      const A = Dx * Dx + Dy * Dy;
      if (A < 1e-18) continue;
      const B = 2 * ((Px - x) * Dx + (Py - y) * Dy), C = (Px - x) * (Px - x) + (Py - y) * (Py - y) - rr;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      for (const sv of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) if (sv >= 0 && sv <= 1) { const c = Pz + sv * Dz; if (c > best) best = c; }
    }
  }
  return best;
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
  // exact contacts with single mesh triangles (facet, edges, corners), looked up in the cell lists around
  // where a contact is expected - the point samples alone let the cutter sink between them by up to ~res²/2r
  if (hm.tris && !tool.profile && tool.type !== 'chamfer' && tool.type !== 'drill') {
    const ball = tool.type === 'ball', { tri, nrm, tris } = hm, m = res * 1.5;
    const { start, list, tv, tz, cellTz, stamp, cellStamp } = tris;
    if (++tris.gen >= 0xffffffff) { stamp.fill(0); cellStamp.fill(0); tris.gen = 1; }
    const gen = tris.gen;
    const testAround = (qx, qy) => {
      // the 2 x 2 cells within half a step of q
      const ci = Math.floor((qx - minX) / res - 0.5), cj = Math.floor((qy - minY) / res - 0.5);
      for (let b = Math.max(0, cj); b <= Math.min(ny - 1, cj + 1); b++) for (let a = Math.max(0, ci); a <= Math.min(nx - 1, ci + 1); a++) {
        const kk = b * nx + a;
        if (cellStamp[kk] === gen || cellTz[kk] <= best) continue;
        cellStamp[kk] = gen;
        for (let e = start[kk]; e < start[kk + 1]; e++) {
          const t = list[e];
          if (stamp[t] === gen || tz[t] <= best) continue; // the tip cannot rise above the triangle's top corner
          stamp[t] = gen;
          const c = dropTri(tv, t * 9, x, y, r, ball);
          if (c > best) best = c;
        }
      }
    };
    const I0 = Math.max(0, Math.floor((x - r - res - minX) / res)), I1 = Math.min(nx - 1, Math.ceil((x + r + res - minX) / res));
    const J0 = Math.max(0, Math.floor((y - r - res - minY) / res)), J1 = Math.min(ny - 1, Math.ceil((y + r + res - minY) / res));
    // ball on a flat face: the contact lies right below the centre
    if (ball) testAround(x, y);
    // sloped faces: each sample knows its triangle's normal and so where the cutter would touch that plane
    for (let j = J0; j <= J1; j++) {
      const py = minY + j * res;
      for (let i = I0; i <= I1; i++) {
        const k = j * nx + i;
        if (tri[k] < 0) continue;
        const ax = nrm[2 * k], ay = nrm[2 * k + 1], lh = Math.sqrt(ax * ax + ay * ay);
        if (lh < 1e-3) continue; // horizontal
        let qx, qy;
        if (ball) { qx = x - r * ax; qy = y - r * ay; } else { qx = x - (r * ax) / lh; qy = y - (r * ay) / lh; }
        if (Math.abs(qx - (minX + i * res)) > m || Math.abs(qy - py) > m) continue;
        testAround(qx, qy);
      }
    }
    // step edges (wall tops): their edge samples lie within one grid step of the real edge
    if (hm.vPts) {
      const { vStart, vPts } = hm, lim = (r + res) * (r + res), W = nx + 1, S = hm.vSum;
      if (!S || S[(J1 + 1) * W + I1 + 1] - S[J0 * W + I1 + 1] - S[(J1 + 1) * W + I0] + S[J0 * W + I0] > 0)
        for (let j = J0; j <= J1; j++) for (let i = I0; i <= I1; i++) {
          const k = j * nx + i;
          for (let v = vStart[k], ve = vStart[k + 1]; v < ve; v++) {
            const ex = vPts[v * 3], ey = vPts[v * 3 + 1];
            if ((ex - x) * (ex - x) + (ey - y) * (ey - y) <= lim) testAround(ex, ey);
          }
        }
    }
  }
  return Math.max(best, floor);
}
