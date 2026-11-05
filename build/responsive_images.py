"""Responsive delivery markup for controlled, generated site HTML."""
import json
from pathlib import Path
import re
MANIFEST=json.loads((Path(__file__).with_name('responsive-images.json')).read_text())
HERO_SIZES='(max-width:692px) 104vw, (max-width:980px) 720px, (max-width:1505px) 89vw, 1340px'
WIDE_SIZES='(max-width:980px) calc(100vw - 44px), 1040px'

def delivery(src):
    choices=MANIFEST[src]['variants']
    fallback=min(choices,key=lambda c:abs(c['width']-960))['src']
    return fallback, ', '.join(f'{v["src"]} {v["width"]}w' for v in choices)

def responsive_markup(html):
    def image(match):
        tag=match[0]
        source=re.search(r'(?<![\w-])src="([^"]+)"',tag)
        if not source or source[1] not in MANIFEST or 'srcset=' in tag: return tag
        src=source[1]
        width=re.search(r'(?<![\w-])width="(\d+)"',tag)
        sizes=('(max-width:640px) calc(100vw - 44px), (max-width:1044px) calc((100vw - 76px) / 3), 323px' if '/tool_modes/' in src else
               f'{width[1]}px' if width and int(width[1])<=150 else
               HERO_SIZES if '/hero_' in src or src.endswith('/iphone_frame.png') else
               '(max-width:760px) calc(100vw - 44px), 760px' if 'guide-media' in html[:match.start()].split('<figure')[-1] else WIDE_SIZES)
        fallback,srcset=delivery(src)
        return tag[:source.start()]+f'src="{fallback}" srcset="{srcset}" sizes="{sizes}"'+tag[source.end():]
    html=re.sub(r'<img\b[^>]*>',image,html)
    def tab(match):
        tag=match[0]
        sizes=HERO_SIZES if 'cmp-tab dot' in tag else WIDE_SIZES
        for side in ('before','after'):
            source=re.search(f'data-{side}="([^"]+)"',tag)
            if source and source[1] in MANIFEST:
                fallback,srcset=delivery(source[1])
                tag=tag[:source.start()]+f'data-{side}="{fallback}" data-{side}-srcset="{srcset}" data-{side}-sizes="{sizes}"'+tag[source.end():]
        return tag
    return re.sub(r'<button\b[^>]*\bclass="cmp-tab[^>]*>',tab,html)
