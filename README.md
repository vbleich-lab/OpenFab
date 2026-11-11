# WerkFab

**English** · [Deutsch](README.de.md)

**Free, open-source CAD/CAM for design and CNC machining – runs completely offline, in the browser or as a Windows app.**

WerkFab is a parametric 3D CAD program with integrated CAM. Parts are designed with sketches and a feature timeline. From there you can build assemblies, drawings and renderings, and generate, simulate and check NC programs (G-code and Heidenhain Klartext) for CNC milling machines and lathes. Everything runs locally: no account, no cloud, no telemetry.

> [!CAUTION]
> **Every NC program must be verified before it runs on a machine for the first time – in a dry run on the machine (single block, reduced rapid, in the air or with a safe Z offset) or in an external NC simulator.** The simulation inside WerkFab does not replace this check. WerkFab is free software and comes with no warranty of any kind; there is no liability for damage to machines, tools, workpieces or people. See [Safety](#safety-always-simulate-nc-programs-first).

> **Status: Release Candidate 3 (v1.0.0-rc.3).** Feature complete for 1.0.

![Designing a part on the timeline, then toolpaths and a simulation with stock removal](docs/media/demo.gif)

*From sketch to finished part: design step by step, then toolpaths and simulation.*

---

## Screenshots

| Design | Sketch |
|---|---|
| ![Parametric 3D model with browser and timeline](docs/media/01-konstruktion.png) | ![Sketch with constraints and dimensions](docs/media/02-skizze.png) |
| **Manufacture: toolpaths** | **Simulation with stock removal** |
| ![Toolpaths for facing, pocket, drilling and contour](docs/media/03-fertigung.png) | ![Simulation of the milling operations](docs/media/04-simulation.png) |
| **Turning** | **Rendering** |
| ![Turned part with roughing, finishing, grooving and threading passes](docs/media/05-drehen.png) | ![Rendering in a photo studio](docs/media/06-rendern.png) |

The screenshots show the German interface. The interface is available in **English, German and Chinese**.

---

## Features

### Design (CAD)
- **Sketches** with line, rectangle (2 points, centre, 3 points), circle (centre, 2 points, 3 points), arcs (3 points, centre, tangent), slot, polygon, text and construction lines
- **Geometric constraint solver** with dimensions and constraints (tangent, concentric, equal … also on arcs)
- **Trim and extend**: constraints and dimensions are kept; trim also works on slots and rounded contours, and by swiping with the mouse button held down
- **Fillet, chamfer and offset** as click tools with a preview at the cursor
- **Solids**: extrude, revolve, sweep, loft, pipe, coil, rib, press/pull, hole (also tapped), thread, fillet, chamfer, draft, shell, thicken, emboss (flat or wrapped on a cylinder), combine, split, scale
- **Patterns**: rectangular, circular and along a path; mirror
- **Construction geometry**: planes (offset, at an angle, through 3 points, tangent), axes and points
- **Surfaces**: extrude, revolve, loft, patch, offset, stitch, trim, extend, fill
- **Sheet metal**: flanges, flange on flange (U hem, Z step, 180° hem), open or closed corners with corner relief (round or square), flat pattern with bend table
- **Timeline** with a cache: a change recomputes only the features it affects, step by step with a progress display

### Assemblies
- Joints: rigid, revolute, slider, cylindrical, ball and planar
- Joint origins, limits, contact stop, linked motion, motion study
- Collision check between bodies

### Drawings
- Standard views, isometric view, sections (full, half and offset section; front and side view) and several detail views with their own dimensions; centre lines on shafts, bosses and holes
- Your own dimensions (linear, diameter, radius, angle) with tolerance / fit text, notes with a leader, surface texture symbols, geometric tolerances with datums, thread and chamfer callouts, balloons, parts list, title block
- Export as SVG, print or save as PDF

### Rendering
- Studio environments, exposure, ground shadow and reflection
- Progressive anti-aliasing, depth of field, PNG export
- Drag and drop appearances onto bodies

### Manufacture (CAM)
- **Setups** with stock (box, cylinder, rest material from the previous setup), work origin, fixtures and 3+2 tilting
- **2D milling**: face, contour and pocket (both also for the rest material of a larger cutter only), 2D adaptive, slot, engrave, chamfer / deburr, drilling, thread milling, bore milling, probing
- **3D milling**: adaptive roughing, parallel, contour (Z levels), spiral, radial, morph, geodesic, scallop, flats, rest material in corners and more
- **4-axis simultaneous**: rotary (helix / lines), 4-axis roughing, wrapping sketches onto the cylinder
- **Turning**: facing, roughing / finishing (with nose radius compensation), grooving, threading, parting, drilling on the axis, boring, internal grooves and internal threads; with live tools and C axis: drilling (axial on a bolt circle, radial as a cross hole), keyways, wrench flats (two flats, square, hexagon), free sketch contours on the face or wrapped around the diameter, and pockets in the face
- **Tool library** with a cutting data calculator, material presets, tool life and holder display
- **Simulation** with stock removal (also on cylindrical stock), comparison with the finished part (rest / too deep), machining time per setup
- **NC editor** with backplot, search and editing; the **NC check** detects collisions of holder, shank and rapid moves, contact with fixtures and table, axis limits and syntax errors (Heidenhain)
- **Post processors**: Heidenhain Klartext (incl. APPR/DEP, cycles 2xx, hole patterns 220/221), Fanuc, Sinumerik, Okuma (milling / turning), LinuxCNC, GRBL and more. Your own post processors can be adapted in the built-in editor with a live preview.
- **Control cycles** instead of computed paths: drilling and pocket cycles, studs, bolt circles and grids, turning roughing cycle and threading cycle

### User interface
- **Languages**: English, German and Chinese (Preferences → Units and value display → Language; the first start follows the browser language)
- Marking menu (right click), ViewCube, keyboard shortcuts (e.g. Q press/pull, F fillet, M move, I measure, X construction line)
- Several documents in tabs, versions on save; import of STEP, IGES, STL, OBJ and DXF, tool libraries and post processors (.cps)

---

## Getting started

### Windows app
Download `WerkFab-<version>-windows-x64.zip` from the [Releases](../../releases), unpack it and start `WerkFab.exe`.

### Browser version (works offline)
Download `WerkFab-<version>-browser.zip` from the [Releases](../../releases) and unpack it. Start a local web server in that folder, for example:

```bash
python -m http.server 8765
```

and open `http://localhost:8765`. After the first load the app also works without a network (service worker). More notes are in `LIESMICH.txt` inside the archive.

### From source
Requirements: [Node.js](https://nodejs.org) 18 or newer. For the browser variant also Python 3 (or any other static web server).

```bash
npm install
```

```bash
npm start
```

starts the Electron app. Alternatively `start.bat` starts a local web server and opens WerkFab in the browser.

---

## Safety: always simulate NC programs first

WerkFab writes programs that move real machines. A wrong program can destroy tools, fixtures, the spindle and the machine, and it can injure people.

- **Check every program before its first run:** on the machine in a dry run (single block, reduced feed and rapid, first in the air) **or in an external NC simulator** or the graphic simulation of the control.
- The simulation and the NC check in WerkFab work on the toolpaths WerkFab itself has computed. They know nothing about your control, its parameters or your machine, and they do not replace the check at the machine.
- The post processors are tested against the programming rules of the controls, **but they have not run on real machines**. M codes, tool changes, tilting, cycles and the C axis depend on the machine and must be adapted to yours.
- Work origin, tool lengths, fixtures and travel limits are the operator's responsibility.
- WerkFab is provided without any warranty (GPL-3.0, sections 15 and 16). You use it at your own risk.
- **Liability (German law):** WerkFab is given away free of charge. As far as the law allows, the author is liable only for intent and gross negligence (as for a gift, §§ 521, 523, 524 BGB); any further liability is excluded.

---

## Building

| Command | Result |
|---|---|
| `npm run build` or `build-exe.bat` | Windows app in `dist/WerkFab-win32-x64` |
| `npm run build:web` or `build-web.bat` | Browser version in `dist/WerkFab-Browser` (+ ZIP via the .bat) |
| `npm run build:kernel` | Rust kernel to WebAssembly (`vendor/openfab-kernel`), needs Rust + `wasm32-unknown-unknown` |

## Tests

All tests at once:

```bash
npm test
```

| Command | Checks |
|---|---|
| `npm run test:trim` | Sketch: trim and extend |
| `npm run test:sketch` | Sketch tools (rectangles, circles, arcs, offset) |
| `npm run test:solver` | Constraints and dimensions on arcs |
| `npm run test:kernel` | Rust kernel (WebAssembly) |
| `npm run test:cam` | Every milling strategy on a test part of exactly known shape: no gouging of the part or the stock to leave (tolerance 0.02 mm finishing, 0.04 mm roughing); every post processor (valid values, program frame, positions read back = toolpath); all turning operations and lathe posts, insert against contour, roughing / finishing cycles G71/G70 and G85/G87; hole patterns and drilling order |
| `npm run test:hh` | Heidenhain Klartext: one program with all cycles, APPR/DEP, helices, probing cycle and a tilted setup in six option combinations, checked block by block against the Klartext rules and the state of the control |
| `npm run test:iso` | G-code for Fanuc/ISO, Okuma OSP-M, LinuxCNC, GRBL and Sinumerik: the same program in five option combinations, checked block by block (length offset, spindle, feed, cycles, arcs) |
| `npm run test:lathe` | Lathe programs for Fanuc, Okuma and LinuxCNC: all operations as paths and as cycles, checked block by block (tool change away from the part, spindle, C axis, cycles with a contour) |
| `npm run test:drawing` | Drawing: dimensions, angles, notes, detail views and sections in the generated SVG |
| `npm run test:i18n` | Languages: every dictionary against the texts of the source (placeholders, line breaks), and the translation at run time |

The tests run without a browser in Node.js, and automatically on GitHub with every push.

### Translations

The interface is written in German; the other languages are dictionaries in `js/lang/`. `node tools/i18n-extract.mjs` collects the German texts from the source, `node tools/i18n-extract.mjs --missing en` lists what has no translation yet, and `node tools/i18n-build.mjs merge` builds the dictionaries from the work files in `tools/i18n/`. Corrections go into `tools/i18n/fix-<language>.json`. Improvements by native speakers are very welcome.

### Publishing a new version

1. Set the version in `package.json` (e.g. `1.0.0`) and add to `CHANGELOG.md`.
2. Commit, tag and push:

```bash
git tag v1.0.0
```

```bash
git push origin main --tags
```

The **Release** workflow (`.github/workflows/release.yml`) tests, builds the Windows app and the browser version and attaches both as ZIP files to the GitHub release. Tags with a hyphen (e.g. `v1.0.0-rc.2`) become pre-releases. The tests also run on every push to `main` (`.github/workflows/ci.yml`).

---

## Project layout

| Folder | Content |
|---|---|
| `js/` | The application (ES modules, no bundler): model, sketch, solver, CAM, simulation, post processors, user interface |
| `js/lang/` | Translations of the interface |
| `css/`, `icons/` | Styles and icons |
| `electron/` | Shell of the Windows app |
| `vendor/` | Bundled libraries (OpenCascade/replicad, three.js, Clipper, opentype.js …) |
| `rust/openfab-kernel/` | Experimental geometry kernel of its own in Rust (truck), built to WebAssembly |
| `tools/` | Build and test scripts |

By default WerkFab computes with **OpenCascade** (through replicad / WebAssembly). The Rust kernel is an experimental alternative that can be switched on through the kernel interface.

---

## Known limits

- The Okuma syntax (milling and turning, incl. the G85/G81 cycles) was written from general knowledge and has not been checked on a real control.
- No simultaneous 5-axis milling. Supported are 3+2 (tilted setups) and 4-axis simultaneous around the A axis.
- Live tools on the lathe: drilling, keyways, flats and sketch contours on the face and around the diameter; no Y axis, pockets on the face only. Polar and cylindrical interpolation (G12.1, G7.1) in the Fanuc post only, otherwise short X/C steps or Z/C without interpolation. The simulation shows these contours as ribbons, not as stock removal. The M codes for the C axis and the tool spindle depend on the machine and must be checked in the post processor. The NC check does not test live tool operations against the stock.
- No freeform / T-spline modelling.
- Large 3D strategies (adaptive 3D, geodesic) need several seconds of computing time, depending on the part.
- Translations: the interface is written in German. In the other languages a few composed messages can remain German; comments in the NC program are always German. The changelog is in German.

---

## License

WerkFab is licensed under the **GNU General Public License v3.0 or later**, see [LICENSE](LICENSE).

Bundled libraries come under their own licenses, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the license texts are in [`licenses/`](licenses).

Names of controls, machines and other software (Heidenhain, Fanuc, Sinumerik, Okuma, LinuxCNC, GRBL and others) are trademarks of their owners. They are used only to say what WerkFab's output and import functions are meant for; WerkFab is not affiliated with or endorsed by any of them.

---

## Support

WerkFab is free and made in my spare time. If the program helps you, I am happy about a coffee:

<a href="https://paypal.me/VitalijBleich"><img src="docs/media/kaffee-button.svg" alt="Buy me a coffee (PayPal)" height="48"></a>
