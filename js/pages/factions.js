/* FORMA MUN · Crisis Division — Factions page
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { pad, arr, str, h, paragraphs, on, Sound, showReleased, emptyNote } = F;

  /* ---------------- Factions ---------------- */
  function initFactions() {
    on('forma:content', (c) => {
      const v = showReleased(c); if (!v) return; v.innerHTML = '';
      const factions = arr(c.factions);
      const chars = arr(c.characters);
      const nameOf = (id) => { const m = chars.find((x) => x && str(x.id) === str(id)); return m ? str(m.name, 80) : str(id, 80); };
      const fname = (id) => { const x = factions.find((y) => y && str(y.id) === str(id)); return x ? str(x.name, 80) : str(id, 80); };
      if (!factions.length) { v.append(emptyNote('NO FACTIONS PUBLISHED IN THE APPROVED MATERIAL')); return; }
      const g = h('div', { class: 'grid' });
      factions.forEach((fa, i) => {
        const members = arr(fa.members).map(nameOf).filter(Boolean);
        const rels = arr(fa.relations).filter((r) => r && (r.target || r.type));
        const detailId = 'fdet-' + i;
        const detail = h('div', { id: detailId, hidden: true },
          members.length ? [h('h3', { style: 'margin-top:16px', text: 'MEMBERS' }), h('ul', null, members.map((m) => h('li', { text: m })))] : null,
          rels.length ? [h('h3', { style: 'margin-top:16px', text: 'RELATIONSHIPS' }), rels.map((r) => h('div', { class: 'rel' }, h('span', { class: 'label vio', text: str(r.type, 40) || 'LINK' }), h('span', { text: fname(r.target) }), str(r.note) ? h('span', { class: 'muted', text: '— ' + str(r.note, 400) }) : null))] : null,
          !members.length && !rels.length ? h('p', { class: 'muted', style: 'margin-top:14px', text: 'No members or relationships listed in the approved material.' }) : null);
        const toggle = h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': detailId, style: 'margin-top:auto;align-self:flex-start' }, 'SELECT FACTION');
        const panel = h('article', { class: 'panel fslot' }, h('span', { class: 'fnum', text: pad(i + 1) }), h('h2', { text: str(fa.name, 120) || 'FACTION ' + pad(i + 1) }), paragraphs(fa.description), detail, toggle);
        toggle.addEventListener('click', () => { const open = detail.hidden; detail.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); toggle.textContent = open ? 'CLOSE' : 'SELECT FACTION'; panel.classList.toggle('panel-neon', open); Sound.play(open ? 'select' : 'move'); });
        g.append(panel);
      });
      v.append(g);
    });
  }

  F.pages = F.pages || {};
  F.pages.factions = initFactions;
})(window.FORMA = window.FORMA || {});
