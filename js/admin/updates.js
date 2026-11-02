/* FORMA MUN · Crisis Division — Admin: post crisis updates
   Updates have their own store, so posting one never touches the rest of the content and an
   open editor can't overwrite them. The server keeps them locked until release. */
(function (F) {
  'use strict';
  const { $, h, toast, fmtStamp, Sound } = F;
  const A = F.Admin;
  const { lbl, erow, efull, ecard, hint, tf, ta, dd } = A.ui;

  const PRIORITIES = [['critical', 'CRITICAL'], ['high', 'HIGH'], ['medium', 'MEDIUM'], ['low', 'LOW']];
  const blank = () => ({ id: '', priority: 'high', title: '', detail: '' });
  let items = [];
  let released = false;
  let form = blank();

  const expired = (res) => { if (res.status === 401) { A.logout('SESSION EXPIRED · LOG IN AGAIN'); return true; } return false; };

  async function load() {
    const { res, data } = await A.get('updates').catch(() => ({ res: { ok: false }, data: null }));
    if (expired(res)) return;
    if (res.ok && data) { items = data.updates || []; released = !!data.released; render(); }
    else toast('COULD NOT LOAD UPDATES');
  }

  async function post(msg) {
    if (!form.title.trim()) { msg.className = 'admin-msg bad'; msg.textContent = 'ADD A HEADLINE FIRST'; Sound.play('error'); return; }
    msg.className = 'admin-msg'; msg.textContent = 'POSTING…';
    const { res, data } = await A.post('post-update', form).catch(() => ({ res: { ok: false }, data: null }));
    if (expired(res)) return;
    if (res.ok && data && data.ok) {
      Sound.play('release');
      toast(data.held ? 'UPDATE SAVED · APPEARS AT RELEASE' : 'UPDATE POSTED · REACHES OPEN PAGES WITHIN 30 SECONDS');
      form = blank();
      await load();
      A.refresh();
    } else {
      msg.className = 'admin-msg bad';
      msg.textContent = res.status === 503 ? 'STORAGE NOT CONNECTED' : 'COULD NOT POST · TRY AGAIN';
      Sound.play('error');
    }
  }

  async function del(u) {
    if (!confirm(`Delete this update?\n\n${u.title}`)) return;
    const { res, data } = await A.post('delete-update', { id: u.id }).catch(() => ({ res: { ok: false }, data: null }));
    if (expired(res)) return;
    if (res.ok && data && data.ok) { Sound.play('select'); await load(); A.refresh(); }
    else toast('COULD NOT DELETE UPDATE');
  }

  function render() {
    const body = $('[data-updates-body]');
    body.innerHTML = '';
    const msg = h('span', { class: 'admin-msg' });
    body.append(
      h('div', { class: released ? 'notice-info' : 'notice-warn' }, released
        ? 'LIVE · A posted update reaches every open page within 30 seconds.'
        : 'HELD UNTIL RELEASE · Updates you post now stay private and appear at the reveal.'),
      ecard(
        erow(lbl('PRIORITY'), dd(PRIORITIES, form.priority, (v) => { form.priority = v; })),
        efull(lbl('HEADLINE'), tf(form.title, (v) => { form.title = v; }, 'Short update headline…')),
        efull(lbl('DETAILS'), ta(form.detail, (v) => { form.detail = v; }, 'Full update text…', 'ta-lg')),
        erow(msg, h('button', { class: 'btn mag', type: 'button', dataset: { updatePost: '' }, onclick: () => post(msg) }, form.id ? 'SAVE CHANGES ▸' : 'POST UPDATE ▸'),
          form.id ? h('button', { class: 'btn', type: 'button', onclick: () => { form = blank(); render(); } }, 'CANCEL') : null)));
    body.append(h('h3', { class: 'ed-section', text: `POSTED (${items.length})` }));
    if (!items.length) body.append(hint('Nothing posted yet.'));
    items.forEach((u) => {
      const card = ecard(
        h('div', { class: 'update-head' },
          h('span', { class: 'prio ' + (u.priority || 'medium'), text: (u.priority || 'medium').toUpperCase() }),
          h('span', { class: 'update-time', text: fmtStamp(u.time) }),
          released ? null : h('span', { class: 'prio held', text: 'HELD' }),
          h('span', { class: 'update-actions' },
            h('button', { class: 'chip-btn', type: 'button', onclick: () => { form = { id: u.id, priority: u.priority || 'medium', title: u.title || '', detail: u.detail || '', time: u.time }; render(); body.scrollIntoView({ block: 'start' }); } }, 'EDIT'),
            h('button', { class: 'ed-del', type: 'button', 'aria-label': 'Delete update', dataset: { updateDelete: '' }, onclick: () => del(u) }, '✕'))),
        h('strong', { class: 'update-title', text: u.title }),
        u.detail ? h('p', { class: 'muted update-detail', text: u.detail }) : null);
      body.append(card);
    });
  }

  A.onPanel.updates = load;
  A.updatesInit = render;
})(window.FORMA = window.FORMA || {});
