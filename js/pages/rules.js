/* FORMA MUN · Crisis Division — Rules & resources page
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $, $$, arr, str, h, safeUrl, on, Sound } = F;

  /* ---------------- Rules & resources ---------------- */
  function initAccordions() {
    $$('.acc > button').forEach((btn) => btn.addEventListener('click', () => {
      const body = document.getElementById(btn.getAttribute('aria-controls')); const o = body.hidden; body.hidden = !o; btn.setAttribute('aria-expanded', String(o)); Sound.play('move');
    }));
  }
  function initRules() {
    initAccordions();
    on('forma:content', (c) => {
      const box = $('[data-resources]'); if (!box) return;
      const res = arr(c.resources).filter((r) => r && safeUrl(r.url) && str(r.title));
      box.innerHTML = '';
      const section = box.closest('.acc-body'), toggle = section && document.querySelector(`[aria-controls="${section.id}"]`);
      if (res.some((r) => r.report) && toggle && toggle.getAttribute('aria-expanded') === 'false') { section.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
      if (!res.length) { box.append(h('p', { class: 'muted', text: 'No approved documents have been published yet.' })); return; }
      box.append(h('ul', null, res.map((r) => h('li', null,
        h('a', { href: safeUrl(r.url), target: (r.report || /^https?:/i.test(r.url)) ? '_blank' : null, rel: 'noopener', text: str(r.title, 160) }),
        str(r.type) ? ' · ' + str(r.type, 30).toUpperCase() : '', str(r.note) ? h('span', { class: 'muted', text: ' — ' + str(r.note, 300) }) : null))));
    });
  }

  F.pages = F.pages || {};
  F.pages.rules = initRules;
})(window.FORMA = window.FORMA || {});
