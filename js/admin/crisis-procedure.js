/* FORMA MUN · Crisis Division — Admin: Crisis Room, MOTIONS tab
   Propose, rule, vote, then carry out. The software never decides for the chair: a passed motion
   only offers the next step, and every ruling and result stays on the record. */
(function (F) {
  'use strict';
  const { h, toast, fmtStamp, Sound } = F;
  const A = F.Admin;
  const R = A.crisis;
  const { fieldAttrs, lbl, efull, ecard, hint, esect, abtn, pbtn, tf, dd, checkbox } = A.ui;

  const blank = () => ({ type: '', proposer: '', topic: '', minutes: 5, speakerSec: 60 });
  let form = blank();
  let quick = { question: '', threshold: '', method: 'placard', public: true };
  let count = { for: 0, against: 0, abstain: 0 };
  let roll = {};
  let countFor = null;      // the vote those counts belong to

  const ask = (text) => { const v = window.prompt(text); return v && v.trim() ? v.trim() : null; };

  function numberBox(value, label, onInput) {
    const el = h('input', Object.assign(fieldAttrs(), { class: 'input num-xs', type: 'number', min: '0', step: '1', value: String(value), 'aria-label': label }));
    el.addEventListener('input', () => onInput(Math.max(0, parseInt(el.value, 10) || 0)));
    return el;
  }

  // ---- open a vote ----
  async function openVote(body) {
    const first = await R.send('vote-open', body);
    if (first.ok) { Sound.play('select'); await R.pull(); return; }
    if (first.expired) return;
    if (first.code === 'no_quorum') {
      const why = ask(`No quorum: ${first.present} present, ${first.needed} needed. To vote anyway, type the reason. It goes on the record.`);
      if (why) await R.act('vote-open', Object.assign({}, body, { quorumOverride: why }));
      return;
    }
    await R.act('vote-open', body);   // shows the plain message for any other problem
  }

  async function carryOut(m) {
    const c = R.state.caucus;
    const running = c && (c.status === 'active' || c.status === 'paused');
    if (m.kind === 'extension') {
      if (!running) { toast('NO CAUCUS IS RUNNING'); Sound.play('error'); return; }
      const r = await A.comm.send('control', { op: 'extend', seconds: m.totalSec });
      if (!r.ok) { A.comm.fail(r, 'COULD NOT ADD THE TIME'); return; }
      await R.act('motion-done', { id: m.id }, 'TIME ADDED');
      return;
    }
    if (running) { toast('END THE CURRENT CAUCUS FIRST'); Sound.play('error'); return; }
    const r = await A.comm.send('caucus', {
      type: m.kind, topic: m.topic, totalMin: Math.floor(m.totalSec / 60), totalSec: m.totalSec % 60,
      perSpeakerMin: Math.floor(m.speakerSec / 60), perSpeakerSec: m.speakerSec % 60
    });
    if (!r.ok) { A.comm.fail(r, 'COULD NOT SET UP THE CAUCUS'); return; }
    if (await R.act('motion-done', { id: m.id }, 'CAUCUS READY')) {
      A.comm.tab = 'run';
      A.goToPanel('committee');
    }
  }

  // ---- the vote that is open now ----
  function openVoteCard(v) {
    if (countFor !== v.id) { countFor = v.id; count = { for: 0, against: 0, abstain: 0 }; roll = {}; }
    const t = v.threshold;
    const box = h('div', { class: 'comm-live', dataset: { voteOpen: v.ref } },
      h('p', { class: 'comm-stage', text: 'VOTE OPEN' }), h('p', { class: 'comm-topic', text: v.question }),
      h('p', { class: 'comm-sub', text: `${v.eligible.length} voters · ${t.label} · ${v.method === 'roll' ? 'Roll call' : 'Placards'}` }),
      v.quorum.override ? h('p', { class: 'comm-warn', text: `⚠ No quorum, voting anyway: ${v.quorum.override}` }) : null);
    if (v.method === 'roll') {
      const list = h('div', { class: 'comm-queue' });
      v.eligible.forEach((name) => {
        const choice = (c, label) => h('button', {
          class: 'chip-btn' + (roll[name] === c ? ' active' : ''), type: 'button', 'aria-pressed': String(roll[name] === c), dataset: { rollVote: `${name}:${c}` },
          onclick: () => { roll[name] = c; R.render(); }
        }, label);
        list.append(h('div', { class: 'comm-speaker-item' }, h('span', { class: 'comm-speaker-name', text: name }),
          h('span', { class: 'comm-row-tools' }, choice('for', 'FOR'), choice('against', 'AGAINST'), choice('abstain', 'ABSTAIN'))));
      });
      const done = Object.keys(roll).length;
      box.append(list, h('p', { class: 'comm-sub', text: `${done} of ${v.eligible.length} recorded` }));
    } else {
      box.append(h('div', { class: 'ed-row' }, ...['for', 'against', 'abstain'].flatMap((k) => {
        const el = numberBox(count[k], k, (n) => { count[k] = n; });
        el.dataset.voteCount = k;
        return [lbl(k.toUpperCase()), el];
      })));
    }
    const close = pbtn('CLOSE VOTE AND RECORD ▸', async () => {
      const entered = v.method === 'roll' ? Object.keys(roll).length : count.for + count.against + count.abstain;
      if (entered < v.eligible.length && !window.confirm(`Only ${entered} of ${v.eligible.length} votes entered. Close the vote anyway?`)) return;
      await R.act('vote-close', v.method === 'roll' ? { id: v.id, roll } : { id: v.id, tally: count }, 'VOTE RECORDED');
    }, 'mag comm-main');
    close.dataset.voteClose = '';
    box.append(h('div', { class: 'comm-ctrl-row comm-mid' }, close));
    return box;
  }

  // ---- motions ----
  function motionActions(m, voteOpen) {
    const row = h('span', { class: 'comm-row-tools' });
    const rule = (ruling, reason) => R.act('motion-rule', { id: m.id, ruling, reason });
    if (m.status === 'proposed') {
      row.append(
        h('button', { class: 'chip-btn', type: 'button', dataset: { motionInOrder: m.ref }, onclick: () => rule('in-order') }, 'IN ORDER'),
        h('button', { class: 'chip-btn', type: 'button', onclick: () => { const why = ask('Why is it out of order?'); if (why) rule('out-of-order', why); } }, 'OUT OF ORDER'),
        h('button', { class: 'chip-btn', type: 'button', onclick: () => rule('withdrawn') }, 'WITHDRAWN'));
    } else if (m.status === 'in-order') {
      if (!voteOpen) {
        row.append(
          h('button', { class: 'chip-btn', type: 'button', dataset: { motionVote: m.ref }, onclick: () => openVote({ motionId: m.id, method: 'placard' }) }, 'VOTE: PLACARDS'),
          h('button', { class: 'chip-btn', type: 'button', onclick: () => openVote({ motionId: m.id, method: 'roll' }) }, 'VOTE: ROLL CALL'));
      }
      row.append(h('button', { class: 'chip-btn', type: 'button', onclick: () => rule('withdrawn') }, 'WITHDRAWN'));
    } else if (m.status === 'passed' && !m.activityDone && ['moderated', 'unmoderated', 'extension'].includes(m.kind)) {
      row.append(h('button', { class: 'chip-btn active', type: 'button', dataset: { motionCarry: m.ref }, onclick: () => carryOut(m) }, m.kind === 'extension' ? 'ADD THE TIME ▸' : 'SET UP CAUCUS ▸'));
    }
    return row;
  }

  function motionRow(m, voteOpen) {
    const time = m.totalSec ? ` · ${Math.floor(m.totalSec / 60)}:${String(m.totalSec % 60).padStart(2, '0')}${m.speakerSec ? `, ${m.speakerSec}s each` : ''}` : '';
    return R.row({ dataset: { motion: m.ref } },
      h('span', { class: 'crisis-ref', text: m.ref }),
      h('span', { class: 'crisis-main' }, h('b', { text: m.typeLabel }), ` · ${m.proposer}${time}`, m.topic ? h('span', { class: 'crisis-sub', text: m.topic }) : null),
      R.badge(m.status), motionActions(m, voteOpen));
  }

  function proposeCard() {
    const types = R.state.rules.motionTypes;
    if (!types.some((t) => t.id === form.type)) form.type = types[0].id;
    const type = types.find((t) => t.id === form.type);
    const timed = ['moderated', 'unmoderated', 'extension'].includes(type.kind);
    const pick = dd(types.map((t) => [t.id, t.label]), form.type, (v) => { form.type = v; R.render(); });
    pick.dataset.motionType = '';
    const proposer = tf(form.proposer, (v) => { form.proposer = v; }, 'Who proposed it?');
    proposer.dataset.motionProposer = '';
    const topic = tf(form.topic, (v) => { form.topic = v; }, 'Topic or purpose');
    topic.dataset.motionTopic = '';
    const add = abtn('ADD MOTION', async () => {
      const r = await R.act('motion-add', { type: form.type, proposer: form.proposer, topic: form.topic, totalSec: timed ? form.minutes * 60 : 0, speakerSec: type.kind === 'moderated' ? form.speakerSec : 0 });
      if (r) { form = blank(); R.render(); }
    });
    add.dataset.motionAdd = '';
    const card = ecard(efull(lbl('TYPE'), pick), efull(lbl('PROPOSED BY'), proposer), efull(lbl('TOPIC'), topic));
    if (timed) {
      card.append(h('div', { class: 'ed-row' }, lbl('MINUTES'), numberBox(form.minutes, 'Minutes', (n) => { form.minutes = n; }),
        type.kind === 'moderated' ? lbl('SECONDS PER SPEAKER') : null, type.kind === 'moderated' ? numberBox(form.speakerSec, 'Seconds per speaker', (n) => { form.speakerSec = n; }) : null));
    }
    card.append(h('div', { class: 'comm-ctrl-row' }, add));
    return card;
  }

  // ---- finished votes ----
  function voteRow(v) {
    const t = v.tally || {};
    const correct = h('button', {
      class: 'chip-btn', type: 'button', dataset: { voteCorrect: v.ref },
      onclick: async () => {
        const text = window.prompt('Correct the counts as: for, against, abstain', `${t.for}, ${t.against}, ${t.abstain}`);
        if (!text) return;
        const [yes, no, abstain] = text.split(',').map((n) => parseInt(n, 10));
        const reason = ask('Why is this being corrected? The first result stays on the record.');
        if (reason) await R.act('vote-correct', { id: v.id, reason, tally: { for: yes, against: no, abstain }, roll: v.roll }, 'CORRECTION RECORDED');
      }
    }, 'CORRECT');
    return R.row({ dataset: { vote: v.ref } },
      h('span', { class: 'crisis-ref', text: v.ref }),
      h('span', { class: 'crisis-main' }, v.question,
        h('span', { class: 'crisis-sub', text: `${t.for} for · ${t.against} against · ${t.abstain} abstaining${t.missing ? ` · ${t.missing} no vote` : ''} · ${v.threshold.label} · ${fmtStamp(v.closedAt)}` }),
        v.corrections.map((c) => h('span', { class: 'crisis-sub', text: `Corrected by ${c.actor}: ${c.reason}. It was ${c.was.tally.for}–${c.was.tally.against}–${c.was.tally.abstain}, ${c.was.passed ? 'passed' : 'failed'}.` }))),
      R.badge(v.passed ? 'passed' : 'failed'), v.method === 'placard' ? h('span', { class: 'comm-row-tools' }, correct) : null);
  }

  function quickVote() {
    const thresholds = R.state.rules.thresholds;
    if (!thresholds.some((t) => t.id === quick.threshold)) quick.threshold = thresholds[0].id;
    const start = pbtn('OPEN VOTE', () => openVote({ question: quick.question, threshold: quick.threshold, method: quick.method, public: quick.public }));
    start.dataset.quickVote = '';
    const q = tf(quick.question, (v) => { quick.question = v; }, 'What is being voted on?');
    q.dataset.quickQuestion = '';
    return ecard(efull(lbl('QUESTION'), q),
      h('div', { class: 'ed-row' }, lbl('NEEDS'), dd(thresholds.map((t) => [t.id, t.label]), quick.threshold, (v) => { quick.threshold = v; }),
        lbl('HOW'), dd([['placard', 'PLACARDS'], ['roll', 'ROLL CALL']], quick.method, (v) => { quick.method = v; })),
      checkbox('SHOW ON THE PROJECTOR', quick.public, (v) => { quick.public = v; }),
      h('div', { class: 'comm-ctrl-row' }, start));
  }

  R.views.motions = (body) => {
    const { motions, votes } = R.state;
    const open = votes.find((v) => v.status === 'open');
    if (open) body.append(openVoteCard(open));
    const live = motions.filter((m) => ['proposed', 'in-order', 'voting'].includes(m.status) || (m.status === 'passed' && !m.activityDone && m.kind !== 'other'));
    const done = motions.filter((m) => !live.includes(m));
    body.append(esect('NEEDS ACTION'));
    if (!live.length) body.append(hint('No motions waiting.'));
    live.forEach((m) => body.append(motionRow(m, !!open)));
    body.append(esect('PROPOSE A MOTION'), proposeCard());
    if (!open) body.append(esect('VOTE ON SOMETHING ELSE'), quickVote());
    const closed = votes.filter((v) => v.status === 'closed');
    if (closed.length) { body.append(esect('VOTE RECORDS')); closed.forEach((v) => body.append(voteRow(v))); }
    if (done.length) { body.append(esect('EARLIER MOTIONS')); done.forEach((m) => body.append(motionRow(m, true))); }
  };
})(window.FORMA = window.FORMA || {});
