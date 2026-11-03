/* FORMA MUN · Crisis Division — Admin: Crisis Room, CRISIS and MESSAGES tabs
   Events are what happens in the story; updates are what people are told. Nothing goes out
   because something else happened: a chair approves it, then a chair publishes it. */
(function (F) {
  'use strict';
  const { h, arr, fmtStamp } = F;
  const A = F.Admin;
  const R = A.crisis;
  const { lbl, efull, ecard, hint, esect, abtn, pbtn, tf, ta, dd, checkbox } = A.ui;

  const blankEvent = () => ({ id: '', title: '', description: '', simTime: '', consequences: '', notes: '', directiveIds: [] });
  const blankUpdate = () => ({ id: '', headline: '', body: '', simTime: '', priority: 'high', visibility: 'public', factions: [], delegateIds: [], eventId: '' });
  let eventForm = blankEvent();
  let updateForm = blankUpdate();
  let message = { to: 'all', subject: '', body: '' };

  /** Factions from the scenario content plus any typed in on the People tab. */
  const factionNames = () => [...new Set([...arr(A.content && A.content.factions).map((f) => f.name), ...R.state.people.map((p) => p.faction)].filter(Boolean))].sort();

  function pickMany(items, chosen, onChange) {
    const box = h('div', { class: 'members-grid' });
    items.forEach(([value, label]) => box.append(checkbox(label, chosen.includes(value), (on) => {
      onChange(on ? chosen.concat(value) : chosen.filter((x) => x !== value));
    })));
    if (!items.length) box.append(hint('Nothing to choose yet.'));
    return box;
  }

  // ---- events ----
  function eventCard() {
    const e = eventForm;
    const title = tf(e.title, (v) => { e.title = v; }, 'What happens?');
    title.dataset.eventTitle = '';
    const save = abtn(e.id ? 'SAVE CHANGES' : 'SAVE EVENT', async () => {
      const r = await R.act('event-save', e, 'EVENT SAVED');
      if (r) { eventForm = blankEvent(); R.render(); }
    });
    save.dataset.eventSave = '';
    const dirs = R.state.directives.filter((d) => !['rejected', 'withdrawn'].includes(d.status)).map((d) => [d.id, `${d.ref} ${d.title}`]);
    return ecard(efull(lbl('TITLE'), title),
      efull(lbl('STORY TIME (WHEN IT HAPPENS IN THE SCENARIO)'), tf(e.simTime, (v) => { e.simTime = v; }, 'e.g. Day 3, 06:00')),
      efull(lbl('WHAT HAPPENS'), ta(e.description, (v) => { e.description = v; }, 'Only chairs see this.')),
      efull(lbl('LIKELY CONSEQUENCES'), ta(e.consequences, (v) => { e.consequences = v; }, 'Only chairs see this.')),
      efull(lbl('CAUSED BY THESE DIRECTIVES'), pickMany(dirs, e.directiveIds, (v) => { e.directiveIds = v; })),
      efull(lbl('INTERNAL NOTES'), ta(e.notes, (v) => { e.notes = v; }, 'Only chairs see this.')),
      h('div', { class: 'comm-ctrl-row' }, save, e.id ? pbtn('CANCEL', () => { eventForm = blankEvent(); R.render(); }) : null));
  }

  function eventRow(e) {
    const tools = h('span', { class: 'comm-row-tools' });
    const set = (status) => R.act('event-status', { id: e.id, status });
    if (e.status === 'draft') {
      tools.append(
        h('button', { class: 'chip-btn', type: 'button', onclick: () => { eventForm = Object.assign(blankEvent(), e); R.render(); window.scrollTo(0, 0); } }, 'EDIT'),
        h('button', { class: 'chip-btn', type: 'button', dataset: { eventApprove: e.ref }, onclick: () => set('approved') }, 'APPROVE'),
        h('button', { class: 'chip-btn', type: 'button', onclick: () => set('rejected') }, 'REJECT'));
    } else {
      tools.append(h('button', { class: 'chip-btn', type: 'button', onclick: () => set('draft') }, 'REOPEN'));
    }
    const write = h('button', {
      class: 'chip-btn', type: 'button', dataset: { eventWrite: e.ref },
      onclick: () => { updateForm = Object.assign(blankUpdate(), { headline: e.title, simTime: e.simTime, eventId: e.id }); R.render(); }
    }, 'WRITE UPDATE');
    if (e.status === 'approved') tools.append(write);
    return R.row({ dataset: { event: e.ref } }, h('span', { class: 'crisis-ref', text: e.ref }),
      h('span', { class: 'crisis-main' }, h('b', { text: e.title }), h('span', { class: 'crisis-sub', text: [e.simTime, e.author].filter(Boolean).join(' · ') }), e.description ? h('span', { class: 'crisis-sub', text: e.description }) : null),
      R.badge(e.status), tools);
  }

  // ---- updates ----
  function updateCard() {
    const u = updateForm;
    const headline = tf(u.headline, (v) => { u.headline = v; }, 'Headline');
    headline.dataset.updateHeadline = '';
    const text = ta(u.body, (v) => { u.body = v; }, 'What people are told.', 'ta-lg');
    text.dataset.updateBody = '';
    const who = dd([['public', 'EVERYONE (PUBLIC)'], ['faction', 'ONE OR MORE FACTIONS'], ['character', 'CHOSEN DELEGATES'], ['chairs', 'CHAIRS ONLY']], u.visibility, (v) => { u.visibility = v; R.render(); });
    who.dataset.updateWho = '';
    const save = abtn(u.id ? 'SAVE CHANGES' : 'SAVE DRAFT', async () => {
      const r = await R.act('update-save', u, 'UPDATE SAVED');
      if (r) { updateForm = blankUpdate(); R.render(); }
    });
    save.dataset.updateSave = '';
    const card = ecard(efull(lbl('HEADLINE'), headline), efull(lbl('MESSAGE'), text),
      efull(lbl('STORY TIME'), tf(u.simTime, (v) => { u.simTime = v; }, 'e.g. Day 3, 06:00')),
      h('div', { class: 'ed-row' }, lbl('WHO SEES IT'), who, lbl('PRIORITY'), dd([['critical', 'CRITICAL'], ['high', 'HIGH'], ['medium', 'MEDIUM'], ['low', 'LOW']], u.priority, (v) => { u.priority = v; })));
    if (u.visibility === 'faction') card.append(efull(lbl('FACTIONS'), pickMany(factionNames().map((f) => [f, f]), u.factions, (v) => { u.factions = v; })));
    if (u.visibility === 'character') card.append(efull(lbl('DELEGATES'), pickMany(R.state.people.map((p) => [p.id, p.name]), u.delegateIds, (v) => { u.delegateIds = v; })));
    if (u.eventId) card.append(hint(`Linked to crisis event ${(R.state.events.find((e) => e.id === u.eventId) || {}).ref || ''}.`));
    card.append(h('div', { class: 'comm-ctrl-row' }, save, (u.id || u.eventId) ? pbtn('CANCEL', () => { updateForm = blankUpdate(); R.render(); }) : null));
    return card;
  }

  const AUDIENCE = { public: 'Everyone', faction: 'Factions', character: 'Chosen delegates', chairs: 'Chairs only' };

  function updateRow(u) {
    const tools = h('span', { class: 'comm-row-tools' });
    const set = (status, text) => R.act('update-status', { id: u.id, status }, text);
    if (u.status === 'draft') {
      tools.append(
        h('button', { class: 'chip-btn', type: 'button', onclick: () => { updateForm = Object.assign(blankUpdate(), u); R.render(); } }, 'EDIT'),
        h('button', { class: 'chip-btn', type: 'button', dataset: { updateApprove: u.ref }, onclick: () => set('approved', 'APPROVED · NOT SENT YET') }, 'APPROVE'));
    }
    if (u.status === 'approved') {
      tools.append(
        h('button', {
          class: 'chip-btn active', type: 'button', dataset: { updatePublish: u.ref },
          onclick: () => { if (window.confirm(`Send "${u.headline}" to: ${AUDIENCE[u.visibility]}? This can't be taken back.`)) R.act('update-publish', { id: u.id }, 'UPDATE SENT'); }
        }, 'SEND NOW ▸'),
        h('button', { class: 'chip-btn', type: 'button', onclick: () => set('draft') }, 'BACK TO DRAFT'));
    }
    if (['draft', 'approved'].includes(u.status)) tools.append(h('button', { class: 'chip-btn', type: 'button', onclick: () => { if (window.confirm('Cancel this update?')) set('cancelled'); } }, 'CANCEL'));
    const sub = u.status === 'published' ? `${AUDIENCE[u.visibility]}${u.delivered.length ? `: ${u.delivered.join(', ')}` : ''} · ${fmtStamp(u.publishedAt)} · by ${u.publishedBy}` : `For: ${AUDIENCE[u.visibility]}${u.simTime ? ` · ${u.simTime}` : ''}`;
    return R.row({ dataset: { update: u.ref } }, h('span', { class: 'crisis-ref', text: u.ref }),
      h('span', { class: 'crisis-main' }, h('b', { text: u.headline }), h('span', { class: 'crisis-sub', text: sub })), R.badge(u.status), tools);
  }

  R.views.crisis = (body) => {
    const { events, updates } = R.state;
    const active = updates.filter((u) => ['draft', 'approved'].includes(u.status));
    body.append(esect('UPDATES WAITING TO GO OUT'));
    if (!active.length) body.append(hint('Nothing waiting.'));
    active.forEach((u) => body.append(updateRow(u)));
    body.append(esect(updateForm.id ? 'EDIT THIS UPDATE' : 'WRITE AN UPDATE'), updateCard());
    body.append(esect(eventForm.id ? 'EDIT THIS EVENT' : 'PLAN A CRISIS EVENT'), hint('An event is only for chairs. Nobody sees it until you write an update about it.'), eventCard());
    if (events.length) { body.append(esect('STORY TIMELINE')); events.forEach((e) => body.append(eventRow(e))); }
    const past = updates.filter((u) => !['draft', 'approved'].includes(u.status));
    if (past.length) { body.append(esect('SENT AND CANCELLED')); past.forEach((u) => body.append(updateRow(u))); }
  };

  // ---- messages ----
  function recipients(to) {
    if (to === 'all') return { all: true };
    if (to.startsWith('f:')) return { factions: [to.slice(2)] };
    return { ids: [to.slice(2)] };
  }

  function sentRow(m) {
    const total = m.to.length;
    const tools = h('span', { class: 'comm-row-tools' });
    if (!m.retracted) {
      tools.append(h('button', {
        class: 'chip-btn', type: 'button',
        onclick: async () => {
          const reason = window.prompt('Why take this back? It disappears from their inbox, but stays on the record here.');
          if (reason && reason.trim()) await R.act('message-retract', { id: m.id, reason }, 'MESSAGE TAKEN BACK');
        }
      }, 'TAKE BACK'));
    }
    return R.row({ dataset: { sent: m.subject } },
      h('span', { class: 'crisis-main' }, h('b', { text: m.subject }), h('span', { class: 'crisis-sub', text: m.body }),
        h('span', { class: 'crisis-sub', text: `To ${m.to.map((d) => d.name).join(', ')} · ${fmtStamp(m.time)} · by ${m.sender}` }),
        m.retracted ? h('span', { class: 'crisis-sub', text: `Taken back by ${m.retracted.actor}: ${m.retracted.reason}` }) : null),
      h('span', { class: 'comm-stat', dataset: { sentRead: '' }, text: `READ ${m.readBy.length} / ${total}` }), tools);
  }

  R.views.messages = (body) => {
    const people = R.state.people;
    const options = [['all', 'EVERY DELEGATE'], ...factionNames().map((f) => ['f:' + f, `FACTION: ${f}`]), ...people.map((p) => ['d:' + p.id, p.name])];
    const to = dd(options, message.to, (v) => { message.to = v; });
    to.dataset.messageTo = '';
    const subject = tf(message.subject, (v) => { message.subject = v; }, 'Subject');
    subject.dataset.messageSubject = '';
    const text = ta(message.body, (v) => { message.body = v; }, 'Only the people you choose can read this.', 'ta-lg');
    text.dataset.messageBody = '';
    const send = pbtn('SEND PRIVATELY ▸', async () => {
      const r = await R.act('message-send', { to: recipients(message.to), subject: message.subject, body: message.body }, 'MESSAGE SENT');
      if (r) { message = { to: message.to, subject: '', body: '' }; R.render(); }
    }, 'mag');
    send.dataset.messageSend = '';
    body.append(esect('NEW PRIVATE MESSAGE'));
    if (!people.length) body.append(hint('Add delegates in the Committee tab first.'));
    body.append(ecard(efull(lbl('TO'), to), efull(lbl('SUBJECT'), subject), efull(lbl('MESSAGE'), text), h('div', { class: 'comm-ctrl-row' }, send)));
    body.append(esect('SENT'));
    if (!R.state.sent.length) body.append(hint('Nothing sent yet.'));
    R.state.sent.forEach((m) => body.append(sentRow(m)));
  };

})(window.FORMA = window.FORMA || {});
