/* FORMA MUN · Crisis Division — Characters page
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $, $$, pad, clamp, arr, h, paragraphs, on, Settings, Sound, Sprite, currentRoster, Modal, emptyNote } = F;

  /* ---------------- Characters ---------------- */
  function initCharacters() {
    const list = $('#roster-big'); const q = $('#char-search'); const f = $('#char-filter'); const count = $('[data-char-count]');
    let roster = [];
    function openDetail(m, i) {
      if (m.locked) {
        Modal.open('UNKNOWN ENTITY ' + pad(i + 1), h('div', { class: 'detail' },
          h('div', { class: 'detail-art' }, Sprite.toCanvas(m, { scale: 5 })),
          h('div', null, h('p', { class: 'restricted', style: 'text-align:left', text: 'SIGNAL RESTRICTED' }), h('span', { class: 'redacted' }), h('span', { class: 'redacted w80' }), h('span', { class: 'redacted w60' }),
            h('p', { class: 'muted', text: 'Authorized briefing pending. This dossier unlocks automatically when the server confirms release.' }))));
        return;
      }
      const art = h('div', { class: 'detail-art' });
      if (m.portrait) {
        const img = h('img', { src: m.portrait, alt: 'Portrait of ' + m.name, style: 'image-rendering:pixelated;max-height:300px' });
        img.addEventListener('error', () => { img.replaceWith(Sprite.toCanvas(m, { scale: 5 })); });
        art.append(img);
      } else art.append(Sprite.toCanvas(m, { scale: 5 }));
      let frame = 0; const anim = Settings.lowMotion ? null : setInterval(() => {
        const cv = $('canvas', art); if (!cv) return; frame += 1;
        const src = Sprite.render(m, { scale: 5, bob: frame % 2 === 1 }); const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(src, 0, 0);
      }, 380);
      const dl = h('dl', null,
        h('dt', { text: 'ROLE' }), h('dd', { text: m.role || '—' }),
        h('dt', { text: 'AFFILIATION' }), h('dd', { text: m.affiliation || '—' }),
        m.faction ? [h('dt', { text: 'FACTION' }), h('dd', { text: m.faction })] : null);
      Modal.open(m.name, h('div', { class: 'detail' }, art, h('div', null, dl, paragraphs(m.bio))), () => { clearInterval(anim); if (location.hash) history.replaceState(null, '', location.pathname + location.search); });
      if (location.hash !== '#' + m.id) history.replaceState(null, '', '#' + m.id);
    }
    function render() {
      const term = (q.value || '').trim().toLowerCase(); const fv = f.value;
      list.innerHTML = '';
      const shown = roster.filter((m) => {
        if (m.locked) return true;
        const hay = [m.name, m.role, m.affiliation, m.faction, typeof m.bio === 'string' ? m.bio : arr(m.bio).join(' ')].join(' ').toLowerCase();
        return (!term || hay.includes(term)) && (!fv || m.faction === fv || m.affiliation === fv);
      });
      shown.forEach((m) => {
        const i = roster.indexOf(m);
        const cardEl = h('button', { class: 'ccard', type: 'button', 'aria-label': m.locked ? 'Unknown entity ' + pad(i + 1) : m.name + (m.role ? ', ' + m.role : '') },
          Sprite.toCanvas(m, { scale: 4 }),
          h('span', { class: 'cname', text: m.locked ? 'UNKNOWN ENTITY ' + pad(i + 1) : m.name }),
          h('span', { class: 'crole', text: m.locked ? 'CLASSIFIED' : (m.role || m.affiliation || '') }));
        cardEl.addEventListener('click', () => openDetail(m, i));
        list.append(cardEl);
      });
      if (!shown.length) list.append(emptyNote('NO MATCHING DELEGATES'));
      if (count) count.textContent = roster[0] && roster[0].locked ? 'ROSTER SEALED' : shown.length + ' / ' + roster.length + ' DELEGATES';
    }
    function build() {
      roster = currentRoster();
      const locked = !roster.length || roster[0].locked;
      q.disabled = locked; f.disabled = locked;
      const opts = Array.from(new Set(roster.filter((m) => !m.locked).flatMap((m) => [m.faction, m.affiliation]).filter(Boolean))).sort();
      f.innerHTML = ''; f.append(h('option', { value: '', text: locked ? 'LOCKED' : 'ALL GROUPS' }));
      opts.forEach((o) => f.append(h('option', { value: o, text: o })));
      render();
      if (!locked && location.hash) { const id = decodeURIComponent(location.hash.slice(1)); const i = roster.findIndex((m) => m.id === id); if (i >= 0) openDetail(roster[i], i); }
    }
    q.addEventListener('input', render); f.addEventListener('change', render);
    list.addEventListener('keydown', (e) => {
      const cards = $$('.ccard', list); const i = cards.indexOf(document.activeElement); if (i < 0) return;
      const cols = Math.max(1, cards.filter((t) => t.offsetTop === cards[0].offsetTop).length);
      const map = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
      if (!(e.key in map)) return; e.preventDefault(); cards[clamp(i + map[e.key], 0, cards.length - 1)].focus(); Sound.play('move');
    });
    build(); on('forma:content', build);
  }

  F.pages = F.pages || {};
  F.pages.characters = initCharacters;
})(window.FORMA = window.FORMA || {});
