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

## Public single-photo preview (September 2026)

`/free-upscale/` keeps one photo at a time: choose, upscale, compare and save. Its
result viewer follows the gallery at main commit `1baa444`: fitted comparison,
expand/close controls and downloads below; the app card sits under the tool.

Separate face enhancement is enabled by default and can be turned off before
processing. MediaPipe finds up to eight faces; the app-parity alignment checks
select suitable faces. Only then is the exact quantized GFPGAN 1.4 model loaded.
512×512 restored patches are feathered into the Regular 2× result. Photos with
no suitable faces still receive normal 2× processing, with an explicit result
summary. AI face restoration can change facial details.

The face worker finishes and is terminated before the regular worker starts,
so their inference heaps are not intentionally kept resident together. Apple
mobile devices always use the CPU face backend because the physical iPhone
findings recorded a WebGPU failure for that graph. Other devices try WebGPU
and retry face processing in a new CPU worker on GPU failure. Face processing
has a conservative 2 MP mobile/low-memory limit and an 8 MP desktop limit,
in addition to the regular photo guards. A failure offers retry, the option
to turn off face enhancement, and the app; it never reports a face pass as
successful when it failed. These limits cannot measure actual free RAM.

`npm run build:preview` requires the approved `face_512.onnx` and
`face_landmarker.task` artifacts alongside the existing regular models. The
face model is split into content-addressed parts below Cloudflare Pages'
25 MiB per-file limit and streamed into one preallocated buffer. Generated
weights and runtime assets are ignored by Git and cached with immutable URLs.

Validation: 11 processing tests, a 900×1200 portrait with one separate face
restored and a verified 1800×2400 JPEG result, CPU face inference, no-face
handling without a GFPGAN download, mobile face admission rejection, optional
face-off processing, keyboard comparison, expanded view, and a 390px layout.
The new complete flow still needs testing on physical iPhones and Android
phones; the iOS backend choice uses the earlier real-device findings.
