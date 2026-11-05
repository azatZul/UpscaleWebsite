#!/usr/bin/env python3
"""Copy explicit test input and existing fixtures into the private lab only."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--photo", required=True, type=Path)
    parser.add_argument("--parrot", type=Path)
    parser.add_argument("--eiffel", type=Path)
    parser.add_argument("--parrot-result", type=Path)
    parser.add_argument("--crisp-result", type=Path)
    args = parser.parse_args()
    output = ROOT / ".web-model-work/photo4x/inputs"
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.photo, output / "girls_blured.jpg")
    with Image.open(args.photo) as image:
        if image.size != (466, 700):
            raise ValueError("The specified experiment expects the 466×700 source")
        image.crop((70, 140, 390, 460)).save(output / "girls-crop320.png")
    large = ROOT / "resources/before_after/film_negative_after.jpg"
    with Image.open(large) as image:
        # Native crop of an existing real photograph; no enlargement or tiling.
        image.convert("RGB").crop((378, 195, 4410, 3219)).save(output / "camera12mp.jpg", quality=96)
        large_size = image.size
    inputs = [{"file": "girls_blured.jpg", "sha256": digest(args.photo), "size": [466, 700], "source": "user-supplied photo"},
              {"file": "girls-crop320.png", "sha256": digest(output / "girls-crop320.png"), "crop": [70, 140, 390, 460], "source": "girls_blured.jpg"},
              {"file": "camera12mp.jpg", "sha256": digest(output / "camera12mp.jpg"), "source": str(large.relative_to(ROOT)),
               "source_sha256": digest(large), "originalSize": large_size, "crop": [378, 195, 4410, 3219], "size": [4032, 3024], "resize": False}]
    for name in ["restore_original", "denoise_orig", "lol_dark_2", "sky_original", "face_preview_blured_2", "japan_blured", "evan_original"]:
        source = ROOT / f"static/benchmarks/ios/normal_2x/asset_{name}.input.png"
        target = output / f"corpus-{name}.png"
        shutil.copyfile(source, target)
        inputs.append({"file": target.name, "sha256": digest(target), "source": str(source.relative_to(ROOT)),
                       "purpose": "diagnostic animation fixture" if name == 'evan_original' else 'photographic corpus'})
    references = ROOT / '.web-model-work/photo4x/results/external-references'
    references.mkdir(parents=True, exist_ok=True)
    for source, target, purpose in [
        (args.parrot, output / 'parrot.png', 'user input; no synthetic degradation'),
        (args.eiffel, output / 'eiffel_bw.png', 'user input; no synthetic degradation'),
        (args.parrot_result, references / 'parrot-result.png', 'external result; not ground truth'),
        (args.crisp_result, references / 'crisp-result.png', 'Crisp user-provided result; not ground truth'),
    ]:
        if source is None:
            continue
        with Image.open(source) as original:
            normalized = ImageOps.exif_transpose(original)
            if 'A' in normalized.getbands() and normalized.getchannel('A').getextrema()[0] < 255:
                raise ValueError('These additional photographic comparisons expect opaque RGB inputs')
            normalized.convert('RGB').save(target)
        inputs.append({'file': str(target.relative_to(ROOT / '.web-model-work/photo4x')), 'sha256': digest(target),
                       'source_sha256': digest(source), 'purpose': purpose, 'groundTruth': False,
                       'change': 'EXIF orientation and decoded RGB to lossless PNG; no resizing'})
    (output / "inputs.json").write_text(json.dumps(inputs, indent=2) + "\n")


if __name__ == "__main__":
    main()
