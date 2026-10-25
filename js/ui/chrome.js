/* FORMA MUN · Crisis Division — Nav, settings buttons, page transitions, shortcuts, easter eggs
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $, $$, reducedMotionQuery, isTyping, toast, Settings, Sound, Music, Modal, pixelBurst } = F;

  /* ---------------- Shared chrome: nav, settings, transitions, keys ---------------- */
  function initChrome() {
    $$('[data-toggle-sound]').forEach((b) => b.addEventListener('click', () => Settings.toggleSound()));
    $$('[data-toggle-fx]').forEach((b) => b.addEventListener('click', () => Settings.toggleFx()));
    const navBtn = $('.nav-toggle'); const nav = $('#site-nav');
    if (navBtn && nav) navBtn.addEventListener('click', () => { const open = !nav.classList.contains('open'); nav.classList.toggle('open', open); navBtn.setAttribute('aria-expanded', String(open)); Sound.play('move'); });
    if (reducedMotionQuery.addEventListener) reducedMotionQuery.addEventListener('change', () => Settings.apply());

    // Arcade page transition (real navigation; browser history/back work normally).
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!/^[a-z0-9-]+\.html/i.test(href)) return;
      const dest = href.split('#')[0].split('?')[0];
      const here = (location.pathname.split('/').pop() || 'index.html');
      if (dest === here || (dest === 'index.html' && here === '')) return;
      Sound.play('select');
      if (Settings.lowMotion) return;
      e.preventDefault();
      const w = $('#transition'); if (w) w.classList.add('go');
      setTimeout(() => { location.href = a.href; }, 260);
    });
    window.addEventListener('pageshow', () => { const w = $('#transition'); if (w) w.classList.remove('go'); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && Modal.node) { e.preventDefault(); Modal.close(); return; }
      if ((e.key === 'm' || e.key === 'M') && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) Settings.toggleSound();
    });
    // iOS/iPadOS only unlocks audio inside a real gesture (touchend/click), so listen to all of them.
    const unlock = () => { if (Settings.sound) { Sound.unlock(); Music.sync(); } };
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { once: true, passive: true }));

    // Easter egg 1: Konami code (non-sensitive).
    const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']; let pos = 0;
    document.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      pos = (e.key === code[pos] || e.key.toLowerCase() === code[pos]) ? pos + 1 : (e.key === code[0] ? 1 : 0);
      if (pos === code.length) { pos = 0; Sound.play('release'); toast('CHEAT ACCEPTED · +99 CONTINUES · STILL NO SPOILERS'); pixelBurst(2200, 'NICE TRY, DELEGATE'); }
    });
    // Easter egg 2: tap the logo mark 5 times.
    let taps = 0, tapTimer;
    const mark = $('.brand-mark');
    if (mark) mark.parentElement.addEventListener('click', (e) => {
      taps += 1; clearTimeout(tapTimer); tapTimer = setTimeout(() => { taps = 0; }, 900);
      if (taps >= 5) { e.preventDefault(); taps = 0; Sound.play('start'); toast('INSERT COIN · CREDIT 01'); }
    });
  }

  Object.assign(F, { initChrome });
})(window.FORMA = window.FORMA || {});
