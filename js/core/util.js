/* FORMA MUN · Crisis Division — DOM helpers, storage, events, time formatting
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { CONFIG } = F;

  /* ---------------- Utilities ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max = 6000) => (typeof v === 'string' ? v.slice(0, max) : (typeof v === 'number' ? String(v) : ''));
  const reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false || kid === '') continue;
      n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  function paragraphs(v) {
    const list = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/\n{2,}/) : []);
    return list.map((p) => str(p)).filter(Boolean).map((p) => h('p', { text: p }));
  }
  function safeUrl(u) {
    const s = str(u, 2000).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return ''; // block javascript:, data:, etc.
    if (s.startsWith('//')) return '';
    return s; // relative path
  }
  const makeStore = (area) => ({
    get(k, d) { try { const v = window[area].getItem('forma:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { window[area].setItem('forma:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  });
  const store = makeStore('localStorage');
  const session = makeStore('sessionStorage');
  const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const on = (name, fn) => document.addEventListener(name, (e) => fn(e.detail));

  function toast(msg) {
    const root = $('#toast-root');
    if (!root) return;
    const t = h('div', { class: 'toast', role: 'status', text: msg });
    root.append(t);
    setTimeout(() => t.remove(), 3400);
  }

  const tzFmt = (opts) => { try { return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: CONFIG.timezone }, opts)); } catch (e) { return new Intl.DateTimeFormat('en-GB', opts); } };
  const clockFmt = tzFmt({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const stampFmt = tzFmt({ day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  function fmtStamp(v) { const t = Date.parse(v); return Number.isFinite(t) ? stampFmt.format(t).toUpperCase() : str(v, 60); }

  Object.assign(F, { $, $$, pad, clamp, arr, str, reducedMotionQuery, h, paragraphs, safeUrl, makeStore, store, session, isTyping, emit, on, toast, tzFmt, clockFmt, stampFmt, fmtStamp });
})(window.FORMA = window.FORMA || {});
