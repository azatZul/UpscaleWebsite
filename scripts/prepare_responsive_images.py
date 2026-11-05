#!/usr/bin/env python3
"""Generate checked-in WebP delivery variants; originals remain untouched.
Run with tools/album/.venv/bin/python scripts/prepare_responsive_images.py.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image, ImageOps
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'resources/responsive'
OUT.mkdir(exist_ok=True)
manifest={}
paths=sorted((ROOT/'resources/before_after').glob('*'))+sorted((ROOT/'resources/compare').glob('*'))+sorted((ROOT/'resources/tool_modes').glob('*'))+[ROOT/'resources/iphone_frame.png']
for path in paths:
    if path.suffix.lower() not in ('.jpg','.jpeg','.png'): continue
    with Image.open(path) as opened:
        image=ImageOps.exif_transpose(opened)
        if image.mode not in ('RGB','RGBA'): image=image.convert('RGBA' if 'transparency' in image.info else 'RGB')
        width,height=image.size
        key='/'+str(path.relative_to(ROOT))
        digest=hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        widths=sorted({min(width,limit) for limit in (480,960,1440,1920)})
        variants=[]
        for w in widths:
            h=max(1,round(height*w/width))
            name=f'{path.stem}-{digest}-{w}.webp'
            target=OUT/name
            image.resize((w,h),Image.Resampling.LANCZOS).save(target,'WEBP',quality=90,method=6)
            if target.stat().st_size >= path.stat().st_size:
                target.unlink()
                if not any(v['src']==key for v in variants):
                    variants.append({'src':key,'width':width,'height':height,'bytes':path.stat().st_size})
            else:
                variants.append({'src':'/resources/responsive/'+name,'width':w,'height':h,'bytes':target.stat().st_size})
        manifest[key]={'width':width,'height':height,'original_bytes':path.stat().st_size,'variants':sorted(variants,key=lambda v:v['width'])}
(ROOT/'build/responsive-images.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(f'{len(manifest)} originals, {sum(len(v["variants"]) for v in manifest.values())} WebP variants; no upscaling')
