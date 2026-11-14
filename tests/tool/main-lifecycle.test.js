import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as capability from '../../src/tool/capability.js';
import * as pricing from '../../src/tool/cloud-pricing.js';
import * as models from '../../src/tool/model-selection.js';

// Run the page and its real cloud controls together. Replace browser/IO
// boundaries so delayed storage and identity answers are deterministic.
const pageSource = readFileSync(new URL('../../src/tool/main.js', import.meta.url), 'utf8');
const cloudSource = readFileSync(new URL('../../src/tool/cloud.js', import.meta.url), 'utf8');
const script = source => source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')
  .replaceAll('import.meta.url', JSON.stringify(import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
const photo = name => new File(['photo'], name, {type: 'image/jpeg'});

class Node {
  constructor() {
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = new Map();
    this.classList = {toggle() {}, add() {}, remove() {}};
    this.style = {setProperty() {}};
    this.checked = false;
    this.hidden = false;
    this.textContent = '';
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  async emit(type, extra = {}) {
    const event = {target: this, button: 0, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra};
    for (const listener of this.listeners.get(type) || []) await listener(event);
    await tick();
  }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  querySelector() { return this.caption ||= new Node(); }
  closest(selector) { return selector === 'a[data-tool-mode]' && this.dataset.toolMode ? this : null; }
  focus() {}
  scrollIntoView() {}
}

function boot({page = 'free', handoff = {async take() { return null; }}} = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id);
  };
  node('main-content').dataset = {page, mode: page === 'hub' || page === 'free' ? 'device' : page};
  node('enhance-faces').checked = true;
  node('handoff-note').hidden = true;
  const links = (page === 'hub' ? ['device', 'creative', 'restore'] : ['picker']).map(mode => {
    const link = node(`link-${mode}`);
    link.dataset.toolMode = mode;
    link.pathname = mode === 'picker' ? '/upscale/' : `/upscale/${mode === 'device' ? 'free' : mode}/`;
    link.href = `https://upscales.app${link.pathname}`;
    return link;
  });
  const resolutions = ['2k', '4k', '8k'].map(value => {
    const button = node(`resolution-${value}`);
    button.dataset.resolution = value;
    return button;
  });
  const restores = pricing.RESTORE_MODES.map(value => {
    const button = node(`restore-${value}`);
    button.dataset.restoreMode = value;
    return button;
  });
  const document = Object.assign(new Node(), {
    documentElement: {lang: 'en'}, getElementById: node,
    querySelectorAll: selector => selector === '[data-resolution]' ? resolutions
      : selector === '[data-restore-mode]' ? restores : selector === 'a[data-tool-mode]' ? links : [],
  });
  const listeners = new Set();
  const state = {known: false, identity: null, balance: null, prices: null};
  const session = {state, start() {}, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    signInUrl: path => `/account/?next=${encodeURIComponent(path)}`};
  const navigation = [], processed = [], memory = new Map();
  const window = new Node();
  const context = vm.createContext({
    ...capability, ...pricing, ...models,
    document, window, navigator: {userAgent: 'test', platform: 'MacIntel'},
    location: {pathname: page === 'hub' ? '/upscale/' : `/upscale/${page}/`, assign: url => navigation.push(url)},
    localStorage: {getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key)},
    URL, setTimeout, clearTimeout, performance, isSecureContext: true,
    Worker: class {}, createImageBitmap() {}, OffscreenCanvas: class {},
    ResizeObserver: class { observe() {} },
    pageTranslator: () => ({t: key => key, duration: String}),
    initAnalytics: () => ({trackAction() {}, trackEvent() {}, trackScreen() {}, flush() {}}),
    AnalyticsAction: {}, AnalyticsEvent: {}, SCREEN: 'upscale', installErrorDiagnostics() {},
    createComparison: () => ({reset() {}}), createPanZoom: () => ({reset() {}, clamp() {}}),
    createOverlay: () => ({open() {}, close() {}}),
    createTopUp: () => ({isOpen: () => false, reason: () => undefined}),
    createSession: () => session, createHandoff: () => handoff,
    inspectFile: async () => ({width: 300, height: 200, size: 5}),
    recordRun: options => processed.push(options),
  });
  vm.runInContext(script(cloudSource), context, {filename: 'cloud.js'});
  vm.runInContext(`const controller = createCloud;
    createCloud = hooks => {
      const cloud = controller(hooks);
      cloud.start = () => recordRun(cloud.getOptions());
      return cloud;
    };`, context);
  vm.runInContext(script(pageSource), context, {filename: 'main.js'});
  return {
    node, navigation, processed,
    async choose(file) { node('photo-input').files = [file]; await node('photo-input').emit('change'); },
    navigate(mode, event = {}) { return document.emit('click', {target: node(`link-${mode}`), ...event}); },
    pagehide() { return window.emit('pagehide'); },
    pageshow() { return window.emit('pageshow', {persisted: true}); },
    async signedIn() { Object.assign(state, {known: true, identity: {uid: 'user'}}); for (const listener of listeners) listener(state); await tick(); },
    async signedOut() { Object.assign(state, {known: true, identity: null}); for (const listener of listeners) listener(state); await tick(); },
  };
}

test('late handoff cannot replace a newly selected photo or its settings', async () => {
  let deliver;
  const app = boot({handoff: {take: () => new Promise(resolve => { deliver = resolve; })}});
  await app.choose(photo('new.jpg'));
  app.node('enhance-faces').checked = false;
  deliver({file: photo('old.jpg'), settings: {mode: 'device', scale: 4, enhanceFaces: true}});
  await tick();
  assert.equal(app.node('source-name').textContent, 'new.jpg');
  assert.equal(app.node('enhance-faces').checked, false);
  assert.equal(app.node('scale-2x').attributes.get('aria-pressed'), 'true');
});

test('removing a photo while storage is pending prevents its later restoration', async () => {
  let deliver;
  const app = boot({handoff: {take: () => new Promise(resolve => { deliver = resolve; })}});
  await app.choose(photo('new.jpg'));
  await app.node('remove-photo').emit('click');
  deliver({file: photo('old.jpg'), settings: {mode: 'device'}});
  await tick();
  assert.equal(app.node('selected-photo').hidden, true);
  assert.equal(app.node('process-photo').hidden, true);
});

test('face enhancement stays off across the tool, picker and tool round trip', async () => {
  let record;
  const handoff = {async save(value) { record = value; return true; }, async take() { const result = record; record = null; return result; }};
  const first = boot({handoff});
  await tick();
  await first.choose(photo('portrait.jpg'));
  first.node('enhance-faces').checked = false;
  await first.node('enhance-faces').emit('change');
  await first.node('scale-4x').emit('click');
  await first.navigate('picker');
  const hub = boot({page: 'hub', handoff});
  await tick();
  await hub.navigate('device');
  const returned = boot({handoff});
  await tick();
  assert.equal(returned.node('source-name').textContent, 'portrait.jpg');
  assert.equal(returned.node('enhance-faces').checked, false);
  assert.equal(returned.node('scale-4x').attributes.get('aria-pressed'), 'true');
});

test('handoffs without a face setting keep the default enabled', async () => {
  const app = boot({handoff: {async take() { return {file: photo('old.jpg'), settings: {mode: 'device'}}; }}});
  await tick();
  assert.equal(app.node('enhance-faces').checked, true);
});

test('a quick tool link waits for the incoming photo and carries it to the destination', async () => {
  let deliver, record;
  const handoff = {
    take() {
      if (record) { const arrived = record; record = null; return Promise.resolve(arrived); }
      return new Promise(resolve => { deliver = resolve; });
    },
    async save(value) { record = value; return true; },
  };
  const hub = boot({page: 'hub', handoff});
  let prevented = false;
  const navigation = hub.navigate('creative', {preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.equal(hub.navigation.length, 0);
  let repeatedPrevented = false;
  await hub.navigate('restore', {preventDefault() { repeatedPrevented = true; }});
  assert.equal(repeatedPrevented, true);
  assert.equal(hub.navigation.length, 0);
  deliver({file: photo('portrait.jpg'), settings: {mode: 'creative', cloud: {creative: {resolution: '8k'}}}});
  await navigation;
  assert.deepEqual(hub.navigation, ['https://upscales.app/upscale/creative/']);
  const destination = boot({page: 'creative', handoff});
  await tick();
  assert.equal(destination.node('source-name').textContent, 'portrait.jpg');
  assert.equal(destination.node('resolution-8k').attributes.get('aria-pressed'), 'true');
});

for (const outcome of ['empty', 'failed', 'rejected']) {
  test(`a pending tool link still navigates after an ${outcome} handoff`, async () => {
    let deliver, reject;
    const hub = boot({page: 'hub', handoff: {take: () => new Promise((resolve, fail) => { deliver = resolve; reject = fail; })}});
    const navigation = hub.navigate('device');
    assert.equal(hub.navigation.length, 0);
    if (outcome === 'rejected') reject(new Error('storage unavailable'));
    else deliver(outcome === 'empty' ? null : {failed: true});
    await navigation;
    assert.deepEqual(hub.navigation, ['https://upscales.app/upscale/free/']);
  });
}

test('a quick Back link carries the restored photo and its settings through the picker', async () => {
  let deliver, record;
  const handoff = {
    take() {
      if (record) { const arrived = record; record = null; return Promise.resolve(arrived); }
      return new Promise(resolve => { deliver = resolve; });
    },
    async save(value) { record = value; return true; },
  };
  const tool = boot({page: 'creative', handoff});
  const navigation = tool.navigate('picker');
  assert.equal(tool.navigation.length, 0);
  deliver({file: photo('portrait.jpg'), settings: {mode: 'creative', cloud: {creative: {resolution: '8k'}}}});
  await navigation;
  const hub = boot({page: 'hub', handoff});
  await tick();
  await hub.navigate('creative');
  const returned = boot({page: 'creative', handoff});
  await tick();
  assert.equal(returned.node('source-name').textContent, 'portrait.jpg');
  assert.equal(returned.node('resolution-8k').attributes.get('aria-pressed'), 'true');
});

for (const [control, event, change, model, scale, enhanceFaces] of [
  ['model-photo', 'click', () => {}, 'photo', 4, false],
  ['scale-2x', 'click', () => {}, 'drawing', 2, false],
  ['enhance-faces', 'change', node => { node.checked = true; }, 'drawing', 4, true],
]) {
  test(`${control} chosen before handoff wins while untouched device settings are restored`, async () => {
    let deliver;
    const app = boot({handoff: {take: () => new Promise(resolve => { deliver = resolve; })}});
    change(app.node(control));
    await app.node(control).emit(event);
    deliver({file: photo('portrait.jpg'), settings: {mode: 'device', modelKind: 'drawing', scale: 4, enhanceFaces: false}});
    await tick();
    assert.equal(app.node('source-name').textContent, 'portrait.jpg');
    assert.equal(app.node(`model-${model}`).attributes.get('aria-pressed'), 'true');
    assert.equal(app.node(`scale-${scale}x`).attributes.get('aria-pressed'), 'true');
    assert.equal(app.node('enhance-faces').checked, enhanceFaces);
  });
}

for (const [page, control, event, change, group, field, expected] of [
  ['creative', 'resolution-8k', 'click', () => {}, 'creative', 'resolution', '8k'],
  ['creative', 'creativity', 'input', node => { node.value = '2'; }, 'creative', 'creativity', 2],
  ['restore', 'negative', 'change', node => { node.checked = false; }, 'restore', 'negative', false],
  ['restore', 'increase-resolution', 'change', node => { node.checked = false; }, 'restore', 'increaseResolution', false],
  ['restore', 'restore-restore', 'click', () => {}, 'restore', 'mode', 'restore'],
  ['restore', 'restore-prompt', 'input', node => { node.value = 'new prompt'; }, 'restore', 'prompt', 'new prompt'],
]) {
  test(`${control} chosen before handoff wins while untouched cloud settings are restored`, async () => {
    let deliver;
    const app = boot({page, handoff: {take: () => new Promise(resolve => { deliver = resolve; })}});
    change(app.node(control));
    await app.node(control).emit(event);
    const saved = {creative: {resolution: '2k', creativity: -1},
      restore: {mode: 'colorization', negative: true, increaseResolution: true, prompt: 'saved prompt'}};
    deliver({file: photo('portrait.jpg'), settings: {mode: page, cloud: saved}});
    await tick();
    await app.signedIn();
    await app.node('process-photo').emit('click');
    assert.equal(app.processed.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(app.processed[0])),
      {...saved, [group]: {...saved[group], [field]: expected}});
  });
}

for (const [page, control, event, change] of [
  ['creative', 'resolution-8k', 'click', () => {}],
  ['creative', 'creativity', 'input', node => { node.value = '2'; }],
  ['restore', 'negative', 'change', node => { node.checked = true; }],
  ['restore', 'increase-resolution', 'change', node => { node.checked = true; }],
  ['restore', 'restore-colorization', 'click', () => {}],
  ['restore', 'restore-prompt', 'input', node => { node.value = 'restore colors'; }],
]) {
  test(`${control} edits cancel a pending sign-in start and allow a new click`, async () => {
    const app = boot({page});
    await tick();
    await app.choose(photo('portrait.jpg'));
    await app.node('process-photo').emit('click');
    assert.equal(app.node('process-photo').disabled, true);
    change(app.node(control));
    await app.node(control).emit(event);
    assert.equal(app.node('process-photo').disabled, false);
    await app.signedIn();
    assert.equal(app.processed.length, 0);
    await app.node('process-photo').emit('click');
    assert.equal(app.processed.length, 1);
  });
}

test('an unchanged pending click resumes once identity is known', async () => {
  const app = boot({page: 'creative'});
  await tick();
  await app.choose(photo('portrait.jpg'));
  await app.node('process-photo').emit('click');
  await app.signedIn();
  assert.equal(app.processed.length, 1);
});

test('a new pending click does not revive the cancelled request', async () => {
  const app = boot({page: 'creative'});
  await tick();
  await app.choose(photo('portrait.jpg'));
  await app.node('process-photo').emit('click');
  await app.node('resolution-8k').emit('click');
  await app.node('process-photo').emit('click');
  await app.signedIn();
  assert.equal(app.processed.length, 1);
  assert.equal(app.processed[0].creative.resolution, '8k');
});

for (const identity of ['signedIn', 'signedOut']) {
  test(`Back cancels a pending start while saving the photo (${identity})`, async () => {
    let finishSave;
    const app = boot({page: 'creative', handoff: {
      async take() { return null; },
      save() { return new Promise(resolve => { finishSave = resolve; }); },
    }});
    await tick();
    await app.choose(photo('portrait.jpg'));
    await app.node('process-photo').emit('click');
    const navigation = app.navigate('picker');
    await tick();
    assert.equal(typeof finishSave, 'function');
    await app[identity]();
    // Even a second Start click during the save cannot send a paid request.
    await app.node('process-photo').emit('click');
    assert.equal(app.processed.length, 0);
    assert.deepEqual(app.navigation, []);
    finishSave(true);
    await navigation;
    assert.deepEqual(app.navigation, ['https://upscales.app/upscale/']);
  });
}

test('Back cancels a pending start before the incoming handoff finishes', async () => {
  let deliver;
  const app = boot({page: 'creative', handoff: {
    take() { return new Promise(resolve => { deliver = resolve; }); },
    async save() { return true; },
  }});
  await app.choose(photo('portrait.jpg'));
  await app.node('process-photo').emit('click');
  const navigation = app.navigate('picker');
  await app.signedIn();
  await app.node('process-photo').emit('click');
  assert.equal(app.processed.length, 0);
  deliver(null);
  await navigation;
  assert.deepEqual(app.navigation, ['https://upscales.app/upscale/']);
});

for (const identity of ['signedIn', 'signedOut']) {
  test(`BFCache restoration does not resume the old Start click (${identity})`, async () => {
    const app = boot({page: 'creative'});
    await tick();
    await app.choose(photo('portrait.jpg'));
    await app.node('process-photo').emit('click');
    await app.pagehide();
    await app.pageshow();
    await app[identity]();
    assert.equal(app.processed.length, 0);
    assert.deepEqual(app.navigation, []);
    assert.equal(app.node('process-photo').disabled, false);
    assert.equal(app.node('source-name').textContent, 'portrait.jpg');
    if (identity === 'signedIn') {
      await app.node('process-photo').emit('click');
      assert.equal(app.processed.length, 1);
    }
  });
}
