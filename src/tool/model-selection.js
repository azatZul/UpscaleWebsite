export const MODEL_KINDS = ['photo', 'drawing'];

export function isModelKind(value) {
  return MODEL_KINDS.includes(value);
}

export function resolveModelAsset(models, modelKind, scale, backend) {
  if (!isModelKind(modelKind)) throw new Error(`Unknown model kind: ${modelKind}`);
  if (![2, 4].includes(scale)) throw new Error(`Unknown upscale scale: ${scale}`);
  if (!['webgpu', 'wasm'].includes(backend)) throw new Error(`Unknown model backend: ${backend}`);
  const asset = models?.[modelKind]?.[scale]?.[backend === 'webgpu' ? 'gpu' : 'cpu'];
  if (!asset) throw new Error(`Missing ${modelKind} ${scale}x ${backend} model asset`);
  return asset;
}

export function shouldEnhanceFaces(modelKind, checked) {
  return modelKind === 'photo' && checked;
}

export function tileMetricKey(modelKind, scale) {
  if (!isModelKind(modelKind)) throw new Error(`Unknown model kind: ${modelKind}`);
  if (![2, 4].includes(scale)) throw new Error(`Unknown upscale scale: ${scale}`);
  return `uscale-tile-ms-v2-${modelKind}-${scale}`;
}
