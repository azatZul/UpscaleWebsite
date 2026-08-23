/* UScale — upscales.app */
(function () {
  'use strict';

  var now = function () {
    return window.performance && performance.now ? performance.now() : Date.now();
  };
  var matches = function (q) {
    return !!(window.matchMedia && window.matchMedia(q).matches);
  };

  /* nav: shadow on scroll, mobile menu, language menu */
  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('stuck', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  var burger = document.querySelector('.burger');
  var links = document.querySelector('.nav-links');
  if (burger && links) {
    burger.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { links.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); }
    });
  }

  /* theme switch.
     The inline <head> script has already put the right theme on <html> before the
     first paint (stored choice, else the OS preference), so this only wires the
     button up: it flips the theme, remembers the pick for the rest of the site and
     for the next visit, and — as long as nothing was picked — keeps following the OS. */
  var THEME_KEY = 'uscale-theme';
  var THEME_BG = { dark: '#07080d', light: '#f3f6fe' };
  var root = document.documentElement;
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var themeBtn = document.querySelector('.theme-btn');
  var themeTimer;

  var storedTheme = function () {
    try {
      var v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) { return null; }
  };
  var currentTheme = function () {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  };
  var applyTheme = function (theme, animate) {
    var light = theme === 'light';
    if (animate && !matches('(prefers-reduced-motion:reduce)')) {
      /* The colours cross-fade on their own: the palette tokens are registered custom
         properties and :root eases them. Only shadows need a per-element transition,
         which this class turns on for one beat and then takes away again so it never
         interferes with the hover animations. */
      root.classList.add('theme-anim');
      clearTimeout(themeTimer);
      themeTimer = setTimeout(function () { root.classList.remove('theme-anim'); }, 560);
    }
    root.setAttribute('data-theme', theme);
    if (themeMeta) themeMeta.setAttribute('content', THEME_BG[theme]);
    if (themeBtn) {
      var label = light ? themeBtn.dataset.dark : themeBtn.dataset.light;
      themeBtn.setAttribute('aria-pressed', light ? 'true' : 'false');
      themeBtn.setAttribute('aria-label', label);
      themeBtn.setAttribute('title', label);
    }
  };

  applyTheme(currentTheme(), false); /* sync the button with what the head script chose */

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var theme = currentTheme() === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
      applyTheme(theme, true);
      themeBtn.classList.remove('flip');
      void themeBtn.offsetWidth; /* reflow, so a quick second tap replays the pulse */
      themeBtn.classList.add('flip');
    });
  }

  var themeMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme:light)') : null;
  if (themeMQ && themeMQ.addEventListener) {
    themeMQ.addEventListener('change', function (e) {
      if (!storedTheme()) applyTheme(e.matches ? 'light' : 'dark', true);
    });
  }
  /* a pick made in another tab applies here too */
  window.addEventListener('storage', function (e) {
    if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
      applyTheme(e.newValue, true);
    }
  });

  var langBtn = document.querySelector('.lang-btn');
  var langMenu = document.querySelector('.lang-menu');
  if (langBtn && langMenu) {
    langBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = langMenu.classList.toggle('open');
      langBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function () {
      langMenu.classList.remove('open'); langBtn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { langMenu.classList.remove('open'); langBtn.setAttribute('aria-expanded', 'false'); }
    });
  }

  /* home guides: 4 cards on larger screens, 2 on phones, with an animated reveal */
  (function () {
    var list = document.querySelector('.guides-collapsible');
    var toggle = document.querySelector('.guides-toggle');
    if (!list || !toggle) return;
    var cards = [].slice.call(list.children);
    var reduce = matches('(prefers-reduced-motion:reduce)');
    var expanded = false;
    var timer = 0;

    function visibleCount() { return matches('(max-width:760px)') ? 2 : 4; }
    function collapsedHeight() {
      var count = Math.min(visibleCount(), cards.length);
      if (!count) return 0;
      var first = cards[0].getBoundingClientRect();
      var last = cards[count - 1].getBoundingClientRect();
      /* the list is padded so hover lifts are not clipped; border-box height includes it */
      var pad = parseFloat(getComputedStyle(list).paddingTop) || 0;
      return Math.ceil(last.bottom - first.top + pad);
    }
    function setCardAccess() {
      var count = visibleCount();
      cards.forEach(function (card, i) {
        var hidden = !expanded && i >= count;
        card.toggleAttribute('inert', hidden);
        card.setAttribute('aria-hidden', hidden ? 'true' : 'false');
      });
    }
    function settle() {
      list.style.height = expanded ? 'auto' : collapsedHeight() + 'px';
    }
    function sync(immediate) {
      clearTimeout(timer);
      setCardAccess();
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle.querySelector('span').textContent = expanded ? toggle.dataset.collapse : toggle.dataset.expand;
      if (immediate || reduce) { settle(); return; }
      var from = list.getBoundingClientRect().height;
      list.style.height = 'auto';
      var to = expanded ? list.scrollHeight : collapsedHeight();
      list.style.height = from + 'px';
      list.offsetHeight;
      list.style.height = to + 'px';
      timer = setTimeout(settle, 560);
    }
    toggle.addEventListener('click', function () { expanded = !expanded; sync(false); });
    window.addEventListener('resize', function () { sync(true); });
    sync(true);
  })();

  /* FAQ accordion — smooth height animation, opening one answer closes the others */
  (function () {
    var EASE = 'cubic-bezier(.4,0,.2,1)';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function natural(panel) {
      var h = panel.style.height, t = panel.style.transition;
      panel.style.transition = 'none';
      panel.style.height = 'auto';
      var v = panel.getBoundingClientRect().height;
      panel.style.height = h;
      panel.style.transition = t;
      return v;
    }

    function animate(panel, from, to, dur, done) {
      if (panel._faqStop) panel._faqStop();
      var timer, done_ = false;
      var finish = function (e) {
        if (e && e.propertyName !== 'height') return;
        if (done_) return;
        done_ = true;
        panel.removeEventListener('transitionend', finish);
        clearTimeout(timer);
        panel._faqStop = null;
        panel.style.transition = '';
        panel.style.height = '';
        if (done) done();
      };
      panel._faqStop = function () {
        if (done_) return;
        done_ = true;
        panel.removeEventListener('transitionend', finish);
        clearTimeout(timer);
        panel._faqStop = null;
      };
      if (Math.abs(to - from) < 1) { setTimeout(finish, 0); return; }
      panel.style.transition = 'none';
      panel.style.height = from + 'px';
      panel.offsetHeight; /* reflow */
      panel.style.transition = 'height ' + dur + 's ' + EASE;
      panel.style.height = to + 'px';
      panel.addEventListener('transitionend', finish);
      timer = setTimeout(finish, dur * 1000 + 150);
    }

    document.querySelectorAll('.faq').forEach(function (group) {
      var items = [].slice.call(group.querySelectorAll('details'));

      function collapse(item) {
        if (item.getAttribute('data-open') !== '1') return;
        item.setAttribute('data-open', '0');
        var panel = item.querySelector('.a');
        if (reduce) { item.open = false; return; }
        animate(panel, panel.getBoundingClientRect().height, 0, .26, function () { item.open = false; });
      }

      function expand(item) {
        if (item.getAttribute('data-open') === '1') return;
        item.setAttribute('data-open', '1');
        var panel = item.querySelector('.a');
        var from = item.open ? panel.getBoundingClientRect().height : 0;
        item.open = true;
        if (reduce) return;
        animate(panel, from, natural(panel), .32);
      }

      items.forEach(function (item) {
        var summary = item.querySelector('summary');
        if (!summary || !item.querySelector('.a')) return;
        item.setAttribute('data-open', item.open ? '1' : '0');
        summary.addEventListener('click', function (e) {
          e.preventDefault();
          if (item.getAttribute('data-open') === '1') { collapse(item); return; }
          items.forEach(function (other) { if (other !== item) collapse(other); });
          expand(item);
        });
      });
    });
  })();

  /* copy-to-clipboard buttons */
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      var flash = function () {
        btn.classList.add('copied');
        setTimeout(function () { btn.classList.remove('copied'); }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(flash, legacy);
      } else { legacy(); }

      function legacy() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        if (ok) { flash(); } else { selectAddress(); }
      }

      /* clipboard blocked (some in-app browsers): select the address so it can be copied by hand */
      function selectAddress() {
        var a = btn.parentNode.querySelector('a');
        if (!a || !window.getSelection) { return; }
        var range = document.createRange();
        range.selectNodeContents(a);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
  });

  /* legal pages: highlight the section the reader is in */
  var toc = document.querySelector('.doc-toc');
  if (toc) {
    /* the list is a dropdown on phones and an always-open sidebar on desktop */
    var narrow = window.matchMedia('(max-width:1000px)');
    var syncToc = function () {
      if (narrow.matches) { toc.removeAttribute('open'); } else { toc.setAttribute('open', ''); }
    };
    syncToc();
    if (narrow.addEventListener) { narrow.addEventListener('change', syncToc); }
    else if (narrow.addListener) { narrow.addListener(syncToc); }

    var secs = [].slice.call(document.querySelectorAll('.doc-sec'));
    var tocLinks = [].slice.call(toc.querySelectorAll('a[href^="#"]'));
    tocLinks.forEach(function (a) {
      /* on narrow screens the list is a dropdown — fold it back after a jump */
      a.addEventListener('click', function () {
        if (narrow.matches) { toc.removeAttribute('open'); }
      });
    });
    if (secs.length && tocLinks.length) {
      var ticking = false;
      var mark = function () {
        ticking = false;
        var y = window.scrollY + 130, cur = secs[0];
        secs.forEach(function (s) { if (s.getBoundingClientRect().top + window.scrollY <= y) cur = s; });
        tocLinks.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + cur.id);
        });
      };
      mark();
      window.addEventListener('scroll', function () {
        if (!ticking) { ticking = true; window.requestAnimationFrame(mark); }
      }, { passive: true });
      window.addEventListener('resize', mark);
    }
  }

  /* before / after comparison */
  document.querySelectorAll('.cmp-wrap').forEach(function (root) {
    var cmp = root.querySelector('.cmp');
    if (!cmp) return;
    var bar = cmp.querySelector('.cmp-bar');
    var before = cmp.querySelector('.b');
    var after = cmp.querySelector('.a-img');
    var vid = cmp.querySelector('video');
    var tags = cmp.querySelectorAll('.cmp-tag');
    var badge = cmp.querySelector('.on-device');
    var mute = cmp.querySelector('.vid-mute');
    var follow = root.hasAttribute('data-follow');
    var dragging = false, pos = 50, aim = 50, hold = 0;

    /* in-video controls: click the clip to pause it, a badge shows it is stopped */
    function syncMute() {
      if (!mute || !vid) return;
      mute.classList.toggle('muted', vid.muted);
      mute.setAttribute('aria-label', vid.muted ? mute.dataset.on : mute.dataset.off);
    }
    function playing() { return vid && vid.style.display === 'block'; }

    /* switching sources pauses the player for a moment — that is not a real stop */
    var switching = false;

    function startClip(withSound, attempt) {
      vid.muted = !withSound;
      syncMute();
      var p = vid.play();
      if (!p || !p.then) { switching = false; return; }
      p.then(function () { switching = false; }, function (err) {
        var name = err && err.name;
        /* the browser refuses sound without a gesture — fall back to a silent clip */
        if (name === 'NotAllowedError' && withSound) { startClip(false, 0); return; }
        /* load() interrupted the previous play() — try again once the source settles */
        if (name === 'AbortError' && !attempt) { setTimeout(function () { startClip(withSound, 1); }, 150); return; }
        switching = false;
        if (playing() && vid.paused) cmp.classList.add('paused');
      });
    }

    if (vid) {
      vid.addEventListener('playing', function () { switching = false; cmp.classList.remove('paused'); });
      vid.addEventListener('play', function () { cmp.classList.remove('paused'); });
      vid.addEventListener('pause', function () { if (playing() && !switching) cmp.classList.add('paused'); });
      cmp.addEventListener('click', function (e) {
        if (!playing() || (mute && mute.contains(e.target))) return;
        if (vid.paused) { var p = vid.play(); if (p && p.catch) p.catch(function () {}); }
        else { vid.pause(); }
      });
    }
    if (mute) {
      mute.addEventListener('click', function (e) {
        e.stopPropagation();
        vid.muted = !vid.muted;
        syncMute();
      });
    }

    function setPos(p) {
      pos = Math.max(1, Math.min(99, p));
      bar.style.left = pos + '%';
      before.style.clipPath = 'inset(0 ' + (100 - pos) + '% 0 0)';
    }

    /* the hero device runs past the right edge of the window, so the picture keeps the
       device's own left, top and bottom edges but ends halfway between the window edge
       and the far bezel: the subject then reads as centred in what is actually on
       screen. When the whole device fits — phones, tablets — this is the screen itself. */
    var deck = root.querySelector('.phone-screen');
    var midPct = 50;
    function fit() {
      if (!deck) return;
      var r = deck.getBoundingClientRect();
      var vw = document.documentElement.clientWidth || window.innerWidth;
      var cut = Math.max(0, Math.round((r.right - vw) / 2));
      cmp.style.right = cut + 'px';
      /* whatever is still past the window edge cannot be looked at, so the divider
         rests in the middle of the part that is on screen, not of the picture */
      var w = r.width - cut;
      midPct = w > 0
        ? Math.max(8, Math.min(50, ((Math.min(vw, r.right - cut) - r.left) / w) * 50))
        : 50;
    }
    fit();
    setPos(midPct);

    function pointerPos(e) {
      var r = cmp.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      return Math.max(0, Math.min(100, (x / r.width) * 100));
    }
    function start(e) {
      if (playing()) return;
      dragging = true;
      aim = pointerPos(e);
      if (!follow) setPos(aim);
    }
    function move(e) {
      if (!dragging) return;
      aim = pointerPos(e);
      if (!follow) setPos(aim);
      if (e.cancelable) e.preventDefault();
    }
    function end() {
      if (!dragging) return;
      dragging = false;
      /* after a drag the idle drift stays out of the way for a moment */
      hold = now() + 4000;
    }

    cmp.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    cmp.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);

    bar.setAttribute('tabindex', '0');
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      aim = Math.max(0, Math.min(100, pos + (e.key === 'ArrowLeft' ? -4 : 4)));
      hold = now() + 6000;
      setPos(aim);
      e.preventDefault();
    });

    /* hero device: the divider drifts on its own and follows the cursor inside the stage */
    if (follow) {
      var calm = matches('(prefers-reduced-motion:reduce)');
      var fine = matches('(hover:hover) and (pointer:fine)');
      var hover = false, raf = 0, live = true, t0 = 0;

      var frame = function (t) {
        raf = 0;
        if (!t0) t0 = t;
        var mid = midPct;
        var chase = hover || dragging || t < hold;
        var goal = chase ? aim : (calm ? mid : mid * (1 + .46 * Math.sin((t - t0) / 2450)));
        var next = pos + (goal - pos) * (chase ? .18 : .06);
        if (Math.abs(goal - pos) < .04) next = goal;
        if (next !== pos) setPos(next);
        if (live) raf = requestAnimationFrame(frame);
      };
      var run = function () { if (live && !raf) raf = requestAnimationFrame(frame); };

      /* the divider follows the cursor anywhere over the device — on wide screens that
         reaches far past the column the stage itself occupies, so the window is watched
         and the picture's own box decides what counts as "over it" */
      var box = cmp.getBoundingClientRect();
      var remeasure = function () { box = cmp.getBoundingClientRect(); };
      if (fine) {
        window.addEventListener('mousemove', function (e) {
          var over = e.clientX >= box.left && e.clientX <= box.right &&
                     e.clientY >= box.top && e.clientY <= box.bottom;
          hover = over;
          if (!over) return;
          aim = pointerPos(e);
          run();
        }, { passive: true });
        window.addEventListener('scroll', remeasure, { passive: true });
        window.addEventListener('resize', remeasure);
      }
      if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
          live = entries[0].isIntersecting;
          if (live) { t0 = 0; run(); }
          else if (raf) { cancelAnimationFrame(raf); raf = 0; }
        }, { threshold: 0 }).observe(root);
      }
      var rest = function () {
        fit();
        remeasure();
        if (!hover && !dragging) { setPos(midPct); }
        t0 = 0;
        run();
      };
      window.addEventListener('resize', rest);
      window.addEventListener('load', rest);
      run();
    }

    /* media tabs */
    var tabs = root.querySelectorAll('.cmp-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.setAttribute('aria-selected', 'false'); });
        tab.setAttribute('aria-selected', 'true');
        if (tab.dataset.ratio) cmp.style.setProperty('--ar', tab.dataset.ratio);
        if (badge) badge.classList.toggle('cloud', tab.dataset.cloud === '1');
        /* the hero screen is wider than any photo: each example brings its own framing */
        if (tab.dataset.pos) {
          before.style.objectPosition = tab.dataset.pos;
          after.style.objectPosition = tab.dataset.pos;
        }

        if (tab.dataset.video) {
          [before, after, bar].forEach(function (el) { el.style.display = 'none'; });
          tags.forEach(function (el) { el.style.display = 'none'; });
          vid.style.display = 'block';
          cmp.classList.add('has-video');
          cmp.classList.remove('paused');
          switching = true;
          vid.src = tab.dataset.video;
          if (mute) { mute.hidden = tab.dataset.sound !== '1'; }
          vid.load();
          startClip(tab.dataset.sound === '1', 0);
        } else {
          [before, after, bar].forEach(function (el) { el.style.display = 'block'; });
          tags.forEach(function (el) { el.style.display = ''; });
          if (vid) { switching = true; vid.pause(); vid.style.display = 'none'; vid.removeAttribute('src'); vid.load(); }
          cmp.classList.remove('has-video', 'paused');
          if (mute) { mute.hidden = true; }
          before.src = tab.dataset.before;
          after.src = tab.dataset.after;
          setPos(50);
        }
      });
    });

    /* the hero swaps in place, so the other examples are fetched once the page is
       done loading — a tap should never wait for a download */
    if (root.dataset.preload && tabs.length > 1) {
      var warm = function () {
        tabs.forEach(function (tab) {
          [tab.dataset.before, tab.dataset.after].forEach(function (src) {
            if (!src) return;
            var img = new Image();
            img.decoding = 'async';
            img.src = src;
          });
        });
      };
      if (document.readyState === 'complete') setTimeout(warm, 500);
      else window.addEventListener('load', function () { setTimeout(warm, 500); });
    }
  });
})();
