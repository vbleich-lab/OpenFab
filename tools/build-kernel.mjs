// Builds the Rust geometry kernel (rust/werkfab-kernel) as WebAssembly and copies it to vendor/werkfab-kernel.
// Needs Rust with the wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown).
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = path.join(ROOT, 'rust', 'werkfab-kernel');
const cargo = process.env.CARGO || path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
execFileSync(fs.existsSync(cargo) ? cargo : 'cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: CRATE, stdio: 'inherit' });
const out = path.join(ROOT, 'vendor', 'werkfab-kernel');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(CRATE, 'target', 'wasm32-unknown-unknown', 'release', 'werkfab_kernel.wasm'), path.join(out, 'werkfab_kernel.wasm'));
console.log('Rust-Kern gebaut:', path.join(out, 'werkfab_kernel.wasm'));
