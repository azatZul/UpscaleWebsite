import {errorDetails} from './diagnostics.js';
import {variantKey, PHOTO4X_BUDGET_MS, PHOTO4X_CALIBRATION_MS} from './photo4x-policy.js';

const RETRY_OPERATIONS = new Set(['initialize', 'tile', 'detect', 'face']);

// Maxima are evidence, not a claim about the speed of an arbitrary device.
// Existing Chromium/Core ML parity measurements seed only the operations they measured.
export const TIMING_PROFILES = [
  {operation: 'tile', model: 'photo-2', backend: 'wasm', maxMs: 3958.278},
  {operation: 'face', model: 'faces', backend: 'wasm', maxMs: 10183.069},
  {operation: 'tile', model: 'photo-4', backend: 'wasm', maxMs: 3236.04,
    evidence: 'benchmarks/browser/mac_chromium_151_product_cpu.json'},
  {operation: 'tile', model: 'drawing-2', backend: 'wasm', maxMs: 36070.1,
    evidence: 'benchmarks/browser/png-firefox-rgb-parity.json'},
  {operation: 'tile', model: 'drawing-4', backend: 'wasm', maxMs: 1695.93,
    evidence: 'benchmarks/browser/mac_chromium_151_product_cpu.json'},
  {operation: 'initialize', model: 'faces', backend: 'wasm', maxMs: 282.315,
    evidence: 'benchmarks/browser/cpu-face-chromium-final.json'},
  {operation: 'detect', model: 'faces', backend: 'wasm', maxMs: 137.62,
    evidence: 'benchmarks/browser/face-png-chromium-final.json'},
  {operation: 'encode', maxMs: 5208.14, maxPixels: 8192 * 6346,
    evidence: 'benchmarks/browser/iphone_14_pro_png_max_interrupted.json'},
];

export function operationTimeout({operation, model, backend, pixels = 0}, profiles = TIMING_PROFILES) {
  const matches = profiles.filter(p => p.operation === operation);
  const exact = matches.filter(p => p.model === model && p.backend === backend);
  const maximum = Math.max(0, ...(exact.length ? exact : model?.includes('|') ? [] : matches).map(p =>
    p.maxMs * (operation === 'encode' && p.maxPixels && pixels ? Math.max(1, pixels / p.maxPixels) : 1)));
  return Math.max(120_000, Math.ceil(maximum * 3));
}

export function createAttemptController({makeWorker, onMessage, onFailure, onRuntimeFailure = () => {}, onRetry = () => {},
  timeoutFor = operationTimeout, now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout}) {
  let worker, timer, budgetTimer, calibrationTimer, run = 0, attemptIndex = -1, config, payload, attempts = [];
  let operation, evidence, remaining = 0, startedAt = 0, paused = false, active = false;
  function deadline(milliseconds, expire) {
    let id, left = milliseconds, started, cancelled = false;
    const clear = () => { if (id !== undefined) unschedule(id); id = undefined; };
    const resume = () => {
      if (cancelled || paused || id !== undefined) return;
      started = now();
      id = schedule(() => { if (!cancelled && !paused) expire(); }, left);
    };
    resume();
    return {
      pause() {
        if (id !== undefined) left = Math.max(0, left - (now() - started));
        clear();
      },
      resume,
      cancel() { cancelled = true; clear(); },
    };
  }
  const clearTimer = () => { if (timer !== undefined) unschedule(timer); timer = undefined; };
  const terminate = () => {
    worker?.terminate(); worker = undefined; clearTimer();
    budgetTimer?.cancel(); calibrationTimer?.cancel();
    budgetTimer = calibrationTimer = undefined;
  };
  const arm = () => {
    clearTimer();
    if (!active || paused) return;
    startedAt = now();
    timer = schedule(() => failure({type: 'error', code: 'timeout', key: 'err_timeout'}), remaining);
  };
  function advance() {
    terminate();
    config = {...attempts[++attemptIndex], attemptId: `${run}:${attemptIndex}`};
    operation = {operation: 'initialize', model: config.variant ? variantKey(config.variant, config.backend) : payload.modelKind ? `${payload.modelKind}-${payload.scale}` : 'faces',
      backend: config.backend};
    evidence = undefined; remaining = timeoutFor(operation); active = true;
    const currentRun = run, currentIndex = attemptIndex;
    const current = () => active && currentRun === run && currentIndex === attemptIndex;
    try {
      worker = makeWorker(config);
      worker.onmessage = ({data}) => {
        if (!current() || (data.attemptId !== undefined && data.attemptId !== config.attemptId)) return;
        if (data.type === 'error') { failure(data); return; }
        if (config.modelFallback && config.variant) {
          // Once the last tile is done, deliver the result; null keeps it closed.
          if (data.type === 'photo4x-budget' && data.done) {
            budgetTimer?.cancel();
            budgetTimer = null;
          } else if (data.type === 'photo4x-budget' && budgetTimer === undefined) {
            const elapsed = Number.isFinite(data.elapsedMs) ? Math.max(0, data.elapsedMs) : 0;
            budgetTimer = deadline(Math.max(0, PHOTO4X_BUDGET_MS - elapsed), () => { if (current()) failure({code: 'budget', key: 'err_speed'}); });
          }
          if (data.operation === 'calibrate' && calibrationTimer === undefined) {
            calibrationTimer = deadline(PHOTO4X_CALIBRATION_MS, () => { if (current()) failure({code: 'budget', key: 'err_speed'}); });
          } else if (data.operation !== 'calibrate' && calibrationTimer !== undefined) {
            calibrationTimer.cancel(); calibrationTimer = undefined;
          }
        }
        if (config.backend === 'wasm' && config.threads > 1 && data.type === 'status' &&
            data.operation === 'initialize' && data.completed === 1 && data.effectiveThreads === 1 && !config.unavailable) {
          config.unavailable = true;
          onRuntimeFailure(config, {code: 'runtime', key: 'threads_unavailable'});
        }
        if (data.operation) {
          const next = {...operation, operation: data.operation, model: data.model || operation.model,
            backend: data.backend || operation.backend, pixels: data.pixels || 0};
          const nextEvidence = JSON.stringify([next.operation, next.model, data.unit, data.progress, data.completed, data.receivedBytes]);
          if (nextEvidence !== evidence) {
            operation = next; evidence = nextEvidence; remaining = timeoutFor(operation); arm();
          }
        }
        if (['done', 'faces', 'enhanced', 'applied', 'benchmark'].includes(data.type)) { active = false; terminate(); }
        onMessage(data, config);
      };
      worker.onerror = event => { event.preventDefault?.(); if (current()) failure({code: 'runtime', key: 'err_task_stopped',
        ...errorDetails(event.error || event.message || 'Worker stopped without an exception'),
        error_line: event.lineno, error_column: event.colno}); };
      worker.onmessageerror = () => { if (current()) failure({code: 'runtime', key: 'err_result_read'}); };
      worker.postMessage({...payload, execution: config, hidden: paused});
      arm();
    } catch (error) { failure({code: 'runtime', key: 'err_worker_start', ...errorDetails(error)}); }
  }
  function failure(error) {
    if (!active) return;
    error = {...error, operation: operation.operation, model: operation.model, backend: config.backend,
      requested_threads: config.threads, attempt_index: attemptIndex};
    const modelFallback = config.modelFallback && config.variant &&
      ['decode', 'scan', 'prepare-rgb', 'initialize', 'download', 'probe', 'calibrate', 'tile', 'composite', 'encode'].includes(operation.operation) &&
      ['gpu', 'runtime', 'timeout', 'download', 'budget', 'export'].includes(error.code);
    const retryable = modelFallback || (RETRY_OPERATIONS.has(operation.operation) &&
      ['gpu', 'runtime', 'timeout'].includes(error.code));
    if (modelFallback && ['gpu', 'runtime', 'timeout', 'download', 'export'].includes(error.code) && config.failureKey) onRuntimeFailure(config, error);
    if (retryable && config.backend === 'wasm' && config.threads > 1) onRuntimeFailure(config, error);
    if (retryable && attemptIndex + 1 < attempts.length) {
      onRetry({from: {...config}, to: {...attempts[attemptIndex + 1]}, error});
      advance(); return;
    }
    active = false; terminate();
    onFailure({...error, key: error.key || 'err_finish'}, config);
  }
  return {
    start(request, choices) {
      this.cancel(); payload = request;
      attempts = choices.filter((a, i, all) => all.findIndex(b => a.backend === b.backend && a.threads === b.threads &&
        variantKey(a.variant, a.backend) === variantKey(b.variant, b.backend)) === i);
      if (!attempts.length) throw new Error('An execution attempt is required');
      attemptIndex = -1; advance();
    },
    cancel() { run++; active = false; terminate(); },
    setHidden(hidden) {
      if (hidden === paused) return;
      if (hidden && active && timer !== undefined) remaining = Math.max(0, remaining - (now() - startedAt));
      paused = hidden;
      hidden ? clearTimer() : arm();
      for (const timer of [budgetTimer, calibrationTimer]) hidden ? timer?.pause() : timer?.resume();
      if (active && config.variant) worker?.postMessage({type: 'visibility', hidden});
    },
    get current() { return config; },
    get active() { return active; },
  };
}
