/* FORMA MUN · Crisis Division — Committee page: the delegate desk
   A delegate logs in with their personal code, then reads private messages and writes directives.
   Drafts save by themselves. The server decides what this browser may see, not this file. */
(function (F) {
  'use strict';
  const { CONFIG, $, h, session, toast, fmtStamp } = F;

  const endpoint = CONFIG.crisisEndpoint;
  const POLL_MS = 10000;
  const BUSY_TRIES = 8;
  const SAVE_MS = 1500;
  const FIELDS = [
    ['objective', 'OBJECTIVE', 'What should this achieve?', true], ['actions', 'REQUESTED ACTIONS', 'Exactly what should happen?', true],
    ['resources', 'RESOURCES', 'What does it use?'], ['authority', 'RESPONSIBLE AUTHORITY', 'Who carries it out?'], ['timeline', 'TIMELINE', 'When?'],
    ['target', 'TARGET', 'Who or what is it aimed at?'], ['background', 'BACKGROUND', 'Anything the chairs should know?'], ['risks', 'RISKS', 'What could go wrong?']
  ];
  const TYPES = [['individual', 'INDIVIDUAL DIRECTIVE'], ['joint', 'JOINT DIRECTIVE'], ['committee', 'COMMITTEE-WIDE DIRECTIVE'], ['note', 'CRISIS NOTE']];
  const WORDS = { draft: 'DRAFT', submitted: 'SENT', review: 'BEING REVIEWED', revision: 'CHANGES ASKED', hold: 'ON HOLD', approved: 'APPROVED', rejected: 'REJECTED', withdrawn: 'WITHDRAWN', completed: 'WORKED', partial: 'PARTLY WORKED', failed: 'FAILED' };

  let me = null;
  let rev = -1;
  let view = 'home';       // 'home' | 'edit'
  let draft = null;
  let saveTimer = null;
  let saving = Promise.resolve();
  let offset = 0;

  const body = () => $('[data-desk-body]');
  const token = () => session.get('delegateToken', null);
  const opId = () => 'op' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const field = (attrs) => Object.assign({ autocomplete: 'off' }, attrs);

  /** A busy answer means nothing happened yet, so it is safe to quietly try again. */
  async function call(action, post) {
    for (let tries = 1; ; tries++) {
      const r = await callOnce(action, post);
      if (r.code !== 'busy' || tries >= BUSY_TRIES) return r;
      await new Promise((go) => setTimeout(go, 400 + Math.random() * 1000));
    }
  }

  async function callOnce(action, post) {
    const res = await fetch(`${endpoint}?action=${action}&t=${Date.now()}`, {
      method: post ? 'POST' : 'GET', cache: 'no-store',
      headers: Object.assign({ Accept: 'application/json' }, token() ? { Authorization: 'Bearer ' + token() } : {}, post ? { 'Content-Type': 'application/json' } : {}),
      body: post ? JSON.stringify(post) : undefined
    }).catch(() => null);
    if (!res) return { ok: false, offline: true };
    const data = await res.json().catch(() => null);
    if (res.status === 401 && token()) { logout('YOUR LOGIN ENDED · ENTER YOUR CODE AGAIN'); return { ok: false, expired: true }; }
    return data || { ok: false };
  }

  function logout(text) {
    clearTimeout(saveTimer);
    session.set('delegateToken', null);
    me = null;
    draft = null;
    view = 'home';
    renderLogin(text);
  }

  // ---- login ----
  function renderLogin(text) {
    const box = body();
    box.innerHTML = '';
    const input = h('input', field({ id: 'desk-code', name: 'desk-code', class: 'input', type: 'text', placeholder: 'YOUR LOGIN CODE', 'aria-label': 'Your login code', maxlength: '20', autocapitalize: 'characters', spellcheck: 'false' }));
    const msg = h('p', { class: 'dir-msg bad', dataset: { deskMsg: '' }, role: 'alert', text: text || '' });
    const go = h('button', { id: 'desk-login', class: 'btn mag', type: 'submit' }, 'LOG IN ▸');
    const form = h('form', { class: 'directive-form', 'data-desk-login': '' }, h('p', { class: 'muted', text: 'Use the code on your card to read private messages and send directives.' }), input,
      h('div', { class: 'directive-form-footer' }, msg, go));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) { msg.textContent = 'ENTER YOUR CODE'; return; }
      go.disabled = true;
      msg.textContent = '';
      const r = await call('login', { code });
      go.disabled = false;
      if (r.ok) { session.set('delegateToken', r.token); await pull(); return; }
      msg.textContent = r.code === 'not_released' ? 'LOGIN OPENS AT RELEASE'
        : r.code === 'too_many_attempts' ? 'TOO MANY TRIES · WAIT 15 MINUTES'
        : r.code === 'bad_code' ? 'THAT CODE IS NOT RIGHT · ASK YOUR CHAIRS'
        : r.offline ? 'NO CONNECTION · TRY AGAIN' : 'LOGIN FAILED · TRY AGAIN';
    });
    box.append(form);
  }

  // ---- reading the server ----
  async function pull() {
    const r = await call('me');
    if (!r.ok) return;
    const st = Date.parse(r.serverTime);
    if (Number.isFinite(st)) offset = st - Date.now();
    me = r;
    rev = r.rev;
    if (view === 'home') render();
  }

  async function poll() {
    if (!token() || document.hidden) return;
    const r = await call('me-rev');
    if (r.ok && r.rev !== rev) await pull();
  }

  // ---- directive editor ----
  const blank = () => ({ id: '', rev: undefined, title: '', type: 'individual', sponsors: '', fields: {} });

  function openEditor(d) {
    draft = d ? { id: d.id, rev: d.rev, title: d.title, type: d.type, sponsors: d.sponsors.join(', '), fields: Object.assign({}, d.fields), ref: d.ref, feedback: d.feedback } : blank();
    view = 'edit';
    render();
  }

  function payload() {
    return { id: draft.id || undefined, rev: draft.rev, title: draft.title, type: draft.type, sponsors: draft.sponsors.split(',').map((s) => s.trim()).filter(Boolean), fields: draft.fields };
  }

  /** Saves are chained, so a slow save can't land after a newer one. */
  function save() {
    clearTimeout(saveTimer);
    saving = saving.then(async () => {
      if (!draft) return;
      const status = $('[data-desk-saved]');
      if (status) status.textContent = 'SAVING…';
      const r = await call('draft-save', payload());
      const now = $('[data-desk-saved]');
      if (r.ok) { draft.id = r.id; draft.rev = r.rev; if (now) now.textContent = 'SAVED'; }
      else if (now && !r.expired) now.textContent = r.code === 'stale' ? 'CHANGED IN ANOTHER TAB · RELOAD' : 'NOT SAVED · CHECK YOUR CONNECTION';
    });
    return saving;
  }
  const saveSoon = () => { clearTimeout(saveTimer); const s = $('[data-desk-saved]'); if (s) s.textContent = 'UNSAVED'; saveTimer = setTimeout(save, SAVE_MS); };

  function input(value, onInput, attrs, tag) {
    const el = h(tag || 'input', field(Object.assign({ class: 'input' + (tag ? ' dir-textarea' : '') }, attrs)));
    el.value = value || '';
    el.addEventListener('input', () => { onInput(el.value); saveSoon(); });
    return el;
  }

  async function submit(msg) {
    await save();
    if (!draft || !draft.id) { msg.textContent = 'WRITE SOMETHING FIRST'; return; }
    if (!draft.title.trim()) { msg.textContent = 'ADD A TITLE'; return; }
    if (!(draft.fields.objective || '').trim() || !(draft.fields.actions || '').trim()) { msg.textContent = 'FILL IN THE OBJECTIVE AND REQUESTED ACTIONS'; return; }
    if (!window.confirm('Send this to the chairs? You cannot edit it after sending, unless they ask for changes.')) return;
    const r = await call('directive-submit', { id: draft.id, opId: opId() });
    if (r.ok) {
      toast(`SENT · ${r.ref}`);
      draft = null;
      view = 'home';
      await pull();
      render();
      return;
    }
    msg.textContent = r.code === 'submissions_closed' ? 'THE CHAIRS HAVE CLOSED SUBMISSIONS FOR NOW · YOUR DRAFT IS SAVED'
      : r.code === 'missing_fields' ? 'FILL IN THE TITLE, OBJECTIVE AND REQUESTED ACTIONS' : 'NOT SENT · TRY AGAIN';
  }

  function renderEditor(box) {
    const d = draft;
    const type = h('select', field({ id: 'desk-type', name: 'desk-type', class: 'input', 'aria-label': 'Type of document' }), TYPES.map(([v, label]) => h('option', { value: v, selected: v === d.type, text: label })));
    type.addEventListener('change', () => { d.type = type.value; saveSoon(); });
    const msg = h('p', { class: 'dir-msg bad', dataset: { deskMsg: '' }, role: 'alert' });
    const send = h('button', { class: 'btn mag', type: 'button', dataset: { deskSubmit: '' }, onclick: () => submit(msg) }, 'SEND TO CHAIRS ▸');
    const back = h('button', { class: 'chip-btn', type: 'button', dataset: { deskBack: '' }, onclick: async () => { await save(); draft = null; view = 'home'; await pull(); render(); } }, '◂ BACK');
    const form = h('div', { class: 'directive-form' }, back, h('span', { class: 'dir-msg', dataset: { deskSaved: '' }, 'aria-live': 'polite', text: d.id ? 'SAVED' : '' }));
    (d.feedback || []).slice(-1).forEach((f) => form.append(h('div', { class: 'desk-note', text: `Chairs said: ${f.reason}` })));
    form.append(input(d.title, (v) => { d.title = v; }, { id: 'desk-title', name: 'desk-title', placeholder: 'TITLE', 'aria-label': 'Title', maxlength: '200' }), type,
      input(d.sponsors, (v) => { d.sponsors = v; }, { id: 'desk-sponsors', name: 'desk-sponsors', placeholder: 'SPONSORS, SEPARATED BY COMMAS (OPTIONAL)', 'aria-label': 'Sponsors' }));
    FIELDS.forEach(([k, label, hintText, required]) => form.append(h('label', { class: 'desk-label', for: 'desk-' + k, text: required ? label + ' *' : label }),
      input(d.fields[k], (v) => { d.fields[k] = v; }, { id: 'desk-' + k, name: 'desk-' + k, placeholder: hintText, maxlength: '4000' }, 'textarea')));
    form.append(h('div', { class: 'directive-form-footer' }, msg, send));
    box.append(form);
  }

  // ---- home ----
  function messageCard(m) {
    const open = h('details', { class: 'desk-card' + (m.readAt ? '' : ' unread'), dataset: { deskMessage: m.subject } },
      h('summary', null, h('b', { text: m.subject }), h('span', { class: 'desk-meta', text: `${m.from} · ${fmtStamp(m.time)}${m.readAt ? '' : ' · NEW'}` })),
      m.simTime ? h('p', { class: 'desk-meta', text: m.simTime }) : null, h('p', { class: 'desk-text', text: m.body }));
    open.addEventListener('toggle', async () => {
      if (!open.open || m.readAt) return;
      m.readAt = new Date().toISOString();
      await call('message-read', { id: m.id, opId: opId() });
    });
    return open;
  }

  function directiveCard(d) {
    const tools = h('div', { class: 'directive-form-footer' });
    if (['draft', 'revision'].includes(d.status)) tools.append(h('button', { class: 'chip-btn', type: 'button', dataset: { deskEdit: d.title }, onclick: () => openEditor(d) }, d.status === 'draft' ? 'KEEP WRITING' : 'MAKE CHANGES'));
    if (['submitted', 'revision', 'hold'].includes(d.status)) {
      tools.append(h('button', {
        class: 'chip-btn', type: 'button',
        onclick: async () => { if (window.confirm('Withdraw this directive?')) { await call('directive-withdraw', { id: d.id, opId: opId() }); await pull(); } }
      }, 'WITHDRAW'));
    }
    return h('div', { class: 'desk-card', dataset: { deskDirective: d.title || 'untitled' } },
      h('div', { class: 'directive-meta' }, h('b', { text: d.title || 'Untitled draft' }), h('span', { class: 'desk-status', text: WORDS[d.status] || d.status })),
      h('p', { class: 'desk-meta', text: d.ref ? `${d.ref} · version ${d.version} · sent ${fmtStamp(d.submittedAt)}` : 'Not sent yet' }),
      d.feedback.slice(-1).map((f) => h('p', { class: 'desk-text', text: `Chairs said: ${f.reason}` })),
      d.outcomes.map((o) => h('p', { class: 'desk-text', text: `Outcome: ${o.text}` })), tools);
  }

  function clock() {
    const el = $('[data-desk-clock]');
    const c = me && me.countdown;
    if (!el || !c) return;
    const left = c.status === 'paused' ? c.leftMs : Date.parse(c.endsAt) - (Date.now() + offset);
    const s = Math.ceil(Math.max(0, left) / 1000);
    el.textContent = left > 0 ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : 'TIME UP';
  }

  function renderHome(box) {
    const d = me.delegate;
    const unread = me.inbox.filter((m) => !m.readAt).length;
    box.append(h('div', { class: 'directive-meta' }, h('b', { dataset: { deskName: '' }, text: d.character || d.name }), h('button', { class: 'chip-btn', type: 'button', dataset: { deskLogout: '' }, onclick: () => logout('') }, 'LOG OUT')));
    if (d.faction) box.append(h('p', { class: 'desk-meta', text: d.faction }));
    if (me.countdown) box.append(h('div', { class: 'desk-note' }, `${me.countdown.label}: `, h('b', { 'data-desk-clock': '' }, '--:--')));
    box.append(h('h3', { class: 'desk-head', text: `PRIVATE MESSAGES${unread ? ` (${unread} NEW)` : ''}` }));
    if (!me.inbox.length) box.append(h('p', { class: 'muted', text: 'No messages yet.' }));
    me.inbox.forEach((m) => box.append(messageCard(m)));
    box.append(h('h3', { class: 'desk-head', text: 'MY DIRECTIVES' }));
    if (me.submission === 'closed') box.append(h('p', { class: 'muted', text: 'The chairs have closed submissions for now. You can still write drafts.' }));
    if (me.submission === 'unmoderated') box.append(h('p', { class: 'muted', text: 'Directives can be sent during an unmoderated caucus.' }));
    box.append(h('button', { class: 'btn mag', type: 'button', dataset: { deskNew: '' }, onclick: () => openEditor(null) }, 'NEW DIRECTIVE ▸'));
    if (!me.directives.length) box.append(h('p', { class: 'muted', text: 'Nothing written yet.' }));
    me.directives.forEach((x) => box.append(directiveCard(x)));
    clock();
  }

  function render() {
    const box = body();
    if (!box) return;
    if (!token() || !me) return;
    box.innerHTML = '';
    if (view === 'edit' && draft) renderEditor(box);
    else renderHome(box);
  }

  F.Desk = {
    init() {
      if (!body()) return;
      if (token()) pull();
      else renderLogin();
      setInterval(poll, POLL_MS);
      setInterval(clock, 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    }
  };
})(window.FORMA = window.FORMA || {});
