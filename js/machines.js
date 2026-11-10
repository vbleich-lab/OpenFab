// Machine library: travels, spindle/feed limits, rapid rate, tool changer and
// the post-processor that belongs to the control.

export const BUILTIN_MACHINES = [
  { id: 'm-grbl', name: 'Hobby-Portalfräse (GRBL)', vendor: 'generisch', builtin: true, post: 'grbl',
    travel: { x: 600, y: 400, z: 100 }, minRpm: 5000, maxRpm: 24000, maxFeed: 5000, rapid: 5000, toolChanger: 'manual', tools: 1, coolant: false, power: 1.5 },
  { id: 'm-linuxcnc', name: 'Fräse mit LinuxCNC', vendor: 'generisch', builtin: true, post: 'linuxcnc',
    travel: { x: 500, y: 300, z: 150 }, minRpm: 1000, maxRpm: 18000, maxFeed: 4000, rapid: 6000, toolChanger: 'manual', tools: 1, coolant: true, power: 2.2 },
  { id: 'm-vmc-fanuc', name: 'Vertikal-BAZ (Fanuc)', vendor: 'generisch', builtin: true, post: 'fanuc',
    travel: { x: 762, y: 406, z: 508 }, minRpm: 100, maxRpm: 8100, maxFeed: 16500, rapid: 25400, toolChanger: 'auto', tools: 20, coolant: true, power: 22 },
  { id: 'm-sinumerik', name: 'BAZ mit Sinumerik 840D', vendor: 'generisch', builtin: true, post: 'sinumerik',
    travel: { x: 1000, y: 600, z: 500 }, minRpm: 50, maxRpm: 10000, maxFeed: 12000, rapid: 30000, toolChanger: 'auto', tools: 30, coolant: true, power: 18 },
  { id: 'm-tnc', name: 'BAZ mit Heidenhain iTNC 530', vendor: 'generisch', builtin: true, post: 'heidenhain',
    travel: { x: 800, y: 500, z: 450 }, minRpm: 50, maxRpm: 12000, maxFeed: 10000, rapid: 30000, toolChanger: 'auto', tools: 30, coolant: true, power: 15 },
  // multi-axis machines: kin = rotary axes (type A, AC table/table, BC head), their limits in degrees (null =
  // endless), the round table under the part and the spindle nose around the holder
  { id: 'm-5ax-ac', name: '5-Achs-BAZ Schwenktisch A/C (Heidenhain)', vendor: 'generisch', builtin: true, post: 'heidenhain',
    travel: { x: 650, y: 650, z: 500 }, minRpm: 50, maxRpm: 18000, maxFeed: 30000, rapid: 40000, toolChanger: 'auto', tools: 60, coolant: true, power: 25,
    kin: { type: 'AC', a: [-10, 110], c: null, tableR: 125, spindleD: 110 } },
  { id: 'm-5ax-bc', name: '5-Achs-BAZ Schwenkkopf B/C (Sinumerik)', vendor: 'generisch', builtin: true, post: 'sinumerik',
    travel: { x: 1200, y: 800, z: 700 }, minRpm: 50, maxRpm: 15000, maxFeed: 30000, rapid: 40000, toolChanger: 'auto', tools: 60, coolant: true, power: 30,
    kin: { type: 'BC', b: [-100, 100], c: null, tableR: 300, spindleD: 130 } },
  { id: 'm-4ax-a', name: 'Fräse mit 4. Achse A (LinuxCNC)', vendor: 'generisch', builtin: true, post: 'linuxcnc',
    travel: { x: 500, y: 300, z: 200 }, minRpm: 1000, maxRpm: 18000, maxFeed: 4000, rapid: 6000, toolChanger: 'manual', tools: 1, coolant: true, power: 2.2,
    kin: { type: 'A', a: null, tableR: 0, spindleD: 80 } },
];

export const KIN_TYPES = [['none', 'Keine (3 Achsen)'], ['A', '4. Achse A (um X)'], ['AC', '5 Achsen: Schwenktisch A/C'], ['BC', '5 Achsen: Schwenkkopf B/C']];

// Rotary axis positions for a tool axis v (unit vector from tip to spindle, model frame): the axes turn v into
// the machine's +Z. Returns { ok, txt } or { ok: false, why }.
export function kinAngles(kin, v) {
  const deg = x => Math.round(((x * 180) / Math.PI) * 1000) / 1000 + 0;
  const inR = (x, lim) => !Array.isArray(lim) || (x >= lim[0] - 1e-6 && x <= lim[1] + 1e-6);
  const norm = a => Math.round((((a + 540) % 360) - 180) * 1000) / 1000 + 0;
  const range = lim => (Array.isArray(lim) ? `${lim[0]}…${lim[1]}°` : 'endlos');
  if (kin.type === 'A') {
    if (Math.abs(v.x) > 1e-6) return { ok: false, why: 'Werkzeugachse steht nicht senkrecht zur A-Achse (X) – mit der 4. Achse nicht erreichbar' };
    const a = deg(Math.atan2(v.y, v.z));
    return inR(a, kin.a) ? { ok: true, txt: `A${a}°` } : { ok: false, why: `A${a}° außerhalb des Bereichs ${range(kin.a)}` };
  }
  const head = kin.type === 'BC', name = head ? 'B' : 'A', lim = head ? kin.b : kin.a;
  const tilt = deg(Math.acos(Math.max(-1, Math.min(1, v.z))));
  // swivel axis tilts by ±tilt; C turns the tilt direction in place (B tilts about Y, A about X)
  const rot = (Math.atan2(v.y, v.x) * 180) / Math.PI;
  const sols = tilt < 1e-6 ? [[0, 0]] : head ? [[tilt, norm(rot)], [-tilt, norm(rot + 180)]] : [[tilt, norm(rot + 90)], [-tilt, norm(rot - 90)]];
  const s = sols.find(([t, c]) => inR(t, lim) && inR(c, kin.c));
  return s ? { ok: true, txt: `${name}${s[0]}° C${s[1]}°` } : { ok: false, why: `${name} ±${tilt}° außerhalb des Bereichs ${range(lim)}${Array.isArray(kin.c) ? ` (C ${range(kin.c)})` : ''}` };
}

export function allMachines(project) { return [...BUILTIN_MACHINES, ...(project.machines || [])]; }
export function findMachine(project, id) { return id ? allMachines(project).find(m => m.id === id) || null : null; }

export function copyMachine(m, id, name) {
  const c = JSON.parse(JSON.stringify(m));
  delete c.builtin;
  return { ...c, id, name };
}

export function newMachine(id) {
  return { id, name: 'Neue Maschine', vendor: '', post: 'grbl', travel: { x: 500, y: 400, z: 150 }, minRpm: 1000, maxRpm: 18000, maxFeed: 5000, rapid: 6000, toolChanger: 'manual', tools: 1, coolant: false, power: 2 };
}

// Problems of a setup on a machine (stock vs. travels, tools vs. spindle limits).
export function machineChecks(machine, stock, setup, tools) {
  const out = [];
  if (!machine) return out;
  if (stock && machine.travel) {
    const need = { x: stock.maxX - stock.minX, y: stock.maxY - stock.minY, z: stock.top - stock.bottom + (+setup.safeZ || 0) };
    for (const k of ['x', 'y', 'z']) if (machine.travel[k] && need[k] > machine.travel[k]) out.push(`${k.toUpperCase()}-Verfahrweg ${machine.travel[k]} mm < benötigt ${need[k].toFixed(1)} mm`);
  }
  for (const t of tools) {
    if (machine.maxRpm && t.rpm > machine.maxRpm) out.push(`T${t.number}: Drehzahl ${t.rpm} > Maximum ${machine.maxRpm}`);
    if (machine.minRpm && t.rpm < machine.minRpm) out.push(`T${t.number}: Drehzahl ${t.rpm} < Minimum ${machine.minRpm}`);
    if (machine.maxFeed && t.feed > machine.maxFeed) out.push(`T${t.number}: Vorschub ${t.feed} > Maximum ${machine.maxFeed}`);
  }
  if (machine.toolChanger === 'auto' && machine.tools) {
    const big = tools.filter(t => t.number > machine.tools);
    if (big.length) out.push(`Werkzeugnummer(n) ${big.map(t => 'T' + t.number).join(', ')} > Magazinplätze (${machine.tools})`);
  }
  return out;
}
