/* FORMA MUN · Crisis Division — Classified intel page
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $$, pad, arr, str, h, paragraphs, on, toast, Settings, Sound, showReleased, emptyNote } = F;

  /* ---------------- Intel ---------------- */
  function initIntel() {
    const ciphers = $$('.cipher');
    const glyphs = '01ABCDEF#$%&@!?<>/\\|=+*';
    const scramble = () => ciphers.forEach((n) => { let s = ''; for (let i = 0; i < 140; i++) s += glyphs[Math.floor(Math.random() * glyphs.length)]; n.textContent = s; });
    scramble();
    const iv = setInterval(() => { if (!Settings.lowMotion) scramble(); }, 260);
    $$('[data-dossier-locked]').forEach((b) => b.addEventListener('click', () => { Sound.play('error'); toast('ACCESS DENIED · SIGNAL RESTRICTED'); }));
    on('forma:content', (c) => {
      clearInterval(iv);
      const v = showReleased(c); if (!v) return; v.innerHTML = '';
      const items = arr(c.intel).filter((x) => x && (str(x.title) || str(x.body)));
      if (!items.length) { v.append(emptyNote('NO PUBLIC INTEL HAS BEEN APPROVED FOR RELEASE')); return; }
      v.append(h('div', { class: 'grid' }, items.map((x, i) => h('article', { class: 'panel dossier open' },
        h('span', { class: 'classif', text: (str(x.classification, 40) || 'DECLASSIFIED') + ' · ' + (str(x.codename, 60) || 'FILE ' + pad(i + 1)) }),
        h('h2', { text: str(x.title, 160) || 'DOSSIER ' + pad(i + 1) }), paragraphs(x.body)))));
    });
  }

  F.pages = F.pages || {};
  F.pages.intel = initIntel;
})(window.FORMA = window.FORMA || {});
