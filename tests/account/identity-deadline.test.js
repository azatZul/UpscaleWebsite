import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';

// identity.js talks to a provider it downloads at runtime, which a test cannot
// load. So load the real module with that one function replaced: a provider
// that never answers, and one that fails. Everything else -- the deadline, the
// publishing, the stalled flag -- is the shipped code.
const SOURCE = new URL('../../static/account/identity.js', import.meta.url);
const MODEL = new URL('../../static/account/identity-model.js', import.meta.url);

function loadWith(sdkBody, deadlineMs = 120) {
  const source = readFileSync(SOURCE, 'utf8');
  const start = source.indexOf('function sdk() {');
  const end = source.indexOf('\n}\n', start) + 3;
  assert.ok(start > 0 && end > start, 'found the provider loader to replace');
  const patched = (source.slice(0, start) + `function sdk() {\n${sdkBody}\n}\n` + source.slice(end))
    .replace('const RESOLUTION_DEADLINE_MS = 10_000;', `const RESOLUTION_DEADLINE_MS = ${deadlineMs};`)
    .replace("import {FIREBASE_CONFIG, FIREBASE_SDK_VERSION} from './firebase-config.js';", '')
    .replace("from './identity-model.js';", `from ${JSON.stringify(MODEL.href)};`);
  assert.ok(patched.includes(`RESOLUTION_DEADLINE_MS = ${deadlineMs}`), 'the deadline is still a named constant');
  const file = join(mkdtempSync(join(tmpdir(), 'uscale-identity-')), 'identity.js');
  writeFileSync(file, patched);
  return import(pathToFileURL(file).href);
}

const firstAnswer = (module, timeoutMs = 3000) => new Promise(resolve => {
  const started = Date.now();
  module.onIdentityChanged(identity => resolve({identity, stalled: module.identityStalled(), ms: Date.now() - started}));
  setTimeout(() => resolve({timedOut: true}), timeoutMs);
});

test('a provider that never answers stops being waited on', async () => {
  // Without the deadline this hangs, and every page sits on "checking sign-in"
  // with nothing to click -- which is exactly what it used to do.
  const module = await loadWith('  return new Promise(() => {});');
  const answer = await firstAnswer(module);
  assert.equal(answer.timedOut, undefined, 'the listener was called');
  assert.equal(answer.identity, null, 'carries on as signed out');
  assert.equal(answer.stalled, true, 'and says the answer came from the deadline');
});

test('a provider that fails is a real answer, not a stalled one', async () => {
  const module = await loadWith('  return Promise.reject(new Error("blocked"));');
  const answer = await firstAnswer(module);
  assert.equal(answer.identity, null);
  assert.equal(answer.stalled, false, 'a failure means signed out, so the page may go to sign-in');
});
