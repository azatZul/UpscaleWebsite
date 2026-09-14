// build.py embeds locale strings in #tool-strings so one bundle serves every locale.
const PARAM = /\{(\w+)\}/g;

export function translator(strings = {}, locale = 'en') {
  const t = (key, params = {}) => String(strings[key] ?? key)
    .replace(PARAM, (match, name) => (name in params ? String(params[name]) : match));
  function duration(ms) {
    const seconds = ms < 60_000;
    const value = seconds ? Math.max(5, Math.ceil(ms / 5000) * 5) : Math.ceil(ms / 60_000);
    let text;
    try {
      text = new Intl.NumberFormat(locale, {style: 'unit', unit: seconds ? 'second' : 'minute', unitDisplay: 'long'}).format(value);
    } catch { text = `${value} ${seconds ? 's' : 'min'}`; }
    // CJK writes the unit against the number ("約20秒"), Intl adds a space.
    if (/^(ja|zh|ko)\b/.test(locale)) text = text.replace(/\s+/g, '');
    return t('about', {time: text});
  }
  return {t, duration};
}

export function pageTranslator(document) {
  let strings = {};
  try { strings = JSON.parse(document.getElementById('tool-strings')?.textContent || '{}'); } catch { /* Keys stay readable. */ }
  return translator(strings, document.documentElement.lang || 'en');
}
