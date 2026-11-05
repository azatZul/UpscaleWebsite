// This page deliberately has no analytics, account integration or network code.
// Theme toggle, mirroring site.js (which this page does not load).
(() => {
  const KEY = 'uscale-theme';
  const BG = { dark: '#07080d', light: '#f3f6fe' };
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const btn = document.querySelector('.theme-btn');
  let timer;
  const stored = () => {
    try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; }
    catch (e) { return null; }
  };
  const current = () => root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const apply = (theme, animate) => {
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.classList.add('theme-anim');
      clearTimeout(timer);
      timer = setTimeout(() => root.classList.remove('theme-anim'), 560);
    }
    root.setAttribute('data-theme', theme);
    if (meta) meta.setAttribute('content', BG[theme]);
    if (btn) {
      const label = theme === 'light' ? btn.dataset.dark : btn.dataset.light;
      btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
  };
  apply(current(), false);
  if (btn) btn.addEventListener('click', () => {
    const theme = current() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    apply(theme, true);
    btn.classList.remove('flip');
    void btn.offsetWidth; // Restart the pulse animation.
    btn.classList.add('flip');
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    if (!stored()) apply(e.matches ? 'light' : 'dark', true);
  });
  window.addEventListener('storage', e => {
    if (e.key === KEY && (e.newValue === 'light' || e.newValue === 'dark')) apply(e.newValue, true);
  });
})();

(() => {
  const cmp = document.querySelector('.error-comparison');
  const input = document.querySelector('#clarity');
  const sharp = cmp && cmp.querySelector('.error-sharp');
  const pixels = cmp && cmp.querySelector('.error-pixels');
  if (!cmp || !input || !sharp || !pixels || !sharp.getContext) return;

  const off = document.createElement('canvas');
  let sharpCtx, pixelsCtx, sampleCtx;
  try {
    sharpCtx = sharp.getContext('2d');
    pixelsCtx = pixels.getContext('2d');
    sampleCtx = off.getContext('2d', { willReadFrequently: true });
  } catch (e) { return; }
  if (!sharpCtx || !pixelsCtx || !sampleCtx) return;
  let failed = false;

  const TEXT = '404';
  const font = size => `800 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');

  const hex = value => {
    const v = value.trim().replace('#', '');
    const n = parseInt(v.length === 3 ? v.replace(/./g, c => c + c) : v, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const rgba = (c, a) => `rgba(${c.map(Math.round).join(',')},${a})`;
  const tokens = () => {
    const css = getComputedStyle(document.body);
    const get = name => hex(css.getPropertyValue(name) || '#ffd621');
    return { top: get('--nf-top'), mid: get('--nf-mid'), low: get('--nf-low'),
      dull: get('--nf-dull'), grid: get('--nf-grid'), glow: get('--nf-glow'),
      gridAlpha: parseFloat(css.getPropertyValue('--nf-grid-alpha')) || .05,
      glowAlpha: parseFloat(css.getPropertyValue('--nf-glow-alpha')) || .4 };
  };
  const ramp = (t, k) => t < .5 ? mix(k.top, k.mid, t * 2) : mix(k.mid, k.low, (t - .5) * 2);

  // Glyphs are placed one by one so both canvases share identical, tight spacing.
  const metrics = (() => {
    const ctx = sampleCtx;
    ctx.font = font(100);
    const widths = [...TEXT].map(ch => ctx.measureText(ch).width);
    const m = ctx.measureText(TEXT);
    const gap = -5;
    return { widths, gap, total: widths.reduce((a, b) => a + b) + gap * (TEXT.length - 1),
      ascent: m.actualBoundingBoxAscent || 72, descent: m.actualBoundingBoxDescent || 0 };
  })();
  const layout = (w, h) => {
    const scale = Math.min(w * .9 / metrics.total, h * .72 / (metrics.ascent + metrics.descent));
    const size = 100 * scale;
    const top = (h - (metrics.ascent + metrics.descent) * scale) / 2;
    const baseline = top + metrics.ascent * scale;
    let x = (w - metrics.total * scale) / 2;
    const xs = metrics.widths.map(width => { const at = x; x += (width + metrics.gap) * scale; return at; });
    return { size, xs, baseline, top, bottom: baseline + metrics.descent * scale };
  };
  const glyphs = (ctx, L) => {
    ctx.font = font(L.size);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    [...TEXT].forEach((ch, i) => ctx.fillText(ch, L.xs[i], L.baseline));
  };

  // Deterministic noise keeps the mosaic stable across redraws.
  const noise = (x, y, s) => {
    const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };

  let W = 0, H = 0, cells = [], cell = 0, colors = tokens(), L;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const prepare = (canvas, ctx) => {
    const r = dpr();
    canvas.width = Math.round(W * r);
    canvas.height = Math.round(H * r);
    ctx.setTransform(r, 0, 0, r, 0, 0);
    return ctx;
  };

  const drawSharp = () => {
    const ctx = prepare(sharp, sharpCtx);
    const k = colors;
    const fill = ctx.createLinearGradient(0, L.top, 0, L.bottom);
    fill.addColorStop(0, rgba(k.top, 1));
    fill.addColorStop(.5, rgba(k.mid, 1));
    fill.addColorStop(1, rgba(k.low, 1));
    ctx.fillStyle = fill;
    ctx.shadowColor = rgba(k.glow, k.glowAlpha);
    ctx.shadowBlur = L.size * .14;
    glyphs(ctx, L);
    ctx.shadowBlur = 0;
    // A soft top highlight gives the crisp side a little polish.
    ctx.globalCompositeOperation = 'source-atop';
    const shine = ctx.createLinearGradient(0, L.top, 0, L.top + (L.bottom - L.top) * .45);
    shine.addColorStop(0, 'rgba(255,255,255,.35)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  };

  // Rasterize the same digits at grid resolution and keep each cell's coverage.
  const sample = () => {
    cell = Math.max(8, Math.round(H / 19));
    const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
    const ox = (W - cols * cell) / 2, oy = (H - rows * cell) / 2;
    const S = 6;
    off.width = cols * S; off.height = rows * S;
    const ctx = sampleCtx;
    ctx.setTransform(S / cell, 0, 0, S / cell, -ox * S / cell, -oy * S / cell);
    ctx.fillStyle = '#000';
    glyphs(ctx, L);
    const data = ctx.getImageData(0, 0, off.width, off.height).data;
    const cover = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) sum += data[((r * S + y) * off.width + c * S + x) * 4 + 3];
      cover[r * cols + c] = sum / (S * S * 255);
    }
    const at = (c, r) => c < 0 || r < 0 || c >= cols || r >= rows ? 0 : cover[r * cols + c];
    cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = ox + c * cell, y = oy + r * cell;
      let v = at(c, r);
      // Blocky compression: coverage snaps to a few levels, and stray blocks bleed off edges.
      if (v > .12) v = v > .55 ? 1 : v > .3 ? .6 : .3;
      else {
        const near = Math.max(at(c - 1, r), at(c + 1, r), at(c, r - 1), at(c, r + 1));
        v = near > .5 && noise(c, r, 1) < .12 ? .15 : 0;
      }
      cells.push({ x, y, v, t: (y + cell / 2 - L.top) / (L.bottom - L.top), seed: noise(c, r, 2), c, r });
    }
  };

  const drawPixels = () => {
    const ctx = prepare(pixels, pixelsCtx);
    const k = colors;
    const pad = Math.max(1.5, cell * .1);
    const size = cell - pad, radius = cell * .16;
    const cx = W / 2, cy = H / 2;
    for (const p of cells) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(p.x + pad / 2, p.y + pad / 2, size, size, radius);
      else ctx.rect(p.x + pad / 2, p.y + pad / 2, size, size);
      if (p.v) {
        // Muted, slightly off-palette tones read as a low-quality source.
        const base = mix(ramp(Math.max(0, Math.min(1, p.t)), k), k.dull, .42);
        const shade = .86 + p.seed * .24;
        ctx.fillStyle = rgba(base.map(v => Math.min(255, v * shade)), (.2 + .8 * p.v).toFixed(3));
      } else {
        // Faint sensor grid, fading toward the edges.
        const dx = (p.x + cell / 2 - cx) / (W / 2), dy = (p.y + cell / 2 - cy) / (H / 2);
        const fade = Math.max(0, 1 - Math.hypot(dx, dy * .9));
        if (fade <= 0) continue;
        ctx.fillStyle = rgba(k.grid, (k.gridAlpha * fade).toFixed(3));
      }
      ctx.fill();
    }
  };

  const render = () => {
    if (failed) return false;
    const r = cmp.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    try {
      W = r.width; H = r.height;
      colors = tokens();
      L = layout(W, H);
      drawSharp();
      sample();
      drawPixels();
    } catch (e) {
      failed = true;
      cmp.classList.remove('is-live');
      input.disabled = true;
      return false;
    }
    cmp.classList.add('is-live');
    input.disabled = false;
    return true;
  };
  if (!render()) return;

  // Divider: idle drift like the home hero, follows a hovering mouse, drags on touch.
  let pos = 50, aim = 50, hover = false, dragging = false, focused = false, hold = 0, t0 = 0, raf = 0;
  const setPos = p => {
    pos = Math.max(0, Math.min(100, p));
    cmp.style.setProperty('--split', `${pos}%`);
  };
  const pointerPos = e => {
    const r = cmp.getBoundingClientRect();
    return Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
  };
  const frame = t => {
    raf = 0;
    if (failed) return;
    if (!t0) t0 = t;
    const chase = hover || dragging || focused || t < hold;
    const goal = chase ? aim : (calm.matches ? 50 : 50 * (1 + .46 * Math.sin((t - t0) / 2450)));
    // Keep the range at its target so native keyboard steps accumulate while
    // the visual divider is still catching up.
    const whole = String(Math.round(goal));
    if (input.value !== whole) input.value = whole;
    let next = pos + (goal - pos) * (chase ? .18 : .06);
    if (Math.abs(goal - pos) < .04) next = goal;
    if (next !== pos) setPos(next);
    if (!document.hidden) raf = requestAnimationFrame(frame);
  };
  const run = () => { if (!failed && !raf && !document.hidden) raf = requestAnimationFrame(frame); };

  cmp.addEventListener('pointerenter', e => {
    if (!fine.matches || e.pointerType === 'touch') return;
    hover = true; aim = pointerPos(e); run();
  });
  cmp.addEventListener('pointermove', e => {
    if (!hover && !dragging) return;
    aim = pointerPos(e);
    if (dragging && e.cancelable) e.preventDefault();
  });
  cmp.addEventListener('pointerleave', () => { hover = false; t0 = 0; });
  cmp.addEventListener('pointerdown', e => {
    if (typeof e.button === 'number' && e.button !== 0) return;
    dragging = true;
    if (cmp.setPointerCapture) cmp.setPointerCapture(e.pointerId);
    aim = pointerPos(e); run();
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    if (cmp.hasPointerCapture && cmp.hasPointerCapture(e.pointerId)) cmp.releasePointerCapture(e.pointerId);
    hold = performance.now() + 4000;
    t0 = 0;
  };
  cmp.addEventListener('pointerup', end);
  cmp.addEventListener('pointercancel', end);
  input.addEventListener('focus', () => { focused = true; aim = Number(input.value); });
  input.addEventListener('blur', () => { focused = false; t0 = 0; run(); });
  input.addEventListener('input', () => { aim = Number(input.value); hold = performance.now() + 6000; run(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { t0 = 0; run(); } });

  // Quiet shimmer on the pixel side, as if the low-res source were still noisy.
  let tick = 0;
  setInterval(() => {
    if (failed || calm.matches || document.hidden || !cells.length || pos < 2) return;
    tick++;
    for (const p of cells) if (p.v && noise(p.c, p.r, tick) < .05) p.seed = noise(p.c, p.r, tick + .5);
    drawPixels();
  }, 180);

  if (window.ResizeObserver) new ResizeObserver(render).observe(cmp);
  else window.addEventListener('resize', render);
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
  setPos(50);
  run();
})();
