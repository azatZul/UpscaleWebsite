export const APP_STORE_URL = 'https://apps.apple.com/app/id6736931330';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.uscale';

export function detectPlatform(navigator) {
  const ua = navigator.userAgent || '';
  // iPad's desktop mode reports a Mac user agent but has multiple touch points.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh|MacIntel/i.test(ua + (navigator.platform || '')) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(navigator.userAgentData?.platform || ua)) return 'android';
  return 'other';
}

export function playStoreURL(search) {
  const input = new URLSearchParams(search);
  const referrer = new URLSearchParams();
  // Only Android carries campaign information across installation. Other query
  // parameters cannot change the destination or enter the Play referrer.
  const fields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'ad_id', 'adset_id'];
  for (const key of fields) {
    const raw = input.get(key) || (key === 'utm_content' ? input.get('creative') : '') || '';
    let value = '';
    for (const char of raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()) {
      if (encodeURIComponent(value + char).length > 120) break;
      value += char;
    }
    if (value) referrer.set(key, value);
  }
  const url = new URL(PLAY_STORE_URL);
  if (referrer.size) url.searchParams.set('referrer', referrer.toString());
  return url.href;
}
