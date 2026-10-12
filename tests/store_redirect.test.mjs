import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_STORE_URL, PLAY_STORE_URL, detectPlatform, playStoreURL } from '../static/go/links.mjs';

test('iPhone, iPad including desktop mode, Android and desktops select the right platform', () => {
  assert.equal(detectPlatform({ userAgent: 'iPhone OS 18_0' }), 'ios');
  assert.equal(detectPlatform({ userAgent: 'iPad' }), 'ios');
  assert.equal(detectPlatform({ userAgent: 'Macintosh', maxTouchPoints: 5 }), 'ios');
  assert.equal(detectPlatform({ userAgent: 'Macintosh', maxTouchPoints: 0 }), 'other');
  assert.equal(detectPlatform({ userAgent: 'Linux; Android 16' }), 'android');
  assert.equal(detectPlatform({ userAgent: '', userAgentData: { platform: 'Android' } }), 'android');
  assert.equal(detectPlatform({ userAgent: 'Windows NT 10.0' }), 'other');
  assert.equal(detectPlatform({}), 'other');
});

test('Android campaign/ad values survive both levels of Play referrer encoding', () => {
  const fields = { utm_source: 'reddit', utm_medium: 'paid_social', utm_campaign: 'Summer & 秋', utm_content: 'before/after', utm_term: 'a+b', utm_id: 'campaign_1', ad_id: 'ad_2', adset_id: 'group_3' };
  const url = new URL(playStoreURL(new URLSearchParams(fields).toString()));
  const referrer = new URLSearchParams(url.searchParams.get('referrer'));
  for (const [key, value] of Object.entries(fields)) assert.equal(referrer.get(key), value);
  assert.equal(url.origin + url.pathname, 'https://play.google.com/store/apps/details');
  assert.equal(url.searchParams.get('id'), 'com.uscale');
});

test('unknown parameters cannot redirect visitors or enter the attribution payload', () => {
  assert.equal(playStoreURL('?redirect=https://evil.test&fbclid=secret&email=test&referrer=evil'), PLAY_STORE_URL);
  assert.equal(playStoreURL(''), PLAY_STORE_URL);
  assert.equal(new URL(APP_STORE_URL).search, '');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(new URL(playStoreURL('?creative=post_1')).searchParams.get('referrer'))), { utm_content: 'post_1' });
  const referrer = new URLSearchParams(new URL(playStoreURL('?utm_content=canonical&creative=alias')).searchParams.get('referrer'));
  assert.equal(referrer.get('utm_content'), 'canonical');
});

test('campaign values are cleaned and bounded without splitting Unicode', () => {
  const url = new URL(playStoreURL(new URLSearchParams({ utm_source: '\u0000 reddit \n', utm_campaign: '🖼'.repeat(500) }).toString()));
  const referrer = new URLSearchParams(url.searchParams.get('referrer'));
  assert.equal(referrer.get('utm_source'), 'reddit');
  assert.ok(encodeURIComponent(referrer.get('utm_campaign')).length <= 120);
  assert.ok(!referrer.get('utm_campaign').includes('�'));
});
