/* FORMA MUN · Crisis Division — Admin: form building blocks */
(function (F) {
  'use strict';
  const { h, arr } = F;

  let fieldCount = 0;
  /** Browsers want an id or name on every form field. These fields are rebuilt often, so number them. */
  const fieldAttrs = () => { fieldCount += 1; return { id: 'field-' + fieldCount, name: 'field-' + fieldCount, autocomplete: 'off' }; };

  const lbl = (text) => h('span', { class: 'ed-lbl', text });
  const erow = (...kids) => h('div', { class: 'ed-row' }, ...kids);
  const efull = (...kids) => h('div', { class: 'ed-row ed-full' }, ...kids);
  const ecard = (...kids) => h('div', { class: 'ed-card' }, ...kids);
  const hint = (text) => h('p', { class: 'muted ed-hint', text });
  const esect = (text) => h('h3', { class: 'ed-section', text });

  function dbtn(onClick) {
    return h('button', { class: 'ed-del', type: 'button', title: 'Remove this item', 'aria-label': 'Remove this item', onclick: onClick }, '✕');
  }
  function abtn(label, onClick) {
    return h('button', { class: 'btn ed-add', type: 'button', onclick: onClick }, '+ ' + label);
  }
  /** A plain action button. abtn is only for adding something, because it puts a + in front. */
  function pbtn(label, onClick, cls) {
    return h('button', { class: 'btn ' + (cls || ''), type: 'button', onclick: onClick }, label);
  }
  /**
   * Names pasted from Excel, WhatsApp or Word. Several lines give one name each (the first real
   * column when tabs are present); a single line is split on commas or semicolons. Numbers and
   * bullets in front are dropped, and repeats are removed.
   */
  function parseNames(text) {
    const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
    const firstCell = (l) => l.split('\t').find((c) => c.trim() && !/^\s*\d+[.)]?\s*$/.test(c)) || '';
    const parts = lines.length > 1 ? lines.map(firstCell) : lines.flatMap((l) => l.split(/[\t,;]/));
    const seen = new Set();
    return parts.map((p) => p.replace(/^\s*(?:\d+[.):-]\s*|\d+\s+|[•·*–—-]\s*)/, '').trim().slice(0, 80)).filter((n) => {
      const key = n.toLowerCase();
      if (!n || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function tf(val, onInput, placeholder) {
    const el = h('input', Object.assign(fieldAttrs(), { class: 'input', type: 'text', placeholder: placeholder || '' }));
    el.value = val || '';
    el.addEventListener('input', () => onInput(el.value));
    return el;
  }
  function ta(val, onInput, placeholder, cls) {
    const el = h('textarea', Object.assign(fieldAttrs(), { class: 'input ' + (cls || 'ta-sm'), placeholder: placeholder || '' }));
    el.value = val || '';
    el.addEventListener('input', () => onInput(el.value));
    return el;
  }
  /** A dropdown that always keeps the stored value as an option, even an unusual one. */
  function dd(options, current, onChange) {
    const list = options.slice();
    if (current && !list.some(([v]) => v === current)) list.unshift([current, current]);
    const el = h('select', Object.assign(fieldAttrs(), { class: 'input dd-sm' }));
    list.forEach(([v, text]) => {
      const o = h('option', { value: v, text });
      if (v === current) o.selected = true;
      el.append(o);
    });
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }
  function cpick(val, onChange) {
    const el = h('input', Object.assign(fieldAttrs(), { class: 'cpick', type: 'color', 'aria-label': 'Pick a colour' }));
    el.value = val || '#000000';
    el.addEventListener('input', () => onChange(el.value));
    return el;
  }
  function checkbox(label, checked, onChange) {
    const cb = h('input', Object.assign(fieldAttrs(), { type: 'checkbox' }));
    cb.checked = !!checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'cb-lbl' }, cb, ' ' + label);
  }
  /** Text that may be stored as one string or a list of paragraphs. Keeps the stored form. */
  function paras(obj, key, placeholder, cls) {
    const wasList = Array.isArray(obj[key]);
    const shown = wasList ? arr(obj[key]).join('\n\n') : obj[key];
    return ta(shown, (v) => {
      obj[key] = wasList ? v.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean) : v;
    }, placeholder, cls);
  }
  /** Sets a value, or removes the key when blank, so empty fields don't add noise to the content. */
  const setOrClear = (obj, key) => (v) => { if (v) obj[key] = v; else delete obj[key]; };

  /** A collapsed row whose form is only built when opened, so long lists stay fast. */
  function fold(title, sub, build) {
    const titleEl = h('span', { class: 'fold-title', text: title });
    const node = h('details', { class: 'ed-fold' }, h('summary', null, titleEl, sub ? h('span', { class: 'fold-sub', text: sub }) : null));
    let built = false;
    node.addEventListener('toggle', () => {
      if (node.open && !built) { built = true; node.append(build(titleEl)); }
    });
    return node;
  }

  F.Admin.ui = { fieldAttrs, lbl, erow, efull, ecard, hint, esect, dbtn, abtn, pbtn, parseNames, tf, ta, dd, cpick, checkbox, paras, setOrClear, fold };
})(window.FORMA = window.FORMA || {});
