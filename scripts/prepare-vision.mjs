import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const base = 'apps/web/public/vision';
await mkdir(base + '/wasm', { recursive: true });
await mkdir(base + '/ocr/core', { recursive: true });
const vision = dirname(require.resolve('@mediapipe/tasks-vision'));
for (const n of await readdir(join(vision, 'wasm')))
  await copyFile(join(vision, 'wasm', n), base + '/wasm/' + n);
const tess = dirname(require.resolve('tesseract.js/package.json'));
await copyFile(join(tess, 'dist/worker.min.js'), base + '/ocr/worker.min.js');
const core = dirname(
  createRequire(join(tess, 'package.json')).resolve('tesseract.js-core/package.json'),
);
// OEM=1 uses the self-contained LSTM wrappers; include scalar/SIMD/relaxed-SIMD fallbacks.
for (const n of await readdir(core))
  if (n.endsWith('lstm.wasm.js')) await copyFile(join(core, n), base + '/ocr/core/' + n);
await copyFile(join(tess, 'LICENSE.md'), base + '/ocr/LICENSE-tesseract.md');
