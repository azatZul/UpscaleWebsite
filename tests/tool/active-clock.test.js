import test from 'node:test';
import assert from 'node:assert/strict';
import {createActiveClock} from '../../src/tool/active-clock.js';

test('worker budgets and measurements exclude repeated background intervals', async () => {
  let time = 100;
  const clock = createActiveClock({now: () => time});
  const started = clock.now();
  time = 120; clock.setHidden(true);
  const visible = clock.waitUntilVisible();
  let resumed = false; visible.then(() => { resumed = true; });
  time = 600_120; clock.setHidden(true);
  assert.equal(clock.now() - started, 20);
  await Promise.resolve(); assert.equal(resumed, false);
  clock.setHidden(false); await visible;
  assert.equal(resumed, true);
  time += 10; clock.setHidden(true);
  time += 600_000; clock.setHidden(false); clock.setHidden(false);
  time += 5;
  assert.equal(clock.now() - started, 35);
});

test('a worker created in the background waits for visibility without charging the pause', async () => {
  let time = 0;
  const clock = createActiveClock({now: () => time, hidden: true});
  const first = clock.waitUntilVisible(), second = clock.waitUntilVisible();
  time = 600_000;
  assert.equal(clock.now(), 0);
  clock.setHidden(false); await Promise.all([first, second]);
  time += 20;
  assert.equal(clock.now(), 20);
});
