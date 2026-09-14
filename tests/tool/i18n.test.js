import test from 'node:test';
import assert from 'node:assert/strict';
import {translator} from '../../src/tool/i18n.js';

test('copy fills named params and leaves unknown keys readable', () => {
  const {t} = translator({upscale_button: 'Upscale photo · {scale}×', enhancing_face: 'Face {current} of {total}'});
  assert.equal(t('upscale_button', {scale: 4}), 'Upscale photo · 4×');
  assert.equal(t('enhancing_face', {current: 1}), 'Face 1 of {total}');
  assert.equal(t('missing_key'), 'missing_key');
});

test('durations take the locale plural form from Intl', () => {
  const ru = translator({about: 'примерно {time}'}, 'ru');
  assert.equal(ru.duration(90_000), 'примерно 2 минуты');
  assert.equal(ru.duration(300_000), 'примерно 5 минут');
  assert.equal(translator({about: 'about {time}'}, 'en').duration(12_000), 'about 15 seconds');
  assert.equal(translator({about: '約{time}'}, 'ja').duration(20_000), '約20秒');
});
