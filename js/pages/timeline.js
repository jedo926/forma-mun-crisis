/* FORMA MUN · Crisis Division — Timeline page
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $$, arr, str, h, paragraphs, on, Sound, showReleased, premise, emptyNote } = F;

  /* ---------------- Timeline ---------------- */
  function node(kind, date, title, bodyNodes, open) {
    const id = 'tn-' + Math.random().toString(36).slice(2, 8);
    const body = h('div', { class: 'tbody', id, hidden: !open }, bodyNodes);
    const btn = h('button', { type: 'button', 'aria-expanded': String(!!open), 'aria-controls': id },
      h('span', { class: 'caret', 'aria-hidden': 'true', text: '▸' }), h('span', { class: 'tdate', text: date }), h('span', { class: 'ttitle', text: title }),
      kind === 'crisis' ? h('span', { class: 'label mag', text: 'FICTIONAL CRISIS' }) : (kind === 'background' ? h('span', { class: 'label cyan', text: 'BACKGROUND' }) : null));
    btn.addEventListener('click', () => { const o = body.hidden; body.hidden = !o; btn.setAttribute('aria-expanded', String(o)); Sound.play('move'); });
    return h('li', { class: 'tnode ' + (kind || '') }, btn, body);
  }
  function initTimeline() {
    $$('.tnode.locked button').forEach((btn) => btn.addEventListener('click', () => {
      const body = document.getElementById(btn.getAttribute('aria-controls')); const o = body.hidden; body.hidden = !o; btn.setAttribute('aria-expanded', String(o)); Sound.play('error');
    }));
    on('forma:content', (c) => {
      const v = showReleased(c); if (!v) return; v.innerHTML = '';
      const items = arr(c.timeline);
      v.append(premise(c));
      v.append(h('div', { class: 'legend' }, h('span', { class: 'label cyan', text: 'BACKGROUND EVENTS' }), h('span', { class: 'label mag', text: 'FICTIONAL CRISIS DEVELOPMENT' })));
      if (!items.length) { v.append(emptyNote('NO TIMELINE ENTRIES PUBLISHED')); return; }
      v.append(h('ol', { class: 'timeline' }, items.map((t, i) => node(t.kind === 'crisis' ? 'crisis' : (t.kind === 'background' ? 'background' : ''), str(t.date, 60) || '—', str(t.title, 200) || 'EVENT', paragraphs(t.detail), i === 0))));
    });
  }

  F.pages = F.pages || {};
  F.pages.timeline = initTimeline;
})(window.FORMA = window.FORMA || {});
