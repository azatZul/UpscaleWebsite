import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FACE_PIXEL_POLICY as P} from '../src/tool/face-quality.js';
const root=resolve(process.argv[2] || '.web-model-work/face-quality-canvas');
const report=JSON.parse(await readFile(resolve(root,'report.json')));
const cases=JSON.parse(await readFile(resolve(root,'cases.json')));
const payload=JSON.stringify({report,cases,policy:P}).replaceAll('<','\\u003c');
await writeFile(resolve(root,'index.html'),`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Проверка переноса face-гейта</title>
<style>body{font:16px/1.5 system-ui;margin:32px auto;padding:0 20px;max-width:1100px;background:#11151a;color:#edf1f5}h1{font-size:28px}select{font:inherit;padding:8px;background:#222b35;color:inherit;border:1px solid #738091;border-radius:6px;margin:8px 12px 12px 0;max-width:100%}.notice{padding:16px;background:#30291a;border-left:4px solid #e5b860}.pair{display:flex;gap:18px;flex-wrap:wrap}figure{margin:0;flex:1;min-width:260px}canvas,img{width:100%;max-width:512px;image-rendering:auto;background:#000}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:8px;border-bottom:1px solid #425062}small{color:#b0bdcb}.status{font-weight:700;color:#e5b860}</style>
<h1>Проверка переноса face-гейта</h1><p class="notice">Интеграция остановлена на проверке Canvas. Это сравнение фиксированных пар и способов ресемплинга, а не проверка качества GFPGAN или текущего автовыбора сайта. Фотографии доступны только локально.</p>
<p id="summary"></p><label>Браузер <select id="browser"></select></label><label>Случай <select id="sample"></select></label><p id="status" class="status"></p>
<div class="pair"><figure><canvas id="before" width="512" height="512"></canvas><figcaption>Исходник: Canvas 512 (перерисовка текущего браузера)</figcaption></figure><figure><img id="after" alt="Фиксированный результат face-модели"><figcaption>Результат GFPGAN из лаборатории</figcaption></figure></div>
<p><small>Числа ниже сохранены при тестовом прогоне выбранного движка. Перерисовка слева при открытии отчёта другим браузером может отличаться.</small></p><table><thead><tr><th>Метрика</th><th>Core Image</th><th>Браузер</th><th>Порог</th></tr></thead><tbody id="metrics"></tbody></table><p id="decision"></p>
<script>const DATA=${payload};const $=id=>document.getElementById(id);const fmt=x=>Number(x).toFixed(5);let revision=0;
$('summary').textContent=DATA.report.summary.independentPhotos+' фотографий, '+DATA.report.summary.faces+' лиц, '+DATA.report.summary.casesPerBrowser+' случаев на движок. Пограничных расхождений: '+DATA.report.summary.borderlineDisagreements+'. Устойчивые pass: '+DATA.report.summary.stablePass.map(x=>x.browser+' '+x.count).join(', ')+'.';
for(const b of DATA.report.reports){const o=document.createElement('option');o.value=b.browser;o.textContent=b.browser+' '+b.version;$('browser').append(o)}
for(let i=0;i<DATA.cases.length;i++){const c=DATA.cases[i],o=document.createElement('option');o.value=i;o.textContent=c.id+' · кроп '+Math.round(c.targetCrop)+(c.original?' · исходный масштаб':c.upscaled?' · увеличен':' · уменьшен');$('sample').append(o)}
async function render(){const rev=++revision,index=Number($('sample').value),c=DATA.cases[index],r=DATA.report.reports.find(b=>b.browser===$('browser').value).rows[index];
$('status').textContent=(r.stable?'Устойчивый случай':'Переносимость решения не подтверждена')+' · '+(r.referenceDecision===r.actualDecision?'решения совпали':'решения различаются');
$('decision').textContent='Core Image: '+r.referenceDecision+'; браузер: '+r.actualDecision;
const rows=[['Сигнал 512',r.reference.canonical.sourceSignal,r.actual.canonical.sourceSignal,DATA.policy.sourceSignal],['Retention 512',r.reference.canonical.retention,r.actual.canonical.retention,DATA.policy.retention],['SSIM',r.reference.structure,r.actual.structure,DATA.policy.structure],['Сигнал 1024',r.reference.native.sourceSignal,r.actual.native.sourceSignal,DATA.policy.nativeSignal],['Retention 1024',r.reference.native.retention,r.actual.native.retention,DATA.policy.nativeRetention]];
$('metrics').replaceChildren(...rows.map(a=>{const tr=document.createElement('tr');for(const v of a){const td=document.createElement('td');td.textContent=typeof v==='number'?fmt(v):v;tr.append(td)}return tr}));
$('after').src=c.after;const image=new Image;image.src=c.source;await image.decode();if(rev!==revision)return;const ctx=$('before').getContext('2d');ctx.resetTransform();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality=DATA.report.summary.smoothing||'low';ctx.fillStyle='#000';ctx.fillRect(0,0,512,512);ctx.setTransform(...c.transform);ctx.drawImage(image,0,0);ctx.resetTransform();}
$('browser').onchange=$('sample').onchange=()=>render().catch(console.error);render().catch(console.error);</script></html>`);
console.log(resolve(root,'index.html'));
