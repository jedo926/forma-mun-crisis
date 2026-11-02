/* FORMA MUN · Crisis Division — Admin: see the real pages, click text and type.
   Pages load in a same-origin frame named "forma-embed", which they read as "stay quiet: no server
   checks, no intro, no sound". This module hands the frame the content being edited, so what shows
   is always the latest work, saved or not. Preview uses the same frame with editing switched off,
   so it needs no pop-up and no new tab.

   Nothing on the public pages knows about editing. Public text is found by its data-edit key, and
   scenario text is found by matching what is on the page against the content, so any new page or
   field works without extra code. */
(function (F) {
  'use strict';
  const { NAV, $, $$, h, toast, Sound } = F;
  const A = F.Admin;

  const FRAME_NAME = 'forma-embed';
  // Values that aren't prose: ids, colours, coordinates and fixed choices stay in the forms.
  const NOT_TEXT = new Set(['id', 'members', 'relations', 'look', 'color', 'kind', 'priority', 'time', 'x', 'y', 'url', 'portrait', 'image', 'classification', 'type', 'updates']);
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const PARA = /\n{2,}/;

  let posted = null;                       // live updates, shown in the page like any visitor would see
  const edit = { frame: null, page: 'index.html', view: 'after' };
  const preview = { frame: null, view: 'after' };

  // ---- content ----
  /** text on the page → every place in the content holding that text */
  function indexContent() {
    const index = new Map();
    const add = (text, entry) => { const k = norm(text); if (k.length < 2) return; if (!index.has(k)) index.set(k, []); index.get(k).push(entry); };
    const walk = (node, path) => {
      if (typeof node === 'string') {
        const parts = node.split(PARA);
        add(node, { path, para: null });
        if (parts.length > 1) parts.forEach((p, para) => add(p, { path, para }));
      } else if (Array.isArray(node)) node.forEach((v, i) => walk(v, path.concat(i)));
      else if (node && typeof node === 'object') Object.keys(node).forEach((k) => { if (!NOT_TEXT.has(k)) walk(node[k], path.concat(k)); });
    };
    walk(A.content, []);
    return index;
  }
  function writeAt({ path, para }, text) {
    const key = path[path.length - 1];
    const owner = path.slice(0, -1).reduce((o, k) => o[k], A.content);
    if (para === null) { owner[key] = text; return; }
    const parts = owner[key].split(PARA);
    parts[para] = text;
    owner[key] = parts.join('\n\n');
  }
  async function loadPosted() {
    const { res, data } = await A.get('updates').catch(() => ({ res: { ok: false }, data: null }));
    posted = res.ok && data ? data.updates : null;
  }
  const shownContent = () => Object.assign(JSON.parse(JSON.stringify(A.content)), posted ? { updates: posted } : {});

  // ---- the frame ----
  function makeFrame(box, onLoad) {
    box.innerHTML = '';
    const frame = h('iframe', { name: FRAME_NAME, class: 'site-frame', title: 'Site page' });
    frame.addEventListener('load', () => { if (frame.getAttribute('src')) onLoad(frame); });
    box.append(frame);
    return frame;
  }
  /** Returns the frame's site API once its page has booted. */
  function fill(frame, view) {
    const win = frame.contentWindow;
    if (!win || !win.FORMA || !win.FORMA.Release) return null;
    const site = win.FORMA;
    const defaults = {};
    $$('[data-edit]', win.document).forEach((el) => { defaults[el.dataset.edit] = site.SiteCopy.getText(el); });
    site.SiteCopy.apply(A.site);
    if (view === 'after' && A.contentReady) site.Release.setContent(shownContent());
    return { site, win, doc: win.document, defaults };
  }

  // ---- click to edit ----
  function bindEditing(api) {
    const { site, win, doc, defaults } = api;
    let index = indexContent();

    doc.head.append(h('style', { text: `
      [data-vedit] { outline: 2px dashed rgba(0, 245, 255, .55); outline-offset: 2px; cursor: text; }
      [data-vedit="scenario"] { outline-color: rgba(255, 43, 214, .6); }
      [data-vedit]:hover { outline-style: solid; background: rgba(0, 245, 255, .1); }
      [data-vedit="scenario"]:hover { background: rgba(255, 43, 214, .1); }
      [data-vedit][contenteditable] { outline: 3px solid #fff; background: #000; color: #fff; }
    ` }));

    function tag() {
      $$('[data-edit]', doc).forEach((el) => el.setAttribute('data-vedit', 'site'));
      $$('main *, .modal *', doc).forEach((el) => {
        if (el.children.length || el.hasAttribute('data-vedit') || el.closest('[data-edit], script, style, select, label')) return;
        const btn = el.closest('button');
        if (btn && !btn.hasAttribute('aria-expanded')) return;   // buttons that open things keep opening them
        if (index.has(norm(el.textContent))) el.setAttribute('data-vedit', 'scenario');
      });
    }

    function commit(el, before, cancelled) {
      el.removeAttribute('contenteditable');
      const text = norm(el.textContent);
      const isSite = el.getAttribute('data-vedit') === 'site';
      if (cancelled || text === before) { if (isSite) site.SiteCopy.setText(el, before); else el.textContent = before; return; }
      if (isSite) {
        const key = el.dataset.edit;
        if (!text || text === defaults[key]) delete A.site[key]; else A.site[key] = text;
        site.SiteCopy.setText(el, text || defaults[key]);
      } else {
        if (!text) { el.textContent = before; toast('TEXT CANNOT BE EMPTY · USE MORE → ALL FIELDS TO REMOVE AN ITEM'); return; }
        (index.get(before) || []).forEach((entry) => writeAt(entry, text));
        index = indexContent();
        el.textContent = text;
      }
      A.markDirty();
      Sound.play('select');
    }

    function begin(el) {
      if (el.isContentEditable) return;
      const isSite = el.getAttribute('data-vedit') === 'site';
      const before = isSite ? site.SiteCopy.getText(el) : norm(el.textContent);
      if (isSite) el.textContent = before;   // shows **bold** markers while editing
      try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; }
      if (el.contentEditable === 'inherit') el.contentEditable = 'true';
      let cancelled = false;
      const key = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
        if (e.key === 'Escape') { cancelled = true; el.blur(); }
      };
      el.addEventListener('keydown', key);
      el.addEventListener('keyup', (e) => e.stopPropagation());
      el.addEventListener('blur', () => { el.removeEventListener('keydown', key); commit(el, before, cancelled); }, { once: true });
      el.focus();
      const range = doc.createRange();
      range.selectNodeContents(el); range.collapse(false);
      const sel = win.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }

    doc.addEventListener('click', (e) => {
      const el = e.target.closest('[data-vedit]');
      const btn = e.target.closest('button');
      if (el && !(btn && btn.getAttribute('aria-expanded') === 'false')) {
        e.preventDefault(); e.stopPropagation();
        begin(el);
        return;
      }
      const a = e.target.closest('a[href]');
      if (a) {
        e.preventDefault(); e.stopPropagation();
        const file = a.getAttribute('href').split(/[?#]/)[0];
        if (NAV.some((n) => n.file === file)) openPage(file);
      }
    }, true);

    let timer = 0;
    new win.MutationObserver(() => { clearTimeout(timer); timer = setTimeout(tag, 120); }).observe(doc.body, { childList: true, subtree: true });
    tag();
  }

  // ---- edit panel ----
  function paintBar() {
    const bar = $('[data-vis-pages]');
    bar.innerHTML = '';
    NAV.forEach((n) => bar.append(h('button', { class: 'chip-btn' + (n.file === edit.page ? ' active' : ''), type: 'button', dataset: { visPage: n.file }, onclick: () => openPage(n.file) }, n.label)));
    $$('[data-vis-view]').forEach((b) => b.classList.toggle('active', b.dataset.visView === edit.view));
  }
  function openPage(file) {
    edit.page = file;
    paintBar();
    if (edit.frame) edit.frame.src = file;
  }
  function onEditLoad(frame) {
    const api = fill(frame, edit.view);
    if (api) bindEditing(api);
  }
  async function showEdit() {
    if (!edit.frame) edit.frame = makeFrame($('[data-vis-frame]'), onEditLoad);
    await loadPosted();
    openPage(edit.page);
  }

  // ---- preview ----
  function paintPreview() {
    $$('[data-prev-view]').forEach((b) => b.classList.toggle('active', b.dataset.prevView === preview.view));
    $('[data-prev-reveal]').hidden = preview.view !== 'after';
    $('[data-prev-note]').textContent = preview.view === 'after' ? 'AFTER RELEASE · YOUR LATEST CHANGES' : 'BEFORE RELEASE · WHAT VISITORS SEE NOW';
  }
  function loadPreview() {
    paintPreview();
    if (!preview.frame) preview.frame = makeFrame($('[data-prev-frame]'), (frame) => fill(frame, preview.view));
    preview.frame.src = 'index.html';
  }
  async function openPreview() {
    if (!A.contentReady) { toast('STILL LOADING · TRY AGAIN IN A MOMENT'); return; }
    await loadPosted();
    $('[data-preview-overlay]').hidden = false;
    document.body.classList.add('no-scroll');
    loadPreview();
    $('[data-prev-close]').focus();
  }
  function closePreview() {
    $('[data-preview-overlay]').hidden = true;
    document.body.classList.remove('no-scroll');
    if (preview.frame) preview.frame.removeAttribute('src');
  }
  function playReveal() {
    const win = preview.frame && preview.frame.contentWindow;
    if (win && win.FORMA && win.FORMA.playReveal) win.FORMA.playReveal(shownContent());
  }

  function init() {
    paintBar();
    $$('[data-vis-view]').forEach((b) => b.addEventListener('click', () => { edit.view = b.dataset.visView; openPage(edit.page); }));
    $('[data-a="preview"]').addEventListener('click', openPreview);
    $('[data-prev-close]').addEventListener('click', closePreview);
    $('[data-prev-reveal]').addEventListener('click', playReveal);
    $$('[data-prev-view]').forEach((b) => b.addEventListener('click', () => { preview.view = b.dataset.prevView; loadPreview(); }));
    $('[data-prev-newtab]').addEventListener('click', (e) => { e.currentTarget.href = 'index.html?preview=1#at=' + encodeURIComponent(A.token()); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('[data-preview-overlay]').hidden) closePreview(); });
  }

  A.onPanel.edit = showEdit;
  A.onContent = () => { if (edit.frame && !$('[data-panel-id="edit"]').hidden) openPage(edit.page); };
  A.visualInit = init;
})(window.FORMA = window.FORMA || {});
