#!/usr/bin/env python3
"""Private blind review with synchronized 100% views and paired HR references."""
import argparse
import hashlib
import html
import json
import random
import shutil
from pathlib import Path

import numpy as np
from PIL import Image


WORK = Path(".web-model-work/photo4x")
FILES = {"current": "current-256-fp32-o16.png", "nomos-esrgan": "nomos-esrgan-256-fp16-o32.png",
         "nomos-realplksr": "nomos-realplksr-256-fp16-o32.png"}
LABELS = {"current": "Текущая SRVGG FP32 · overlap 16", "nomos-esrgan": "Nomos ESRGAN FP16 · overlap 32",
          "nomos-realplksr": "Nomos RealPLKSR FP16 · overlap 32 · GPU-only"}
# Photo 2x: same references, 2x inputs (prepare_photo2x_corpus.py); separate ratings and blind order.
FILES_2X = {"current": "current-256-fp32-o16.png", "nomos-realplksr-2x": "nomos-realplksr-2x-256-fp16-o32.png",
            "public2x-realplksr": "public2x-realplksr-256-fp16-o32.png",
            "safmn2x-purescale": "safmn2x-purescale-256-fp16-o32.png"}
LABELS_2X = {"current": "Текущая SRVGG 2× FP32 · overlap 16",
             "nomos-realplksr-2x": "Nomos RealPLKSR 4× FP16 · хвост свёрнут в 2× (box 2×2) · overlap 32",
             "public2x-realplksr": "2xPublic RealPLKSR DySample FP16 · overlap 32 · GridSample на CPU",
             "safmn2x-purescale": "2x SAFMN PureScale FP16 · overlap 32 · CC BY-NC-SA, только локально"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scale", type=int, choices=[2, 4], default=4)
    scale = parser.parse_args().scale
    files, labels = (FILES_2X, LABELS_2X) if scale == 2 else (FILES, LABELS)
    suffix = "-2x" if scale == 2 else ""
    out = WORK / f"results/review-web{suffix}"
    out.mkdir(parents=True, exist_ok=True)
    corpus = json.loads((WORK / f"web-corpus/manifest{suffix}.json").read_text())
    cases = json.loads((WORK / f"quality-cases{suffix}.json").read_text())
    sources = {photo["id"]: photo for photo in corpus["images"]}
    public, key, measured, pending = [], {}, [], []
    for case in cases:
        case_id = case["id"]
        folder = WORK / "results" / (f"2x-{case_id}" if scale == 2 else case_id)
        if not all((folder / filename).exists() for filename in files.values()):
            pending.append(case_id)
            continue
        input_path = WORK / "inputs" / case["input"]
        input_image = Image.open(input_path).convert("RGB")
        width, height = (value * scale for value in input_image.size)
        thumb = input_image.copy()
        thumb.thumbnail((200, 150))
        thumb.save(out / f"{case_id}-input.png")
        item = {"id": case_id, "track": case["track"], "input": f"{case_id}-input.png", "inputSize": input_image.size,
                "size": [width, height], "title": case.get("label"), "variants": []}
        reference = None
        if case.get("photo"):
            source = sources[case["photo"]]
            item["title"] = source["label"]
            item["credit"] = {k: source.get(k) for k in ["author", "credit", "sourcePage", "license", "licenseUrl"]}
            ref_file = WORK / "web-corpus" / case["reference"]
            shutil.copyfile(ref_file, out / f"{case_id}-reference.png")
            item["reference"] = f"{case_id}-reference.png"
            reference = np.asarray(Image.open(ref_file).convert("RGB"))
        # New stable mapping per image, unrelated to the original A/B/C page.
        order = list(files)
        random.Random(("photo2x-diverse-v1:" if scale == 2 else "photo4x-diverse-v1:") + case_id).shuffle(order)
        key[case_id] = {}
        for index, model in enumerate(order):
            letter = chr(65 + index)
            original = folder / files[model]
            anonymous = f"{case_id}-{letter}.png"
            shutil.copyfile(original, out / anonymous)
            key[case_id][letter] = labels[model]
            item["variants"].append({"letter": letter, "image": anonymous})
            record = {"case": case_id, "model": model, "letter": letter, "sha256": sha(original), "bytes": original.stat().st_size}
            if reference is not None:
                actual = np.asarray(Image.open(original).convert("RGB"))
                if actual.shape != reference.shape:
                    raise ValueError(f"Wrong output dimensions for {case_id}/{model}")
                diff = actual.astype(np.float64) - reference.astype(np.float64)
                mse = float(np.mean(diff * diff))
                record.update({"rgbPsnr": float(10 * np.log10(255 ** 2 / mse)) if mse else None,
                               "rgbMae": float(np.mean(np.abs(diff))), "meaning": "Paired degradation fidelity; not a perceptual quality ranking"})
            measured.append(record)
        # External results are 4x outputs; they do not apply to the 2x review.
        if case_id == "real-parrot" and scale == 4:
            external = WORK / "results/external-references/parrot-result.png"
            if not external.exists():
                external = WORK / "inputs/user-parrot-native.png"
            if external.exists():
                if Image.open(external).size != (width, height):
                    raise ValueError("Parrot external result has different dimensions")
                shutil.copyfile(external, out / "external-parrot.png")
                item["external"] = {"image": "external-parrot.png", "label": "Присланный результат WebP · сервис не подтверждён"}
        if case_id == "real-girls" and scale == 4:
            external = WORK / "results/external-references/crisp-result.png"
            if not external.exists():
                external = WORK / "results/crisp-comparison/crisp.png"
            if external.exists():
                shutil.copyfile(external, out / "external-girls.png")
                item["external"] = {"image": "external-girls.png", "label": "Crisp · результат пользователя без улучшения лиц"}
        public.append(item)
    data = {"cases": public, "pending": pending, "protocol": corpus["protocol"]}
    (out / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    (out / "blind-key.json").write_text(json.dumps(key, ensure_ascii=False, indent=2) + "\n")
    (out / "paired-metrics.json").write_text(json.dumps(measured, indent=2) + "\n")
    page = HTML if scale == 4 else (HTML.replace("Фото 4×", "Фото 2×").replace("уменьшение 4×", "уменьшение 2×")
        .replace("photo4x-diverse-v1", "photo2x-diverse-v1").replace("photo4x-diverse-review", "photo2x-diverse-review")
        .replace("Все A/B/C", "Все варианты").replace("<option>C</option>", "".join(f"<option>{chr(65 + i)}</option>" for i in range(2, len(files)))))
    (out / "index.html").write_text(page)
    print(f"Review ready: {len(public)} cases; pending {len(pending)}")


HTML = '''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Фото 4× — разнообразный корпус</title>
<style>body{font:15px system-ui;margin:0;color:#192332;background:#f2f4f7}header{padding:22px 28px;background:white;border-bottom:1px solid #d8dee7}h1{font-size:26px;margin:0 0 10px}p{line-height:1.5;max-width:1100px}button,select{font:inherit;background:white;color:inherit;padding:9px 12px;border:1px solid #bac6d6;border-radius:7px;cursor:pointer;margin:3px}button.selected{background:#153f6b;color:white}#layout{display:grid;grid-template-columns:230px minmax(0,1fr)}aside{padding:14px;max-height:calc(100vh - 220px);overflow:auto}aside button{display:block;text-align:left;width:100%;margin:7px 0}aside img{width:44px;height:44px;object-fit:cover;vertical-align:middle;margin-right:7px}main{padding:18px;min-width:0}h2{font-size:22px;margin:0 0 8px}.controls{margin-bottom:12px}.panels{display:flex;gap:12px;overflow:auto;align-items:flex-start}.panel{flex:1;min-width:290px;background:white;border-radius:10px;padding:10px}.panel h3{font-size:16px;line-height:20px;height:60px;overflow:auto;margin:0 0 7px}.viewport{overflow:auto;height:66vh;background:#e0e5ec}.viewport img{display:block;width:100%;height:auto;max-width:none}.actual .viewport img{width:auto}#credit{font-size:13px;color:#465367}textarea{width:min(800px,95%);height:70px;font:inherit;border:1px solid #bac6d6;border-radius:7px;padding:8px}#notice{color:#6a3e0b}a{color:#1758a1}@media(max-width:700px){#layout{display:block}aside{display:flex;gap:8px;max-height:180px}aside button{min-width:190px}header{padding:16px}main{padding:12px}}</style>
<header><h1>Фото 4×: новые фотографии и ваши исходники</h1><p>Все A/B/C без GFPGAN. Буквы перемешаны отдельно для каждого снимка. Смотрите на естественность, реальные детали, шум, ореолы, текст и швы. У контрольных примеров рядом доступен качественный исходник; у пользовательских фотографий эталона нет.</p>
<select id="filter"><option value="all">Все примеры</option><option value="real">Ваши исходники · без искусственного ухудшения</option><option value="clean">Чистое уменьшение 4×</option><option value="mild">Лёгкое размытие и JPEG85</option></select><button id="export">Скачать оценки</button><span id="notice"></span></header>
<div id="layout"><aside id="cases"></aside><main><h2 id="title"></h2><div id="credit"></div><div class="controls"><button id="fit">Вписать</button><button id="actual">100% · синхронная прокрутка</button><button id="detail">Ключевой фрагмент · 100%</button><button id="reference">Показать исходник / внешний результат</button><button id="reveal">Раскрыть модели</button></div><div id="panels" class="panels"></div><p>Предпочтение: <select id="choice"><option value="">Не выбрано</option><option>A</option><option>B</option><option>C</option><option value="tie">Примерно одинаково</option><option value="none">Ни один</option></select></p><textarea id="notes" placeholder="Где лучше фактура, а где изменены черты, буквы или появились лишние детали"></textarea><p><small>Контролируемая подготовка: качественный исходник нормализован в sRGB, размер до 2048 по длинной стороне; bicubic уменьшение 4×. В дополнительном треке: Gaussian σ0,45 пикселя и JPEG85. Это не полная имитация камерного размытия. Источники и лицензии указаны для каждого снимка.</small></p></main></div>
<script>
const $=s=>document.querySelector(s);let data,current,keys={},showReference=false,revealed=false;let ratings={};try{ratings=JSON.parse(localStorage.getItem('photo4x-diverse-v1')||'{}')}catch{}
const centers={'real-parrot':[.43,.30],'real-eiffel':[.58,.35],'real-girls':[.36,.46],'portrait-hair':[.47,.30],'portrait-cloth':[.48,.43],'portrait-beard':[.5,.43],'cat':[.5,.40],'bird':[.41,.39],'market':[.66,.36],'forest':[.48,.50],'landscape':[.5,.4],'night-signs':[.35,.27],'night-stone':[.43,.45],'phone-cafe':[.55,.53],'architecture':[.5,.34]};
function credit(){const el=$('#credit');el.replaceChildren();const c=current.credit;if(c){el.append(document.createTextNode(c.author+(c.credit&&c.credit!=='Own work'&&c.credit!==c.author?' · '+c.credit:'')+' · '));for(const [text,url] of [['Источник',c.sourcePage],[c.license,c.licenseUrl||c.sourcePage]]){const a=document.createElement('a');a.textContent=text;a.href=url;a.target='_blank';a.rel='noopener';el.append(a,document.createTextNode(' · '))}el.append(document.createTextNode('Изменения: размер, указанная деградация и апскейл; производные изображения — по лицензии источника.'))}else el.textContent='Локальный файл пользователя. Эталон высокого разрешения отсутствует; внешний результат не является эталоном.'}
function save(){ratings[current.id]={choice:$('#choice').value,notes:$('#notes').value};try{localStorage.setItem('photo4x-diverse-v1',JSON.stringify(ratings))}catch{}}
function list(){const filter=$('#filter').value;$('#cases').replaceChildren();for(const c of data.cases.filter(c=>filter==='all'||c.track===filter)){const b=document.createElement('button');b.classList.toggle('selected',c.id===current?.id);const img=new Image();img.src=c.input;img.alt='';b.append(img,document.createTextNode(c.title+(c.track==='mild'?' · JPEG/blur':'')));b.onclick=()=>choose(c);$('#cases').append(b)}}
function panel(label,file){const a=document.createElement('article');a.className='panel';const h=document.createElement('h3');h.textContent=label;h.title=label;const v=document.createElement('div');v.className='viewport';const img=new Image();img.src=file;img.alt=label;v.append(img);a.append(h,v);v.onscroll=()=>{for(const o of document.querySelectorAll('.viewport'))if(o!==v&&(o.scrollTop!==v.scrollTop||o.scrollLeft!==v.scrollLeft)){o.scrollTop=v.scrollTop;o.scrollLeft=v.scrollLeft}};return a}
function render(){const el=$('#panels');el.replaceChildren();for(const v of current.variants)el.append(panel(v.letter+(revealed?' · '+keys[current.id][v.letter]:''),v.image));if(showReference&&current.reference)el.append(panel('Качественный исходник · известный контроль',current.reference));if(showReference&&current.external)el.append(panel('Внешний результат: '+current.external.label,current.external.image));$('#reference').disabled=!current.reference&&!current.external}
function choose(c){current=c;$('#title').textContent=c.title+' · '+c.inputSize.join('×')+' → '+c.size.join('×')+(c.track==='mild'?' · лёгкое размытие/JPEG85':c.track==='clean'?' · чистое уменьшение':'');$('#choice').value=ratings[c.id]?.choice||'';$('#notes').value=ratings[c.id]?.notes||'';credit();list();render()}
$('#filter').onchange=()=>{const c=data.cases.find(c=>$('#filter').value==='all'||c.track===$('#filter').value);if(c)choose(c)};$('#fit').onclick=()=>document.body.classList.remove('actual');$('#actual').onclick=()=>document.body.classList.add('actual');$('#detail').onclick=()=>{document.body.classList.add('actual');const name=current.id.replace(/^web-/,'').replace(/-(clean|mild)$/,'');const center=centers[name]||[.5,.5];requestAnimationFrame(()=>{for(const v of document.querySelectorAll('.viewport')){v.scrollLeft=current.size[0]*center[0]-v.clientWidth/2;v.scrollTop=current.size[1]*center[1]-v.clientHeight/2}})};$('#reference').onclick=()=>{showReference=!showReference;render()};$('#reveal').onclick=async()=>{if(!revealed){keys=await(await fetch('blind-key.json')).json();revealed=true;render()}};$('#choice').onchange=save;$('#notes').oninput=save;$('#export').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({protocol:data.protocol,ratings},null,2)],{type:'application/json'}));a.download='photo4x-diverse-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
fetch('data.json').then(r=>r.json()).then(d=>{data=d;$('#notice').textContent=d.pending.length?'Ещё обрабатываются: '+d.pending.length:'';if(d.cases.length)choose(d.cases[0])});
</script></html>'''


if __name__ == "__main__":
    main()
