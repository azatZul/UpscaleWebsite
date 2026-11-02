import assert from 'node:assert/strict';
import {assertDownloadProgress, captureDownloadProgress} from './check_download_progress.mjs';

// Real Chrome/iOS failure: CriOS includes Safari, but has no Version/ token.
// The UA must reach the worker as well as the page to exercise MediaPipe's check.
export const IOS_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.8078.54 Mobile/15E148 Safari/604.1';

export async function checkIosFaces(page, origin) {
  await captureDownloadProgress(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {value: undefined});
    window.__faceExecutions = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({data}) => {
          if (data.type === 'faces') window.__faceExecutions.push({type: data.type, backend: data.backend,
            detected: data.detectedCount, enhanced: data.faces.filter(face => face.patch).length});
          if (data.type === 'done') window.__faceExecutions.push({type: data.type, faceCount: data.faceCount,
            backend: data.backend, faceEnabled: data.faceEnabled});
          if (data.type === 'error') window.__faceExecutions.push({type: data.type, code: data.code, key: data.key});
        });
      }
    };
  });
  await page.goto(`${origin}/upscale/?mode=device`);
  assert.equal(await page.evaluate(() => navigator.userAgent), IOS_CHROME_UA);
  const input = await page.evaluate(async () => {
    const source = await (await fetch('/benchmarks/ios/face/asset_face_preview_original.input.png')).blob();
    const bitmap = await createImageBitmap(source), canvas = new OffscreenCanvas(320, 320);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, 320, 320); bitmap.close();
    return [...new Uint8Array(await (await canvas.convertToBlob({type: 'image/jpeg'})).arrayBuffer())];
  });
  await page.locator('#photo-input').setInputFiles({name: 'ios-portrait.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(input)});
  await page.locator('#enhance-faces').check();
  await page.locator('#process-photo').click();
  await page.waitForFunction(() => !document.getElementById('results').hidden || !document.getElementById('retry').hidden,
    undefined, {timeout: 180_000});
  const executions = await page.evaluate(() => window.__faceExecutions);
  assert.equal(await page.locator('#results').isVisible(), true,
    `${await page.locator('#status-detail').textContent()}: ${JSON.stringify(executions)}`);
  const faces = executions.find(run => run.type === 'faces'), result = executions.find(run => run.type === 'done');
  assert.ok(faces?.detected > 0 && faces.enhanced > 0, 'landmarks and GFPGAN must actually execute');
  assert.equal(faces.backend, 'wasm', 'iOS face processing must retain the CPU policy');
  assert.ok(result.faceEnabled && result.faceCount > 0, 'the upscaled photo must include enhanced faces');
  const output = await page.evaluate(async () => {
    const blob = await (await fetch(document.getElementById('download-result').href)).blob();
    const bitmap = await createImageBitmap(blob);
    const dimensions = {width: bitmap.width, height: bitmap.height, mime: blob.type}; bitmap.close(); return dimensions;
  });
  assert.deepEqual(output, {width: 640, height: 640, mime: 'image/jpeg'});
  const downloads = assertDownloadProgress(await page.evaluate(() => window.__downloadStatuses),
    ['loading_faces', 'loading_upscaler']);
  return {kind: 'ios-chrome-face-ui', userAgent: IOS_CHROME_UA, executions, downloads, output, passed: true};
}
