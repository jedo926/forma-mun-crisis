/* FORMA MUN · Crisis Division — Shared header, nav, status bar
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { CONFIG, NAV, PAGE, h, toast } = F;

  /* ---------------- Shared layout: header, nav, status bar, overlays ----------------
     Rendered from CONFIG/NAV so every page shares one source of truth. Each page only
     contains its own <main>; edit the nav in js/core/config.js. */
  function renderLayout() {
    const slot = (name) => document.querySelector('[data-slot="' + name + '"]');
    const header = h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: 'index.html', 'aria-label': 'FORMA MUN Crisis Division home' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
        h('span', null, h('span', { class: 'brand-name' }, 'FORMA', h('b', { text: ' MUN' })), h('span', { class: 'brand-sub', text: 'CRISIS DIVISION' }))),
      h('button', { class: 'chip-btn nav-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'site-nav' }, 'MENU'),
      h('nav', { id: 'site-nav', class: 'nav', 'aria-label': 'Main' },
        h('ul', null, NAV.map((n) => h('li', null, h('a', { href: n.file, 'aria-current': n.id === PAGE ? 'page' : null }, h('span', { class: 'num', text: n.num }), n.label))))),
      h('div', { class: 'hud-controls' },
        h('button', { class: 'chip-btn', type: 'button', 'data-toggle-sound': true, 'aria-pressed': 'false', title: 'Sound (M)' }, 'SND OFF'),
        h('button', { class: 'chip-btn', type: 'button', 'data-toggle-fx': true, 'aria-pressed': 'true', title: 'Visual effects' }, 'FX FULL')));
    const skip = h('a', { class: 'skip-link', href: '#main', text: 'SKIP TO CONTENT' });
    const footer = h('footer', { class: 'statusbar' },
      h('span', null, h('span', { class: 'dot' }), 'LINK: ', h('b', { 'data-link-status': true, text: 'CHECKING…' })),
      h('span', null, h('span', { class: 'dot bad' }), 'RELEASE: ', h('b', { 'data-release-status': true, text: 'LOCKED' })),
      h('span', null, 'T-MINUS ', h('b', { 'data-cd-inline': true, text: '--:--:--:--' })),
      h('span', null, CONFIG.timezoneLabel + ' ', h('b', { 'data-local-clock': true, text: '--:--:--' })),
      h('span', { text: 'M SOUND · ESC CLOSE' }));
    const overlays = [
      h('div', { class: 'crt', 'aria-hidden': 'true' }), h('div', { class: 'noise', 'aria-hidden': 'true' }),
      h('div', { id: 'transition', class: 'wipe', 'aria-hidden': 'true' }), h('div', { id: 'toast-root', class: 'toast-root', 'aria-live': 'polite' })
    ];
    const hs = slot('header'); if (hs) hs.replaceWith(skip, header); else document.body.prepend(skip, header);
    const fs = slot('footer'); if (fs) fs.replaceWith(footer, ...overlays); else document.body.append(footer, ...overlays);
    const nos = document.querySelector('noscript.nav-fallback'); if (nos) nos.remove();
  }
  renderLayout();

  Object.assign(F, { renderLayout });
})(window.FORMA = window.FORMA || {});
