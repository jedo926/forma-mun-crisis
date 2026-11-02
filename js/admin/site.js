/* FORMA MUN · Crisis Division — Admin: public page text
   The list of editable text is read from the pages themselves: tag anything with data-edit and it
   appears here, so there is no second list to maintain. Blank means "use the page's own text". */
(function (F) {
  'use strict';
  const { NAV, $, h } = F;
  const A = F.Admin;
  const { hint, ta } = A.ui;

  let pages = null;    // [{ label, fields: [{ key, text }] }]
  let filter = '';

  async function readPages() {
    const parser = new DOMParser();
    const list = await Promise.all(NAV.map(async (n) => {
      const res = await fetch(n.file, { cache: 'no-store' });
      if (!res.ok) return null;
      const doc = parser.parseFromString(await res.text(), 'text/html');
      const fields = Array.from(doc.querySelectorAll('[data-edit]')).map((el) => ({ key: el.dataset.edit, text: F.SiteCopy.getText(el) }));
      return fields.length ? { label: n.menu || n.label, fields } : null;
    }));
    return list.filter(Boolean);
  }

  function field(f) {
    const edited = typeof A.site[f.key] === 'string';
    const box = ta(edited ? A.site[f.key] : f.text, (v) => {
      if (!v.trim() || v.trim() === f.text) delete A.site[f.key];
      else A.site[f.key] = v;
      row.classList.toggle('changed', typeof A.site[f.key] === 'string');
    }, f.text);
    box.setAttribute('aria-label', f.text.slice(0, 60));
    box.rows = f.text.length > 90 ? 4 : 1;
    box.className = 'input site-text';
    box.dataset.siteKey = f.key;
    const row = h('div', { class: 'site-row' + (edited ? ' changed' : '') }, box);
    return row;
  }

  function render() {
    const body = $('[data-site-body]');
    if (!body) return;
    body.innerHTML = '';
    if (!pages) { body.append(hint('Loading the pages…')); return; }
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search page text…', 'aria-label': 'Search page text', dataset: { siteSearch: '' } });
    search.value = filter;
    const list = h('div', { class: 'ed-list' });
    const paint = () => {
      list.innerHTML = '';
      const q = filter.trim().toLowerCase();
      pages.forEach((p) => {
        const fields = p.fields.filter((f) => !q || f.text.toLowerCase().includes(q) || String(A.site[f.key] || '').toLowerCase().includes(q));
        if (!fields.length) return;
        const edits = fields.filter((f) => typeof A.site[f.key] === 'string').length;
        const node = h('details', { class: 'ed-fold', open: q ? true : null },
          h('summary', null, h('span', { class: 'fold-title', text: p.label }), h('span', { class: 'fold-sub', text: `${fields.length} text blocks${edits ? ` · ${edits} changed` : ''}` })));
        let built = false;
        const build = () => { if (!built) { built = true; node.append(h('div', { class: 'ed-card' }, fields.map(field))); } };
        node.addEventListener('toggle', () => { if (node.open) build(); });
        if (q) build();
        list.append(node);
      });
      if (!list.childNodes.length) list.append(hint('No page text matches.'));
    };
    search.addEventListener('input', () => { filter = search.value; paint(); });
    body.append(h('div', { class: 'notice-warn' }, h('strong', null, 'PUBLIC NOW'),
      ' — this text is visible to everyone as soon as you publish, even before release. Keep the scenario out of it. Use **double asterisks** for bold. Clear a box to go back to the original text.'), search, list);
    paint();
  }

  A.renderSite = render;
  A.onPanel.site = async () => {
    render();
    if (!pages) {
      render();
      try { pages = await readPages(); } catch (e) { pages = []; }
    }
    render();
  };
})(window.FORMA = window.FORMA || {});
