# Browser image processing prototype

## Short answer

Yes. Regular photo and Real-ESRGAN/SRVGG drawing upscaling at 2× and 4×, plus
the same GFPGAN face enhancement model for photos, can run entirely in a
browser. The tested GPU path is fast enough to feel practical.
The CPU fallback works, but face enhancement is slow.

The prototype is a separate page at `/lab/`. A photo stays in the browser tab;
the page does not upload it.

## What is in the prototype

- Exact Regular 2× weights from the iOS model.
- Exact quantized GFPGAN 1.4 face model used by the apps.
- 256-pixel overlapping tiles for normal upscaling.
- The same face alignment target and soft circular blend used by Android, and
  its size checks; the rotation check is deliberately looser here.
- GPU processing when the browser makes it available, with a CPU fallback.
- A hidden engineering benchmark at `/lab/?benchmark=1` that compares browser
  output pixel-by-pixel with iOS Core ML reference images.

YuNet (OpenCV Zoo, MIT) finds the faces and MediaPipe then places its
landmarks on a crop around each one. MediaPipe's own bundled detector only sees
faces that fill much of the frame, so group and full-length photos used to find
no faces at all. The detector runs at 1280 px on desktop and 640 px on phones,
measured at 56 ms and 16 ms on an M4 Pro; a physical iPhone (iOS 27, Chrome)
measured 0.9 s at 640 against 3.6 s at 1280 and found the same faces.
Android uses ML Kit for that
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
   model files from the sibling iOS and Android repositories. Non-standard
   checkout locations can be supplied with `USCALE_IOS_REPO` and
   `USCALE_MODEL_PORT`.
2. Run `npm install` and `npm run build` (the site builder needs Python 3).
3. Run `npm run preview:lab` and open `http://127.0.0.1:4173/lab/`.

The model files are deliberately not committed. For a public experiment they
should live behind the same site or a model CDN with long-lived caching.

## Public single-photo preview (September 2026)

`/free-upscale/` keeps one photo at a time: choose, upscale, compare and save. Its
result viewer follows the gallery at main commit `1baa444`: fitted comparison,
expand/close controls and downloads below; the app card sits under the tool.

Separate face enhancement is enabled by default and can be turned off before
processing. The detector returns up to eight faces; alignment checks select
suitable ones. The apps skip a face whose nose sits 140 or further from the
eye-to-mouth line, measured from the centroid of Vision's nose region; the web
measures the same average over the mesh's nose but allows 300, because
enhancing the most turned faces of a 45-photo sample by hand showed the 512
model stays faithful on three-quarter views, which score 190 to 290. A family
photo of five people kept only one of its three usable faces at 140.
Only then is the exact quantized GFPGAN 1.4 model loaded.
512×512 restored patches are feathered into the Regular 2× result. Photos with
no suitable faces still receive normal 2× processing, with an explicit result
summary. AI face restoration can change facial details.

The tool defaults to Photo and keeps the selected image type until the page is
reloaded. Drawing uses the exact iOS `anime_2x_dsize` or `anime_4x_dsize`
Real-ESRGAN/SRVGG model; face enhancement is hidden and never loaded in that
mode. Model assets are selected independently for WebGPU and the WASM fallback.

The face worker finishes and is terminated before the regular worker starts,
so their inference heaps are not intentionally kept resident together. Apple
mobile devices always use the CPU face backend because the physical iPhone
findings recorded a WebGPU failure for that graph. Other devices try WebGPU
and retry face processing in a new CPU worker on GPU failure. Face processing
has a conservative 2 MP mobile/low-memory limit and an 8 MP desktop limit,
in addition to the regular photo guards. A failure offers retry, the option
to turn off face enhancement, and the app; it never reports a face pass as
successful when it failed. These limits cannot measure actual free RAM.

After a photo with faces finishes, **Choose faces** opens the original full
screen with an upright box over every face found, including the ones outside
the limits above, which start unselected. The button carries the enhanced
count. Every detected face keeps a
transform: from the mesh, or from YuNet's own five points when the mesh cannot
be placed. Apply never runs the 2× model again: the processor keeps a faceless
JPEG of the upscaled photo, and `face-edit.worker.js` feathers the chosen
patches onto it and re-encodes, so the background is re-encoded at most once
however often the selection changes. The face model runs only for selected
faces that were never enhanced; patches are kept as PNG blobs for the whole
photo, so turning a face off and on again costs a re-blend. The picker is
offered only where the base and a second full-size canvas fit
(`faceEditFits`): all of 2× on desktop and phones, and 4× on desktop up to
about 11 MP. A failed Apply keeps the previous result and its download.

`npm run build:preview` requires the approved `face_512.onnx`,
`face_detector_yunet.onnx` and `face_landmarker.task` artifacts alongside the existing regular models. The
face model is split into content-addressed parts below Cloudflare Pages'
25 MiB per-file limit and streamed into one preallocated buffer. Generated
weights and runtime assets are ignored by Git and cached with immutable URLs.

Validation: 11 processing tests, a 900×1200 portrait with one separate face
restored and a verified 1800×2400 JPEG result, CPU face inference, no-face
handling without a GFPGAN download, mobile face admission rejection, optional
face-off processing, keyboard comparison, expanded view, and a 390px layout.
The new complete flow still needs testing on physical iPhones and Android
phones; the iOS backend choice uses the earlier real-device findings.
