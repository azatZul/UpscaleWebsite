// This page deliberately has no analytics, account integration or network code.
(() => {
  const comparison = document.querySelector('.error-comparison');
  const input = document.querySelector('#clarity');
  if (!comparison || !input) return;
  input.disabled = false;
  let frame;
  let touched = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const position = value => {
    input.value = String(value);
    comparison.style.setProperty('--split', `${value}%`);
  };
  const stop = () => { touched = true; cancelAnimationFrame(frame); };
  input.addEventListener('pointerdown', stop);
  input.addEventListener('focus', stop);
  input.addEventListener('keydown', stop);
  input.addEventListener('input', () => { stop(); position(Number(input.value)); });
  const start = performance.now();
  const animate = now => {
    if (touched || reduced.matches || document.hidden) { position(50); return; }
    const t = Math.min(1, (now - start) / 2000);
    const points = [50, 20, 80, 50];
    const part = Math.min(2, Math.floor(t * 3));
    const progress = (t * 3 - part);
    const ease = (1 - Math.cos(progress * Math.PI)) / 2;
    position(points[part] + (points[part + 1] - points[part]) * ease);
    if (t < 1) frame = requestAnimationFrame(animate);
  };
  reduced.addEventListener('change', () => { stop(); position(50); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  if (!reduced.matches) frame = requestAnimationFrame(animate);
})();
