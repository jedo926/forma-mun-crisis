/* FORMA MUN · Crisis Division — Admin: live committee, the shared part
   Holds the state, the tabs and the Directives tab. RUN CAUCUS is in committee-run.js and DELEGATES
   in committee-delegates.js; they register in A.comm.views. Everything saves as you go. */
(function (F) {
  'use strict';
  const { $, h, toast, session, fmtStamp, isTyping, Sound } = F;
  const A = F.Admin;
  const { fieldAttrs, lbl, ecard, hint, dbtn, pbtn, ta } = A.ui;

  // New directives are reviewed in the Crisis Room. This tab only tidies old public ones.
  const TABS = [['run', 'RUN CAUCUS'], ['delegates', 'DELEGATES'], ['directives', 'OLD DIRECTIVES']];
  const C = A.comm = { data: null, delegates: [], views: {}, tab: session.get('commTab', 'run') };

  let open = false;
  let pending = 0;        // changes on their way to the server
  let changes = 0;        // total changes sent, to spot a reading that is already out of date
  let chain = Promise.resolve();
  let shown = '';         // what is on screen, to skip needless redraws
  let stale = false;      // something changed while the chair was typing
  let dirFilter = '';

  const bodyEl = () => $('[data-committee-body]');
  const fresh = () => { const d = C.data || {}; return JSON.stringify([d.caucus, d.directives, d.kvReady, C.delegates, A.status && A.status.delegateCode]); };
  const typingHere = () => { const el = document.activeElement; return isTyping(el) && bodyEl().contains(el); };

  /** Sends one change. Changes go one at a time, so fast tapping can't overwrite itself. */
  C.send = (action, body) => {
    pending += 1;
    changes += 1;
    const job = chain.then(() => A.committeePost(action, body)).catch(() => ({ res: { ok: false }, data: null })).then(({ res, data }) => {
      pending -= 1;
      if (res.ok && data && data.ok) return data;
      return { ok: false, code: data && data.code, expired: res.status === 401 };
    });
    chain = job;
    return job;
  };
  C.isOpen = () => open;
  C.idle = () => pending === 0;
  /** For failed changes. An expired session has already gone to the login screen. */
  C.fail = (r, text) => { if (r.expired) return; toast(text); Sound.play('error'); };
  C.search = (placeholder, value, onInput) => {
    const el = h('input', Object.assign(fieldAttrs(), { class: 'input', type: 'text', placeholder, 'aria-label': placeholder }));
    el.value = value;
    el.addEventListener('input', () => onInput(el.value));
    return el;
  };

  /** The box for a pasted list of names, which says what will happen before anything is added. */
  C.pasteBox = ({ text, onText, known, addLabel, onAdd, onCancel }) => {
    const count = h('span', { class: 'admin-msg', dataset: { pasteCount: '' } });
    const add = pbtn(addLabel, () => onAdd(A.ui.parseNames(text)), 'mag');
    const box = ta(text, (v) => { text = v; onText(v); update(); }, 'Paste or type names. One per line, or separated by commas.', 'ta-lg');
    box.dataset.pasteBox = '';
    function update() {
      const names = A.ui.parseNames(text);
      const repeats = names.filter(known).length;
      const newOnes = names.length - repeats;
      count.textContent = names.length ? `${newOnes} NEW${repeats ? ` · ${repeats} ALREADY THERE` : ''}` : '';
      add.disabled = !newOnes;
    }
    update();
    return ecard(lbl('PASTE A LIST'), box, h('div', { class: 'comm-ctrl-row comm-mid' }, add, pbtn('CANCEL', onCancel), count));
  };

  function renderTabs() {
    const count = ((C.data && C.data.directives) || []).length;
    return h('div', { class: 'comm-tabs', role: 'group', 'aria-label': 'Committee sections' }, TABS.filter(([id]) => id !== 'directives' || count).map(([id, label]) => h('button', {
      class: 'chip-btn' + (id === C.tab ? ' active' : ''), type: 'button', 'aria-pressed': String(id === C.tab), dataset: { commTab: id },
      onclick: () => { C.tab = id; session.set('commTab', id); Sound.play('move'); C.render(); pull(true); }
    }, id === 'directives' && count ? `${label} (${count})` : label)));
  }

  C.render = () => {
    const body = bodyEl();
    if (!open) return;
    const y = window.scrollY;
    shown = fresh();
    stale = false;
    body.innerHTML = '';
    if (!C.data) { body.append(hint('Loading committee state…')); return; }
    if (!C.data.kvReady) {
      body.append(h('div', { class: 'comm-banner' }, '⚠ COMMITTEE FEATURES NEED THE VERCEL KV STORE. Connect it under Project → Storage, then redeploy once.'), pbtn('REFRESH', () => pull(true)));
      return;
    }
    const pane = h('div', { dataset: { commPane: C.tab } });
    body.append(renderTabs(), pane);
    C.views[C.tab](pane);
    window.scrollTo(0, y);
  };

  /** Reads the server. Redraws only when something changed, and never over someone typing. */
  async function pull(first) {
    const seen = changes;
    const fail = () => ({ res: { ok: false }, data: null });
    const [main, list] = await Promise.all([
      A.committeeGet().catch(fail),
      C.tab === 'directives' && !first ? null : A.committeeDelegates().catch(fail)
    ]);
    if (seen !== changes || pending) return;       // a newer change is on its way, so this is old
    if (!main.res.ok || !main.data || !main.data.ok) { if (first) toast('COULD NOT LOAD COMMITTEE STATE'); return; }
    if (A.token() && main.data.admin === false) { A.logout('SESSION EXPIRED · LOG IN AGAIN'); return; }
    const st = Date.parse(main.data.serverTime);
    if (Number.isFinite(st)) A.clockOffset = st - Date.now();
    C.data = main.data;
    if (list && list.res.ok && list.data && list.data.ok) C.delegates = list.data.delegates;
    if (!first && fresh() === shown && !stale) return;
    if (typingHere()) { stale = true; return; }
    C.render();
  }
  C.pull = pull;

  function schedule() {
    const c = C.data && C.data.caucus;
    const live = c && (c.status === 'active' || c.status === 'paused');
    setTimeout(async () => {
      if (open && A.token() && !document.hidden) await pull();
      schedule();
    }, live ? 5000 : 15000);
  }
  schedule();

  // ---- directives ----
  function directiveCard(d) {
    return h('div', { class: 'comm-dir-card', dataset: { directive: d.id } },
      h('div', { class: 'comm-dir-header' },
        h('span', { class: 'comm-dir-delegation', text: d.delegation }),
        h('span', { class: 'comm-dir-time', text: fmtStamp(d.time) }),
        dbtn(async () => {
          if (!confirm(`Delete this directive from ${d.delegation}? This can't be undone.`)) return;
          const r = await C.send('del-directive', { id: d.id });
          if (!r.ok) { C.fail(r, 'COULD NOT DELETE DIRECTIVE'); return; }
          Sound.play('select');
          C.data.directives = C.data.directives.filter((x) => x.id !== d.id);
          C.render();
        })),
      h('div', { class: 'comm-dir-text', text: d.text }));
  }

  C.views.directives = (body) => {
    if (!(C.data.directives || []).length) { C.tab = 'run'; C.views.run(body); return; }
    const dirs = (C.data.directives || []).slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    body.append(hint('These were posted before delegate logins. They stay public until you delete them. New directives are in the Crisis Room.'));
    const list = h('div');
    const paint = () => {
      const q = dirFilter.trim().toLowerCase();
      const match = dirs.filter((d) => !q || `${d.delegation} ${d.text}`.toLowerCase().includes(q));
      list.innerHTML = '';
      if (!dirs.length) list.append(hint('No directives yet. New ones appear here by themselves.'));
      else if (!match.length) list.append(hint('No directives match.'));
      list.append(...match.map(directiveCard));
    };
    if (dirs.length) body.append(C.search('Search by delegation or text…', dirFilter, (v) => { dirFilter = v; paint(); }));
    body.append(list);
    paint();
  };

  A.onPanel.committee = () => { open = true; C.render(); pull(true); };
  A.onPanelLeave = () => { open = false; };
  A.onLogout.push(() => { open = false; C.data = null; C.delegates = []; });
})(window.FORMA = window.FORMA || {});
