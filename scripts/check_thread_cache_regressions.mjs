import assert from 'node:assert/strict';

export async function checkThreadCacheRegressions(page, origin) {
  const faceWorkers = await page.evaluate(() => uscaleProductLab.verifyFaceThreadCache());
  assert.equal(faceWorkers.passed, true);
  assert.ok(faceWorkers.policy.upscale[0].threads > 1);
  assert.ok(faceWorkers.policy.faces[0].threads > 1);
  const fixtures = await page.evaluate(async () => Object.fromEntries(await Promise.all(
    ['empty', 'alpha254'].map(async name => [name, [...new Uint8Array(await (await uscaleProductLab.makePngFixture(name, 32, 24)).arrayBuffer())]]))));

  await page.addInitScript(() => {
    // Leave CPU/OS/browser identity intact: the shipped policy must select N>1.
    Object.defineProperty(navigator, 'gpu', {value: undefined});
    localStorage.setItem('uscale-consent', JSON.stringify({v: 1, analytics: true}));
    window.__threadRuns = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, ...args) {
        super(url, ...args);
        this.group = String(url).includes('processor.worker-') ? 'upscale' : 'faces';
        this.addEventListener('message', ({data}) => {
          if (!this.record) return;
          if (data.type === 'status' && data.operation === 'initialize' && data.completed === 1) {
            this.record.initializations.push(data.effectiveThreads);
          }
          if (['done', 'faces', 'enhanced'].includes(data.type)) {
            Object.assign(this.record, {type: data.type, effectiveThreads: data.effectiveThreads,
              threadCountPresent: data.effectiveThreads !== undefined, responseRequestedThreads: data.requestedThreads});
          }
        });
      }
      postMessage(data, ...args) {
        this.record = {file: data.file.name, group: this.group, backend: data.execution.backend,
          requestedThreads: data.execution.threads, initializations: []};
        window.__threadRuns.push(this.record);
        return super.postMessage(data, ...args);
      }
    };
  });
  await page.goto(`${origin}/upscale/?mode=device&analytics_debug=1`);
  const failureKeys = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('uscale-cpu-failure:')));
  assert.deepEqual(await failureKeys(), []);
  const runs = [];
  for (const name of ['empty', 'alpha254']) {
    await page.locator('#photo-input').setInputFiles({name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(fixtures[name])});
    await page.locator('#process-photo').waitFor({state: 'visible'});
    if (!await page.locator('#enhance-faces').isChecked()) await page.locator('#enhance-faces').check();
    const completed = page.waitForEvent('console', {predicate: message => message.text().startsWith('[analytics] processing_completed')});
    await page.locator('#process-photo').click();
    await page.locator('#results').waitFor({state: 'visible', timeout: 120_000});
    const event = await (await completed).args()[1].jsonValue();
    const requests = await page.evaluate(name => window.__threadRuns.filter(run => run.file === `${name}.png`), name);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(run => run.group), ['faces', 'upscale']);
    for (const request of requests) {
      assert.equal(request.backend, 'wasm');
      assert.equal(request.requestedThreads, faceWorkers.policy[request.group][0].threads);
      assert.ok(request.requestedThreads > 1, `${name}: test silently fell back to CPU1`);
      assert.equal(request.responseRequestedThreads, request.requestedThreads);
      if (name === 'empty') {
        assert.equal(request.effectiveThreads, undefined);
        assert.equal(request.threadCountPresent, false);
        assert.deepEqual(request.initializations, []);
      } else {
        assert.equal(request.effectiveThreads, request.requestedThreads);
        assert.ok(request.effectiveThreads > 1);
        assert.deepEqual(request.initializations, [request.requestedThreads]);
      }
    }
    assert.equal(event.result, 'success');
    if (name === 'empty') assert.equal(event.cpu_threads, undefined);
    else assert.equal(event.cpu_threads, faceWorkers.policy.upscale[0].threads);
    assert.deepEqual(await failureKeys(), []);
    runs.push({name, requests, outcome: event, cpuThreadsPresent: event.cpu_threads !== undefined, passed: true});
    if (name === 'empty') await page.locator('#another-photo').click();
  }
  return {kind: 'thread-cache-regressions', createdAt: new Date().toISOString(), passed: true,
    method: 'Actual compiled workers and actual UI with native device identity; only WebGPU disabled to select CPU',
    faceWorkers, runs, failureKeys: await failureKeys()};
}
