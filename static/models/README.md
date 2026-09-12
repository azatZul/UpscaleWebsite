# Browser prototype models

The generated model files in this directory are intentionally ignored by Git.
Run `python3 scripts/prepare_web_models.py` from this website checkout to recreate
them from the sibling iOS and Android repositories.

The prototype expects:

- `normal_2x_web.onnx` — exact iOS Regular 2× weights in the portable graph
  used by WebGPU.
- `normal_2x_web.ort` — the same Regular 2× graph prepared for the browser CPU
  fallback so it starts without a long optimization pause.
- `normal_2x_litert.tflite` — the exact Regular 2× weights rebuilt in the
  browser-native channel-last layout for the LiteRT.js WebKit/iOS runtime.
- `face_512.onnx` — the exact quantized GFPGAN 1.4 graph used for face
  enhancement, exported from the seven-bit Core ML source without expanding
  the weights to FP32.
- `face_detector_yunet.onnx` — YuNet from the OpenCV Zoo (MIT), which finds
  the faces. The landmark bundle's own BlazeFace detector only sees faces that
  fill much of the frame, so group and full-length photos found none at all.
- `face_landmarker.task` — MediaPipe face landmarks, placed on a crop around
  each face YuNet found, used only to align and composite faces. It is not the
  enhancement model.

The benchmark corpus under `static/benchmarks/ios/` is generated directly from
the Core ML models and records hashes for every input and reference image.
