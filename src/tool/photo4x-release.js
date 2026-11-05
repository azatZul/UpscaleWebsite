// One approved artifact. Browser admission still requires local GPU execution
// and a forecast for the actual image; these switches never bypass that check.
const sha256 = 'b9d2b0fad4830776a807ffad91efb9d56c91486b151c1192b6bfdeb4956ecd8a';
export const PHOTO4X_RELEASE = Object.freeze({
  enabled: true,
  licenseApproved: true,
  runtimeVersion: '1.23.2',
  browsers: {chrome: true, edge: true, safari: false},
  // Photo 2× runs the same 4× graph and box-downscales each tile; drop 2 to disable.
  scales: [4, 2],
  winner: {
    id: 'nomos-realplksr', revision: sha256, sha256, bytes: 15_021_513,
    sourceFile: 'photo4x-realplksr-fp16-gpu.onnx',
    url: `/assets/processor/${sha256.slice(0, 16)}-photo4x-realplksr-fp16-gpu.onnx`,
    precision: 'fp16', tileSize: 256, overlap: 32, scale: 4,
    requires: {gpuOnly: true, features: ['shader-f16'], limits: {
      maxBufferSize: 33_554_432, maxStorageBufferBindingSize: 33_554_432,
    }},
  },
});
