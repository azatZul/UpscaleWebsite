import assert from 'node:assert/strict';

async function checkWorkerPreflightAndTiming(page) {
  const result = {preflight: []};
  let mode = 'null';
  const instrument = async route => {
    const response = await route.fetch();
    const prefix = `let testBackend;addEventListener('message',e=>testBackend=e.data.execution?.backend);
      const testPost=globalThis.postMessage.bind(globalThis),testFetch=globalThis.fetch.bind(globalThis);
      globalThis.fetch=async(url,...args)=>{testPost({type:'asset-request',url:String(url),backend:testBackend});
        try{return await testFetch(url,...args)}catch(error){testPost({type:'asset-error',url:String(url),message:String(error)});throw error}};
      const testGpu=navigator.gpu,testAdapter=testGpu?.requestAdapter.bind(testGpu);
      ${mode === 'missing' ? "Object.defineProperty(navigator,'gpu',{value:undefined});" : `Object.defineProperty(navigator,'gpu',{value:new Proxy(testGpu,{get(target,key){
        if(key!=='requestAdapter')return Reflect.get(target,key,target);
        return async(...args)=>{testPost({type:'gpu-probe',backend:testBackend,caller:/ort[.-]|vision_bundle/.test(new Error().stack)?'library':'product'});
          ${mode === 'null' ? 'return null;' : mode === 'throw' ? "throw Error('Injected adapter failure');" : 'return testAdapter(...args);'}};}})});`}`;
    await route.fulfill({response, body: prefix + await response.text()});
  };
  const pattern = '**/{processor,face}.worker-*.js';
  await page.context().route(pattern, instrument);
  try {
    for (mode of ['missing', 'null', 'throw']) for (const group of ['photo', 'faces']) {
      const requests = [];
      const requested = request => requests.push(request.url());
      page.context().on('request', requested);
      let run;
      try { run = await page.evaluate(group => uscaleProductLab.verifyBackendImportRecovery(group), group); }
      finally { page.context().off('request', requested); }
      assert.equal(run.passed, true, JSON.stringify(run));
      assert.deepEqual(run.retries.map(r => [r.error.code, r.operation]), [['gpu', 'initialize']]);
      const gpuFetches = run.diagnostics.filter(d => d.type === 'asset-request' && d.backend === 'webgpu');
      assert.deepEqual(gpuFetches, []);
      assert.equal(requests.some(url => /ort\.webgpu|asyncify\.wasm|(?:normal|anime)_[24]x_web\.onnx/.test(url)), false);
      result.preflight.push({mode, group, ...run, passed: true});
    }
    mode = 'ok';
    result.workingAdapter = await page.evaluate(async () => {
      const diagnostics = [];
      const adapter = await navigator.gpu.requestAdapter();
      const adapterInfo = {vendor: adapter.info.vendor, architecture: adapter.info.architecture, isFallbackAdapter: adapter.info.isFallbackAdapter};
      const onProgress = data => { if (['gpu-probe', 'asset-request', 'asset-error'].includes(data.type)) diagnostics.push(data); };
      const original = await (await fetch('/benchmarks/ios/face/asset_face_preview_original.input.png')).blob();
      const file = new File([original], 'portrait.png', {type: 'image/png'});
      let faces;
      try { faces = await uscaleProductLab.runProductWorker({file}, {group: 'faces', backend: 'webgpu', onProgress}); }
      catch (error) { return {passed: false, code: error.code, message: error.message, diagnostics}; }
      const enhanced = faces.faces.filter(face => face.patch).length;
      const productProbes = diagnostics.filter(d => d.type === 'gpu-probe' && d.caller === 'product').length;
      return {backend: faces.backend, detected: faces.detectedCount, enhanced, productProbes, adapterInfo,
        libraryProbes: diagnostics.filter(d => d.type === 'gpu-probe' && d.caller === 'library').length,
        passed: enhanced > 0 && productProbes === 1 && faces.backend === 'webgpu'};
    });
    assert.equal(result.workingAdapter.passed, true, JSON.stringify(result.workingAdapter));
  } finally { await page.context().unroute(pattern, instrument); }

  const clockWorker = async route => {
    const response = await route.fetch();
    const prefix = `let testClock=0,testTileUnit;Object.defineProperty(performance,'now',{value:()=>testClock});
      const testPost=globalThis.postMessage.bind(globalThis);globalThis.postMessage=(data,...args)=>{
        if(data.operation==='initialize'&&data.completed===1)testClock=30000;
        if(data.operation==='tile'&&data.type==='status'&&data.unit!==testTileUnit){testTileUnit=data.unit;testClock+=1000;}
        return testPost(data,...args)};`;
    await route.fulfill({response, body: prefix + await response.text()});
  };
  await page.context().route('**/processor.worker-*.js', clockWorker);
  try {
    result.currentEta = await page.evaluate(async () => {
      const file = await uscaleProductLab.makePngFixture('alpha254', 896, 896), estimates = [];
      const output = await uscaleProductLab.runProductWorker({type: 'prepare', file, modelKind: 'drawing', scale: 2}, {
        onProgress: data => { if (data.remainingMs !== undefined) estimates.push({completed: data.completed, remainingMs: data.remainingMs}); },
      });
      return {first: estimates[0], last: estimates.at(-1), tiles: output.plan.tileCount,
        totalMs: output.totalMs, tilesMs: output.tilesMs};
    });
    assert.deepEqual(result.currentEta, {first: {completed: 1, remainingMs: 15000}, last: {completed: 16, remainingMs: 0},
      tiles: 16, totalMs: 46000, tilesMs: 16000});
  } finally { await page.context().unroute('**/processor.worker-*.js', clockWorker); }
  return {...result, passed: true};
}

// UI wiring uses controlled worker replies; inference/import and composition
// checks below execute real product workers. No production hooks are added.
export async function checkProcessingRegressions(page, origin) {
  const results = {};
  const input = await page.evaluate(async () => [...new Uint8Array(await (await uscaleProductLab.makePngFixture('alpha254', 32, 24)).arrayBuffer())]);
  results.cachedFaceScale = await page.evaluate(() => uscaleProductLab.verifyCachedFaceScale());
  assert.equal(results.cachedFaceScale.passed, true);
  results.adapterAndTiming = await checkWorkerPreflightAndTiming(page);

  let blocked = 0;
  const blockImport = route => { blocked++; return route.abort('failed'); };
  await page.context().route('**/ort.webgpu.min.mjs', blockImport);
  results.importRecovery = {};
  for (const group of ['photo', 'faces']) {
    results.importRecovery[group] = await page.evaluate(group => uscaleProductLab.verifyBackendImportRecovery(group), group);
    assert.equal(results.importRecovery[group].passed, true, `${group}: ${JSON.stringify(results.importRecovery[group])}`);
  }
  assert.ok(blocked >= 2);
  await page.context().unroute('**/ort.webgpu.min.mjs', blockImport);
  results.downloadFailures = {};
  const blockModel = route => route.abort('failed');
  await page.context().route('**/*.onnx', blockModel);
  for (const group of ['photo', 'faces']) {
    results.downloadFailures[group] = await page.evaluate(group => uscaleProductLab.verifyBackendImportRecovery(group, 'download'), group);
    assert.equal(results.downloadFailures[group].passed, true);
  }
  await page.context().unroute('**/*.onnx', blockModel);

  // Count actual allocations in the compiled worker, including the rejected
  // maximum-size input. Route only its entry script; model/runtime stay intact.
  let instrumentedWorkers = 0;
  const instrument = async route => {
    instrumentedWorkers++;
    const response = await route.fetch();
    const prefix = `const OriginalUint8Array=globalThis.Uint8Array;globalThis.Uint8Array=new Proxy(OriginalUint8Array,{construct(target,args){if(typeof args[0]==='number')postMessage({type:'allocation',length:args[0]});return Reflect.construct(target,args)}});const originalExport=OffscreenCanvas.prototype.convertToBlob;OffscreenCanvas.prototype.convertToBlob=function(...args){if((this.width===128&&this.height===96)||(this.width===64&&this.height===48))throw Error('Injected export failure');return originalExport.apply(this,args)};`;
    await route.fulfill({response, body: prefix + await response.text()});
  };
  await page.context().route('**/processor.worker-*.js', instrument);
  results.admission = await page.evaluate(async () => {
    const cases = [];
    for (const [width, height, transparent, lossless] of [[80, 60, false, false], [3200, 3200, true, false], [3200, 3200, false, true]]) {
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
      context.fillStyle = '#ff00ff'; context.fillRect(0, 0, width, height);
      if (transparent) context.clearRect(0, 0, 1, 1);
      const file = new File([await canvas.convertToBlob({type: 'image/png'})], 'admission.png', {type: 'image/png'});
      canvas.width = canvas.height = 1;
      const allocations = [];
      let error, mime;
      try {
        const output = await uscaleProductLab.runProductWorker({type: 'prepare', file, modelKind: 'drawing', scale: 4,
          ...(lossless ? {benchmark: {lossless: true}} : {})}, {onProgress: data => {
          if (data.type === 'allocation') allocations.push(data.length);
        }});
        mime = output.blob.type;
      } catch (failure) { error = {code: failure.code, key: failure.key, fallbackScale: failure.fallbackScale}; }
      cases.push({width, height, transparent, lossless, error, mime,
        fullRgbAllocated: allocations.includes(width * height * 3), fullAlphaAllocated: allocations.includes(width * height)});
    }
    const exportFailures = [];
    const canvas = new OffscreenCanvas(32, 24);
    canvas.getContext('2d');
    const empty = new File([await canvas.convertToBlob({type: 'image/png'})], 'empty.png', {type: 'image/png'});
    for (const scale of [2, 4]) {
      try { await uscaleProductLab.runProductWorker({type: 'prepare', file: empty, modelKind: 'drawing', scale}); }
      catch (error) { exportFailures.push({scale, code: error.code, key: error.key, fallbackScale: error.fallbackScale}); }
    }
    return {cases, exportFailures, passed: cases.every(c => !c.fullRgbAllocated && !c.fullAlphaAllocated) &&
      cases[0].mime === 'image/jpeg' && cases[1].error?.code === 'size' && cases[1].error?.fallbackScale === 2 &&
      cases[2].error?.code === 'size' && exportFailures.length === 2 && exportFailures.every(c =>
        c.code === 'export' && c.key === (c.scale === 4 ? 'err_png_export_2x' : 'err_png_export') &&
        c.fallbackScale === (c.scale === 4 ? 2 : undefined))};
  });
  await page.context().unroute('**/processor.worker-*.js', instrument);
  assert.ok(instrumentedWorkers >= 3);
  results.admission.instrumentedWorkers = instrumentedWorkers;
  assert.equal(results.admission.passed, true, JSON.stringify(results.admission));

  const events = [], taps = [];
  page.on('console', async message => {
    if (/^\[analytics\] (processing_completed|tap)/.test(message.text())) {
      const args = message.args();
      try {
        const event = await args[1].jsonValue();
        if (message.text().startsWith('[analytics] processing_completed')) events.push(event);
        else if (event.element === 'start_processing') taps.push(event);
      } catch { /* A closing page releases handles. */ }
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem('uscale-consent', JSON.stringify({v: 1, analytics: true}));
    Object.defineProperty(navigator, 'gpu', {value: location.search.includes('test_cpu=1') ? undefined : {}});
    Object.defineProperty(navigator, 'hardwareConcurrency', {value: 12});
    Object.defineProperty(navigator, 'deviceMemory', {value: 8});
    Object.defineProperty(navigator, 'userAgent', {configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36'});
    if (location.search.includes('test_ios=1')) {
      Object.defineProperty(navigator, 'userAgent', {value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/27.2 Mobile/15E148 Safari/604.1'});
      Object.defineProperty(navigator, 'platform', {value: 'iPhone'});
      Object.defineProperty(navigator, 'maxTouchPoints', {value: 5});
    }
    window.__requests = [];
    window.__scenario = {};
    // These four keys are cleared only on this local test origin. Production
    // keeps v2 measurements and has no new automatic migration.
    if (['127.0.0.1', 'localhost'].includes(location.hostname)) {
      for (const kind of ['photo', 'drawing']) for (const scale of [2, 4]) localStorage.removeItem(`uscale-tile-ms-v2-${kind}-${scale}`);
    }
    window.Worker = class {
      constructor(url) { this.group = String(url).includes('processor.worker-') ? 'upscale' : 'faces'; }
      terminate() { this.stopped = true; }
      postMessage(request) {
        const {group} = this, {execution} = request;
        const send = data => {
          if (!this.stopped) this.onmessage?.({data: {attemptId: execution.attemptId, backend: execution.backend, ...data}});
        };
        const state = window.__scenario;
        const run = window.__requests.filter(row => row.group === group).length;
        window.__requests.push({group, backend: execution.backend, scale: request.scale,
          threads: execution.threads,
          hasFaces: request.faceResults !== undefined, patches: request.faceResults?.faces.filter(face => face.patch).length});
        queueMicrotask(async () => {
          const canvas = new OffscreenCanvas(32, 24);
          canvas.getContext('2d').fillRect(0, 0, 32, 24);
          const blob = await canvas.convertToBlob({type: 'image/png'});
          if ((state.autoGpu === group && execution.backend === 'webgpu') ||
              (state.cpuThreadFailure && execution.backend === 'wasm' && execution.threads > 1)) {
            send({type: 'status', operation: 'initialize', title: 'initializing'});
            send({type: 'error', code: execution.backend === 'webgpu' ? 'gpu' : 'runtime', key: 'err_engine_start'});
            return;
          }
          if (group === 'faces') {
            if (state.faceError && !run) {
              send({type: 'status', operation: 'download', title: 'finding_faces'});
              send({type: 'error', code: state.faceError, key: state.faceError === 'download' ? 'err_download' : state.faceError === 'size' ? 'err_face_limit' : state.faceError === 'format' ? 'err_format' : 'err_face'});
            } else send({type: 'faces', detectedCount: 1, faces: state.noFaces ? [] : [{patch: blob, transform: {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0}}]});
          } else if (state.failUpscale && !run) {
            send({type: 'status', operation: 'encode', title: 'encoding'});
            send({type: 'error', code: 'export', key: state.fallbackScale ? 'err_png_export_2x' : 'err_png_export', fallbackScale: state.fallbackScale});
          } else {
            const scale = request.scale;
            const plan = {width: 32, height: 24, outputWidth: 32 * scale, outputHeight: 24 * scale, scale, tileCount: 25};
            send({type: 'photo', plan, thumbnail: blob});
            send({type: 'done', blob, plan, modelKind: request.modelKind, faceEnabled: Boolean(request.faceResults),
              faceCount: request.faceResults?.faces.length || 0, tilesMs: 2500, skippedTiles: state.skippedTiles || 0});
          }
        });
      }
    };
  });
  const open = async (scenario = {}, ios = false, cpu = false) => {
    await page.goto(`${origin}/upscale/?mode=device&analytics_debug=1${ios ? '&test_ios=1' : ''}${cpu ? '&test_cpu=1' : ''}`);
    await page.evaluate(scenario => { window.__scenario = scenario; }, scenario);
    await page.locator('#photo-input').setInputFiles({name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(input)});
    await page.locator('#process-photo').waitFor({state: 'visible'});
    if (!await page.locator('#enhance-faces').isChecked()) await page.locator('#enhance-faces').check();
  };
  await open({faceError: 'gpu', failUpscale: true});
  await page.locator('#process-photo').click();
  await page.locator('#cpu-retry').waitFor({state: 'visible'});
  await page.locator('#cpu-retry').click();
  await page.locator('#retry').waitFor({state: 'visible'});
  await page.locator('#retry').click();
  await page.locator('#results').waitFor({state: 'visible'});
  await page.locator('#scale-4x').click();
  await page.locator('#process-photo').click();
  await page.locator('#results').waitFor({state: 'visible'});
  const requests = await page.evaluate(() => window.__requests);
  assert.deepEqual(requests.map(r => [r.group, r.backend]), [['faces', 'webgpu'], ['faces', 'wasm'], ['upscale', 'wasm'], ['upscale', 'wasm'], ['upscale', 'wasm']]);
  assert.ok(requests.filter(r => r.group === 'upscale').every(r => r.patches === 1));
  assert.equal(requests.at(-1).scale, 4);
  await page.waitForTimeout(50);
  assert.deepEqual(taps.slice(0, 4).map(e => e.cpu_fallback), [false, true, true, true]);
  assert.deepEqual(events.slice(0, 4).map(e => e.cpu_fallback), [false, true, true, true]);
  results.retryWithFaces = {passed: true, requests, startFallback: taps.slice(0, 4).map(e => e.cpu_fallback),
    outcomeFallback: events.slice(0, 4).map(e => e.cpu_fallback)};

  await page.locator('#enhance-faces').uncheck();
  await page.locator('#enhance-faces').check();
  await page.locator('#process-photo').click();
  await page.locator('#results').waitFor({state: 'visible'});
  const countFaces = () => page.evaluate(() => window.__requests.filter(r => r.group === 'faces').length);
  assert.equal(await countFaces(), 3);
  await page.locator('#model-drawing').click();
  await page.locator('#model-photo').click();
  await page.locator('#process-photo').click();
  await page.locator('#results').waitFor({state: 'visible'});
  assert.equal(await countFaces(), 4);
  results.faceCacheInvalidation = {passed: true};

  await page.locator('#another-photo').click();
  await page.evaluate(() => { window.__scenario = {}; });
  await page.locator('#photo-input').setInputFiles({name: 'new-file.png', mimeType: 'image/png', buffer: Buffer.from(input)});
  await page.locator('#process-photo').click();
  await page.locator('#results').waitFor({state: 'visible'});
  await page.waitForTimeout(50);
  assert.equal(taps.at(-1).cpu_fallback, false);
  assert.equal(events.at(-1).cpu_fallback, false);
  const newFileRequests = await page.evaluate(() => window.__requests.slice(-2));
  assert.ok(newFileRequests.every(request => request.backend === 'webgpu'));
  results.newFileClearsCpu = {passed: true, requests: newFileRequests};

  await open({noFaces: true, failUpscale: true}, true);
  await page.locator('#process-photo').click();
  await page.locator('#retry').waitFor({state: 'visible'});
  await page.locator('#retry').click();
  await page.locator('#results').waitFor({state: 'visible'});
  const iosRequests = await page.evaluate(() => window.__requests);
  assert.deepEqual(iosRequests.map(r => [r.group, r.backend]), [['faces', 'wasm'], ['upscale', 'webgpu'], ['upscale', 'webgpu']]);
  results.iosStageIndependence = {passed: true, requests: iosRequests};
  await page.waitForTimeout(50);
  assert.equal(events.at(-1).cpu_fallback, false);

  results.fallbackAnalytics = [];
  for (const [name, scenario, ios, cpu, expected, faces] of [
    ['gpu-success', {}, false, false, false, false],
    ['native-cpu', {}, false, true, false, false],
    ['ios-face-cpu', {}, true, false, false, true],
    ['face-gpu-fallback', {autoGpu: 'faces'}, false, false, true, true],
    ['upscale-gpu-fallback', {autoGpu: 'upscale'}, false, false, true, false],
    ['cpu-thread-fallback', {cpuThreadFailure: true}, false, true, false, false],
  ]) {
    await open(scenario, ios, cpu);
    if (!faces) await page.locator('#enhance-faces').uncheck();
    await page.locator('#process-photo').click();
    await page.locator('#results').waitFor({state: 'visible'});
    await page.waitForTimeout(50);
    assert.equal(taps.at(-1).cpu_fallback, false, name);
    assert.equal(events.at(-1).cpu_fallback, expected, name);
    const requests = await page.evaluate(() => window.__requests);
    if (name === 'cpu-thread-fallback') {
      assert.deepEqual(requests.map(r => r.threads), [8, 1]);
    }
    if (name === 'face-gpu-fallback') {
      assert.equal(requests.at(-1).backend, 'webgpu');
      await page.evaluate(() => { window.__scenario = {}; });
      await page.locator('#scale-4x').click();
      await page.locator('#process-photo').click();
      await page.locator('#results').waitFor({state: 'visible'});
      await page.waitForTimeout(50);
      assert.equal(taps.at(-1).cpu_fallback, false);
      assert.equal(events.at(-1).cpu_fallback, false);
    }
    results.fallbackAnalytics.push({name, startFallback: false, outcomeFallback: expected, requests, passed: true});
  }

  results.errorCodes = [];
  for (const code of ['download', 'size', 'format', 'runtime']) {
    await open({faceError: code});
    const before = events.length;
    await page.locator('#process-photo').click();
    // Runtime during download is intentionally non-retryable; the import
    // recovery checks above cover runtime/gpu errors during initialize.
    await page.waitForFunction(() => !document.getElementById('status').classList.contains('is-busy'));
    await page.waitForTimeout(50);
    const event = events.slice(before).find(e => e.result === 'failed');
    assert.equal(event?.error_reason, code);
    assert.equal(event.error_stage, 'faces');
    assert.equal(event.error_type, code === 'download' ? 'download' : 'face');
    assert.equal(await page.locator('#photo-error').isVisible(), ['size', 'format'].includes(code));
    assert.equal(await page.locator('#retry').isVisible(), ['download', 'runtime'].includes(code));
    results.errorCodes.push({code, event, passed: true});
  }

  results.scaleFallback = [];
  for (const scale of [2, 4]) {
    await open({failUpscale: true, fallbackScale: scale === 4 ? 2 : undefined});
    await page.locator('#enhance-faces').uncheck();
    if (scale === 4) await page.locator('#scale-4x').click();
    await page.locator('#process-photo').click();
    await page.waitForFunction(() => !document.getElementById('status').classList.contains('is-busy'));
    const offered = await page.locator('#try-2x').isVisible();
    assert.equal(offered, scale === 4);
    results.scaleFallback.push({scale, offered, passed: true});
  }

  results.eta = [];
  for (const skippedTiles of [24, 25, 0]) {
    await open({skippedTiles});
    await page.locator('#enhance-faces').uncheck();
    await page.evaluate(() => {
      localStorage.setItem('uscale-tile-ms-v2-photo-2', '777');
      localStorage.setItem('unrelated-preference', 'keep');
    });
    await page.locator('#process-photo').click();
    await page.locator('#results').waitFor({state: 'visible'});
    const saved = await page.evaluate(() => ({tile: localStorage.getItem('uscale-tile-ms-v2-photo-2'), other: localStorage.getItem('unrelated-preference')}));
    assert.equal(saved.tile, skippedTiles ? '777' : '100');
    assert.equal(saved.other, 'keep');
    results.eta.push({skippedTiles, ...saved, passed: true});
  }
  return {kind: 'processing-regressions', createdAt: new Date().toISOString(), passed: true,
    methods: {importsDownloadsAdmissionExportsAndComposition: 'Actual compiled product workers; failures injected by browser routing',
      ui: 'Actual product page with controlled worker replies', ios: 'User-agent emulation for stage policy, not a physical-device test'}, ...results};
}
