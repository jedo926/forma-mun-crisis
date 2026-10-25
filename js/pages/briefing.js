/* FORMA MUN · Crisis Division — Briefing page
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { arr, str, h, paragraphs, on, showReleased, premise, emptyNote } = F;

  /* ---------------- Briefing ---------------- */
  function initBriefing() {
    on('forma:content', (c) => {
      const v = showReleased(c); if (!v) return; v.innerHTML = '';
      const b = (c.briefing && typeof c.briefing === 'object') ? c.briefing : {};
      v.append(premise(c));
      v.append(h('div', { class: 'panel panel-neon', style: 'margin-bottom:22px' },
        h('span', { class: 'label cyan', text: 'TOPIC OVERVIEW' }),
        h('h2', { style: 'margin-top:14px', text: str(c.title, 200) || 'CRISIS BRIEFING' }),
        str(c.subtitle, 300) ? h('p', { class: 'muted', text: str(c.subtitle, 300) }) : null,
        paragraphs(b.overview)));
      const sec = (label, cls, val) => {
        const body = paragraphs(val);
        if (!body.length) return null;
        return h('section', { class: 'panel' }, h('span', { class: 'label ' + cls, text: label }), h('div', { style: 'margin-top:14px' }, body));
      };
      const list = (label, cls, val) => {
        const items = arr(val).map((x) => str(x)).filter(Boolean);
        if (!items.length) return sec(label, cls, val);
        return h('section', { class: 'panel' }, h('span', { class: 'label ' + cls, text: label }), h('ul', { style: 'margin:14px 0 0;padding-left:22px' }, items.map((t) => h('li', { text: t }))));
      };
      const g = h('div', { class: 'grid' },
        sec('CONTEXT', 'cyan', b.context),
        sec('COMMITTEE FORMAT', 'vio', b.committeeFormat),
        list('DEBATE SCOPE', 'mag', b.debateScope),
        sec('BACKGROUND', 'cyan', b.background));
      v.append(g.childNodes.length ? g : emptyNote('BRIEFING SECTIONS NOT SUPPLIED YET'));
    });
  }

  F.pages = F.pages || {};
  F.pages.briefing = initBriefing;
})(window.FORMA = window.FORMA || {});
