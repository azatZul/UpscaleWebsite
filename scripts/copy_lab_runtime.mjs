import {cp, mkdir, readdir} from 'node:fs/promises';

const output = new URL('../assets/lab/', import.meta.url);

async function copyMatching(source, destination, predicate) {
  await mkdir(destination, {recursive: true});
  for (const entry of await readdir(source, {withFileTypes: true})) {
    if (entry.isFile() && predicate(entry.name)) {
      await cp(new URL(entry.name, source), new URL(entry.name, destination));
    }
  }
}

await mkdir(new URL('vendor/', output), {recursive: true});
await cp(
  new URL('../node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs', import.meta.url),
  new URL('vendor/ort.webgpu.min.mjs', output),
);
await cp(
  new URL('../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', import.meta.url),
  new URL('vendor/vision_bundle.mjs', output),
);

await mkdir(new URL('ort/', output), {recursive: true});
for (const fileName of [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
]) {
  await cp(
    new URL(`../node_modules/onnxruntime-web/dist/${fileName}`, import.meta.url),
    new URL(`ort/${fileName}`, output),
  );
}

await copyMatching(
  new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url),
  new URL('mediapipe/', output),
  (name) => name.endsWith('.wasm') || name.endsWith('.js'),
);
