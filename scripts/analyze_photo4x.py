#!/usr/bin/env python3
"""Seam measurements and a private blind review artifact from saved PNGs."""
import argparse
import hashlib
import html
import json
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


def metrics(diff, mask):
    values = diff[mask]
    if not values.size:
        return {"pixels": 0, "psnr": None}
    mse = float(np.mean(values.astype(np.float64) ** 2))
    return {"pixels": int(mask.sum()), "mae": float(values.mean()), "p99": float(np.percentile(values, 99)),
            "max": int(values.max()), "psnr": 10 * math.log10(255 ** 2 / mse) if mse else None,
            "identical": mse == 0}


def seam_report(reference, tiled, overlap, tile_size=256, scale=4):
    expected = np.asarray(Image.open(reference).convert("RGB"))
    actual = np.asarray(Image.open(tiled).convert("RGB"))
    if expected.shape != actual.shape:
        raise ValueError("Reference and tiled dimensions must match")
    diff = np.abs(expected.astype(np.int16) - actual.astype(np.int16)).astype(np.uint8)
    height, width = diff.shape[:2]
    seam = np.zeros((height, width), dtype=bool)
    stride = tile_size - overlap * 2
    for core in range(stride, width // scale, stride):
        seam[:, max(0, (core - overlap) * scale):min(width, (core + overlap) * scale)] = True
    for core in range(stride, height // scale, stride):
        seam[max(0, (core - overlap) * scale):min(height, (core + overlap) * scale), :] = True
    interior = np.zeros_like(seam)
    border = overlap * scale
    interior[border:height-border, border:width-border] = True
    output = tiled.with_name(f"{tiled.stem}-difference-x16.png")
    Image.fromarray(np.minimum(diff.astype(np.uint16) * 16, 255).astype(np.uint8)).save(output)
    return {"reference": str(reference), "tiled": str(tiled), "overlap": overlap, "tileSize": tile_size,
            "meaning": "Tiling consistency, not restoration fidelity", "all": metrics(diff, np.ones_like(seam)),
            "seams": metrics(diff, seam & interior), "outsideSeams": metrics(diff, ~seam & interior),
            "outerBorder": metrics(diff, ~interior), "difference": output.name}


def blind_review(folder, files, source):
    # The mapping is a separate explicit reveal, not in captions/alt text.
    order = list(files)
    random.Random(20261102).shuffle(order)
    mapping = {chr(65 + i): p.name for i, p in enumerate(order)}
    (folder / "blind-key.json").write_text(json.dumps(mapping, indent=2) + "\n")
    crops = {"Faces": (110, 115, 340, 370), "Hair and fabric": (70, 240, 310, 510), "Hands and objects": (80, 160, 280, 320)}
    panels = []
    for letter, path in zip(mapping, order):
        image = Image.open(path).convert("RGB")
        anonymous = f"blind-{letter}.png"
        image.save(folder / anonymous)
        crop_html = []
        for index, (name, box) in enumerate(crops.items()):
            crop_path = f"blind-{letter}-crop{index}.png"
            image.crop(tuple(v * 4 for v in box)).save(folder / crop_path)
            crop_html.append(f'<details><summary>{html.escape(name)} · 100%</summary><div class="crop"><img src="{crop_path}" alt="{letter}: {html.escape(name)}"></div></details>')
        panels.append(f'<article><h2>{letter}</h2><div class="photo"><img src="{anonymous}" alt="Result {letter}"></div>{"".join(crop_html)}<label>Notes <textarea data-letter="{letter}"></textarea></label></article>')
    if source:
        Image.open(source).save(folder / "original.png")
    document = '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Фото 4× — слепое сравнение</title><style>
body{font:16px system-ui;background:#f4f5f7;color:#222;margin:24px}header{max-width:1000px}button{padding:10px 16px;margin:6px;border:1px solid #bbb;border-radius:8px;background:white;cursor:pointer}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}article{background:white;padding:16px;border-radius:14px;min-width:0}.photo,.crop{overflow:auto;max-height:80vh}.photo img{width:100%;height:auto}.actual .photo img{width:auto;max-width:none}.crop img{max-width:none}textarea{box-sizing:border-box;width:100%;min-height:80px}details{margin:12px 0}pre{white-space:pre-wrap}
</style><header><h1>Фото 4× — слепое сравнение</h1><p>Все результаты без улучшения лиц. Сравните естественность, детали, волосы, ткань, руки, ореолы и швы. Более резкий результат не обязательно лучше.</p>
<button id="fit">По размеру экрана</button><button id="actual">100%</button><button id="export">Скачать оценки</button><button id="reveal">Показать модели</button><pre id="key" hidden></pre></header><main>''' + "".join(panels) + '''</main><script>
document.querySelector('#fit').onclick=()=>document.body.classList.remove('actual');document.querySelector('#actual').onclick=()=>document.body.classList.add('actual');
for(const field of document.querySelectorAll('textarea')){try{field.value=localStorage.getItem('photo4x-review-'+field.dataset.letter)||''}catch{}field.oninput=()=>{try{localStorage.setItem('photo4x-review-'+field.dataset.letter,field.value)}catch{}}}
document.querySelector('#export').onclick=()=>{const data=Object.fromEntries([...document.querySelectorAll('textarea')].map(f=>[f.dataset.letter,f.value]));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='photo4x-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
document.querySelector('#reveal').onclick=async()=>{const el=document.querySelector('#key');el.textContent=JSON.stringify(await(await fetch('blind-key.json')).json(),null,2);el.hidden=false};
</script></html>'''
    (folder / "index.html").write_text(document)


def reference_comparison(folder, files, labels):
    """Compare user-supplied service output locally, without contacting it."""
    if len(files) != len(labels) or not files:
        raise ValueError("Provide one label per comparison image")
    folder.mkdir(parents=True, exist_ok=True)
    panels, provenance = [], []
    dimensions = None
    for index, (path, label) in enumerate(zip(files, labels)):
        image = Image.open(path).convert("RGB")
        if dimensions is not None and dimensions != image.size:
            raise ValueError("Comparison images must have identical dimensions")
        dimensions = image.size
        name = f"result-{index}.png"
        image.save(folder / name)
        provenance.append({"label": label, "source": str(path.resolve()),
                           "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "size": image.size})
        panels.append(f'<article><h2>{html.escape(label)}</h2><div class="photo"><img src="{name}" alt="{html.escape(label)}"></div></article>')
    crops = {"Лицо справа": (990, 530, 1290, 900), "Лицо слева": (520, 1140, 840, 1460),
             "Волосы и ткань": (850, 440, 1160, 750), "Руки": (360, 720, 680, 1040)}
    sections = []
    for crop_index, (title, box) in enumerate(crops.items()):
        cells = []
        for index, (path, label) in enumerate(zip(files, labels)):
            name = f"crop-{crop_index}-{index}.png"
            Image.open(path).convert("RGB").crop(box).save(folder / name)
            cells.append(f'<article><h3>{html.escape(label)}</h3><img src="{name}" alt="{html.escape(label)}"></article>')
        sections.append(f'<h2>{title} · 100%</h2><div class="crops">{"".join(cells)}</div>')
    (folder / "sources.json").write_text(json.dumps({"images": provenance,
        "externalReference": "User-supplied Crisp output without separate face enhancement, as confirmed by the user. Public JS inspected; historical browser/backend not recorded. Compared locally; no upload."}, ensure_ascii=False, indent=2) + "\n")
    (folder / "index.html").write_text('''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nomos и Crisp — локальное сравнение</title><style>body{font:16px system-ui;margin:24px;background:#f4f5f7;color:#222}main,.crops{display:flex;gap:16px;overflow:auto}article{background:white;padding:16px;border-radius:12px;min-width:0}main article{flex:1;min-width:280px}.photo{overflow:auto;max-height:80vh}.photo img{width:100%;height:auto}.actual .photo img{width:auto;max-width:none}.crops article{flex-shrink:0}.crops img{max-width:none}h2,h3{font-size:18px}button{padding:10px;margin:8px}p{max-width:1000px}</style>
<h1>Nomos и Crisp</h1><p>Crisp — файл, предоставленный пользователем без отдельного улучшения лиц. Публичный JS сервиса проверен: UltraSharpV2 Lite FP32, RGB 0–1, тайл 256 с суммарным перекрытием 16 и обрезкой стыков, PNG. Браузер и backend выполненного пользователем сеанса не записаны. Сравнивайте прежде всего с Nomos без GFPGAN. Все файлы обрабатываются здесь локально.</p>
<p>Проверьте черты лиц, зубы, текстуру кожи, волосы, ткань и ореолы. GFPGAN может менять черты лица. Ни один результат не является эталоном утраченных деталей.</p>
<button onclick="document.body.classList.remove('actual')">По размеру экрана</button><button onclick="document.body.classList.add('actual')">100%</button><main>''' + "".join(panels) + '</main>' + "".join(sections) + '</html>')


def corpus_review(folder):
    folder.mkdir(parents=True, exist_ok=True)
    panels = []
    for name in ["restore_original", "denoise_orig", "lol_dark_2", "sky_original", "face_preview_blured_2", "japan_blured"]:
        case = folder.parent / f"corpus-{name}"
        files = [case / "current-256-fp32-o16.png", case / "nomos-realplksr-256-fp16-o32.png"]
        if not all(path.exists() for path in files):
            raise ValueError(f"Missing photographic corpus result: {name}")
        cells = ''.join(f'<article><h3>{label}</h3><div class="photo"><img src="../{case.name}/{path.name}" alt="{label}"></div></article>'
                        for path, label in zip(files, ['Current SRVGG', 'Nomos RealPLKSR FP16 · overlap 32']))
        panels.append(f'<section><h2>{name}</h2><img src="../../inputs/corpus-{name}.png" alt="Input"><div class="pair">{cells}</div></section>')
    (folder / "index.html").write_text('''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Фото 4× — шесть фотографий</title>
<style>body{font:16px system-ui;margin:24px;background:#f4f5f7;color:#222}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}article{min-width:0;background:white;padding:16px;border-radius:12px}.photo{overflow:auto}.photo img{width:100%;height:auto}.actual .photo img{width:auto;max-width:none}button{padding:10px;margin:8px}section>img{max-width:256px}</style>
<h1>Шесть фотографий · без GFPGAN</h1><p>Проверьте естественность, шум, контуры, текст, волосы и швы. Эталон высокого разрешения отсутствует; резкость сама по себе не доказывает восстановление деталей.</p>
<button onclick="document.body.classList.remove('actual')">По размеру экрана</button><button onclick="document.body.classList.add('actual')">100%</button>''' + ''.join(panels) + '</html>')


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--review", type=Path)
    p.add_argument("--source", type=Path)
    p.add_argument("--images", nargs="*", type=Path)
    p.add_argument("--comparison", type=Path)
    p.add_argument("--corpus", type=Path)
    p.add_argument("--labels", nargs="*")
    p.add_argument("--reference", type=Path)
    p.add_argument("--tiled", type=Path)
    p.add_argument("--overlap", type=int, default=32)
    p.add_argument("--tile-size", type=int, default=256)
    args = p.parse_args()
    if args.reference:
        report = seam_report(args.reference, args.tiled, args.overlap, args.tile_size)
        target = args.tiled.with_name(f"{args.tiled.stem}-seams.json")
        target.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
    if args.review:
        args.review.mkdir(parents=True, exist_ok=True)
        blind_review(args.review, args.images, args.source)
    if args.comparison:
        reference_comparison(args.comparison, args.images, args.labels)
    if args.corpus:
        corpus_review(args.corpus)


if __name__ == "__main__":
    main()
