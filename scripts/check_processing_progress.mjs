import assert from 'node:assert/strict';
import {assertDownloadProgress, captureDownloadProgress} from './check_download_progress.mjs';

// Exercise real workers through the public UI. In particular, sample the UI
// after every status, including the start of the next (slow) inference.
export async function checkProcessingProgress(page, origin) {
  await captureDownloadProgress(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {value: undefined});
    const NativeWorker = Worker;
    window.__processingStatuses = [];
    window.Worker = class extends NativeWorker {
      set onmessage(callback) {
        super.onmessage = event => {
          callback(event);
          const data = event.data;
          if (data.type !== 'status' || !['tile', 'composite', 'encode'].includes(data.operation)) return;
          const progress = document.getElementById('progress');
          window.__processingStatuses.push({operation: data.operation, unit: data.unit,
            completed: data.completed, progress: data.progress, remainingMs: data.remainingMs,
            hidden: progress.hidden, value: progress.value,
            label: document.getElementById('status-value').textContent,
            detail: document.getElementById('status-detail').textContent});
        };
      }
    };
  });
  await page.goto(`${origin}/upscale/?mode=device`);
  const cases = [];
  for (const transparent of [false, true]) {
    const input = await page.evaluate(async transparent => {
      const canvas = new OffscreenCanvas(672, 32), context = canvas.getContext('2d');
      context.fillStyle = '#936b47'; context.fillRect(0, 0, canvas.width, canvas.height);
      if (transparent) context.clearRect(0, 0, 1, 1);
      const blob = await canvas.convertToBlob({type: transparent ? 'image/png' : 'image/jpeg'});
      return [...new Uint8Array(await blob.arrayBuffer())];
    }, transparent);
    await page.locator('#photo-input').setInputFiles({name: transparent ? 'progress.png' : 'progress.jpg',
      mimeType: transparent ? 'image/png' : 'image/jpeg', buffer: Buffer.from(input)});
    if (await page.locator('#enhance-faces').isChecked()) await page.locator('#enhance-faces').uncheck();
    await page.evaluate(() => { window.__processingStatuses = []; window.__downloadStatuses = []; });
    await page.locator('#process-photo').click();
    await page.locator('#results').waitFor({state: 'visible', timeout: 180_000});
    const statuses = await page.evaluate(() => window.__processingStatuses);
    const tiles = statuses.filter(s => s.operation === 'tile');
    const starts = tiles.filter((s, i) => i === 0 || s.unit !== tiles[i - 1].unit);
    assert.equal(starts.length, 3, 'must exercise multiple actual inferences');
    assert.equal(starts[0].progress, 0, 'show 0% during the first inference');
    assert.ok(starts.slice(1).every(s => s.progress > 0 && s.remainingMs > 0),
      'keep measured progress and ETA during subsequent inferences');
    assert.ok(statuses.every(s => !s.hidden && Number.isFinite(s.progress) &&
      Math.abs(s.value - s.progress) < 1e-6 && s.label === `${Math.round(s.progress * 100)}%`),
    'progress must stay visible through inference, compositing and export');
    assert.ok(statuses.every((s, i) => !i || s.progress >= statuses[i - 1].progress),
      'processing progress must not move backwards');
    const output = await page.evaluate(async () => {
      const blob = await (await fetch(document.getElementById('download-result').href)).blob();
      const bitmap = await createImageBitmap(blob);
      const result = {mime: blob.type, width: bitmap.width, height: bitmap.height};
      bitmap.close(); return result;
    });
    assert.deepEqual(output, {mime: transparent ? 'image/png' : 'image/jpeg', width: 1344, height: 64});
    const downloads = assertDownloadProgress(await page.evaluate(() => window.__downloadStatuses),
      ['loading_upscaler']);
    cases.push({transparent, statuses, downloads, output, passed: true});
    await page.locator('#another-photo').click();
  }
  return {kind: 'processing-progress-ui', cases, passed: true};
}
