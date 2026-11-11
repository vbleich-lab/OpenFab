//! Toolbahn Rust-Geometriekern.
//!
//! B-rep-Modellierung auf Basis von `truck`, als WebAssembly ohne Bindungsgenerator:
//! JavaScript schreibt einen JSON-Befehl in den Speicher, ruft `of_call` auf und liest das Ergebnis
//! (JSON, bei der Vernetzung binär) zurück. Körper liegen in einer Handle-Tabelle und werden
//! von JavaScript mit `free` wieder freigegeben.

use serde_json::{Value, json};
use std::cell::RefCell;
use std::f64::consts::PI;
use truck_meshalgo::prelude::*;
use truck_modeling::*;

type R<T> = std::result::Result<T, String>;

static mut PANIC_MSG: Vec<u8> = Vec::new();

/// Records the panic text so JavaScript can show it after the trap (panic = abort on wasm).
#[unsafe(no_mangle)]
pub extern "C" fn of_init() {
    std::panic::set_hook(Box::new(|info| {
        let msg = info.to_string().into_bytes();
        unsafe { PANIC_MSG = msg };
    }));
}
#[unsafe(no_mangle)]
pub extern "C" fn of_panic_ptr() -> *const u8 {
    unsafe { (*std::ptr::addr_of!(PANIC_MSG)).as_ptr() }
}
#[unsafe(no_mangle)]
pub extern "C" fn of_panic_len() -> usize {
    unsafe { (*std::ptr::addr_of!(PANIC_MSG)).len() }
}

#[derive(Default)]
struct Store {
    shapes: Vec<Option<Solid>>,
    free: Vec<usize>,
    result: Vec<u8>,
}

thread_local! {
    static STORE: RefCell<Store> = RefCell::new(Store::default());
}

fn put(s: Solid) -> usize {
    STORE.with(|st| {
        let mut st = st.borrow_mut();
        if let Some(i) = st.free.pop() {
            st.shapes[i] = Some(s);
            i
        } else {
            st.shapes.push(Some(s));
            st.shapes.len() - 1
        }
    })
}

fn get(h: usize) -> R<Solid> {
    STORE.with(|st| st.borrow().shapes.get(h).and_then(|s| s.clone()).ok_or_else(|| format!("Ungültiger Körper #{h}")))
}

fn release(h: usize) {
    STORE.with(|st| {
        let mut st = st.borrow_mut();
        if let Some(slot) = st.shapes.get_mut(h) {
            if slot.take().is_some() {
                st.free.push(h);
            }
        }
    })
}

// ---------- memory interface ----------

#[unsafe(no_mangle)]
pub extern "C" fn of_alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[unsafe(no_mangle)]
pub extern "C" fn of_dealloc(p: *mut u8, n: usize) {
    unsafe { drop(Vec::from_raw_parts(p, 0, n.max(1))) }
}

#[unsafe(no_mangle)]
pub extern "C" fn of_result_len() -> usize {
    STORE.with(|st| st.borrow().result.len())
}

fn set_result(bytes: Vec<u8>) -> *const u8 {
    STORE.with(|st| {
        let mut st = st.borrow_mut();
        st.result = bytes;
        st.result.as_ptr()
    })
}

/// JSON-Befehl ausführen. Ergebnis: JSON `{ok:…}` oder `{err:"…"}`; bei `mesh` Binärdaten mit Präfix 'M'.
#[unsafe(no_mangle)]
pub extern "C" fn of_call(p: *const u8, n: usize) -> *const u8 {
    let input = unsafe { std::slice::from_raw_parts(p, n) };
    let cmd: Value = match serde_json::from_slice(input) {
        Ok(v) => v,
        Err(e) => return set_result(json!({ "err": format!("Befehl unlesbar: {e}") }).to_string().into_bytes()),
    };
    if cmd["op"] == "mesh" {
        return match mesh(&cmd) {
            Ok(mut bytes) => {
                bytes.insert(0, b'M');
                set_result(bytes)
            }
            Err(e) => set_result(json!({ "err": e }).to_string().into_bytes()),
        };
    }
    let out = match run(&cmd) {
        Ok(v) => json!({ "ok": v }),
        Err(e) => json!({ "err": e }),
    };
    set_result(out.to_string().into_bytes())
}

// ---------- helpers ----------

fn num(v: &Value, k: &str) -> R<f64> {
    v[k].as_f64().ok_or_else(|| format!("Wert „{k}“ fehlt"))
}
fn numd(v: &Value, k: &str, d: f64) -> f64 {
    v[k].as_f64().unwrap_or(d)
}
fn vec3(v: &Value) -> R<Vector3> {
    let a = v.as_array().ok_or("Vektor fehlt")?;
    let f = |i: usize| a.get(i).and_then(|x| x.as_f64()).ok_or("Vektor unvollständig");
    Ok(Vector3::new(f(0)?, f(1)?, f(2)?))
}
fn pt3(v: &Value) -> R<Point3> {
    Ok(Point3::from_vec(vec3(v)?))
}
fn handle(v: &Value, k: &str) -> R<usize> {
    v[k].as_u64().map(|x| x as usize).ok_or_else(|| format!("Körper „{k}“ fehlt"))
}

/// Ebene einer Skizze: Ursprung, x-Achse, Normale.
struct Frame {
    o: Point3,
    x: Vector3,
    y: Vector3,
    n: Vector3,
}
impl Frame {
    fn from(v: &Value) -> R<Frame> {
        let o = pt3(&v["o"])?;
        let x = vec3(&v["x"])?.normalize();
        let n = vec3(&v["n"])?.normalize();
        let y = n.cross(x).normalize();
        Ok(Frame { o, x, y, n })
    }
    fn at(&self, uv: &Value) -> R<Point3> {
        let a = uv.as_array().ok_or("Punkt fehlt")?;
        let u = a.first().and_then(|x| x.as_f64()).ok_or("Punkt unvollständig")?;
        let w = a.get(1).and_then(|x| x.as_f64()).ok_or("Punkt unvollständig")?;
        Ok(self.o + self.x * u + self.y * w)
    }
}

/// Geschlossene Kontur aus Segmenten: [{t:"M",p}, {t:"L",p}, {t:"A",m,p}, …] (u/v in der Skizzenebene).
/// Liefert Punkte (für Flächeninhalt/Orientierung) und den Draht.
fn loop_wire(fr: &Frame, segs: &Value) -> R<(Wire, f64)> {
    let segs = segs.as_array().ok_or("Kontur fehlt")?;
    if segs.len() < 2 {
        return Err("Kontur zu kurz".into());
    }
    // 2D-Punkte für die Orientierung (Bogenmitten mitgezählt)
    let uv = |x: &Value| -> (f64, f64) { (x[0].as_f64().unwrap_or(0.0), x[1].as_f64().unwrap_or(0.0)) };
    let mut poly: Vec<(f64, f64)> = Vec::new();
    for s in segs {
        if s["t"] == "A" {
            poly.push(uv(&s["m"]));
        }
        poly.push(uv(&s["p"]));
    }
    let mut area = 0.0;
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[(i + 1) % poly.len()]);
        area += a.0 * b.1 - b.0 * a.1;
    }
    area *= 0.5;
    let first = fr.at(&segs[0]["p"])?;
    let v0 = builder::vertex(first);
    let mut prev = v0.clone();
    let mut edges = Vec::new();
    let last = segs.len() - 1;
    for (i, s) in segs.iter().enumerate().skip(1) {
        let p = fr.at(&s["p"])?;
        let closes = i == last && p.distance(first) < 1e-7;
        if !closes && p.distance(prev.point()) < 1e-7 {
            continue; // zero-length segment
        }
        let v = if closes { v0.clone() } else { builder::vertex(p) };
        let e = if s["t"] == "A" { builder::circle_arc(&prev, &v, fr.at(&s["m"])?) } else { builder::line(&prev, &v) };
        edges.push(e);
        prev = v;
    }
    if prev.point().distance(first) > 1e-7 {
        edges.push(builder::line(&prev, &v0));
    } else if prev != v0 {
        // last point equals the first one but is a separate vertex: rebuild the last edge onto v0
        let e = edges.pop().ok_or("Kontur leer")?;
        let a = e.front().clone();
        edges.push(builder::line(&a, &v0));
    }
    if edges.len() < 2 && !segs.iter().any(|s| s["t"] == "A") {
        return Err("Kontur zu kurz".into());
    }
    Ok((Wire::from_iter(edges), area))
}

/// Fläche aus Bereichen: äußere Kontur gegen den Uhrzeigersinn, Löcher im Uhrzeigersinn (bezogen auf die Normale).
fn region_face(fr: &Frame, region: &Value) -> R<Face> {
    let (mut outer, a) = loop_wire(fr, &region["outer"])?;
    if a < 0.0 {
        outer.invert();
    }
    let mut wires = vec![outer];
    if let Some(holes) = region["holes"].as_array() {
        for h in holes {
            let (mut w, a) = loop_wire(fr, h)?;
            if a > 0.0 {
                w.invert();
            }
            wires.push(w);
        }
    }
    let face = builder::try_attach_plane(&wires).map_err(|e| format!("Profil nicht eben: {e:?}"))?;
    Ok(orient_face(face, fr.n))
}

/// Flächennormale in Richtung `dir` drehen (für richtig orientierte Volumen beim Austragen).
fn orient_face(mut face: Face, dir: Vector3) -> Face {
    if let Surface::Plane(pl) = face.oriented_surface() {
        if pl.normal().dot(dir) < 0.0 {
            face.invert();
        }
    }
    face
}

fn regions(cmd: &Value, fr: &Frame) -> R<Vec<Face>> {
    let rs = cmd["regions"].as_array().ok_or("Kein geschlossenes Profil")?;
    if rs.is_empty() {
        return Err("Kein geschlossenes Profil".into());
    }
    rs.iter().map(|r| region_face(fr, r)).collect()
}

/// Schnelle Hülle aus Eckpunkten und Kantenpunkten, etwas vergrößert (für Überschneidungstests).
fn bounds_fast(s: &Solid) -> ([f64; 3], [f64; 3]) {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    let mut add = |p: Point3| {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    };
    for e in unique_edges(s) {
        let c = e.oriented_curve();
        let (t0, t1) = c.range_tuple();
        for i in 0..=32 {
            add(c.subs(t0 + (t1 - t0) * i as f64 / 32.0));
        }
    }
    let pad = (0..3).map(|k| hi[k] - lo[k]).fold(0.0, f64::max) * 0.02 + 1e-3;
    for k in 0..3 {
        lo[k] -= pad;
        hi[k] += pad;
    }
    (lo, hi)
}

/// Hülle für die Anzeige: Kantenpunkte plus Stichproben auf gekrümmten Flächen (ohne Vernetzung).
fn bounds(s: &Solid) -> ([f64; 3], [f64; 3]) {
    use std::ops::Bound;
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    let mut add = |p: Point3| {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    };
    for e in unique_edges(s) {
        let c = e.oriented_curve();
        let (t0, t1) = c.range_tuple();
        for i in 0..=48 {
            add(c.subs(t0 + (t1 - t0) * i as f64 / 48.0));
        }
    }
    let val = |b: Bound<f64>| match b {
        Bound::Included(x) | Bound::Excluded(x) => Some(x),
        Bound::Unbounded => None,
    };
    for sh in s.boundaries() {
        for f in sh.face_iter() {
            let surf = f.oriented_surface();
            if matches!(surf, Surface::Plane(_)) {
                continue; // planar faces are bounded by their edges
            }
            let ((u0, u1), (v0, v1)) = surf.parameter_range();
            if let (Some(u0), Some(u1), Some(v0), Some(v1)) = (val(u0), val(u1), val(v0), val(v1)) {
                for i in 0..=16 {
                    for j in 0..=16 {
                        add(surf.subs(u0 + (u1 - u0) * i as f64 / 16.0, v0 + (v1 - v0) * j as f64 / 16.0));
                    }
                }
            }
        }
    }
    (lo, hi)
}

fn overlap(a: &([f64; 3], [f64; 3]), b: &([f64; 3], [f64; 3])) -> bool {
    (0..3).all(|k| a.0[k] <= b.1[k] + 1e-6 && b.0[k] <= a.1[k] + 1e-6)
}

/// Vorzeichenbehaftetes Volumen (zur Prüfung der Orientierung).
fn signed_volume(s: &Solid) -> f64 {
    signed_volume_tol(s, 0.01)
}
fn signed_volume_tol(s: &Solid, rel: f64) -> f64 {
    let (lo, hi) = bounds_fast(s);
    let size = (0..3).map(|k| hi[k] - lo[k]).fold(0.0, f64::max).max(1e-3);
    let m = s.triangulation((size * rel).max(0.002));
    let mut vol = 0.0;
    for sh in m.boundaries() {
        for f in sh.face_iter() {
            if let Some(pm) = f.surface() {
                let pos = pm.positions();
                let sg = if f.orientation() { 1.0 } else { -1.0 };
                for t in pm.faces().triangle_iter() {
                    let (a, b, c) = (pos[t[0].pos].to_vec(), pos[t[1].pos].to_vec(), pos[t[2].pos].to_vec());
                    vol += sg * a.dot(b.cross(c)) / 6.0;
                }
            }
        }
    }
    vol
}

fn outward(mut s: Solid) -> Solid {
    if signed_volume(&s) < 0.0 {
        s.not();
    }
    s
}

fn merge_disjoint(a: &Solid, b: &Solid) -> Solid {
    let mut shells: Vec<Shell> = a.boundaries().clone();
    shells.extend(b.boundaries().iter().cloned());
    Solid::new(shells)
}

fn tol_of(cmd: &Value) -> f64 {
    numd(cmd, "tol", 0.05).max(1e-4)
}

/// One boolean operation (exact). Coplanar contact faces make truck fail; see `perturbed`.
fn boolean(kind: &str, a: &Solid, b: &Solid, tol: f64) -> R<Option<Solid>> {
    // a tool made of several separate pieces (e.g. a row of holes): one piece at a time is much faster,
    // and pieces that miss the body are skipped. Only when every shell is a solid of its own (no voids).
    if (kind == "cut" || kind == "or") && b.boundaries().len() > 1 {
        let parts: Vec<Solid> = b.boundaries().iter().map(|sh| Solid::new(vec![sh.clone()])).collect();
        if parts.iter().all(|p| signed_volume(p) > 0.0) {
            let mut acc = a.clone();
            for p in &parts {
                acc = boolean_one(kind, &acc, p, tol)?.ok_or("Ergebnis leer")?;
            }
            return Ok(Some(acc));
        }
    }
    boolean_one(kind, a, b, tol)
}

fn boolean_one(kind: &str, a: &Solid, b: &Solid, tol: f64) -> R<Option<Solid>> {
    boolean_exact(kind, a, b, tol)
}

/// Fallback variants (1…4): grow the tool slightly, then also shift it sideways (off every axis) –
/// that resolves most coincident faces. JavaScript tries the variants one after another, each in its
/// own call, so an internal truck error (panic) in one variant does not stop the next.
pub const VARIANTS: usize = 4;
fn perturbed(b: &Solid, variant: usize) -> Solid {
    if variant == 0 {
        return b.clone();
    }
    let (grow, shift) = [(2e-3, 0.0), (2e-3, 1e-3), (4e-3, -2e-3), (1e-2, 4e-3)][(variant - 1).min(VARIANTS - 1)];
    let (lo, hi) = bounds_fast(b);
    let c = Point3::new((lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0, (lo[2] + hi[2]) / 2.0);
    let k = |i: usize| 1.0 + grow / (hi[i] - lo[i]).max(1e-3);
    let nb = builder::scaled(b, c, Vector3::new(k(0), k(1), k(2)));
    if shift != 0.0 { builder::translated(&nb, Vector3::new(0.31, 0.57, 0.76).normalize() * shift) } else { nb }
}

// ---------- containment (truck cannot combine solids whose faces never intersect) ----------

fn sample_points(s: &Solid, per_edge: usize) -> Vec<Point3> {
    let mut out = Vec::new();
    for e in unique_edges(s) {
        let c = e.oriented_curve();
        let (t0, t1) = c.range_tuple();
        for i in 0..per_edge {
            out.push(c.subs(t0 + (t1 - t0) * (i as f64 + 0.5) / per_edge as f64));
        }
    }
    out
}

fn tight_bounds(pts: &[Point3]) -> ([f64; 3], [f64; 3]) {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for p in pts {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    (lo, hi)
}

fn triangles(s: &Solid) -> Vec<[Point3; 3]> {
    let mut out = Vec::new();
    let m = s.triangulation(0.05);
    for sh in m.boundaries() {
        for f in sh.face_iter() {
            if let Some(pm) = f.surface() {
                let ps = pm.positions();
                for t in pm.faces().triangle_iter() {
                    out.push([ps[t[0].pos], ps[t[1].pos], ps[t[2].pos]]);
                }
            }
        }
    }
    out
}

/// Point inside a closed triangle mesh (ray parity, skewed ray direction).
fn inside(tris: &[[Point3; 3]], p: Point3) -> bool {
    let d = Vector3::new(0.5377, 0.3012, 0.7877).normalize();
    let mut hits = 0;
    for [a, b, c] in tris {
        let (e1, e2) = (*b - *a, *c - *a);
        let h = d.cross(e2);
        let det = e1.dot(h);
        if det.abs() < 1e-12 {
            continue;
        }
        let f = 1.0 / det;
        let sv = p - *a;
        let u = f * sv.dot(h);
        if !(0.0..=1.0).contains(&u) {
            continue;
        }
        let q = sv.cross(e1);
        let v = f * d.dot(q);
        if v < 0.0 || u + v > 1.0 {
            continue;
        }
        if f * e2.dot(q) > 1e-9 {
            hits += 1;
        }
    }
    hits % 2 == 1
}

/// Distance from a point to a triangle (closest-point construction).
fn tri_dist(p: Point3, [a, b, c]: &[Point3; 3]) -> f64 {
    let (ab, ac, ap) = (*b - *a, *c - *a, p - *a);
    let (d1, d2) = (ab.dot(ap), ac.dot(ap));
    if d1 <= 0.0 && d2 <= 0.0 {
        return ap.magnitude();
    }
    let bp = p - *b;
    let (d3, d4) = (ab.dot(bp), ac.dot(bp));
    if d3 >= 0.0 && d4 <= d3 {
        return bp.magnitude();
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return (p - (*a + ab * (d1 / (d1 - d3)))).magnitude();
    }
    let cp = p - *c;
    let (d5, d6) = (ab.dot(cp), ac.dot(cp));
    if d6 >= 0.0 && d5 <= d6 {
        return cp.magnitude();
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return (p - (*a + ac * (d2 / (d2 - d6)))).magnitude();
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        return (p - (*b + (*c - *b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6))))).magnitude();
    }
    let den = 1.0 / (va + vb + vc);
    (p - (*a + ab * (vb * den) + ac * (vc * den))).magnitude()
}

const SURF_EPS: f64 = 0.06; // > triangulation tolerance (0.05)

/// Is `inner` completely inside `outer`? `touching`: points on the surface count as inside
/// (right for union/intersection; a cut needs the tool strictly inside, otherwise it is a pocket, not a cavity).
fn contained(inner: &Solid, outer: &Solid, touching: bool) -> bool {
    let pi = sample_points(inner, 6);
    let po = sample_points(outer, 6);
    if pi.is_empty() || po.is_empty() {
        return false;
    }
    let (bi, bo) = (tight_bounds(&pi), tight_bounds(&po));
    if !(0..3).all(|k| bi.0[k] >= bo.0[k] - 1e-6 && bi.1[k] <= bo.1[k] + 1e-6) {
        return false;
    }
    let tris = triangles(outer);
    pi.iter().all(|p| {
        let near = tris.iter().any(|t| tri_dist(*p, t) < SURF_EPS);
        if near { touching } else { inside(&tris, *p) }
    })
}

fn boolean_exact(kind: &str, a: &Solid, b: &Solid, tol: f64) -> R<Option<Solid>> {
    if a.boundaries().is_empty() || b.boundaries().is_empty() {
        return Err("Leerer Körper".into());
    }
    let ov = overlap(&bounds_fast(a), &bounds_fast(b));
    match kind {
        "or" => {
            if !ov {
                return Ok(Some(merge_disjoint(a, b)));
            }
            if contained(a, b, true) {
                return Ok(Some(b.clone()));
            }
            if contained(b, a, true) {
                return Ok(Some(a.clone()));
            }
            truck_shapeops::or(a, b, tol).map(Some).ok_or_else(|| "Vereinigung fehlgeschlagen (Rust-Kern)".into())
        }
        "and" => {
            if !ov {
                return Ok(None);
            }
            if contained(a, b, true) {
                return Ok(Some(a.clone()));
            }
            if contained(b, a, true) {
                return Ok(Some(b.clone()));
            }
            truck_shapeops::and(a, b, tol).map(Some).ok_or_else(|| "Schnittmenge fehlgeschlagen (Rust-Kern)".into())
        }
        "cut" => {
            if !ov {
                return Ok(Some(a.clone()));
            }
            if contained(a, b, false) {
                return Err("Der Körper würde vollständig entfernt".into());
            }
            if contained(b, a, false) {
                // tool inside the body: a closed cavity
                let mut nb = b.clone();
                nb.not();
                return Ok(Some(merge_disjoint(a, &nb)));
            }
            let mut nb = b.clone();
            nb.not();
            truck_shapeops::and(a, &nb, tol).map(Some).ok_or_else(|| "Ausschneiden fehlgeschlagen (Rust-Kern)".into())
        }
        _ => Err(format!("Unbekannte Operation {kind}")),
    }
}

fn solid_from_face_sweep(face: &Face, dir: Vector3) -> Solid {
    let face = orient_face(face.clone(), dir);
    builder::tsweep(&face, dir)
}

fn circle_face(c: Point3, r: f64, ax: Vector3, ref_dir: Vector3) -> R<Face> {
    let u = ref_dir.normalize();
    let w = ax.normalize().cross(u).normalize();
    let v0 = builder::vertex(c + u * r);
    let v1 = builder::vertex(c - u * r);
    let e0 = builder::circle_arc(&v0, &v1, c + w * r);
    let e1 = builder::circle_arc(&v1, &v0, c - w * r);
    let face = builder::try_attach_plane(&[Wire::from_iter(vec![e0, e1])]).map_err(|e| format!("{e:?}"))?;
    Ok(orient_face(face, ax))
}

// ---------- commands ----------

fn run(cmd: &Value) -> R<Value> {
    let op = cmd["op"].as_str().unwrap_or("");
    let made = |s: Solid| Ok(json!(put(s)));
    match op {
        "version" => Ok(json!({ "name": "Toolbahn Rust-Kern (truck)", "version": env!("CARGO_PKG_VERSION"), "variants": VARIANTS })),
        "box" => {
            let (w, d, h) = (num(cmd, "w")?, num(cmd, "d")?, num(cmd, "h")?);
            if w <= 0.0 || d <= 0.0 || h == 0.0 {
                return Err("Maße fehlen".into());
            }
            let z = numd(cmd, "z", 0.0) + h.min(0.0);
            let v = builder::vertex(Point3::new(numd(cmd, "x", 0.0), numd(cmd, "y", 0.0), z));
            let e = builder::tsweep(&v, Vector3::unit_x() * w);
            let f = builder::tsweep(&e, Vector3::unit_y() * d);
            made(outward(solid_from_face_sweep(&f, Vector3::unit_z() * h.abs())))
        }
        "cylinder" => {
            let (r, h) = (num(cmd, "r")?, num(cmd, "h")?);
            if r <= 0.0 || h == 0.0 {
                return Err("Maße fehlen".into());
            }
            let c = Point3::new(numd(cmd, "x", 0.0), numd(cmd, "y", 0.0), numd(cmd, "z", 0.0) + h.min(0.0));
            let f = circle_face(c, r, Vector3::unit_z(), Vector3::unit_x())?;
            made(outward(builder::tsweep(&f, Vector3::unit_z() * h.abs())))
        }
        "sphere" => {
            let r = num(cmd, "r")?;
            if r <= 0.0 {
                return Err("Radius fehlt".into());
            }
            let c = Point3::new(numd(cmd, "x", 0.0), numd(cmd, "y", 0.0), numd(cmd, "z", 0.0));
            let top = builder::vertex(c + Vector3::unit_z() * r);
            let half: Wire = builder::rsweep(&top, c, Vector3::unit_y(), Rad(PI));
            // `cone` closes the poles (both ends of the meridian lie on the axis)
            let shell: Shell = builder::cone(&half, Vector3::unit_z(), Rad(2.0 * PI));
            made(outward(Solid::new(vec![shell])))
        }
        "torus" => {
            let (rr, r) = (num(cmd, "R")?, num(cmd, "r")?);
            if rr <= 0.0 || r <= 0.0 || r >= rr {
                return Err("Rohrradius muss kleiner als der Ringradius sein".into());
            }
            let f = circle_face(Point3::new(rr, 0.0, 0.0), r, Vector3::unit_y(), Vector3::unit_x())?;
            let mut s: Solid = builder::rsweep(&f, Point3::origin(), Vector3::unit_z(), Rad(2.0 * PI));
            match cmd["axis"].as_str() {
                Some("x") => s = builder::rotated(&s, Point3::origin(), Vector3::unit_y(), Rad(PI / 2.0)),
                Some("y") => s = builder::rotated(&s, Point3::origin(), Vector3::unit_x(), Rad(PI / 2.0)),
                _ => {}
            }
            let t = Vector3::new(numd(cmd, "x", 0.0), numd(cmd, "y", 0.0), numd(cmd, "z", 0.0));
            made(outward(builder::translated(&s, t)))
        }
        "extrude" => {
            // Profilbereiche auf der Skizzenebene, von `from` um `len` entlang der Normalen
            let fr = Frame::from(&cmd["plane"])?;
            let (from, len) = (numd(cmd, "from", 0.0), num(cmd, "len")?);
            if len == 0.0 {
                return Err("Abstand ist 0".into());
            }
            let start = from + len.min(0.0);
            let mut out: Option<Solid> = None;
            for face in regions(cmd, &fr)? {
                let base = builder::translated(&face, fr.n * start);
                let s = outward(solid_from_face_sweep(&base, fr.n * len.abs()));
                out = Some(match out {
                    None => s,
                    Some(acc) => boolean("or", &acc, &s, tol_of(cmd))?.ok_or("Vereinigung leer")?,
                });
            }
            made(out.ok_or("Kein geschlossenes Profil")?)
        }
        "revolve" => {
            let fr = Frame::from(&cmd["plane"])?;
            let o = pt3(&cmd["axisO"])?;
            let d = vec3(&cmd["axisD"])?.normalize();
            let ang = numd(cmd, "angle", 360.0);
            let rad = if ang.abs() >= 360.0 { 2.0 * PI } else { ang.to_radians() };
            let mut out: Option<Solid> = None;
            for face in regions(cmd, &fr)? {
                let s: Solid = outward(builder::rsweep(&face, o, d, Rad(rad)));
                out = Some(match out {
                    None => s,
                    Some(acc) => boolean("or", &acc, &s, tol_of(cmd))?.ok_or("Vereinigung leer")?,
                });
            }
            made(out.ok_or("Kein geschlossenes Profil")?)
        }
        "bool" => {
            let (a, b) = (get(handle(cmd, "a")?)?, get(handle(cmd, "b")?)?);
            let b = perturbed(&b, cmd["variant"].as_u64().unwrap_or(0) as usize);
            match boolean(cmd["kind"].as_str().unwrap_or(""), &a, &b, tol_of(cmd))? {
                Some(s) => made(s),
                None => Ok(Value::Null),
            }
        }
        "transform" => {
            // 4×4-Matrix, spaltenweise (wie three.js `elements`)
            let s = get(handle(cmd, "h")?)?;
            let m: Vec<f64> = cmd["m"].as_array().ok_or("Matrix fehlt")?.iter().map(|x| x.as_f64().unwrap_or(0.0)).collect();
            if m.len() != 16 {
                return Err("Matrix unvollständig".into());
            }
            let mat = Matrix4::new(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12], m[13], m[14], m[15]);
            let mut t = builder::transformed(&s, mat);
            if mat.determinant() < 0.0 {
                t.not(); // gespiegelt: Orientierung wiederherstellen
            }
            made(t)
        }
        "clone" => made(get(handle(cmd, "h")?)?),
        "free" => {
            release(handle(cmd, "h")?);
            Ok(Value::Null)
        }
        "info" => info(&get(handle(cmd, "h")?)?),
        "volume" => Ok(json!(signed_volume_tol(&get(handle(cmd, "h")?)?, 0.0005).abs())),
        "step" => {
            let hs = cmd["hs"].as_array().ok_or("Körper fehlen")?;
            let solids: Vec<Solid> = hs.iter().map(|h| get(h.as_u64().unwrap_or(u64::MAX) as usize)).collect::<R<_>>()?;
            let comp: Vec<_> = solids.iter().map(|s| s.compress()).collect();
            let header = truck_stepio::out::StepHeaderDescriptor { organization_system: "Toolbahn".to_owned(), ..Default::default() };
            let text = if comp.len() == 1 {
                truck_stepio::out::CompleteStepDisplay::new(truck_stepio::out::StepModel::from(&comp[0]), header).to_string()
            } else {
                truck_stepio::out::CompleteStepDisplay::new(comp.iter().collect::<truck_stepio::out::StepModels<_, _, _>>(), header).to_string()
            };
            Ok(json!(text))
        }
        _ => Err(format!("Unbekannter Befehl „{op}“")),
    }
}

/// Unique edges in a fixed order (same order for `info` and `mesh`).
fn unique_edges<C: Clone, S: Clone>(s: &truck_topology::Solid<Point3, C, S>) -> Vec<truck_topology::Edge<Point3, C>> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for sh in s.boundaries() {
        for e in sh.edge_iter() {
            if seen.insert(e.id()) {
                out.push(e.clone());
            }
        }
    }
    out
}

fn info(s: &Solid) -> R<Value> {
    let (lo, hi) = bounds(s);
    let mut faces = Vec::new();
    for sh in s.boundaries() {
        for f in sh.face_iter() {
            faces.push(match f.oriented_surface() {
                Surface::Plane(pl) => {
                    let n = pl.normal();
                    let o = pl.origin();
                    json!({ "t": "PLANE", "n": [n.x, n.y, n.z], "o": [o.x, o.y, o.z] })
                }
                Surface::RevolutedCurve(_) => json!({ "t": "REVOLUTION" }),
                _ => json!({ "t": "BSPLINE" }),
            });
        }
    }
    let edges: Vec<Value> = unique_edges(s)
        .iter()
        .map(|e| {
            let c = e.oriented_curve();
            let (t0, t1) = c.range_tuple();
            let m = c.subs((t0 + t1) / 2.0);
            let t = match c {
                Curve::Line(_) => "LINE",
                _ => "CURVE",
            };
            json!({ "t": t, "mid": [m.x, m.y, m.z], "closed": e.front() == e.back() })
        })
        .collect();
    Ok(json!({ "bbox": [lo, hi], "faces": faces, "edges": edges }))
}

/// Binary mesh: header (5 × u32) then positions, normals (f32), triangles (u32), face groups,
/// edge polyline points (f32) and edge groups. Face order = `info.faces`, edge order = `info.edges`.
fn mesh(cmd: &Value) -> R<Vec<u8>> {
    let s = get(handle(cmd, "h")?)?;
    let tol = numd(cmd, "tol", 0.02).max(0.002);
    let m = s.triangulation(tol);
    let (mut pos, mut nor, mut tri, mut fg) = (Vec::<f32>::new(), Vec::<f32>::new(), Vec::<u32>::new(), Vec::<u32>::new());
    for sh in m.boundaries() {
        for f in sh.face_iter() {
            let start = tri.len() as u32;
            if let Some(pm) = f.surface() {
                let (ps, ns) = (pm.positions(), pm.normals());
                let flip = !f.orientation();
                for t in pm.faces().triangle_iter() {
                    let order = if flip { [0, 2, 1] } else { [0, 1, 2] };
                    let (a, b, c) = (ps[t[order[0]].pos], ps[t[order[1]].pos], ps[t[order[2]].pos]);
                    let fallback = (b - a).cross(c - a);
                    let fallback = if fallback.magnitude2() > 0.0 { fallback.normalize() } else { Vector3::unit_z() };
                    for (k, p) in [a, b, c].iter().enumerate() {
                        let n = t[order[k]].nor.and_then(|i| ns.get(i)).map(|n| if flip { -n } else { n }).unwrap_or(fallback);
                        tri.push((pos.len() / 3) as u32);
                        pos.extend([p.x as f32, p.y as f32, p.z as f32]);
                        nor.extend([n.x as f32, n.y as f32, n.z as f32]);
                    }
                }
            }
            fg.extend([start, tri.len() as u32 - start]);
        }
    }
    let (mut lines, mut eg) = (Vec::<f32>::new(), Vec::<u32>::new());
    for e in unique_edges(&m) {
        let start = (lines.len() / 3) as u32;
        let c = e.oriented_curve();
        for p in c.iter() {
            lines.extend([p.x as f32, p.y as f32, p.z as f32]);
        }
        eg.extend([start, (lines.len() / 3) as u32 - start]);
    }
    let mut out = Vec::with_capacity(20 + 4 * (pos.len() + nor.len() + tri.len() + fg.len() + lines.len() + eg.len()));
    for n in [pos.len() / 3, tri.len() / 3, fg.len() / 2, lines.len() / 3, eg.len() / 2] {
        out.extend((n as u32).to_le_bytes());
    }
    for x in pos.iter().chain(nor.iter()) {
        out.extend(x.to_le_bytes());
    }
    for x in tri.iter().chain(fg.iter()) {
        out.extend(x.to_le_bytes());
    }
    for x in &lines {
        out.extend(x.to_le_bytes());
    }
    for x in &eg {
        out.extend(x.to_le_bytes());
    }
    Ok(out)
}
