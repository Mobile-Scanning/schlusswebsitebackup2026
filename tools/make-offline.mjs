// Turns the offline Angular build (dist/offline/browser) into a folder you can
// open by double-clicking index.html – no server needed.
// Browsers block ES-module scripts on file:// pages, so all code chunks are
// bundled into one classic script (app.js) with esbuild.
import { build } from 'esbuild';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'dist/offline/browser';
const OUT = 'preview';
if (!existsSync(join(SRC, 'main.js'))) throw new Error('Run "ng build --configuration offline" first.');

rmSync(OUT, { recursive: true, force: true });
await build({ entryPoints: [join(SRC, 'main.js')], bundle: true, format: 'iife', minify: true, target: 'es2022', outfile: join(OUT, 'app.js'), logLevel: 'warning' });

for (const f of readdirSync(SRC)) {
  if (f.endsWith('.js') || f === 'index.html') continue;
  cpSync(join(SRC, f), join(OUT, f), { recursive: true });
}

let html = readFileSync(join(SRC, 'index.html'), 'utf8');
html = html
  .replace(/<base href="[^"]*">/, '')
  .replace(/<link rel="modulepreload"[^>]*>/g, '')
  .replace(/<script[^>]*type="module"[^>]*><\/script>/g, '')
  .replace('</head>', '  <script src="app.js" defer></script>\n</head>');
writeFileSync(join(OUT, 'index.html'), html);
console.log(`Offline preview ready: ${OUT}/index.html (double-click to open).`);
