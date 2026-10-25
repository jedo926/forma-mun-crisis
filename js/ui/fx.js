/* FORMA MUN · Crisis Division — Pixel burst, release overlay, topic cutscene
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { CONFIG, str, h, session, on, Settings, Sound, Release } = F;

  /* ---------------- Pixel burst / release animation ---------------- */
  function pixelBurst(duration, title, subtitle, onDone) {
    const fx = h('div', { class: 'release-fx', role: 'status', 'aria-live': 'assertive' });
    const c = h('canvas', { 'aria-hidden': 'true' });
    fx.append(c);
    if (title) fx.append(h('h2', { text: title }));
    if (subtitle) fx.append(h('p', { text: subtitle }));
    document.body.append(fx);
    let finished = false;
    const done = () => { if (finished) return; finished = true; cancelAnimationFrame(raf); fx.remove(); if (onDone) onDone(); };
    fx.addEventListener('click', done);
    setTimeout(done, duration);
    if (Settings.lowMotion) return;
    const ctx = c.getContext('2d'); c.width = 320; c.height = 180;
    const cols = ['#00F5FF', '#FF2BD6', '#7857FF', '#F1F4FF', '#FF3B52'];
    const parts = Array.from({ length: 260 }, () => { const a = Math.random() * Math.PI * 2; const v = 30 + Math.random() * 150; return { x: 160, y: 90, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: cols[Math.floor(Math.random() * cols.length)], s: Math.random() < 0.3 ? 3 : 2 }; });
    let last = performance.now(); let raf = 0;
    const step = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, 320, 180);
      parts.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function initReleaseFx() {
    on('forma:released', () => {
      const seen = session.get('releaseSeen', false);
      if (seen && Release.link !== 'demo') return;
      session.set('releaseSeen', true);
      Sound.play('release');
      pixelBurst(2600, 'SIGNAL ACQUIRED', 'BRIEFING DECLASSIFIED · TAP TO CONTINUE', () => topicCutscene(Release.content));
    });
  }

  /* ---------------- Topic reveal cutscene (shown once, right after SIGNAL ACQUIRED) ---------------- */
  function topicCutscene(c) {
    if (!c || !str(c.title)) return;
    const cs = (c.cutscene && typeof c.cutscene === 'object') ? c.cutscene : {};
    const words = str(c.title, 200).split(/\s+/).filter(Boolean);
    const title = h('h2', { class: 'cs-title' }, words.map((w, i) => h('span', { class: /^vs\.?$/i.test(w) ? 'cs-w cs-vs' : 'cs-w', style: `animation-delay:${1.3 + i * 0.14}s`, text: w })));
    const node = h('div', { class: 'cutscene', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Topic revealed: ' + str(c.title, 200), tabindex: '-1' },
      h('div', { class: 'cs-bars', 'aria-hidden': 'true' }),
      h('p', { class: 'cs-kicker blink', text: str(cs.kicker, 80) || 'INCOMING TRANSMISSION' }),
      h('p', { class: 'cs-date', text: str(cs.date, 80) || str(c.subtitle, 120) }),
      title,
      h('div', { class: 'cs-rule', 'aria-hidden': 'true' }),
      str(cs.tagline) ? h('p', { class: 'cs-tagline', text: str(cs.tagline, 200) }) : null,
      h('p', { class: 'cs-premise', text: str(cs.disclaimer, 200) || 'CRISIS EVENTS ARE FICTIONAL' }),
      h('p', { class: 'cs-skip', text: 'PRESS ANY KEY TO CONTINUE' }));
    let closed = false;
    const close = () => {
      if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true);
      if (Settings.lowMotion) { node.remove(); return; }
      node.classList.add('leaving'); setTimeout(() => node.remove(), 500);
    };
    const onKey = (e) => { e.preventDefault(); e.stopPropagation(); close(); };
    node.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.append(node); node.focus({ preventScroll: true });
    Sound.play('cutscene');
    setTimeout(close, Settings.lowMotion ? 4500 : CONFIG.cutsceneMs);
  }

  Object.assign(F, { pixelBurst, initReleaseFx, topicCutscene });
})(window.FORMA = window.FORMA || {});
