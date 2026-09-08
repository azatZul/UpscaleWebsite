#!/usr/bin/env python3
"""Recreate the local web-model artifacts from the exact app models."""

from __future__ import annotations

import hashlib
import subprocess
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEV = ROOT.parent
IOS = DEV / "Upscaler"
PORT = DEV / "upscaler-android" / "model-port"
PYTHON = PORT / ".venv" / "bin" / "python"
OUTPUT = ROOT / "static" / "models"
WORK = ROOT / ".web-model-work"


def run(*arguments: str) -> None:
    subprocess.run(arguments, cwd=PORT, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if not PYTHON.exists() or not IOS.exists():
        print("Expected sibling Upscaler and upscaler-android checkouts are missing.", file=sys.stderr)
        return 2
    OUTPUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)

    # The web tiler always feeds 256×256 pieces. A fixed graph avoids symbolic
    # Resize dimensions that make some browser runtimes spend minutes compiling.
    run(str(PYTHON), "-c", (
        "from pathlib import Path; import torch, onnx;"
        "from model_port.srvgg import load_exact_coreml_srvgg;"
        f"m,_=load_exact_coreml_srvgg(Path({str(IOS / 'UpscalePackage/Sources/Processor/models/normal_2x_dsize.mlmodel')!r}),2);"
        f"p={str(OUTPUT / 'normal_2x_web.onnx')!r};"
        "torch.onnx.export(m,torch.rand(1,3,256,256),p,input_names=['image'],output_names=['output'],"
        "opset_version=17,do_constant_folding=True,dynamo=False);"
        "onnx.checker.check_model(onnx.load(p),full_check=True)"
    ))

    # Same graph family as the 2× export above, at the app's separate 4×
    # model. desktop-only in the tool (see capability.js): a 4× output canvas
    # is 4x the linear size of 2×'s for the same photo, so it is offered only
    # where the measured canvas/memory headroom covers that.
    run(str(PYTHON), "-c", (
        "from pathlib import Path; import torch, onnx;"
        "from model_port.srvgg import load_exact_coreml_srvgg;"
        f"m,_=load_exact_coreml_srvgg(Path({str(IOS / 'UpscalePackage/Sources/Processor/models/normal_4x_dsize.mlmodel')!r}),4);"
        f"p={str(OUTPUT / 'normal_4x_web.onnx')!r};"
        "torch.onnx.export(m,torch.rand(1,3,256,256),p,input_names=['image'],output_names=['output'],"
        "opset_version=17,do_constant_folding=True,dynamo=False);"
        "onnx.checker.check_model(onnx.load(p),full_check=True)"
    ))

    run(str(PYTHON), "-m", "model_port", "export-gfpgan", "--repo", str(IOS),
        "--model", "face", "--output", str(OUTPUT / "face_512.onnx"), "--opset", "18")

    # ORT's CPU-ready format avoids a long graph-optimization pause in some
    # browsers. The plain ONNX file remains the WebGPU version because CPU
    # layout optimizations are not portable to the GPU backend.
    ort_output = WORK / "ort-normal"
    ort_output.mkdir(parents=True, exist_ok=True)
    for name in ("normal_2x_web", "normal_4x_web"):
        run(
            str(PYTHON), "-m", "onnxruntime.tools.convert_onnx_models_to_ort",
            str(OUTPUT / f"{name}.onnx"),
            "--output_dir", str(ort_output),
            "--optimization_style", "Fixed",
            "--target_platform", "amd64",
        )
        (OUTPUT / f"{name}.ort").write_bytes(
            (ort_output / f"{name}.ort").read_bytes(),
        )

    # LiteRT.js performs best with browser-native channel-last tensors. Rebuild
    # the same Core ML weights in that layout so the entire graph can stay on
    # WebGPU instead of bouncing between the GPU and WASM.
    run(
        str(PYTHON), str(PORT / "scripts" / "export_nhwc_tflite.py"),
        "--coreml", str(IOS / "UpscalePackage/Sources/Processor/models/normal_2x_dsize.mlmodel"),
        "--output", str(OUTPUT / "normal_2x_litert.tflite"),
        "--tile-size", "256", "--scale", "2", "--fp16-weights",
    )

    landmark_path = OUTPUT / "face_landmarker.task"
    if not landmark_path.exists():
        urllib.request.urlretrieve(
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
            "face_landmarker/float16/1/face_landmarker.task",
            landmark_path,
        )

    for path in sorted(OUTPUT.iterdir()):
        if path.is_file() and path.name != "README.md":
            print(f"{path.name}: {path.stat().st_size} bytes, sha256 {sha256(path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
