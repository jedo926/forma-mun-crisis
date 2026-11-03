/* FORMA MUN · Crisis Division — Admin: Crisis Room, PEOPLE and SETTINGS tabs, the countdown and
   the archive. Login codes are shown once, when made, because only a keyed hash is stored. */
(function (F) {
  'use strict';
  const { $, h, arr, toast, fmtStamp, Sound } = F;
  const A = F.Admin;
  const R = A.crisis;
  const { fieldAttrs, lbl, efull, ecard, hint, esect, abtn, pbtn, tf, dd, checkbox } = A.ui;

  let fresh = [];         // codes just made: names and codes, kept only in this page
  let session = null;     // session form
  let rules = null;       // rules form
  let reason = '';
  let problems = [];
  let timer = { label: 'Directive deadline', minutes: 10, public: true };

  // ---- countdown, shown on LIVE ----
  const fmt = (ms) => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const leftOf = (c) => (c.status === 'paused' ? c.leftMs : Date.parse(c.endsAt) - A.now());
  setInterval(() => {
    const el = $('[data-countdown-clock]');
    const c = R.state && R.state.countdown;
    if (!el || !c) return;
    const left = leftOf(c);
    el.textContent = left > 0 ? fmt(left) : 'TIME UP';
    el.classList.toggle('up', left <= 0);
  }, 500);

  R.countdownCard = () => {
    const c = R.state.countdown;
    const send = (op, extra) => R.act('countdown', Object.assign({ op }, extra));
    if (c && ['running', 'paused'].includes(c.status)) {
      return h('div', { class: 'comm-live ' + (c.status === 'paused' ? 'paused' : ''), dataset: { countdown: '' } },
        h('p', { class: 'comm-clock-title', text: `${c.label}${c.public ? '' : ' (chairs only)'}${c.status === 'paused' ? ' · PAUSED' : ''}` }),
        h('p', { class: 'comm-clock', 'data-countdown-clock': '' }, fmt(leftOf(c))),
        h('div', { class: 'comm-ctrl-row' },
          pbtn(c.status === 'paused' ? 'RESUME' : 'PAUSE', () => send(c.status === 'paused' ? 'resume' : 'pause')),
          pbtn('+1 MIN', () => send('extend', { seconds: 60 })),
          pbtn('STOP', () => { if (window.confirm('Stop this countdown?')) send('cancel'); })));
    }
    const label = tf(timer.label, (v) => { timer.label = v; }, 'What is it counting down to?');
    label.dataset.countdownLabel = '';
    const mins = h('input', Object.assign(fieldAttrs(), { class: 'input num-xs', type: 'number', min: '1', value: String(timer.minutes), 'aria-label': 'Minutes' }));
    mins.dataset.countdownMinutes = '';
    mins.addEventListener('input', () => { timer.minutes = parseInt(mins.value, 10) || 0; });
    const go = pbtn('START', () => send('start', { label: timer.label, seconds: timer.minutes * 60, public: timer.public }));
    go.dataset.countdownStart = '';
    const node = h('details', { class: 'ed-fold', dataset: { countdownNew: '' } }, h('summary', null, h('span', { class: 'fold-title', text: 'START A SEPARATE COUNTDOWN' }), h('span', { class: 'fold-sub', text: 'For deadlines. It never ends anything by itself.' })));
    node.append(ecard(label, h('div', { class: 'ed-row' }, mins, lbl('MINUTES')), checkbox('SHOW TO DELEGATES AND ON THE PROJECTOR', timer.public, (v) => { timer.public = v; }), h('div', { class: 'comm-ctrl-row' }, go)));
    return node;
  };

  // ---- people ----
  function printCards() {
    const win = window.open('', '_blank');
    if (!win) { toast('ALLOW POP-UPS TO PRINT'); return; }
    const doc = win.document;
    doc.title = 'Delegate login cards';
    const style = doc.createElement('style');
    style.textContent = 'body{font-family:Arial,sans-serif;margin:0;padding:12px}.c{display:inline-block;width:45%;margin:1%;padding:14px;border:1px dashed #000;box-sizing:border-box;break-inside:avoid}h2{margin:0 0 6px;font-size:16px}p{margin:4px 0;font-size:12px}b{display:block;margin:8px 0;font:bold 20px monospace}';
    doc.head.append(style);
    fresh.forEach((c) => {
      const card = doc.createElement('div');
      card.className = 'c';
      [['h2', c.character || c.name], ['p', 'Your login code for the Committee page. Keep it private.'], ['b', c.code]].forEach(([tag, text]) => { const el = doc.createElement(tag); el.textContent = text; card.append(el); });
      doc.body.append(card);
    });
    win.print();
  }

  function codePanel(body) {
    if (!fresh.length) return;
    const print = pbtn('PRINT CARDS', printCards, 'mag');
    print.dataset.codesPrint = '';
    body.append(h('div', { class: 'notice-warn', dataset: { codesFresh: '' } }, h('strong', null, 'SHOWN ONLY NOW'), ' — print or copy these before leaving this page. They can never be shown again, only reset.'),
      h('div', { class: 'comm-queue' }, fresh.map((c) => h('div', { class: 'comm-speaker-item', dataset: { code: c.name } }, h('span', { class: 'comm-speaker-name', text: c.name }), h('span', { class: 'comm-code', text: c.code })))),
      h('div', { class: 'comm-ctrl-row' }, print, pbtn('DONE, HIDE THEM', () => { if (window.confirm('Hide these codes? They cannot be shown again.')) { fresh = []; R.render(); } })));
  }

  async function makeCodes(id) {
    const r = await R.act('code-new', id ? { id } : {});
    if (!r) return;
    fresh = id ? fresh.filter((c) => c.id !== id).concat(r.codes) : r.codes;
    if (!r.codes.length) toast('EVERYONE ALREADY HAS A CODE');
    R.render();
  }

  /** Copies each delegate's faction from the scenario, matching on the character's name. */
  async function matchCharacters() {
    const chars = arr(A.content && A.content.characters);
    if (!A.contentReady || !chars.length) { toast('NO CHARACTERS FOUND · ADD THEM UNDER ALL CONTENT'); Sound.play('error'); return; }
    let matched = 0;
    for (const p of R.state.people) {
      const ch = chars.find((c) => String(c.name).trim().toLowerCase() === p.name.trim().toLowerCase());
      if (ch) { await R.send('person-set', { id: p.id, character: ch.name, faction: ch.faction || '' }); matched += 1; }
    }
    await R.pull();
    toast(`${matched} OF ${R.state.people.length} MATCHED`);
    Sound.play('select');
  }

  function personRow(p) {
    const factions = [...new Set([...arr(A.content && A.content.factions).map((f) => f.name), p.faction].filter(Boolean))].sort();
    const save = (change) => R.act('person-set', Object.assign({ id: p.id, faction: p.faction, character: p.character }, change));
    const faction = dd([['', 'NO FACTION'], ...factions.map((f) => [f, f])], p.faction, (v) => save({ faction: v }));
    faction.setAttribute('aria-label', `Faction for ${p.name}`);
    faction.dataset.personFaction = p.name;
    return h('div', { class: 'comm-delegate', dataset: { person: p.name } },
      h('span', { class: 'comm-delegate-name', text: p.name }), faction,
      h('span', { class: 'comm-stat', text: p.hasCode ? '✓ HAS CODE' : 'NO CODE YET' }),
      h('span', { class: 'comm-row-tools' }, h('button', {
        class: 'chip-btn', type: 'button', dataset: { codeReset: p.name },
        onclick: () => { if (!p.hasCode || window.confirm(`Make a new code for ${p.name}? The old code stops working and they are logged out.`)) makeCodes(p.id); }
      }, p.hasCode ? 'NEW CODE' : 'MAKE CODE')));
  }

  R.views.people = (body) => {
    const people = R.state.people;
    codePanel(body);
    if (!people.length) {
      body.append(hint('No delegates yet. Add them in the Committee tab, under DELEGATES.'), pbtn('OPEN DELEGATES ▸', () => { A.comm.tab = 'delegates'; A.goToPanel('committee'); }));
      return;
    }
    const without = people.filter((p) => !p.hasCode).length;
    const all = pbtn(`MAKE ${without} CODE${without === 1 ? '' : 'S'}`, () => makeCodes(), 'mag');
    all.dataset.codesMake = '';
    all.disabled = !without;
    body.append(hint('Each delegate logs in on the Committee page with their own code, after release. Attendance is in the Committee tab.'),
      h('div', { class: 'comm-ctrl-row' }, all, pbtn('MATCH CHARACTERS', matchCharacters)),
      h('div', { class: 'comm-queue' }, people.map(personRow)));
  };

  // ---- settings ----
  function rulesForm() {
    const list = (arrName, blank, row) => {
      const box = h('div', { class: 'comm-queue' });
      rules[arrName].forEach((item, i) => box.append(h('div', { class: 'ed-card' }, row(item), h('div', { class: 'comm-ctrl-row' }, pbtn('REMOVE', () => { rules[arrName].splice(i, 1); R.render(); })))));
      box.append(abtn('ADD', () => { rules[arrName].push(blank()); R.render(); }));
      return box;
    };
    const thresholdRow = (t) => h('div', { class: 'ed-row' }, tf(t.label, (v) => { t.label = v; t.id = ''; }, 'Name'),
      num(t.num, 'Top of the fraction', (n) => { t.num = n; }), lbl('OF'), num(t.den, 'Bottom of the fraction', (n) => { t.den = n; }),
      dd([['voting', 'OF THOSE VOTING'], ['eligible', 'OF ALL WHO COULD VOTE']], t.base, (v) => { t.base = v; }),
      checkbox('MUST GO OVER', t.strict, (v) => { t.strict = v; }));
    const typeRow = (m) => h('div', { class: 'ed-row' }, tf(m.label, (v) => { m.label = v; m.id = ''; }, 'Name'),
      dd([['moderated', 'MODERATED CAUCUS'], ['unmoderated', 'UNMODERATED CAUCUS'], ['extension', 'ADDS CAUCUS TIME'], ['other', 'OTHER']], m.kind, (v) => { m.kind = v; }),
      checkbox('NEEDS A VOTE', m.needsVote, (v) => { m.needsVote = v; R.render(); }),
      m.needsVote ? dd([['', 'CHOOSE THRESHOLD'], ...rules.thresholds.map((t) => [t.id || t.label, t.label || 'UNNAMED'])], m.threshold, (v) => { m.threshold = v; }) : null);
    const save = pbtn('SAVE RULES', async () => {
      const r = await R.send('rules-save', { rules, reason });
      problems = r.ok ? [] : (r.problems || ['Could not save. Try again.']);
      if (r.ok) { toast('RULES SAVED'); Sound.play('select'); rules = null; reason = ''; await R.pull(); } else if (!r.expired) Sound.play('error');
      R.render();
    }, 'mag');
    save.dataset.rulesSave = '';
    const quorum = num(rules.quorumPercent, 'Quorum percent', (n) => { rules.quorumPercent = n; });
    quorum.dataset.rulesQuorum = '';
    return [
      problems.length ? h('div', { class: 'notice-warn', dataset: { rulesProblems: '' } }, h('strong', null, 'NOT SAVED'), h('ul', null, problems.map((p) => h('li', { text: p })))) : null,
      ecard(h('div', { class: 'ed-row' }, lbl('QUORUM: PERCENT OF DELEGATES PRESENT'), quorum),
        efull(lbl('DELEGATES MAY SUBMIT DIRECTIVES'), dd([['always', 'AT ANY TIME'], ['unmoderated', 'ONLY DURING AN UNMODERATED CAUCUS'], ['closed', 'NOT RIGHT NOW']], rules.submission, (v) => { rules.submission = v; }))),
      esect('VOTING THRESHOLDS'), list('thresholds', () => ({ id: '', label: '', num: 1, den: 2, base: 'voting', strict: true }), thresholdRow),
      esect('MOTION TYPES'), list('motionTypes', () => ({ id: '', label: '', kind: 'other', needsVote: true, threshold: '' }), typeRow),
      efull(lbl('WHY ARE THE RULES CHANGING? (GOES IN THE LOG)'), tf(reason, (v) => { reason = v; }, 'Reason')),
      h('div', { class: 'comm-ctrl-row' }, save)
    ];
  }

  function num(value, label, onInput) {
    const el = h('input', Object.assign(fieldAttrs(), { class: 'input num-xs', type: 'number', min: '0', step: '1', value: String(value), 'aria-label': label }));
    el.addEventListener('input', () => onInput(parseInt(el.value, 10) || 0));
    return el;
  }

  R.views.settings = (body) => {
    if (!session) session = Object.assign({ number: 1, phase: '', banner: '' }, R.state.session);
    if (!rules) rules = JSON.parse(JSON.stringify(R.state.rules));
    const phase = tf(session.phase, (v) => { session.phase = v; }, 'e.g. Formal debate');
    phase.dataset.sessionPhase = '';
    const banner = tf(session.banner, (v) => { session.banner = v; }, 'A short line shown large on the projector');
    banner.dataset.sessionBanner = '';
    const save = pbtn('SAVE', () => R.act('session-set', session, 'SAVED'));
    save.dataset.sessionSave = '';
    body.append(esect('THIS SESSION'), ecard(h('div', { class: 'ed-row' }, lbl('SESSION NUMBER'), num(session.number, 'Session number', (n) => { session.number = n; })),
      efull(lbl('CURRENT PHASE'), phase), efull(lbl('PROJECTOR BANNER'), banner), h('div', { class: 'comm-ctrl-row' }, save)));
    body.append(esect('RULES'), hint('These are starting values, not your conference rules. Check them against your rules of procedure before the first session. Votes already taken keep the rules they used.'), ...rulesForm().filter(Boolean));
  };

  // ---- archive ----
  async function archive() {
    const { res, data } = await A.crisisGet('archive').catch(() => ({ res: { ok: false }, data: null }));
    if (!res.ok || !data || !data.ok) { toast('COULD NOT LOAD THE ARCHIVE'); Sound.play('error'); return null; }
    return data;
  }

  async function download() {
    const data = await archive();
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: `crisis-archive-${data.exportedAt.slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('ARCHIVE DOWNLOADED · IT HOLDS PRIVATE DATA');
  }

  /** A plain record for printing. All text goes in as text, never as HTML. */
  async function printable() {
    const win = window.open('', '_blank');
    const data = await archive();
    if (!win) { toast('ALLOW POP-UPS TO PRINT'); return; }
    if (!data) { win.close(); return; }
    const doc = win.document;
    doc.title = 'Committee record';
    const add = (tag, text) => { const el = doc.createElement(tag); el.textContent = text; doc.body.append(el); };
    const style = doc.createElement('style');
    style.textContent = 'body{font-family:Georgia,serif;margin:24px;font-size:13px;line-height:1.4}h1{font-size:22px}h2{font-size:16px;margin-top:22px;border-bottom:1px solid #000}p{margin:4px 0}';
    doc.head.append(style);
    add('h1', 'Committee record');
    add('p', `Exported ${fmtStamp(data.exportedAt)}. Contains private material. Chairs only.`);
    add('h2', 'Motions');
    data.motions.slice().reverse().forEach((m) => add('p', `${m.ref} ${m.typeLabel} by ${m.proposer}: ${m.topic || ''} (${m.status})`));
    add('h2', 'Votes');
    data.votes.slice().reverse().forEach((v) => add('p', `${v.ref} ${v.question}: ${v.status === 'open' ? 'open' : `${v.passed ? 'passed' : 'failed'}, ${v.tally.for} for, ${v.tally.against} against, ${v.tally.abstain} abstaining`}${v.corrections.length ? ' (corrected)' : ''}`));
    add('h2', 'Directives');
    data.directives.slice().reverse().forEach((d) => { add('p', `${d.ref} ${d.title}, by ${d.authorName}, version ${d.version}: ${d.status}`); d.outcomes.forEach((o) => add('p', `Outcome (${o.result}): ${o.text}`)); });
    add('h2', 'Crisis events');
    data.events.slice().reverse().forEach((e) => add('p', `${e.ref} ${e.simTime ? `[${e.simTime}] ` : ''}${e.title} (${e.status})`));
    add('h2', 'Crisis updates');
    data.updates.slice().reverse().forEach((u) => add('p', `${u.ref} ${u.headline}: ${u.status}${u.publishedAt ? `, ${fmtStamp(u.publishedAt)}` : ''}`));
    add('h2', 'Activity');
    data.log.slice().reverse().forEach((e) => add('p', `${fmtStamp(e.time)} ${e.actor}: ${e.summary}${e.target ? ` (${e.target})` : ''}`));
    win.print();
  }

  R.archiveTools = () => {
    const json = pbtn('DOWNLOAD ARCHIVE', download);
    json.dataset.archiveDownload = '';
    return h('div', null, esect('FINAL ARCHIVE'), hint('Everything on record, including private material. Keep it with the chairs.'), h('div', { class: 'comm-ctrl-row' }, json, pbtn('PRINTABLE RECORD', printable)));
  };

  A.onLogout.push(() => { fresh = []; rules = null; session = null; });
})(window.FORMA = window.FORMA || {});
