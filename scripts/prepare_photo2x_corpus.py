#!/usr/bin/env python3
"""Photo 2x inputs from the already curated Photo 4x references. Local only, no downloads.

Each case keeps its 4x reference as ground truth; only the low-resolution
input changes from a 4x to a 2x downscale with the same degradation tracks.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageFilter


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", type=Path, default=Path(".web-model-work/photo4x"))
    args = parser.parse_args()
    root = args.work / "web-corpus"
    corpus = json.loads((root / "manifest.json").read_text())
    if corpus["errors"]:
        raise SystemExit("Prepare and review the complete licensed 4x corpus first")
    cases = []
    for case in corpus["cases"]:
        reference = Image.open(root / case["reference"]).convert("RGB")
        pixels = reference.resize((reference.width // 2, reference.height // 2), Image.Resampling.BICUBIC)
        if case["track"] == "mild":
            buffer = io.BytesIO()
            pixels.filter(ImageFilter.GaussianBlur(.45)).save(buffer, format="JPEG", quality=85, subsampling=2)
            pixels = Image.open(io.BytesIO(buffer.getvalue())).convert("RGB")
        name = f"web2x-{case['id']}.png"
        output = args.work / "inputs" / name
        pixels.save(output)
        cases.append({**case, "input": name, "sha256": sha(output), "size": pixels.size})
    protocol = {**corpus["protocol"], "scale": 2,
                "clean": "Bicubic downscale by 2 of the same reference; lossless PNG; no artificial noise or scratches",
                "mild": "Same downscale, Gaussian blur sigma 0.45 LR pixels, JPEG quality85 4:2:0; decoded to PNG"}
    (root / "manifest-2x.json").write_text(json.dumps({**corpus, "cases": cases, "protocol": protocol},
                                                      ensure_ascii=False, indent=2) + "\n")
    print(f"Prepared {len(cases)} Photo 2x inputs")


if __name__ == "__main__":
    main()
