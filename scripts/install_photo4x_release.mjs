// Install only the reviewed graph; never copy the experiment directory.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PHOTO4X_RELEASE} from '../src/tool/photo4x-release.js';
const spec = PHOTO4X_RELEASE.winner;
const bytes = await readFile(new URL('../.web-model-work/photo4x/models/nomos-realplksr-256-fp16-gpu.onnx', import.meta.url));
if (bytes.length !== spec.bytes || createHash('sha256').update(bytes).digest('hex') !== spec.sha256) {
  throw new Error('Prepared graph differs from the reviewed release; do not silently replace the approved hash');
}
await writeFile(new URL(`../static/models/${spec.sourceFile}`, import.meta.url), bytes);
console.log(`Installed reviewed Photo 4x model (${bytes.length} bytes, ${spec.sha256})`);
