// Keep the existing per-model/scale ETA units: full tile assembly time. A run
// with skipped tiles cannot teach the cost of a later opaque photograph.
export function learnedTileMs({plan, tilesMs, skippedTiles = 0}) {
  return plan?.tileCount >= 16 && skippedTiles === 0 && Number.isFinite(tilesMs) && tilesMs > 0
    ? tilesMs / plan.tileCount : undefined;
}

// Group face-model failures only in analytics. The UI and retry controller need
// the original cause (especially gpu, size, format and download).
export function processingFailureProperties(code, stage) {
  if (!stage) return {error_type: code};
  return {error_type: stage === 'faces' && code !== 'download' ? 'face' : code,
    error_stage: stage, error_reason: code};
}
