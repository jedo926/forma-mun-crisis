/* FORMA MUN · Crisis Division — Locations page
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $, pad, clamp, arr, str, h, paragraphs, safeUrl, on, Settings, Sound, showReleased, emptyNote } = F;

  /* ---------------- Locations ---------------- */
  function initLocations() {
    const scr = $('.map .scramble');
    if (scr) {
      const g = scr.getContext('2d'); scr.width = 160; scr.height = 100;
      const paint = () => { for (let i = 0; i < 260; i++) { g.fillStyle = ['#7857FF', '#00F5FF', '#FF2BD6', '#111326'][i % 4]; g.fillRect(Math.floor(Math.random() * 160), Math.floor(Math.random() * 100), 2, 2); } g.fillStyle = 'rgba(7,8,18,.35)'; g.fillRect(0, 0, 160, 100); };
      paint(); const iv = setInterval(() => { if (!Settings.lowMotion && !scr.hidden) paint(); }, 180);
      on('forma:content', () => clearInterval(iv));
    }
    on('forma:content', (c) => {
      const v = showReleased(c); if (!v) return; v.innerHTML = '';
      const locs = arr(c.locations).filter((l) => l && str(l.name));
      const mapCfg = (c.map && typeof c.map === 'object') ? c.map : {};
      if (!locs.length) { v.append(emptyNote('NO LOCATIONS PUBLISHED IN THE APPROVED MATERIAL')); return; }
      const map = h('div', { class: 'map', role: 'group', 'aria-label': str(mapCfg.label, 120) || 'Schematic map' }, h('div', { class: 'sweep', 'aria-hidden': 'true' }));
      const img = safeUrl(mapCfg.image); if (img) map.prepend(h('img', { class: 'map-image', src: img, alt: '' }));
      const info = h('div', { class: 'panel panel-neon', 'aria-live': 'polite' }, h('p', { class: 'muted', text: 'Select a marker or a location from the list.' }));
      const list = h('ul', { class: 'loc-list' });
      const btns = [];
      const pick = (i) => {
        const l = locs[i]; btns.forEach((b) => b.forEach((x) => x && x.setAttribute('aria-pressed', 'false')));
        btns[i].forEach((x) => x && x.setAttribute('aria-pressed', 'true'));
        info.innerHTML = '';
        info.append(h('span', { class: 'label cyan', text: str(l.type, 40) || 'LOCATION' }), h('h2', { style: 'margin-top:14px', text: str(l.name, 120) }), paragraphs(l.description));
        Sound.play('select');
      };
      locs.forEach((l, i) => {
        const x = Number(l.x), y = Number(l.y); let pin = null;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          pin = h('button', { class: 'pin', type: 'button', 'aria-pressed': 'false', 'aria-label': str(l.name, 120), title: str(l.name, 120), style: `left:${clamp(x, 0, 100)}%;top:${clamp(y, 0, 100)}%` });
          pin.addEventListener('click', () => pick(i)); map.append(pin);
        }
        const lb = h('button', { type: 'button', 'aria-pressed': 'false', text: pad(i + 1) + ' · ' + str(l.name, 120) });
        lb.addEventListener('click', () => pick(i)); list.append(h('li', null, lb));
        btns.push([pin, lb]);
      });
      v.append(h('div', { class: 'map-wrap' },
        h('div', null, map, h('p', { class: 'map-note', text: str(mapCfg.note, 300) || 'SCHEMATIC · POSITIONS AS SUPPLIED BY THE CHAIRS · NOT TO SCALE' })),
        h('div', { class: 'stack' }, info, h('div', { class: 'panel' }, h('h3', { text: 'LOCATIONS' }), list))));
    });
  }

  F.pages = F.pages || {};
  F.pages.locations = initLocations;
})(window.FORMA = window.FORMA || {});
