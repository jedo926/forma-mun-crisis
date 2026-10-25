/* FORMA MUN · Crisis Division — Crisis updates page
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $, $$, arr, str, h, paragraphs, on, fmtStamp, Sound, Release, emptyNote } = F;

  /* ---------------- Crisis updates ---------------- */
  const SAMPLE_UPDATES = [
    { priority: 'critical', title: 'Sample alert — interface test, not an official update', detail: 'This is placeholder text used to demonstrate how a critical alert will look. It contains no scenario information.' },
    { priority: 'high', title: 'Sample alert — directive received (format demo)', detail: 'Placeholder entry showing a high-priority item with an expandable body.' },
    { priority: 'medium', title: 'Sample alert — press note (format demo)', detail: 'Placeholder entry. Official updates replace these once the chairs publish them.' },
    { priority: 'low', title: 'Sample alert — system check (format demo)', detail: 'Placeholder entry for low-priority notices.' }
  ];
  function initUpdates() {
    const feed = $('#feed'); const chip = $('[data-feed-chip]'); const note = $('[data-feed-note]');
    let filter = 'all'; let items = [];
    const prios = ['critical', 'high', 'medium', 'low'];
    function load() {
      const official = Release.status === 'released' && Release.content ? arr(Release.content.updates) : [];
      if (official.length) {
        items = official.map((u) => ({ official: true, priority: prios.includes(u.priority) ? u.priority : 'medium', title: str(u.title, 200) || 'UPDATE', detail: u.detail, time: u.time }));
        items.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
        chip.textContent = 'OFFICIAL FEED'; chip.className = 'lock-chip open';
        note.textContent = 'Official updates published by the chairs. The feed refreshes from the release server every few minutes; it is not a real-time stream.';
      } else {
        items = SAMPLE_UPDATES.map((u) => Object.assign({ official: false, time: '' }, u));
        chip.textContent = 'SAMPLE FEED'; chip.className = 'lock-chip sample';
        note.textContent = 'These entries are SAMPLES that show the alert format. No official updates have been published yet.';
      }
      render();
    }
    function render() {
      feed.innerHTML = '';
      const shown = items.filter((u) => filter === 'all' || u.priority === filter);
      shown.forEach((u, i) => {
        const id = 'al-' + i;
        const body = h('div', { class: 'abody', id, hidden: true }, paragraphs(u.detail));
        const btn = h('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': id },
          h('span', { class: 'prio ' + u.priority, text: u.priority.toUpperCase() }),
          h('span', { class: 'atitle', text: u.title }),
          u.official ? h('span', { class: 'official-tag', text: 'OFFICIAL' }) : h('span', { class: 'sample-tag', text: 'SAMPLE · NOT OFFICIAL' }),
          u.time ? h('span', { class: 'atime', text: fmtStamp(u.time) }) : null);
        btn.addEventListener('click', () => { const o = body.hidden; body.hidden = !o; btn.setAttribute('aria-expanded', String(o)); Sound.play('move'); });
        feed.append(h('li', { class: 'alert' + (u.official ? '' : ' sample') }, btn, body));
      });
      if (!shown.length) feed.append(h('li', null, emptyNote('NO ALERTS AT THIS PRIORITY')));
    }
    $$('.filter-btn').forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.filter; $$('.filter-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); Sound.play('move');
    }));
    load(); on('forma:content', load);
  }

  F.pages = F.pages || {};
  F.pages.updates = initUpdates;
})(window.FORMA = window.FORMA || {});
