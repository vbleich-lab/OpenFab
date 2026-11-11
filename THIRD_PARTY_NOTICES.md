# Drittanbieter-Komponenten

Toolbahn liefert die folgenden Bibliotheken unverändert im Ordner `vendor/` mit. Sie stehen unter ihren eigenen Lizenzen. Die Urheberrechte liegen bei den jeweiligen Autoren.

| Komponente | Version | Lizenz | Quelle |
|---|---|---|---|
| Open CASCADE Technology (WebAssembly-Build `opencascade.js`) | 7.x | LGPL-2.1 mit Open-CASCADE-Ausnahme | https://dev.opencascade.org, https://github.com/donalffons/opencascade.js |
| replicad (inkl. eigenem OpenCascade-Build) | – | MIT | https://github.com/sgenoud/replicad |
| three.js (inkl. `examples/jsm`) | r160 | MIT | https://github.com/mrdoob/three.js |
| three-mesh-bvh | – | MIT | https://github.com/gkjohnson/three-mesh-bvh |
| Clipper (JavaScript-Portierung) | 6.4.2 | Boost Software License 1.0 | https://sourceforge.net/projects/jsclipper/ |
| opentype.js (inkl. tiny-inflate) | 1.3.4 | MIT | https://github.com/opentypejs/opentype.js |
| Roboto, Roboto Mono (Schriften) | – | Apache License 2.0 | https://fonts.google.com/specimen/Roboto |

Die vollständigen Lizenztexte liegen im Ordner [`licenses/`](licenses): MIT (three.js, replicad, three-mesh-bvh, opentype.js, tiny-inflate, serde_json, wasm-bindgen, Electron), Boost Software License 1.0 (Clipper), Apache License 2.0 (Roboto, truck), LGPL 2.1 mit Open-CASCADE-Ausnahme (Open CASCADE Technology, opencascade.js). Der Quelltext von Open CASCADE und opencascade.js steht unter den oben genannten Adressen.

## Rust-Kern (`rust/openfab-kernel`, `vendor/openfab-kernel`)

Der experimentelle Geometriekern wird aus Rust nach WebAssembly übersetzt und enthält unter anderem:

| Crate | Lizenz | Quelle |
|---|---|---|
| truck (geometry, topology, modeling, shapeops, meshalgo, stepio) | Apache License 2.0 | https://github.com/ricosjp/truck |
| serde_json | MIT oder Apache License 2.0 | https://github.com/serde-rs/json |

Die vollständige Liste der Rust-Abhängigkeiten steht in `rust/openfab-kernel/Cargo.lock`.

## Electron (nur Windows-App)

Die Windows-App bündelt [Electron](https://www.electronjs.org) (MIT) und damit Chromium und Node.js. Deren Lizenztexte liegen der gebauten App bei (`LICENSE`, `LICENSES.chromium.html`).

## Hinweis zur LGPL (Open CASCADE)

Open CASCADE wird als eigenständige, austauschbare WebAssembly-Datei (`vendor/opencascade-full/opencascade.wasm.wasm` bzw. `vendor/replicad/replicad_single.wasm`) dynamisch geladen. Sie kann durch einen eigenen, kompatiblen Build ersetzt werden.
