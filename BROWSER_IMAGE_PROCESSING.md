# Browser image processing prototype

## Short answer

Yes. Regular 2× upscaling and the same GFPGAN face enhancement model can run
entirely in a browser. The tested GPU path is fast enough to feel practical.
The CPU fallback works, but face enhancement is slow.

The prototype is a separate page at `/lab/`. A photo stays in the browser tab;
the page does not upload it.

## What is in the prototype

- Exact Regular 2× weights from the iOS model.
- Exact quantized GFPGAN 1.4 face model used by the apps.
- 256-pixel overlapping tiles for normal upscaling.
- The same face alignment target, acceptance checks, and soft circular blend
  used by Android.
- GPU processing when the browser makes it available, with a CPU fallback.
- A hidden engineering benchmark at `/lab/?benchmark=1` that compares browser
  output pixel-by-pixel with iOS Core ML reference images.

The browser uses MediaPipe to find face landmarks. Android uses ML Kit for that
step, so face detection can choose slightly different points even though the
enhancement model and blending rules are the same.

## Results on the test Mac

| Model work | GPU | CPU fallback | iOS comparisons |
| --- | ---: | ---: | --- |
| Regular 2×, one 256-pixel tile | 0.51 s | 3.89 s | 17 of 17 passed |
| GFPGAN, one 512-pixel face | 0.71 s | 9.75 s | 12 of 12 passed |

A real 840×560 photo used 12 overlapping tiles and finished in 6.4 seconds on
the GPU. A 400×360 portrait, including face detection, four background tiles,
one GFPGAN face, blending, and JPEG creation, finished in 9.4 seconds.

The full numbers are in `benchmarks/browser/mac_chromium_151_aggregate.json`.

## Browser reality

- GPU is the intended experience. CPU is a safety net.
- ONNX Runtime officially supports its GPU path in Chrome and Edge on desktop
  and supported Android devices. Its CPU path covers Safari, Firefox, and iOS
  browsers too. The prototype automatically falls back to that CPU path.
- Safari 26 has the browser-level WebGPU feature, but ONNX Runtime does not yet
  list Safari GPU execution as supported. It should be treated as CPU-only
  until a real Safari test says otherwise.
- The exact 86 MB face model is reasonable after browser caching, but it is a
  noticeable first download on a slow connection.
- Tiling keeps model memory predictable and removes hard tile seams.
- The finished 2× image still has to exist in browser memory for JPEG creation.
  Very large phone photos need a streaming image encoder before this should be
  offered without a conservative size limit.
- This run proves the complete flow in a Chromium browser on macOS. Safari,
  Firefox, Windows, iPhone, and Android browsers still need a small device test
  grid before release.

## Running it locally

1. Run `python3 scripts/prepare_web_models.py` once. It recreates the ignored
   model files from the sibling iOS and Android repositories.
2. Run `npm install` and `npm run build` (the existing site builder needs
   Python 3.12).
3. Run `npm run preview:lab` and open `http://127.0.0.1:4173/lab/`.

The model files are deliberately not committed. For a public experiment they
should live behind the same site or a model CDN with long-lived caching.
