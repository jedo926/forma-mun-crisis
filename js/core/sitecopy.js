/* FORMA MUN · Crisis Division — Editable public page text
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA.

   Any element tagged data-edit="page.key" can be changed from the admin panel without touching
   HTML. The page's own text stays the default, so a failed request leaves the page as written.
   To make new text editable, add a data-edit key to it: the admin panel finds it by itself.

   Saved text is applied as text, never as HTML. **double asterisks** mark bold. */
(function (F) {
  'use strict';
  const { CONFIG, $$, h, DEMO, PREVIEW } = F;

  /** Replace an element's text, turning **bold** into <strong>. */
  function setText(el, text) {
    el.textContent = '';
    String(text).split('**').forEach((part, i) => {
      if (part) el.append(i % 2 ? h('strong', { text: part }) : document.createTextNode(part));
    });
  }

  /** The element's current text in the same **bold** form, for the admin editor. */
  function getText(el) {
    return Array.from(el.childNodes).map((n) => (n.nodeName === 'STRONG' ? '**' + n.textContent + '**' : n.textContent))
      .join('').replace(/\s+/g, ' ').trim();
  }

  function apply(map) {
    if (!map || typeof map !== 'object') return;
    $$('[data-edit]').forEach((el) => {
      const v = map[el.dataset.edit];
      if (typeof v === 'string' && v.trim()) setText(el, v);
    });
  }

  async function load() {
    if (location.protocol === 'file:' || DEMO || PREVIEW || !$$('[data-edit]').length) return;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const killer = setTimeout(() => ctrl && ctrl.abort(), 3000);
    try {
      const res = await fetch(CONFIG.siteEndpoint, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (res.ok) { const data = await res.json(); apply(data && data.site); }
    } catch (e) { /* the page keeps its own text */ }
    clearTimeout(killer);
  }

  F.SiteCopy = { setText, getText, apply, load };
})(window.FORMA = window.FORMA || {});
