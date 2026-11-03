/* FORMA MUN · Crisis Division — Admin: RUN CAUCUS tab
   Shows one stage at a time (setup, ready, running, ended), so the chair only sees what they can
   do next. The timers tick in place, so typing is never interrupted. */
(function (F) {
  'use strict';
  const { $, h, toast, Sound } = F;
  const A = F.Admin;
  const C = A.comm;
  const { fieldAttrs, lbl, efull, ecard, hint, esect, dbtn, abtn, pbtn, tf } = A.ui;

  const TOTAL_PRESETS = [300, 600, 900, 1200];
  const SPEAKER_PRESETS = [30, 45, 60, 90];
  const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
  const fmt = (ms) => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${pad2(s / 60)}:${pad2(s % 60)}`; };
  const key = (name) => String(name).trim().toLowerCase();

  let form = null;          // setup form while it is open
  let remembered = null;    // the last setup, so the next caucus starts from it
  let editing = false;      // changing the setup of a caucus that hasn't started
  let query = '';           // text in the add-speaker box
  let refocus = false;
  let pasteOpen = false;
  let pasteText = '';
  let lastLeft, lastSpeakerLeft;

  /** The same sums as the public page, so both screens show the same time. */
  function clocks(c) {
    const now = A.now();
    const activePause = c.status === 'paused' && c.pausedAt ? now - Date.parse(c.pausedAt) : 0;
    const paused = (c.accPausedMs || 0) + activePause;
    const elapsed = c.startedAt ? (c.endedAt ? Date.parse(c.endedAt) : now) - Date.parse(c.startedAt) - paused : 0;
    const speakerElapsed = c.currentSpeakerStartedAt ? now - Date.parse(c.currentSpeakerStartedAt) - (paused - (c.accPausedMsAtSpeakerStart || 0)) : 0;
    return { elapsed, left: (c.totalMs || 0) - elapsed, speakerLeft: (c.perSpeakerMs || 0) - speakerElapsed };
  }

  function paintClock(el, left, warnBelow) {
    if (!el) return;
    el.textContent = left > 0 ? fmt(left) : 'TIME UP';
    el.classList.toggle('warn', left > 0 && left <= warnBelow);
    el.classList.toggle('up', left <= 0);
  }

  function tick() {
    const c = C.data && C.data.caucus;
    if (!C.isOpen() || !c || (c.status !== 'active' && c.status !== 'paused')) return;
    const { left, speakerLeft } = clocks(c);
    const clock = $('[data-comm-clock]');
    const speaker = $('[data-comm-speaker-clock]');
    paintClock(clock, left, 30000);
    paintClock(speaker, speakerLeft, 15000);
    // One beep at zero, only when it reaches zero while watching.
    const showsSpeaker = !!speaker && c.perSpeakerMs > 0;
    if ((lastLeft > 0 && left <= 0) || (showsSpeaker && lastSpeakerLeft > 0 && speakerLeft <= 0)) Sound.play('count', 1);
    lastLeft = left;
    lastSpeakerLeft = showsSpeaker ? speakerLeft : undefined;
  }
  setInterval(tick, 500);

  async function control(op, extra, failText) {
    const r = await C.send('control', Object.assign({ op }, extra));
    if (!r.ok) { C.fail(r, failText || 'THAT DID NOT WORK · TRY AGAIN'); return; }
    Sound.play(op === 'start' ? 'start' : 'select');
    C.data.caucus = r.caucus;
    C.render();
  }

  async function speakerOp(payload, failText) {
    const r = await C.send('speaker', payload);
    if (!r.ok) { C.fail(r, failText || 'THAT DID NOT WORK · TRY AGAIN'); return null; }
    C.data.caucus = r.caucus;
    C.render();
    return r;
  }

  /** Adds names to the queue and says plainly what happened. */
  async function addSpeakers(names) {
    const r = await speakerOp({ op: 'add', names }, 'COULD NOT ADD SPEAKERS · TRY AGAIN');
    if (!r) return false;
    Sound.play(r.added.length ? 'select' : 'error');
    const parts = [];
    if (r.added.length) parts.push(r.added.length === 1 ? `${r.added[0].toUpperCase()} ADDED` : `${r.added.length} ADDED`);
    if (r.skipped.length) parts.push(r.skipped.length === 1 ? `${r.skipped[0].toUpperCase()} IS ALREADY QUEUED` : `${r.skipped.length} ALREADY QUEUED`);
    if (r.full) parts.push('QUEUE IS FULL (100)');
    toast(parts.join(' · '));
    return true;
  }
  C.addSpeakers = addSpeakers;
  C.queuedNames = () => new Set(((C.data && C.data.caucus && C.data.caucus.speakers) || []).filter((s) => s.status !== 'done').map((s) => key(s.name)));

  // ---- setup ----
  function blankForm(c) {
    if (c && c.totalMs) {
      return { type: c.type, topic: c.topic || '', totalSec: c.totalMs / 1000, speakerSec: (c.perSpeakerMs || 0) / 1000,
        customTotal: !TOTAL_PRESETS.includes(c.totalMs / 1000), customSpeaker: !SPEAKER_PRESETS.includes((c.perSpeakerMs || 0) / 1000) };
    }
    return Object.assign({ type: 'moderated', topic: '', totalSec: 600, speakerSec: 60, customTotal: false, customSpeaker: false }, remembered, { topic: '' });
  }

  function numberInput(value, max, label, onInput) {
    const el = h('input', Object.assign(fieldAttrs(), { class: 'input num-xs', type: 'number', min: '0', max: String(max), step: '1', value: String(value), 'aria-label': label }));
    el.addEventListener('input', () => onInput(Math.max(0, Math.min(max, parseInt(el.value, 10) || 0))));
    return el;
  }

  function timePicker(title, list, secKey, customKey, labelOf, onChange) {
    const pick = (sec, custom) => { form[customKey] = custom; if (!custom) form[secKey] = sec; C.render(); };
    const row = h('div', { class: 'comm-choices' },
      list.map((sec) => {
        const on = !form[customKey] && form[secKey] === sec;
        return h('button', { class: 'chip-btn' + (on ? ' active' : ''), type: 'button', 'aria-pressed': String(on), onclick: () => pick(sec, false) }, labelOf(sec));
      }),
      h('button', { class: 'chip-btn' + (form[customKey] ? ' active' : ''), type: 'button', 'aria-pressed': String(form[customKey]), onclick: () => pick(0, true) }, 'CUSTOM'));
    const box = efull(lbl(title), row);
    if (form[customKey]) {
      const min = Math.floor(form[secKey] / 60), sec = form[secKey] % 60;
      const set = () => { form[secKey] = minBox.value * 60 + Math.min(59, +secBox.value || 0); onChange(); };
      const minBox = numberInput(min, 999, title + ' minutes', set);
      const secBox = numberInput(sec, 59, title + ' seconds', set);
      box.append(h('div', { class: 'ed-row' }, minBox, lbl('MIN'), secBox, lbl('SEC')));
    }
    return box;
  }

  function fitsText() {
    if (form.type !== 'moderated') return 'Delegates talk freely. Only the caucus timer runs.';
    if (!form.speakerSec) return 'No speaker timer. Only the caucus timer runs.';
    const n = Math.floor(form.totalSec / form.speakerSec);
    return `Time for about ${n} speaker${n === 1 ? '' : 's'}.`;
  }

  function renderSetup(body, c) {
    if (!form) form = blankForm(c);
    const typeBtn = (id, label) => h('button', {
      class: 'chip-btn comm-big-choice' + (form.type === id ? ' active' : ''), type: 'button', 'aria-pressed': String(form.type === id),
      onclick: () => { form.type = id; C.render(); }
    }, label);
    const fits = h('p', { class: 'comm-fits', dataset: { commFits: '' }, text: fitsText() });
    const msg = h('span', { class: 'admin-msg' });
    const btn = pbtn(editing ? 'SAVE SETUP' : 'SET UP CAUCUS ▸', async () => {
      if (!form.totalSec) { msg.className = 'admin-msg bad'; msg.textContent = 'SET A TOTAL TIME FIRST'; Sound.play('error'); return; }
      btn.disabled = true;
      msg.textContent = 'SAVING…';
      const r = await C.send('caucus', { type: form.type, topic: form.topic, totalMin: Math.floor(form.totalSec / 60), totalSec: form.totalSec % 60,
        perSpeakerMin: Math.floor(form.speakerSec / 60), perSpeakerSec: form.speakerSec % 60, keepSpeakers: editing });
      if (r.ok) {
        Sound.play('select');
        C.data.caucus = r.caucus;
        remembered = Object.assign({}, form);
        form = null;
        editing = false;
        C.render();
        toast('CAUCUS READY');
        return;
      }
      msg.className = 'admin-msg bad';
      msg.textContent = r.code === 'missing_duration' ? 'SET A TOTAL TIME FIRST' : 'FAILED · TRY AGAIN';
      if (!r.expired) Sound.play('error');
      btn.disabled = false;
    }, 'mag comm-main');
    const card = ecard(
      efull(lbl('TYPE'), h('div', { class: 'comm-choices' }, typeBtn('moderated', 'MODERATED'), typeBtn('unmoderated', 'UNMODERATED'))),
      efull(lbl('TOPIC (OPTIONAL)'), tf(form.topic, (v) => { form.topic = v; }, 'What is this caucus about?')),
      timePicker('TOTAL TIME', TOTAL_PRESETS, 'totalSec', 'customTotal', (s) => `${s / 60} MIN`, () => { fits.textContent = fitsText(); }));
    if (form.type === 'moderated') card.append(timePicker('TIME PER SPEAKER', SPEAKER_PRESETS, 'speakerSec', 'customSpeaker', (s) => `${s} SEC`, () => { fits.textContent = fitsText(); }));
    card.append(fits, h('div', { class: 'comm-ctrl-row comm-mid' }, btn, editing ? pbtn('CANCEL', () => { form = null; editing = false; C.render(); }) : null, msg));
    body.append(esect(editing ? 'CHANGE THE SETUP' : 'STEP 1: SET UP THE CAUCUS'), card);
  }

  // ---- speakers ----
  function timeWarning(c) {
    const waiting = c.speakers.filter((s) => s.status === 'waiting').length;
    if (!c.perSpeakerMs || !waiting) return null;
    const left = c.status === 'idle' ? c.totalMs : Math.max(0, clocks(c).left);
    const fit = Math.floor(left / c.perSpeakerMs);
    if (waiting <= fit) return null;
    return h('p', { class: 'comm-warn', dataset: { commOvertime: '' }, text: `⚠ ${waiting} waiting, but only time for about ${fit}.` });
  }

  function queueRow(c, s, i) {
    const running = c.status === 'active' || c.status === 'paused';
    const move = (dir, label, arrow, off) => h('button', {
      class: 'comm-arrow', type: 'button', title: label, 'aria-label': `${label}: ${s.name}`, disabled: off,
      onclick: () => speakerOp({ op: 'move', id: s.id, dir })
    }, arrow);
    return h('div', { class: 'comm-speaker-item ' + s.status, dataset: { speakerRow: s.name } },
      h('span', { class: 'comm-speaker-name', text: `${i + 1}. ${s.name}` }),
      h('span', { class: 'speaker-badge ' + s.status, text: s.status.toUpperCase() }),
      h('span', { class: 'comm-row-tools' },
        running && s.status !== 'speaking' ? h('button', {
          class: 'chip-btn', type: 'button', dataset: { speakNow: s.name },
          title: s.status === 'done' ? 'Go back to this speaker. The one speaking now keeps their turn.' : 'Let this speaker go now',
          onclick: () => control('jump', { id: s.id })
        }, 'SPEAK NOW') : null,
        move('up', 'Move up', '▲', i === 0),
        move('down', 'Move down', '▼', i === c.speakers.length - 1),
        dbtn(() => { if (confirm(`Remove ${s.name} from the queue?`)) speakerOp({ op: 'remove', id: s.id }); })));
  }

  function renderQueue(body, c) {
    const list = h('div', { class: 'comm-queue', dataset: { commQueue: '' } });
    if (!c.speakers.length) list.append(hint('Nobody in the queue yet.'));
    c.speakers.forEach((s, i) => list.append(queueRow(c, s, i)));
    const waiting = c.speakers.some((s) => s.status === 'waiting');
    body.append(esect(`SPEAKERS QUEUE (${c.speakers.length})`), timeWarning(c) || '', list);
    if (waiting) {
      body.append(pbtn('CLEAR WAITING', () => {
        if (confirm('Remove everyone who has not spoken yet?')) speakerOp({ op: 'clear-waiting' });
      }));
    }
  }

  function renderAdders(body, c) {
    const delegates = C.delegates.slice().sort((a, b) => Number(!!b.present) - Number(!!a.present) || a.name.localeCompare(b.name));
    const queued = C.queuedNames();
    const grid = h('div', { class: 'comm-grid', dataset: { commGrid: '' } });
    const matches = () => { const q = key(query); return delegates.filter((d) => !q || key(d.name).includes(q)); };
    const paintGrid = () => {
      grid.innerHTML = '';
      matches().forEach((d) => {
        const inQueue = queued.has(key(d.name));
        const chip = h('button', {
          class: 'comm-chip' + (inQueue ? ' in' : '') + (d.present ? '' : ' away'), type: 'button', disabled: inQueue, dataset: { addSpeaker: d.name },
          title: inQueue ? 'Already in the queue' : (d.present ? 'Add to the queue' : 'Marked absent. Tap to add anyway.'),
          onclick: () => { chip.disabled = true; chip.classList.add('in'); addSpeakers([d.name]); }
        }, (inQueue ? '✓ ' : '') + d.name);
        grid.append(chip);
      });
    };
    const addTyped = async () => {
      const typed = query.trim();
      if (!typed) return;
      const top = matches().find((d) => !queued.has(key(d.name)));
      refocus = true;
      query = '';
      await addSpeakers([top ? top.name : typed]);
    };
    const input = C.search('Type a name, press Enter', query, (v) => { query = v; paintGrid(); });
    input.dataset.commSearch = '';
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } });
    const present = delegates.filter((d) => d.present && !queued.has(key(d.name))).map((d) => d.name);
    body.append(esect('ADD SPEAKERS'), h('div', { class: 'ed-row' }, input, abtn('ADD', addTyped)));
    if (delegates.length) { body.append(hint('Tap a name to add it to the queue.'), grid); paintGrid(); }
    else {
      body.append(h('div', { class: 'comm-ctrl-row comm-mid' }, hint('Save your delegates once and you can add them with one tap.'),
        pbtn('SET UP DELEGATES ▸', () => { C.tab = 'delegates'; C.render(); })));
    }
    const tools = h('div', { class: 'comm-ctrl-row' });
    if (present.length) {
      const all = abtn(`ADD ALL PRESENT (${present.length})`, () => addSpeakers(present));
      all.dataset.addAllPresent = '';
      tools.append(all);
    }
    if (!pasteOpen) {
      const paste = pbtn('PASTE LIST', () => { pasteOpen = true; C.render(); });
      paste.dataset.pasteOpen = '';
      tools.append(paste);
    }
    body.append(tools);
    if (pasteOpen) {
      body.append(C.pasteBox({
        text: pasteText, onText: (v) => { pasteText = v; }, known: (n) => queued.has(key(n)), addLabel: 'ADD TO QUEUE',
        onAdd: async (names) => { pasteOpen = false; const before = pasteText; pasteText = ''; if (!await addSpeakers(names)) { pasteOpen = true; pasteText = before; C.render(); } },
        onCancel: () => { pasteOpen = false; pasteText = ''; C.render(); }
      }));
    }
    if (refocus) { refocus = false; setTimeout(() => { const el = $('[data-comm-search]'); if (el) el.focus(); }, 0); }
  }

  // ---- stages ----
  const summary = (c) => [c.type === 'moderated' ? 'MODERATED' : 'UNMODERATED', fmt(c.totalMs), c.type === 'moderated' && c.perSpeakerMs ? `${fmt(c.perSpeakerMs)} EACH` : ''].filter(Boolean).join(' · ');
  const topicLine = (c) => (c.topic ? h('p', { class: 'comm-topic', text: c.topic }) : null);

  function renderReady(body, c) {
    const early = A.status && !A.status.released;
    const start = pbtn('START CAUCUS ▸', () => {
      if (early && !confirm('The site is not released yet. Starting shows the topic and speakers list to everyone. Start anyway?')) return;
      control('start', null, 'START FAILED · TRY AGAIN');
    }, 'mag comm-main');
    start.dataset.commStart = '';
    body.append(h('div', { class: 'comm-live' },
      h('p', { class: 'comm-stage', text: 'READY TO START' }), h('p', { class: 'comm-sub', text: summary(c) }), topicLine(c),
      early ? h('p', { class: 'comm-warn', text: '⚠ Not released yet: starting makes this topic and speakers list public.' }) : null,
      h('div', { class: 'comm-ctrl-row comm-mid' }, start, pbtn('CHANGE SETUP', () => { editing = true; form = blankForm(c); C.render(); }))));
    if (c.type === 'moderated') { renderAdders(body, c); renderQueue(body, c); }
  }

  function mainButton(c, cur, waiting) {
    const button = (label, op) => { const b = pbtn(label, () => control(op), 'mag comm-main'); b.dataset.commMain = ''; return b; };
    if (c.status === 'paused') return button('RESUME ▸', 'resume');
    if (c.type !== 'moderated') return button('PAUSE', 'pause');
    if (cur) return button(waiting ? 'NEXT SPEAKER ▸' : 'FINISH SPEAKER ✓', 'next');
    if (waiting) return button(c.speakers.some((s) => s.status === 'done') ? 'START NEXT SPEAKER ▸' : 'START FIRST SPEAKER ▸', 'next');
    return null;
  }

  function renderRunning(body, c) {
    const cur = c.speakers[c.currentSpeakerIdx];
    const waiting = c.speakers.find((s) => s.status === 'waiting');
    const hasSpeakerClock = cur && c.perSpeakerMs > 0;
    const end = pbtn('END CAUCUS', () => { if (confirm('End this caucus now? You can resume it afterwards.')) control('stop'); });
    end.dataset.commEnd = '';
    const clock = (title, attrs, big) => h('div', { class: 'comm-clock-box' }, h('p', { class: 'comm-clock-title', text: title }), h('p', Object.assign({ class: 'comm-clock' + (big ? ' big' : '') }, attrs), '--:--'));
    const clocksRow = h('div', { class: 'comm-clocks' });
    if (c.type === 'moderated') {
      clocksRow.append(cur
        ? (hasSpeakerClock ? clock(`SPEAKING: ${cur.name}`, { 'data-comm-speaker-clock': '' }, true) : h('div', { class: 'comm-clock-box' }, h('p', { class: 'comm-clock-title', text: 'SPEAKING' }), h('p', { class: 'comm-clock big', text: cur.name })))
        : h('div', { class: 'comm-clock-box' }, h('p', { class: 'comm-clock-title', text: 'SPEAKING' }), h('p', { class: 'comm-nobody', text: 'NOBODY YET' })));
    }
    clocksRow.append(clock('CAUCUS TIME', { 'data-comm-clock': '' }, c.type !== 'moderated'));
    const next = c.type === 'moderated' ? (waiting ? `Up next: ${waiting.name}` : (cur ? 'Nobody else is waiting.' : 'The queue is empty. Add speakers below.')) : '';
    body.append(h('div', { class: 'comm-live ' + c.status },
      h('p', { class: 'comm-stage', text: c.status === 'paused' ? 'PAUSED' : `${c.type === 'moderated' ? 'MODERATED' : 'UNMODERATED'} CAUCUS LIVE` }),
      topicLine(c), clocksRow,
      next ? h('p', { class: 'comm-sub', dataset: { commUpNext: '' }, text: next }) : null,
      h('div', { class: 'comm-ctrl-row comm-mid' }, mainButton(c, cur, waiting),
        c.status === 'active' && c.type === 'moderated' ? pbtn('PAUSE', () => control('pause')) : null,
        pbtn('+1 MIN CAUCUS', () => control('extend', { seconds: 60 })),
        hasSpeakerClock ? pbtn('+30 SEC SPEAKER', () => control('extend-speaker', { seconds: 30 })) : null,
        end)));
    if (c.type === 'moderated') { renderAdders(body, c); renderQueue(body, c); }
    tick();
  }

  function renderEnded(body, c) {
    const heard = c.speakers.filter((s) => s.status !== 'waiting').length;
    const used = fmt(Math.min(clocks(c).elapsed, c.totalMs));
    const reopen = pbtn('RESUME CAUCUS', () => control('reopen'));
    reopen.dataset.commReopen = '';
    const fresh = pbtn('NEW CAUCUS ▸', () => { if (confirm('Start a new caucus? This speakers list will be cleared.')) { form = null; control('clear'); } }, 'mag comm-main');
    fresh.dataset.commNew = '';
    body.append(h('div', { class: 'comm-live ended' },
      h('p', { class: 'comm-stage', text: 'CAUCUS ENDED' }), topicLine(c),
      h('p', { class: 'comm-sub', dataset: { commSummary: '' }, text: `${c.type === 'moderated' ? `${heard} speaker${heard === 1 ? '' : 's'} heard · ` : ''}${used} used of ${fmt(c.totalMs)}` }),
      h('div', { class: 'comm-ctrl-row comm-mid' }, fresh, reopen)));
    if (c.type === 'moderated' && c.speakers.length) {
      // Nobody is speaking any more, so the last speaker shows as done.
      const finished = (s) => (s.status === 'waiting' ? 'waiting' : 'done');
      body.append(esect('SPEAKERS'), h('div', { class: 'comm-queue' }, c.speakers.map((s, i) => h('div', { class: 'comm-speaker-item ' + finished(s) },
        h('span', { class: 'comm-speaker-name', text: `${i + 1}. ${s.name}` }), h('span', { class: 'speaker-badge ' + finished(s), text: finished(s).toUpperCase() })))));
    }
  }

  C.views.run = (body) => {
    const c = C.data.caucus;
    if (!c || (c.status === 'idle' && !c.totalMs) || editing) renderSetup(body, c);
    else if (c.status === 'idle') renderReady(body, c);
    else if (c.status === 'ended') renderEnded(body, c);
    else renderRunning(body, c);
  };
})(window.FORMA = window.FORMA || {});
