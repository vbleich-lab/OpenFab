// WerkFab icon set: line drawings in the text colour plus two-tone shading.
// Classes (colours in css/style.css, light and dark theme):
//   f1 / f2 / f3   light / mid / dark face of a body (isometric view: top, left, right)
//   a  / af        accent line / accent area (direction, new geometry)
//   r  / rf        red line / area (removed material)       g   green line
//   k              solid in the text colour (small marks)
const svg = body => `<svg viewBox="0 0 24 24">${body}</svg>`;
const P = (d, c) => `<path d="${d}"${c ? ` class="${c}"` : ''}/>`;
const C = (cx, cy, r, c) => `<circle cx="${cx}" cy="${cy}" r="${r}"${c ? ` class="${c}"` : ''}/>`;
const E = (cx, cy, rx, ry, c) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${c ? ` class="${c}"` : ''}/>`;
const R = (x, y, w, h, c, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''}${c ? ` class="${c}"` : ''}/>`;

// isometric box: centre x, top corner y, half width w, height h
function isoBox(cx, ty, w, h, cls = ['f1', 'f2', 'f3']) {
  const t = w / 2;
  return P(`M${cx} ${ty}l${w} ${t} ${-w} ${t} ${-w} ${-t}z`, cls[0])
    + P(`M${cx - w} ${ty + t}l${w} ${t}v${h}l${-w} ${-t}z`, cls[1])
    + P(`M${cx + w} ${ty + t}l${-w} ${t}v${h}l${w} ${-t}z`, cls[2]);
}
// upright cylinder: centre x, top y, radii, height
function isoCyl(cx, ty, rx, ry, h, top = 'f1', side = 'f2') {
  return P(`M${cx - rx} ${ty}v${h}a${rx} ${ry} 0 0 0 ${2 * rx} 0v${-h}`, side) + E(cx, ty, rx, ry, top);
}
const plate = (cls = ['f1', 'f2', 'f3']) => isoBox(12, 9, 9, 3.5, cls);   // flat slab for CAM/feature icons
const arrowUp = (x, y1, y2, c = 'a') => P(`M${x} ${y1}V${y2}M${x - 2.2} ${y2 + 2.2}L${x} ${y2}l2.2 2.2`, c);
const doc = inner => P('M6 3h8.5L19 7.5V21H6z', 'f1') + P('M14.5 3v4.5H19') + inner;
const pt = (x, y) => C(x, y, 1.5, 'af');

export const ICONS = {
  // ---------- netz ----------
  mesh: svg(P('M3 19 12 4l9 15z', 'f2') + P('M7.5 11.5h9M12 4v15M7.5 11.5 12 19l4.5-7.5')),
  mesh_repair: svg(P('M3 19 12 4l9 15z', 'f2') + P('M8.5 14l2.5 2.5 4.5-5.5', 'g')),
  mesh_reduce: svg(P('M3 19 12 4l9 15z', 'f2') + P('M8 19 12 12l4 7', 'a')),
  mesh_smooth: svg(P('M3 18c3-9 6-12 9-12s6 3 9 12z', 'f2') + P('M7 13c2-3 4-4 5-4', 'a')),
  mesh_cut: svg(P('M3 19 12 4l9 15z', 'f2') + P('M2 12h20', 'r')),
  mesh_transform: svg(P('M3 19 12 4l9 15z', 'f1') + P('M12 9v10M7 14h10M12 9l-2 2M12 9l2 2', 'a')),
  mesh_flip: svg(P('M3 19 12 4l9 15z', 'f2') + P('M12 9v6M10 13l2 2 2-2', 'a')),
  mesh_split: svg(P('M2 19 7 9l5 10z', 'f2') + P('M12 15 17 5l5 10z', 'f3')),
  mesh_mirror: svg(P('M12 3v18', 'a').replace('/>', ' stroke-dasharray="2 2"/>') + P('M9.5 6 3.5 18h6z', 'f2') + P('M5.5 14h4M7.5 10v8') + P('M14.5 6l6 12h-6z', 'f1')),
  mesh_combine: svg(P('M2 19 8 8l6 11z', 'f2') + P('M10 19 16 8l6 11z', 'f1') + P('M12 5v6M9 8h6', 'a')),
  mesh_boolean: svg(P('M2 19 8 8l6 11z', 'f2') + P('M10 19 16 8l6 11z', 'f1') + P('M10 19l2-3.7 2 3.7z', 'af')),
  mesh_refine: svg(P('M3 19 12 4l9 15z', 'f2') + P('M7.5 11.5h9M7.5 11.5 12 19l4.5-7.5M5.25 15.25h13.5M9.75 7.75h4.5', 'a')),
  mesh_tobody: svg(P('M2 14 6 6l4 8z', 'f2') + P('M4 10h4M6 6v8') + P('M10 11h4M12 9l2 2-2 2', 'a') + P('M15 9l4-2 3 2v7l-4 2-3-2z', 'f1') + P('M15 9l3 2 4-2M18 11v7')),
  mesh_frombody: svg(P('M2 9l4-2 3 2v7l-4 2-3-2z', 'f1') + P('M2 9l3 2 4-2M5 11v7') + P('M10 11h4M12 9l2 2-2 2', 'a') + P('M14 16 18 7l4 9z', 'f2') + P('M16 11.5h4M18 7v9')),
  mesh_section: svg(P('M3 19 12 4l9 15z', 'f2') + P('M2 13h20', 'r') + P('M8.4 13h7.2', 'a').replace('/>', ' stroke-width="2.4"/>')),

  // ---------- skizze ----------
  sketch: svg(R(3, 13, 14, 8, 'f1', 1) + P('M8 19h3.5L21 9.5l-3.5-3.5L8 15.5z', 'f2') + P('M16 7.5l3.5 3.5') + P('M8 19l1.2-3.3 2.1 2.1z', 'k')),
  select: svg(P('M6 3l12 8-5.5 1.5L10 18z', 'f1')),
  line: svg(P('M5 19L19 5') + pt(5, 19) + pt(19, 5)),
  rect: svg(R(4, 6, 16, 12, 'f1') + pt(4, 6) + pt(20, 18)),
  circle: svg(C(12, 12, 8, 'f1') + C(12, 12, 1.2, 'af') + P('M12 12l5.7-5.7', 'a')),
  ngon: svg(P('M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'f1') + C(12, 12, 1.2, 'af')),
  arc: svg(P('M4 18a9 9 0 0 1 16 0') + pt(4, 18) + pt(20, 18) + pt(12, 9)),
  ellipse: svg(E(12, 12, 9, 5.5, 'f1').replace('/>', ' transform="rotate(-20 12 12)"/>') + C(12, 12, 1.2, 'af')),
  spline: svg(P('M3 17c3-9 6-9 8-5s5 4 10-6') + pt(3, 17) + pt(11, 12) + pt(21, 6)),
  slot: svg(R(3, 8, 18, 8, 'f1', 4) + C(7, 12, 1.1, 'af') + C(17, 12, 1.1, 'af')),
  text: svg(P('M5 6V4h14v2M12 4v16M9 20h6') + P('M5 4h14', 'a')),
  offset: svg(R(3, 3, 18, 18, 'a', 3).replace('/>', ' stroke-dasharray="3 2"/>') + R(7, 7, 10, 10, 'f1', 1)),
  sketchMirror: svg(P('M12 3v18', 'a').replace('/>', ' stroke-dasharray="2 2"/>') + P('M9 6L4 18h5z', 'f1') + P('M15 6l5 12h-5z', 'f2')),
  sketchPattern: svg(R(3, 3, 6, 6, 'f1') + R(15, 3, 6, 6, 'f2') + R(3, 15, 6, 6, 'f2') + R(15, 15, 6, 6, 'f2') + P('M10.5 6h3M6 10.5v3', 'a')),
  rectc: svg(R(4, 6, 16, 12, 'f1') + C(12, 12, 1.5, 'af') + P('M12 12l8 6', 'a').replace('/>', ' stroke-dasharray="2 1.5"/>') + C(20, 18, 1.5, 'af')),
  rect3: svg(P('M3 15 13 5l8 8-10 10z', 'f1').replace('M3 15 13 5l8 8-10 10z', 'M3 14 12 5l7 7-9 9z') + C(3, 14, 1.5, 'af') + C(12, 5, 1.5, 'af') + C(19, 12, 1.5, 'af')),
  circle2: svg(C(12, 12, 8, 'f1') + P('M4 12h16', 'a').replace('/>', ' stroke-dasharray="2 1.5"/>') + C(4, 12, 1.5, 'af') + C(20, 12, 1.5, 'af')),
  circle3: svg(C(12, 12, 8, 'f1') + C(4.7, 8.6, 1.5, 'af') + C(18, 6.7, 1.5, 'af') + C(14.5, 19.6, 1.5, 'af')),
  arcc: svg(P('M20 12a8 8 0 0 0-8-8') + P('M12 12 20 12M12 12 12 4', 'a').replace('/>', ' stroke-dasharray="2 1.5"/>') + C(12, 12, 1.5, 'af') + C(20, 12, 1.5, 'af') + C(12, 4, 1.5, 'af')),
  arct: svg(P('M3 18h9') + P('M12 18a7 7 0 0 0 7-7V5', 'a') + C(12, 18, 1.5, 'af') + C(19, 5, 1.5, 'af')),
  emboss: svg(isoCyl(12, 5, 8, 3, 14, 'f1', 'f2') + P('M7 12.5v5M7 12.5h2.6M7 15h2M12 12.8v5.4M12 12.8l3 5.4v-5.4', 'a')),
  trim: svg(P('M3 12h7', '') + P('M10 12h11', 'r').replace('/>', ' stroke-dasharray="2 1.6"/>') + P('M10 4v16') + P('M15 6.5l4 4M19 6.5l-4 4', 'r')),
  extend: svg(P('M3 12h9') + P('M12 12h7', 'a').replace('/>', ' stroke-dasharray="2 1.6"/>') + P('M20 4v16') + P('M15.5 9.5 18 12l-2.5 2.5', 'a')),
  chamfer2d: svg(P('M3 20h8l10-10V4', 'f1') + P('M11 20l10-10', 'a')),
  project: svg(P('M4 15l8-4 8 4-8 4z', 'f1') + P('M12 3v8M9 8l3 3 3-3', 'a') + P('M8 6l4-2 4 2-4 2z', 'f2')),
  finish: svg(P('M5 12l5 5 9-10', 'g')),
  fit: svg(R(7, 7, 10, 10, 'f1', 1) + P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', 'a')),

  // ---------- volumenkörper ----------
  extrude: svg(isoBox(12, 8, 7, 7) + P('M5 19.5l7 3.5 7-3.5', 'a') + arrowUp(12, 9, 2)),
  box: svg(isoBox(12, 3, 8, 9)),
  cylinder: svg(isoCyl(12, 6, 7, 2.6, 12)),
  sphere: svg(C(12, 12, 8.5, 'f2') + E(12, 12, 8.5, 3, 'f1') + P('M7 7.5a6 6 0 0 1 4-2', 'a')),
  torus: svg(E(12, 12.5, 9.5, 5.5, 'f2') + E(12, 11.8, 4, 1.8, 'f1') + P('M4.5 11c1.5-2.5 4.5-3.5 7.5-3.5', 'a')),
  revolve: svg(P('M12 2v20', 'a').replace('/>', ' stroke-dasharray="2 2"/>') + P('M12 5c5 0 7.5 2.5 7.5 7s-2.5 7-7.5 7z', 'f2') + P('M12 5c-3 0-5 2.5-5 7s2 7 5 7z', 'f1') + P('M17 3.5l2.5 1.5-1 2.6', 'a')),
  hole: svg(isoBox(12, 6, 9, 6) + E(12, 10.5, 3.6, 1.8, 'k') + P('M12 2v6', 'a') + P('M10.2 6.3 12 8.1l1.8-1.8', 'a')),
  sweep: svg(P('M3 20c0-8 6-14 17-14', 'a').replace('/>', ' stroke-dasharray="2 2"/>') + P('M2.5 19c0-9 7-15 18-15v5c-8 0-13 4-13 10z', 'f2') + E(5, 19, 2.5, 1.2, 'f1')),
  loft: svg(P('M5 17l3.5-10h7L19 17z', 'f2') + E(12, 7, 3.5, 1.4, 'f1') + R(5, 16, 14, 4, 'f1')),
  rib: svg(P('M3 20h18M3 20V9M21 20V9') + P('M9.5 20l1-10h3l1 10z', 'af')),
  pipe: svg(P('M4 19V10a6 6 0 0 1 6-6h11v5H10a1 1 0 0 0-1 1v9z', 'f2') + E(6.5, 19, 2.5, 1.1, 'f1') + E(21, 6.5, 1.1, 2.5, 'f1')),
  coil: svg(P('M6 5c6-2 12 0 12 1.5S6 9 6 10.5s12 1 12 2.5-12 1.5-12 3 12 1 12 2.5', 'a') + P('M12 2v20', '').replace('/>', ' stroke-dasharray="1.5 2" opacity=".5"/>')),
  thread: svg(isoCyl(12, 4.5, 5, 2, 15) + P('M7 8.5l10 2M7 12l10 2M7 15.5l10 2', 'a')),
  presspull: svg(isoBox(12, 9, 8, 9) + P('M12 9l8 4-8 4-8-4z', 'af').replace('/>', ' opacity=".55"/>') + P('M12 13V2M9.6 4.4 12 2l2.4 2.4', 'a')),
  appearance: svg(C(10, 13, 7.5, 'f2') + P('M5.5 10.5a5 5 0 0 1 4-3.2', 'a') + C(18, 6, 3.5, 'af') + C(18, 6, 1.2, 'f1')),
  fillet: svg(P('M4 20V11a7 7 0 0 1 7-7h9v16z', 'f1') + P('M4 11a7 7 0 0 1 7-7', 'a')),
  edgechamfer: svg(P('M4 20V10l6-6h10v16z', 'f1') + P('M4 10l6-6', 'a')),
  shell: svg(isoBox(12, 4, 8.5, 10) + P('M12 6.5l5 2.5-5 2.5-5-2.5z', 'f3')),
  draft: svg(P('M4 20h16l-3-14H7z', 'f1') + P('M7 6l-1.6 7.5M17 6l1.6 7.5', 'a') + P('M7 6V3M17 6V3').replace('/>', ' stroke-dasharray="1.5 1.5"/>')),
  split: svg(isoBox(12, 4, 8, 11) + P('M2 13.5l20-5', 'r')),
  combine: svg(C(9, 12, 6.5, 'f2') + C(15, 12, 6.5, 'f1') + P('M12 6.6a6.5 6.5 0 0 1 0 10.8', 'a')),
  move: svg(R(8, 8, 8, 8, 'f1', 1) + P('M12 2v5M12 17v5M2 12h5M17 12h5M12 2l-2 2M12 2l2 2M12 22l-2-2M12 22l2-2M2 12l2-2M2 12l2 2M22 12l-2-2M22 12l-2 2', 'a')),
  scale: svg(R(3, 11, 10, 10, 'f2') + R(3, 3, 18, 18, '').replace('/>', ' stroke-dasharray="2 2"/>') + P('M13 11l7-7M15.5 4H20v4.5', 'a')),
  mirror: svg(P('M12 3v18', 'a').replace('/>', ' stroke-dasharray="2 2"/>') + P('M9.5 6L3.5 18h6z', 'f2') + P('M14.5 6l6 12h-6z', 'f1')),
  patternRect: svg(R(3, 3, 6, 6, 'f2') + R(11, 3, 6, 6, 'f1') + R(3, 11, 6, 6, 'f1') + R(11, 11, 6, 6, 'f1') + P('M17.5 17.5l3.5 3.5M21 17.5V21h-3.5', 'a')),
  patternCirc: svg(C(12, 12, 7.5, 'a').replace('/>', ' stroke-dasharray="2 2"/>') + C(12, 4.5, 2.4, 'f2') + C(18.5, 15.8, 2.4, 'f1') + C(5.5, 15.8, 2.4, 'f1')),
  freeform: svg(P('M3 19h18') + P('M3 16c3-7 5-9 9-9s6 3 9 9z', 'f1') + P('M7 12.5v6.5M12 7v12M17 10v9', 'a').replace('/>', ' stroke-dasharray="1.5 1.5"/>')),
  plane: svg(P('M2.5 17l5-9h14l-5 9z', 'f1') + arrowUp(12, 12.5, 3)),
  planeAngle: svg(P('M3 19h14', '') + P('M3 19l9-13', 'a') + P('M8.5 19a5.5 5.5 0 0 0-2.3-4.4') + P('M3 19l14 0 4-6H7z', 'f1').replace('/>', ' opacity=".7"/>')),
  planeMid: svg(P('M3 5h15l3 3H6z', 'f2') + P('M3 17h15l3 3H6z', 'f2') + P('M3 11h15l3 3H6z', 'f1') + P('M12 11v3', 'a')),
  planeTangent: svg(isoCyl(9, 7, 5.5, 2.2, 11, 'f1', 'f2') + P('M14.5 3l6 3v14l-6-3z', 'af').replace('/>', ' opacity=".55"/>')),
  patternPath: svg(P('M3 19c4-1 6-12 18-14', 'a').replace('/>', ' stroke-dasharray="2 2"/>') + R(2, 15, 5, 5, 'f2') + R(8.5, 8.5, 5, 5, 'f1') + R(16, 3, 5, 5, 'f1')),
  plane3pt: svg(P('M2.5 17l5-9h14l-5 9z', 'f1') + C(5.5, 15.5, 1.7, 'af') + C(10, 9.5, 1.7, 'af') + C(17.5, 12, 1.7, 'af')),
  axisCyl: svg(isoCyl(12, 7, 6, 2.4, 11, 'f1', 'f2') + P('M12 2v20', 'a').replace('/>', ' stroke-dasharray="3 2"/>')),
  axis2pt: svg(P('M3 21 21 3', 'a').replace('/>', ' stroke-dasharray="3 2"/>') + C(7, 17, 2, 'af') + C(17, 7, 2, 'af')),
  axisPlanes: svg(P('M2 16l6-6h14l-6 6z', 'f1') + P('M9 3v13l6 5V8z', 'f2') + P('M12 2v20', 'a')),
  cpoint: svg(P('M12 3v18M3 12h18', '').replace('/>', ' opacity=".35"/>') + C(12, 12, 3.6, 'af')),
  flat: svg(P('M3 8h18v8H3z', 'f1') + P('M8 8v8M16 8v8', 'a').replace('/>', ' stroke-dasharray="2 1.5"/>') + P('M3 8h18v8H3z')),
  nest: svg(R(2, 4, 20, 16, 'f1', 1) + R(4, 6, 7, 5, 'f2') + R(12.5, 6, 7.5, 5, 'f2') + R(4, 13, 10, 5, 'f2') + R(15.5, 13, 4.5, 5, 'f2')),
  flat_dxf: svg(P('M3 6h18v8H3z', 'f1') + P('M8 6v8M16 6v8', 'a').replace('/>', ' stroke-dasharray="2 1.5"/>') + P('M12 15v6M9.5 18.5 12 21l2.5-2.5', 'a')),
  sheet: svg(P('M4 15l8-4 8 4-8 4z', 'f1') + P('M4 15v2l8 4v-2zM12 19v2l8-4v-2z', 'f2') + P('M12 11V5l8-4', 'a')),
  section: svg(isoBox(12, 3, 8, 9) + P('M2 14l20-6', 'a').replace('/>', ' stroke-dasharray="3 2"/>')),
  component: svg(isoBox(11, 6, 7, 7) + P('M19 2v6M16 5h6', 'a')),
  derive: svg(isoBox(9, 3, 6, 6) + P('M15 15l3.5 3.5L22 15M18.5 10v8.5', 'a')),
  import: svg(P('M4 14v6h16v-6', '') + R(4, 16, 16, 4, 'f1') + P('M12 3v11M8 10l4 4 4-4', 'a')),

  // ---------- prüfen ----------
  measure: svg(P('M3 17L17 3l4 4L7 21z', 'f1') + P('M7 13l2 2M10 10l2 2M13 7l2 2', 'a')),
  zebra: svg(C(12, 12, 8.5, 'f1') + P('M5 7l14 4M3.8 12l16 4.5M6 17.5l9 2.5')),
  draftAn: svg(P('M4 20l4-14h8l4 14z', 'f1') + P('M8 6l-2 7', 'r') + P('M16 6l2 7', 'g')),
  curv: svg(P('M3 19c5-12 13-12 18 0z', 'f1') + P('M6 13l-2-3M9 10l-1-3.5M12 8.5V4.5M15 10l1-3.5M18 13l2-3', 'a')),
  params: svg(P('M5 4c-2 4-2 12 0 16M19 4c2 4 2 12 0 16') + P('M9 9l6 6M15 9l-6 6', 'a')),

  // ---------- fertigung ----------
  setup: svg(isoBox(12, 11, 8.5, 5) + P('M12 1.5v8M9.5 7 12 9.5 14.5 7', 'a') + C(12, 15.25, 1.3, 'af')),
  face: svg(plate() + P('M7 10.5h10', 'a') + R(10, 1.5, 4, 6, 'f2', .8)),
  contour: svg(plate() + P('M3 13.5l9 4.5 9-4.5', 'a') + R(10, 1.5, 4, 6, 'f2', .8)),
  pocket: svg(plate() + P('M12 11l4.5 2.25L12 15.5l-4.5-2.25z', 'f3') + P('M12 11l4.5 2.25L12 15.5l-4.5-2.25z', 'a')),
  adaptive: svg(plate() + P('M12 11.5c2.5 0 3 1.2 1.5 2-2 1-5 .5-5.5-.5s1.5-2.5 4-2.5 6 .8 6 2.5', 'a')),
  drill: svg(plate() + E(12, 13.5, 2.4, 1.2, 'k') + P('M12 1.5v8M10 7.5 12 11l2-3.5', 'a')),
  bore: svg(plate() + E(12, 13.5, 4, 2, 'k') + P('M9 6c2-1.2 4-1.2 6 0M9 9c2-1.2 4-1.2 6 0', 'a')),
  trace: svg(plate() + P('M5 12c3-2 5 2 7 0s4-2 7 0', 'a')),
  chamferCam: svg(plate() + P('M3 12.5l9 4.5 9-4.5', 'a')),
  rough3d: svg(P('M3 19h18') + R(4, 15, 16, 3, 'f2') + R(6, 11, 12, 3, 'f2') + R(9, 7, 6, 3, 'f1') + P('M4 15h16M6 11h12M9 7h6', 'a')),
  adaptive3d: svg(P('M3 19h18') + P('M3 19c3-8 6-11 9-11s6 3 9 11z', 'f1') + P('M5 15c2-3 4-3 5 0s3 3 4 0 3-3 5 0', 'a')),
  pocket3d: svg(P('M3 19h18') + R(4, 9, 16, 9, 'f1', 1) + R(7, 11, 10, 4, 'f3', .5) + P('M7 13h10', 'a')),
  rough32: svg(P('M3 19h12') + R(5, 15, 8, 3, 'f2') + R(7, 11, 4, 3, 'f1') + P('M15 4l5 5M17 4h3v3M14 14l5-5', 'a')),
  flat3d: svg(P('M3 17l5-6h8l5 6z', 'f1') + P('M9 12h6M8.5 13.5h7', 'a')),
  ramp3d: svg(P('M4 19h16') + P('M4 19l3-14h10l3 14z', 'f1') + P('M5 15l14-2M6 11l12-2M8 7l8-1.5', 'a')),
  pencil3d: svg(P('M3 6v13h18') + P('M3 19V12c4 0 3 4 7 4h11v3z', 'f1') + P('M5 17c4 0 3-4 7-4', 'a') + P('M3.5 18.5l3-3', 'a')),
  morphspiral3d: svg(R(3, 4, 18, 16, 'f1', 5) + R(7, 8, 10, 8, 'a', 3) + P('M11 12h2', 'a')),
  blend3d: svg(P('M3 7c5-4 13-4 18 0v11c-5 2-13 2-18 0z', 'f1') + P('M3 11c5-2 13-2 18 1M3 14.5c5 0 13 0 18 2', 'a')),
  guidemorph3d: svg(P('M3 6c5-3 13-3 18 0v12c-5 2-13 2-18 0z', 'f1') + P('M6 5v14M10 4.3v15.4M14 4.3v15.4M18 5v14', 'a')),
  corner3d: svg(P('M4 4v15h16z', 'f1') + P('M4 13c3 0 6 3 6 6M4 9c5 0 10 5 10 10', 'a') + C(6.5, 16.5, 1.4, 'af')),
  flow3d: svg(P('M3 16c4-8 14-8 18 0v4H3z', 'f1') + P('M5 18c3-6 11-6 14 0M7 20c2-4 8-4 10 0', 'a')),
  morph3d: svg(P('M3 17c3-10 15-10 18 0z', 'f1') + P('M7 16c2-6 8-6 10 0z', 'a')),
  deburr3d: svg(P('M4 20V9l5-5h11v16z', 'f1') + P('M4 9l5-5', 'a') + C(8.5, 7.5, 1.6, 'af')),
  geodesic3d: svg(P('M3 17c3-9 15-9 18 0z', 'f1') + P('M6 17c2-6 10-6 12 0M9 17c1-3 5-3 6 0', 'a') + P('M3 19h18')),
  parallel3d: svg(P('M3 19c3-9 6-9 9-3s6 6 9-3v6H3z', 'f1') + P('M3 13c3-9 6-9 9-3s6 6 9-3', 'a')),
  sim: svg(C(12, 12, 9.5, 'f1') + P('M9.5 7.5l7 4.5-7 4.5z', 'af')),
  post: svg(doc(P('M9 11h7M9 14.5h7M9 18h4', 'a') + P('M9 7.5h3'))),
  tools: svg(R(10, 2, 4, 7, 'f2', .5) + P('M9 9h6l-1 12h-4z', 'f1') + P('M10 12l4 1.5M10 15.5l4 1.5', 'a')),
  holder3d: svg(P('M8 3h8v4l-2 3v4h-4v-4L8 7z', 'f2') + P('M11 14v7h2v-7z', 'f1') + P('M11 17h2', 'a')),
  formtool: svg(R(9, 2, 6, 7, 'f2', .5) + P('M9 9v5l-2 3 3 2 2-3 2 3 3-2-2-3V9z', 'f1') + P('M7 17l3 2 2-3 2 3 3-2', 'a')),
  material: svg(R(3, 3, 18, 18, 'f1', 2) + P('M3 3h6v6H3zM15 3h6v6h-6zM9 9h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z', 'f3')),
  gear: svg(C(12, 12, 6.5, 'f1') + C(12, 12, 2.6, 'af') + P('M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1')),

  // ---------- dateien & verwalten ----------
  example: svg(doc(isoBox(12.5, 10, 4, 3.5))),
  svgfile: svg(doc(P('M8 17c2-6 5 2 8-4', 'a'))),
  dxffile: svg(doc(P('M8.5 17h7M8.5 17v-5M8.5 12l7 5', 'a'))),
  template: svg(doc(P('M9 11h7M9 14h7M9 17h4', 'a'))),
  exportdef: svg(doc(P('M12.5 10v7.5M9.5 14.5l3 3 3-3', 'a'))),
  importdef: svg(doc(P('M12.5 17.5V10M9.5 13l3-3 3 3', 'a'))),
  resetdef: svg(P('M4 12a8 8 0 1 0 3-6.2', 'a') + P('M4 4v4h4', 'a') + C(12, 12, 2, 'f2')),
  scene: svg(R(3, 5, 18, 14, 'f2', 1.5) + P('M3 15l5-5 4 4 3-3 6 6v1.5q0 .5-.5.5h-17Q3 19 3 18.5z', 'f1') + C(16, 9, 1.8, 'a')),
  render: svg(C(12, 12, 8, 'f1') + P('M6.5 9.5a6.5 6.5 0 0 1 5.5-4', 'a') + C(9, 9, 1.6, 'k')),
  capture: svg(R(3, 7, 18, 12, 'f1', 2) + P('M8 7l1.5-2.5h5L16 7', 'f2') + C(12, 13, 3.4, 'a')),
  surfextend: svg(P('M3 16q5-6 10-3v6q-5-3-10 3z', 'f1') + P('M13 13q4 2 8-1v6q-4 3-8 1z', 'f2') + P('M13 13v6', 'a') + P('M15 9h5M18 7l2 2-2 2')),
  fill: svg(P('M4 17q2-9 8-11t8 11q-8 3-16 0z', 'f2') + P('M4 17q2-9 8-11t8 11', 'a') + P('M4 17q8 3 16 0', 'a')),
  surfloft: svg(P('M4 18q8-4 16 0L17 7q-5-2-10 0z', 'f1') + P('M4 18q8-4 16 0M7 7q5-2 10 0', 'a')),
  surftrim: svg(P('M3 15q9-8 18 0v4H3z', 'f1') + P('M12 3v18', 'a') + P('M14 8l4-4M18 8l-4-4', 'k')),
  surfextrude: svg(P('M5 17V8q4-3 7 0t7 0v9q-4 3-7 0t-7 0z', 'f1') + P('M5 17q4-3 7 0t7 0', 'a')),
  surfrevolve: svg(P('M6 6q6 3 0 12', 'a') + P('M6 6q12 0 12 6t-12 6q6-3 0-12z', 'f1') + P('M4 3v18', 'k')),
  patch: svg(P('M4 8l8-4 8 4-8 4z', 'f2') + P('M4 8v8l8 4 8-4V8', 'f1') + P('M4 8l8 4 8-4', 'a')),
  offsetsurf: svg(P('M3 15q9-6 18 0', 'f1') + P('M3 10q9-6 18 0', 'a') + P('M12 8v-3M10.5 6.5 12 5l1.5 1.5')),
  stitch: svg(P('M3 14q4-6 9-2v7q-5-4-9 1z', 'f1') + P('M12 12q5-4 9 2v6q-4-5-9-1z', 'f2') + P('M12 10v11', 'a') + P('M10.5 13h3M10.5 16h3M10.5 19h3')),
  thicken: svg(P('M4 9q8-5 16 0v5q-8-5-16 0z', 'f1') + P('M4 14q8-5 16 0', 'f2') + P('M12 3v4M10.5 5.5 12 7l1.5-1.5', 'a')),
  clock: svg(C(12, 13, 8, 'f1') + P('M12 8.5V13l3 2', 'a') + P('M10 3h4M12 3v2')),
  tasks: svg(R(3, 4, 18, 16, 'f1', 2) + P('M7 9h2M7 13h2M7 17h2', 'a') + P('M11 9h6M11 13h6M11 17h4')),
  decal: svg(R(4, 5, 16, 14, 'f1', 2) + C(9, 10, 1.6, 'af') + P('M5 18l5-5 3 3 2-2 4 4', 'a')),
  canvas: svg(P('M3 18l4-11h14l-4 11z', 'f1') + P('M9 15l3-3 2 2 2-2', 'a')),
  bolt: svg(R(7, 3, 10, 4, 'f2', .5) + P('M10 7v14h4V7z', 'f1') + P('M10 10l4 1.5M10 13l4 1.5M10 16l4 1.5', 'a')),
  dupjoint: svg(R(3, 6, 8, 8, 'f1', 1) + R(13, 10, 8, 8, 'f2', 1) + C(12, 12, 1.8, 'af')),
  spacemouse: svg(E(12, 17, 8, 3.5, 'f2') + P('M4 17v-2c0-2 3.6-3.5 8-3.5s8 1.5 8 3.5v2') + isoCyl(12, 9, 4.5, 2, 3) + P('M12 2v3M10.5 3.5 12 2l1.5 1.5', 'a')),
  rollback: svg(R(17, 4, 3, 16, 'f2', 1) + P('M4 12h11M4 12l4-4M4 12l4 4', 'a')),
};
