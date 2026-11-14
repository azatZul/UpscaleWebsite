// Uses the private output of prepare_face_quality_canvas.swift; serves it only
// on loopback. No images or private source paths are written to the public report.
// Usage: node scripts/check_face_quality_canvas.mjs [data] [report.json] [--smoothing=low|medium|high] [--summarize]
import {readFile, writeFile, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {measureFaceQuality, decideFaceQuality, resizeFaceLuma2x, FACE_PIXEL_POLICY} from '../src/tool/face-quality.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const dataRoot = resolve(args[0] || resolve(repo, '.web-model-work/face-quality-canvas'));
const output = resolve(args[1] || resolve(dataRoot, 'report.json'));
const summarizeOnly = process.argv.includes('--summarize');
const smoothing = flag('smoothing') || 'low';
if (!['low', 'medium', 'high'].includes(smoothing)) throw Error(`Unknown --smoothing=${smoothing}`);
const cases = JSON.parse(await readFile(resolve(dataRoot, 'cases.json')));
const label = decision => `${decision.status}:${decision.reason}`;
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');

async function measureInBrowsers() {
  const moduleRoot = resolve(repo, 'src/tool');
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Private face quality validation</title>'); return; }
      const [base, rest] = path.startsWith('/data/') ? [dataRoot, path.slice(6)] : path.startsWith('/src/tool/') ? [moduleRoot, path.slice(10)] : [];
      const file = base && resolve(base, rest);
      if (!file?.startsWith(base + sep) || !(await stat(file)).isFile()) throw Error('Invalid file');
      res.setHeader('Content-Type', {'.js': 'text/javascript', '.png': 'image/png'}[extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store'); res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  const playwright = await import(process.env.USCALE_PLAYWRIGHT_MODULE || 'playwright');
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const reports = [];
  try {
    for (const name of ['chromium', 'webkit']) {
      const browser = await playwright[name].launch({headless: true,
        ...(name === 'chromium' && process.env.USCALE_CHROMIUM_EXECUTABLE ? {executablePath: process.env.USCALE_CHROMIUM_EXECUTABLE} : {})});
      try {
        const page = await browser.newPage(); await page.goto(origin);
        const rows = [];
        for (let index = 0; index < cases.length; index++) {
          const c = cases[index];
          const read = async key => { const b = await readFile(resolve(dataRoot, c[key])); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
          const [before, after, native] = await Promise.all(['referenceBefore', 'referenceAfter', 'referenceNative'].map(read));
          const canonical = measureFaceQuality(before, after, 512, 512), n = measureFaceQuality(native, resizeFaceLuma2x(after), 1024, 1024, false);
          const reference = {canonical: canonical.detail, structure: canonical.structure, native: n.detail, cropPixels: c.targetCrop, interEyePixels: c.interEyePixels, landmarkShift: null};
          const actual = await page.evaluate(async ({c, smoothing}) => {
            const q = await import('/src/tool/face-quality.js');
            const bitmap = await createImageBitmap(await (await fetch('/data/' + c.source)).blob(), {premultiplyAlpha: 'none'});
            const result = await createImageBitmap(await (await fetch('/data/' + c.after)).blob(), {premultiplyAlpha: 'none'});
            const canvas = new OffscreenCanvas(512, 512), ctx = canvas.getContext('2d', {willReadFrequently: true});
            ctx.drawImage(result, 0, 0); const after = q.faceLuma(ctx.getImageData(0, 0, 512, 512).data);
            const render = side => {
              // Resizing resets all context state, so smoothing is set afterwards.
              canvas.width = canvas.height = side;
              ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = smoothing;
              ctx.fillStyle = '#000'; ctx.fillRect(0, 0, side, side);
              ctx.setTransform(...c.transform.map(v => v * side / 512)); ctx.drawImage(bitmap, 0, 0); ctx.resetTransform();
              return q.faceLuma(ctx.getImageData(0, 0, side, side).data);
            };
            const before = render(512), canonical = q.measureFaceQuality(before, after, 512, 512);
            const native = q.measureFaceQuality(render(1024), q.resizeFaceLuma2x(after), 1024, 1024, false);
            bitmap.close(); result.close(); canvas.width = canvas.height = 1;
            return {canonical: canonical.detail, structure: canonical.structure, native: native.detail, cropPixels: c.targetCrop, interEyePixels: c.interEyePixels, landmarkShift: null};
          }, {c, smoothing});
          rows.push({id: c.id, targetCrop: c.targetCrop, upscaled: c.upscaled, original: c.original, reference, actual,
            referenceDecision: label(decideFaceQuality(reference)), actualDecision: label(decideFaceQuality(actual))});
          if ((index + 1) % 25 === 0) console.log(`${name}: ${index + 1}/${cases.length}`);
        }
        reports.push({browser: name, version: browser.version(), rows});
      } finally { await browser.close(); }
    }
  } finally { await new Promise(r => server.close(r)); }
  const provenance = {smoothing};
  for (const file of ['src/tool/face-quality.js', 'scripts/prepare_face_quality_canvas.swift', 'scripts/check_face_quality_canvas.mjs', 'tests/fixtures/face-quality/ios-reference/manifest.json'])
    provenance[file] = await sha256(resolve(repo, file));
  provenance.cases = await sha256(resolve(dataRoot, 'cases.json'));
  return {reports, provenance};
}

// --summarize keeps the provenance of the stored measurements.
const {reports, provenance} = summarizeOnly ? JSON.parse(await readFile(output)) : await measureInBrowsers();

const snapshot = JSON.parse(await readFile(resolve(repo, 'tests/fixtures/face-quality/ios-reference/manifest.json')));
const photoOf = id => snapshot.samples.find(s => s.id === id)?.sourceSha256 ?? id;
const P = FACE_PIXEL_POLICY;
const metrics = {
  sourceSignal: [e => e.canonical.sourceSignal, P.sourceSignal],
  retention: [e => e.canonical.retention, P.retention],
  structure: [e => e.structure, P.structure],
  nativeSignal: [e => e.native.sourceSignal, P.nativeSignal],
  nativeRetention: [e => e.native.retention, P.nativeRetention],
};
// The caller knows cropPixels, so error bounds are estimated per browser and per
// resampling regime instead of letting one outlier set a global interval.
const cropRange = crop => crop <= 512 ? 'upTo512' : crop <= 1024 ? 'upTo1024' : 'above1024';
// Do not let unused native measurements on crops <=512, or retention on
// signal-free skin, determine the error bound for an active detail-loss branch.
const eligible = (r, key) => (!key.startsWith('native') || r.targetCrop > 512) &&
  (key !== 'retention' || Math.max(r.reference.canonical.sourceSignal, r.actual.canonical.sourceSignal) > P.sourceSignal) &&
  (key !== 'nativeRetention' || Math.max(r.reference.native.sourceSignal, r.actual.native.sourceSignal) > P.nativeSignal);
const maximumError = rows => Object.fromEntries(Object.entries(metrics).map(([key, [get]]) =>
  [key, Math.max(0, ...rows.filter(r => eligible(r, key)).map(r => Math.abs(get(r.actual) - get(r.reference))))]));
const maximumErrors = Object.fromEntries(reports.map(b => [b.browser, Object.fromEntries(['upTo512', 'upTo1024', 'above1024']
  .map(range => [range, maximumError(b.rows.filter(r => cropRange(r.targetCrop) === range))]))]));

let stableDisagreements = 0, borderlineDisagreements = 0;
for (const b of reports) for (const r of b.rows) {
  // Leave one photo out: a row never widens its own interval, otherwise every
  // disagreement would be borderline by construction. Variants of the same
  // photo are dependent, so they are excluded together.
  const errors = maximumError(b.rows.filter(o => cropRange(o.targetCrop) === cropRange(r.targetCrop) && photoOf(o.id) !== photoOf(r.id)));
  r.errorBound = errors;
  r.margins = Object.fromEntries(Object.entries(metrics).map(([key, [get, threshold]]) => [key, get(r.reference) - threshold]));
  // A decision is stable only when every corner of the ±2×error box keeps the
  // same branch; thresholds are per-axis, so corners cover the whole box.
  r.stable = true;
  for (let bits = 0; bits < 1 << 5; bits++) {
    const v = Object.fromEntries(Object.entries(metrics).map(([key, [get]], i) => [key, get(r.reference) + (bits & 1 << i ? 1 : -1) * 2 * errors[key]]));
    const corner = {...r.reference, canonical: {sourceSignal: v.sourceSignal, retention: v.retention}, structure: v.structure,
      native: {sourceSignal: v.nativeSignal, retention: v.nativeRetention}};
    if (label(decideFaceQuality(corner)) !== r.referenceDecision) { r.stable = false; break; }
  }
  if (r.targetCrop > 512 && r.reference.native.sourceSignal + 2 * errors.nativeSignal > P.nativeSignal && Math.abs(r.margins.nativeRetention) < .02) r.stable = false;
  if (r.actualDecision !== r.referenceDecision) r.stable ? stableDisagreements++ : borderlineDisagreements++;
}

const count = predicate => reports.map(b => ({browser: b.browser, count: b.rows.filter(predicate).length}));
const summary = {casesPerBrowser: cases.length, faces: new Set(cases.map(c => c.id)).size,
  independentPhotos: new Set(cases.map(c => photoOf(c.id))).size,
  smoothing: provenance.smoothing ?? 'low', maximumErrors, stableDisagreements, borderlineDisagreements,
  stablePass: count(r => r.stable && r.actualDecision.startsWith('pass')),
  stableSkip: count(r => r.stable && r.actualDecision.startsWith('skip')),
  passed: stableDisagreements === 0 && reports.every(b => b.rows.some(r => r.stable && r.targetCrop > 512 && r.actualDecision.startsWith('pass')) &&
    b.rows.some(r => r.stable && r.actualDecision.startsWith('skip')))};
await writeFile(output, JSON.stringify({summary, provenance, reports}, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2)); if (!summary.passed) process.exitCode = 1;
