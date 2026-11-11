// Copies third-party runtime files into public/ so the app never depends on an outside CDN
// (many school networks block them). Runs automatically after `npm install`.
// 1. Pyodide: the Python runtime used for Python scripts.
import fs from 'node:fs';
import path from 'node:path';
const from = path.resolve('node_modules/pyodide');
const to = path.resolve('public/pyodide');
if (fs.existsSync(from)) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
    if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
}

// Blockly's icons and click sounds, served locally instead of from Google's demo server.
const media = path.resolve('node_modules/blockly/media');
if (fs.existsSync(media)) fs.cpSync(media, path.resolve('public/blockly-media'), { recursive: true });
