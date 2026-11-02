/* FORMA MUN · Crisis Division — Admin: Crisis Room
   One place to see the session and what has happened. The caucus itself still runs from the
   Committee tab. Browsers poll a small change counter and only read everything when it moves. */
(function (F) {
  'use strict';
  const { $, h, toast, session, fmtStamp, isTyping, Sound } = F;
  const A = F.Admin;
  const { fieldAttrs, lbl, ecard, hint, esect, pbtn, ta } = A.ui;

  const TABS = [['live', 'LIVE'], ['log', 'FULL LOG']];
  const PAGE = 50;
  const POLL_MS = 5000;
  const R = A.crisis = { state: null, tab: session.get('crisisTab', 'live') };

  let open = false;
  let rev = -1;
  let pending = 0;
  let chain = Promise.resolve();
  let stale = false;
  let online = true;
  let noteText = '';
  let log = { entries: [], total: 0, loaded: false };

  const bodyEl = () => $('[data-crisis-body]');
  const typingHere = () => { const el = document.activeElement; return isTyping(el) && bodyEl().contains(el); };
  const opId = () => 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const chairName = () => session.get('chairName', '');
  /** Redraws, unless that would wipe what a chair is typing. */
  const redraw = () => { if (typingHere()) stale = true; else R.render(); };

  /** Sends one change. Changes go one at a time, and the same opId is safe to repeat. */
  R.send = (action, body) => {
    pending += 1;
    const job = chain.then(() => A.crisisPost(action, Object.assign({ opId: opId() }, body))).catch(() => ({ res: { ok: false }, data: null })).then(({ res, data }) => {
      pending -= 1;
      if (res.ok && data && data.ok) return data;
      return { ok: false, code: data && data.code, expired: res.status === 401 };
    });
    chain = job;
    return job;
  };

  async function pullState() {
    const { res, data } = await A.crisisGet('state').catch(() => ({ res: { ok: false }, data: null }));
    online = !!res.ok;
    if (!res.ok || !data || !data.ok) { redraw(); return; }
    const st = Date.parse(data.serverTime);
    if (Number.isFinite(st)) A.clockOffset = st - Date.now();
    R.state = data;
    rev = data.rev;
    redraw();
  }

  async function poll() {
    if (!open || !A.token() || document.hidden || pending) return;
    const { res, data } = await A.crisisGet('rev').catch(() => ({ res: { ok: false }, data: null }));
    const wasOnline = online;
    online = !!(res.ok && data);
    if (online !== wasOnline) redraw();
    if (!online) return;
    if (data.rev !== rev) await pullState();
    else if (stale && !typingHere()) { stale = false; R.render(); }
  }
  setInterval(poll, POLL_MS);

  // ---- who is at the desk ----
  function nameCard(body) {
    const input = h('input', Object.assign(fieldAttrs(), { class: 'input', type: 'text', maxlength: '40', placeholder: 'Your name', 'aria-label': 'Your name' }));
    input.dataset.chairName = '';
    const save = () => {
      const name = input.value.trim();
      if (!name) { toast('TYPE YOUR NAME FIRST'); Sound.play('error'); return; }
      session.set('chairName', name);
      Sound.play('select');
      R.render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    const go = pbtn('CONTINUE ▸', save, 'mag');
    go.dataset.chairSave = '';
    body.append(esect('WHO IS USING THIS?'), hint('Chairs share one login, so your name is what shows in the log next to everything you do.'),
      ecard(input, h('div', { class: 'comm-ctrl-row' }, go)));
    setTimeout(() => input.focus(), 0);
  }

  // ---- live ----
  const fmt = (ms) => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  /** Same sums as the Committee tab and the public page, so every screen agrees. */
  function caucusLeft(c) {
    const now = A.now();
    const activePause = c.status === 'paused' && c.pausedAt ? now - Date.parse(c.pausedAt) : 0;
    const elapsed = c.startedAt ? now - Date.parse(c.startedAt) - (c.accPausedMs || 0) - activePause : 0;
    return (c.totalMs || 0) - elapsed;
  }

  function tick() {
    const el = $('[data-crisis-clock]');
    const c = R.state && R.state.caucus;
    if (!open || !el || !c) return;
    const left = caucusLeft(c);
    el.textContent = left > 0 ? fmt(left) : 'TIME UP';
    el.classList.toggle('up', left <= 0);
  }
  setInterval(tick, 500);

  function caucusCard() {
    const c = R.state.caucus;
    const go = pbtn('OPEN COMMITTEE ▸', () => A.goToPanel('committee'));
    go.dataset.crisisOpenCommittee = '';
    const running = c && (c.status === 'active' || c.status === 'paused');
    const card = h('div', { class: 'comm-live ' + (c ? c.status : '') });
    if (!running) {
      const text = !c || (c.status === 'idle' && !c.totalMs) ? 'NO CAUCUS RUNNING' : (c.status === 'ended' ? 'CAUCUS ENDED' : 'CAUCUS READY TO START');
      card.append(h('p', { class: 'comm-stage', dataset: { crisisCaucus: '' }, text }), c && c.topic ? h('p', { class: 'comm-topic', text: c.topic }) : null);
    } else {
      const cur = c.speakers && c.speakers[c.currentSpeakerIdx];
      const waiting = (c.speakers || []).filter((s) => s.status === 'waiting');
      card.append(
        h('p', { class: 'comm-stage', dataset: { crisisCaucus: '' }, text: c.status === 'paused' ? 'PAUSED' : `${c.type === 'moderated' ? 'MODERATED' : 'UNMODERATED'} CAUCUS LIVE` }),
        c.topic ? h('p', { class: 'comm-topic', text: c.topic }) : null,
        h('p', { class: 'comm-clock big', 'data-crisis-clock': '' }, '--:--'),
        c.type === 'moderated' ? h('p', { class: 'comm-sub', text: `${cur ? `Speaking: ${cur.name}` : 'Nobody speaking'} · ${waiting.length} waiting` }) : null);
    }
    card.append(h('div', { class: 'comm-ctrl-row comm-mid' }, go));
    return card;
  }

  function statTiles() {
    const s = R.state.summary;
    const tile = (label, value, panelTab) => h('button', {
      class: 'crisis-tile', type: 'button', dataset: { crisisTile: label },
      onclick: () => { A.comm.tab = panelTab; session.set('commTab', panelTab); A.goToPanel('committee'); }
    }, h('b', { text: value }), h('span', { text: label }));
    return h('div', { class: 'crisis-tiles' }, tile('PRESENT', `${s.present} / ${s.delegates}`, 'delegates'), tile('DIRECTIVES', String(s.directives), 'directives'));
  }

  function feedRow(e) {
    return h('li', { class: 'crisis-feed-row', dataset: { feedType: e.type } },
      h('span', { class: 'crisis-feed-time', text: fmtStamp(e.time) }),
      h('span', { class: 'crisis-feed-text' }, h('b', { text: e.summary }), e.target ? ` · ${e.target}` : '', e.detail ? h('span', { class: 'crisis-feed-detail', text: e.detail }) : null),
      h('span', { class: 'crisis-feed-actor', text: e.actor }));
  }

  function noteBox() {
    const box = ta(noteText, (v) => { noteText = v; }, 'Write a note for the other chairs…');
    box.dataset.crisisNote = '';
    box.maxLength = 500;
    const add = pbtn('ADD NOTE', async () => {
      const text = noteText.trim();
      if (!text) return;
      add.disabled = true;
      const r = await R.send('note', { text });
      if (r.ok) { noteText = ''; Sound.play('select'); await pullState(); return; }
      add.disabled = false;
      if (r.expired) return;
      toast('COULD NOT SAVE THE NOTE · TRY AGAIN');
      Sound.play('error');
    });
    add.dataset.crisisNoteAdd = '';
    return ecard(lbl('CHAIR NOTE (ONLY CHAIRS SEE THIS)'), box, h('div', { class: 'comm-ctrl-row' }, add));
  }

  function viewLive(body) {
    body.append(caucusCard(), statTiles(), esect('ACTIVITY'));
    const list = h('ol', { class: 'crisis-feed', dataset: { crisisFeed: '' } });
    if (!R.state.feed.length) body.append(hint('Nothing yet. What chairs do will appear here.'));
    list.append(...R.state.feed.map(feedRow));
    body.append(list, noteBox());
    tick();
  }

  // ---- full log ----
  async function loadLog(reset) {
    const before = reset || !log.oldest ? '' : `&before=${log.oldest}`;
    const { res, data } = await A.crisisGet('log', { query: `&limit=${PAGE}${before}` }).catch(() => ({ res: { ok: false }, data: null }));
    if (!res.ok || !data || !data.ok) { toast('COULD NOT LOAD THE LOG'); return; }
    const entries = reset ? data.entries : log.entries.concat(data.entries);
    // Positions count from the start of the log, so new entries don't shift the next page.
    const end = reset ? data.total : log.oldest;
    log = { entries, total: data.total, loaded: true, oldest: Math.max(0, end - data.entries.length) };
    R.render();
  }

  function viewLog(body) {
    if (!log.loaded) { body.append(hint('Loading the log…')); loadLog(true); return; }
    body.append(hint(`${log.total} event${log.total === 1 ? '' : 's'} recorded. Names are what each chair typed, because chairs share one login.`));
    const list = h('ol', { class: 'crisis-feed', dataset: { crisisLog: '' } });
    list.append(...log.entries.map(feedRow));
    body.append(list);
    if (log.oldest > 0) {
      const more = pbtn('SHOW OLDER', () => loadLog(false));
      more.dataset.crisisMore = '';
      body.append(more);
    }
  }

  // ---- shell ----
  function renderTabs() {
    return h('div', { class: 'comm-tabs', role: 'group', 'aria-label': 'Crisis Room sections' }, TABS.map(([id, label]) => h('button', {
      class: 'chip-btn' + (id === R.tab ? ' active' : ''), type: 'button', 'aria-pressed': String(id === R.tab), dataset: { crisisTab: id },
      onclick: () => { R.tab = id; session.set('crisisTab', id); log.loaded = false; Sound.play('move'); R.render(); }
    }, label)));
  }

  R.render = () => {
    const body = bodyEl();
    if (!open) return;
    const y = window.scrollY;
    stale = false;
    body.innerHTML = '';
    if (!online) body.append(h('div', { class: 'notice-warn', dataset: { crisisOffline: '' } }, h('strong', null, '⚠ NO CONNECTION'), ' — showing the last saved view. Nothing new is confirmed until this goes away.'));
    if (!chairName()) { nameCard(body); return; }
    if (!R.state) { body.append(hint('Loading the Crisis Room…')); return; }
    const who = h('p', { class: 'crisis-who' }, `Using this as ${chairName()} · `,
      h('button', { class: 'crisis-link', type: 'button', onclick: () => { session.set('chairName', ''); R.render(); } }, 'CHANGE NAME'));
    const pane = h('div', { dataset: { crisisPane: R.tab } });
    body.append(who, renderTabs(), pane);
    (R.tab === 'log' ? viewLog : viewLive)(pane);
    window.scrollTo(0, y);
  };

  A.onPanel.crisis = () => { open = true; R.render(); pullState(); };
  const leavePrevious = A.onPanelLeave;
  A.onPanelLeave = () => { open = false; if (leavePrevious) leavePrevious(); };
  A.onLogout.push(() => { open = false; R.state = null; rev = -1; });
})(window.FORMA = window.FORMA || {});
