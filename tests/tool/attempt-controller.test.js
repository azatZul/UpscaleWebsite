import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttemptController, operationTimeout} from '../../src/tool/attempt-controller.js';

function harness() {
  let now = 0, id = 0; const workers = [], scheduled = new Map(), messages = [], failures = [], rejected = [], retries = [];
  const controller = createAttemptController({
    makeWorker: config => { const w = {config, postMessage(p) { this.request = p; }, terminate() { this.stopped = true; }}; workers.push(w); return w; },
    onMessage: x => messages.push(x), onFailure: x => failures.push(x), onRuntimeFailure: x => rejected.push(x),
    onRetry: x => retries.push(x),
    now: () => now, timeoutFor: () => 100, schedule: (fn, ms) => { scheduled.set(++id, {fn, ms}); return id; },
    unschedule: key => scheduled.delete(key),
  });
  return {controller, workers, messages, failures, rejected, retries, scheduled, time: value => { now = value; }};
}
const choices = [{backend: 'webgpu', threads: 1}, {backend: 'wasm', threads: 2}, {backend: 'wasm', threads: 1}];

test('GPU failure, CPU worker crash, then single-thread success preserve request and ignore old messages', () => {
  const h = harness(); h.controller.start({faceResults: {faces: ['cached']}}, choices);
  const first = h.workers[0]; first.onmessage({data: {type: 'status', operation: 'tile', completed: 0}});
  first.onmessage({data: {type: 'error', code: 'gpu'}});
  const second = h.workers[1]; second.onerror({preventDefault() {}});
  assert.equal(h.workers.length, 3); assert.equal(h.rejected.length, 1);
  assert.equal(first.stopped, true);
  assert.deepEqual(h.workers[2].request.faceResults, {faces: ['cached']});
  first.onmessage({data: {type: 'done', blob: 'stale'}});
  assert.equal(h.messages.some(x => x.blob === 'stale'), false);
  h.workers[2].onmessage({data: {type: 'done', blob: 'good'}});
  assert.equal(h.messages.at(-1).blob, 'good'); assert.equal(h.controller.active, false);
  assert.deepEqual(h.retries.map(r => [r.from.backend, r.to.backend, r.to.threads, r.error.code]),
    [['webgpu', 'wasm', 2, 'gpu'], ['wasm', 'wasm', 1, 'runtime']]);
});

test('download and encode failures do not retry; cancellation never remembers failure', () => {
  for (const operation of ['download', 'encode', 'scan']) {
    const h = harness(); h.controller.start({}, choices);
    h.workers[0].onmessage({data: {type: 'status', operation}});
    h.workers[0].onmessage({data: {type: 'error', code: 'runtime'}});
    assert.equal(h.workers.length, 1); assert.equal(h.failures.length, 1);
    assert.equal(h.retries.length, 0);
  }
  const h = harness(); h.controller.start({}, choices.slice(1)); h.controller.cancel();
  h.workers[0].onerror({}); assert.equal(h.rejected.length, 0); assert.equal(h.failures.length, 0);
  assert.equal(h.retries.length, 0);
});

test('retry callback reports only actual transitions, not initial or terminal attempts', () => {
  const h = harness(); h.controller.start({}, [choices[0], choices[0], choices[2]]);
  assert.equal(h.retries.length, 0);
  h.workers[0].onmessage({data: {type: 'error', code: 'gpu'}});
  assert.equal(h.retries.length, 1);
  assert.equal(h.retries[0].from.attemptId, h.workers[0].config.attemptId);
  h.workers[1].onmessage({data: {type: 'error', code: 'runtime'}});
  assert.equal(h.retries.length, 1);
  assert.equal(h.failures.length, 1);
});

test('worker crashes retain sanitized cause and last operation through retries and final failure', () => {
  const h = harness(); h.controller.start({modelKind: 'photo', scale: 2}, choices);
  h.workers[0].onmessage({data: {type: 'status', operation: 'tile'}});
  h.workers[0].onerror({message: 'GPU device lost', lineno: 12, colno: 3});
  assert.equal(h.retries[0].error.engine_message, 'GPU device lost');
  assert.equal(h.retries[0].error.operation, 'tile');
  assert.equal(h.retries[0].error.backend, 'webgpu');
  h.workers[1].onerror({message: 'WASM initialization failed'});
  h.workers[2].onerror({message: 'Failed https://example.com/worker.js?token=secret'});
  assert.equal(h.failures[0].engine_message, 'Failed [url]');
  assert.equal(h.failures[0].operation, 'initialize');
  assert.equal(h.failures[0].model, 'photo-2');
  assert.equal(h.failures[0].backend, 'wasm');
  assert.equal(h.failures[0].attempt_index, 2);
});

test('identical status is not progress and background pause preserves remaining time', () => {
  const h = harness(); h.controller.start({}, choices);
  const status = {type: 'status', operation: 'tile', completed: 0};
  h.workers[0].onmessage({data: status});
  const timer = [...h.scheduled.keys()][0];
  h.time(20); h.workers[0].onmessage({data: {...status, title: 'new text'}});
  assert.equal([...h.scheduled.keys()][0], timer);
  h.controller.setHidden(true); assert.equal(h.scheduled.size, 0);
  h.time(1000); h.controller.setHidden(false);
  assert.equal([...h.scheduled.values()][0].ms, 80);
  [...h.scheduled.values()][0].fn(); assert.equal(h.workers.length, 2);
});

test('timeouts use a measured operation maximum and a conservative 120s floor', () => {
  assert.equal(operationTimeout({operation: 'face', model: 'faces', backend: 'wasm'}), 120_000);
  assert.equal(operationTimeout({operation: 'face'}, [{operation: 'face', maxMs: 90_000}]), 270_000);
  assert.equal(operationTimeout({operation: 'encode', pixels: 40_000_000}, [{operation: 'encode', maxPixels: 10_000_000, maxMs: 50_000}]), 600_000);
});

test('an ORT downgrade to one thread is remembered without discarding a successful run', () => {
  const h = harness(); h.controller.start({}, choices.slice(1));
  h.workers[0].onmessage({data: {type: 'status', operation: 'initialize', completed: 1, effectiveThreads: 1}});
  h.workers[0].onmessage({data: {type: 'status', operation: 'initialize', completed: 1, effectiveThreads: 1}});
  assert.equal(h.rejected.length, 1);
  h.workers[0].onmessage({data: {type: 'done', blob: 'valid'}});
  assert.equal(h.messages.at(-1).blob, 'valid'); assert.equal(h.workers.length, 1);
});

test('model-free completion and unconfirmed thread counts never reject a configuration', () => {
  for (const type of ['done', 'faces', 'enhanced']) for (const effectiveThreads of [undefined, 1]) {
    const h = harness(); h.controller.start({}, choices.slice(1));
    // Each condition of the initialization proof is necessary. Terminal
    // messages must not become proof even if they carry stale init fields.
    for (const status of [
      {type: 'status', operation: 'initialize', effectiveThreads: 1},
      {type: 'status', operation: 'initialize', completed: 0, effectiveThreads: 1},
      {type: 'status', operation: 'initialize', completed: 1},
      {type: 'status', operation: 'detect', completed: 1, effectiveThreads: 1},
      {type: 'photo', operation: 'initialize', completed: 1, effectiveThreads: 1},
    ]) h.workers[0].onmessage({data: status});
    h.workers[0].onmessage({data: {type, operation: 'initialize', completed: 1, effectiveThreads}});
    assert.equal(h.rejected.length, 0, `${type}/${effectiveThreads}`);
    assert.equal(h.failures.length, 0);
    assert.equal(h.workers.length, 1);
    assert.equal(h.controller.active, false);
    assert.equal(h.messages.at(-1).type, type);
  }
});

test('streamed bytes are real progress even when Content-Length is absent', () => {
  const h = harness(); h.controller.start({}, choices);
  const send = bytes => h.workers[0].onmessage({data: {type: 'status', operation: 'download', progress: 0, receivedBytes: bytes}});
  send(10); const first = [...h.scheduled.keys()][0];
  send(20); const second = [...h.scheduled.keys()][0];
  assert.notEqual(first, second);
  send(20); assert.equal([...h.scheduled.keys()][0], second);
});
