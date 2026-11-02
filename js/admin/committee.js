/* FORMA MUN · Crisis Division — Admin: live committee controls
   Saves as you go; nothing here needs publishing. */
(function (F) {
  'use strict';
  const { $, h, toast, Sound } = F;
  const A = F.Admin;
  const { lbl, erow, efull, ecard, hint, esect, dbtn, abtn, tf, dd } = A.ui;

  let Comm = null; // { caucus, directives, kvReady }
  let open = false;
  const bodyEl = () => $('[data-committee-body]');

  const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
  function fmtMs(ms) {
    if (ms <= 0) return '00:00';
    const s = Math.floor(ms / 1000);
    return `${pad2(s / 60)}:${pad2(s % 60)}`;
  }
  function stateText(c) {
    const now = A.now();
    const activePause = (c.status === 'paused' && c.pausedAt) ? now - Date.parse(c.pausedAt) : 0;
    const elapsed = c.startedAt ? now - Date.parse(c.startedAt) - (c.accPausedMs || 0) - activePause : 0;
    return `STATUS: ${c.status.toUpperCase()} · REMAINING: ${fmtMs(Math.max(0, (c.totalMs || 0) - elapsed))} · TYPE: ${c.type.toUpperCase()}`;
  }

  async function load() {
    const { res, data } = await A.committeeGet().catch(() => ({ res: { ok: false }, data: null }));
    if (!res.ok || !data || !data.ok) { toast('COULD NOT LOAD COMMITTEE STATE'); return; }
    Comm = data;
    render();
  }

  // Timer text updates in place, so typing is never interrupted.
  setInterval(() => {
    const bar = open && Comm && Comm.caucus && $('.comm-state-bar');
    if (bar) bar.textContent = stateText(Comm.caucus);
  }, 1000);
  setInterval(async () => {
    if (!open || !Comm || !A.token() || document.hidden) return;
    const { res, data } = await A.committeeGet().catch(() => ({ res: { ok: false }, data: null }));
    if (!res.ok || !data || !data.ok) return;
    Comm.directives = data.directives;
    const box = $('[data-comm-directives]');
    if (box) renderDirectives(box);
  }, 10000);

  /** Number of minutes/seconds to show: the caucus's own, or a sensible default when it has none. */
  const split = (ms, fallbackMin) => (ms ? [Math.floor(ms / 60000), Math.floor((ms % 60000) / 1000)] : [fallbackMin, 0]);

  function numberInput(value, max, onInput) {
    const el = h('input', { class: 'input num-xs', type: 'number', min: '0', max: String(max), step: '1', value: String(value) });
    el.addEventListener('input', () => onInput(parseInt(el.value, 10) || 0));
    return el;
  }

  async function control(op, failText) {
    const { res, data } = await A.committeePost('control', { op });
    if (res.ok && data && data.ok) { Sound.play(op === 'start' ? 'start' : 'select'); Comm.caucus = data.caucus; render(); }
    else { toast(failText || 'CONTROL FAILED'); Sound.play('error'); }
  }

  function renderSetup(body, c) {
    const form = {
      type: (c && c.type) || 'moderated', topic: (c && c.topic) || '',
      total: split(c && c.totalMs, 5), speaker: split(c && c.perSpeakerMs, 1)
    };
    const perSpeaker = erow(lbl('PER SPEAKER'), numberInput(form.speaker[0], 999, (v) => { form.speaker[0] = v; }), lbl('min'), numberInput(form.speaker[1], 59, (v) => { form.speaker[1] = v; }), lbl('sec'));
    perSpeaker.hidden = form.type === 'unmoderated';
    const msg = h('span', { class: 'admin-msg' });
    const btn = h('button', { class: 'btn mag', type: 'button' }, 'SET UP CAUCUS');
    btn.addEventListener('click', async () => {
      if (c && (c.status === 'active' || c.status === 'paused') && !confirm('A caucus is running. Replace it? Its timer and speakers list will be lost.')) return;
      btn.disabled = true;
      msg.textContent = 'SETTING UP…';
      const { res, data } = await A.committeePost('caucus', { type: form.type, topic: form.topic, totalMin: form.total[0], totalSec: form.total[1], perSpeakerMin: form.speaker[0], perSpeakerSec: form.speaker[1] });
      if (res.ok && data && data.ok) { Sound.play('select'); Comm.caucus = data.caucus; render(); toast('CAUCUS READY'); return; }
      msg.className = 'admin-msg bad';
      msg.textContent = data && data.code === 'missing_duration' ? 'SET A TOTAL TIME FIRST' : 'FAILED · TRY AGAIN';
      Sound.play('error');
      btn.disabled = false;
    });
    body.append(esect('CAUCUS SETUP'), hint('Setting up a new caucus resets the timer and the speakers list.'), ecard(
      efull(lbl('TYPE'), dd([['moderated', 'MODERATED CAUCUS'], ['unmoderated', 'UNMODERATED CAUCUS']], form.type, (v) => { form.type = v; perSpeaker.hidden = v === 'unmoderated'; })),
      efull(lbl('TOPIC'), tf(form.topic, (v) => { form.topic = v; }, 'Caucus topic…')),
      erow(lbl('TOTAL DURATION'), numberInput(form.total[0], 999, (v) => { form.total[0] = v; }), lbl('min'), numberInput(form.total[1], 59, (v) => { form.total[1] = v; }), lbl('sec')),
      perSpeaker,
      erow(msg, btn)));
  }

  function renderControls(body, c) {
    const row = h('div', { class: 'comm-ctrl-row' });
    if (c && c.status !== 'idle') {
      body.append(esect('CONTROLS'), h('div', { class: 'comm-state-bar', text: stateText(c) }));
      if (c.status === 'active') {
        row.append(abtn('PAUSE', () => control('pause')));
        if (c.type === 'moderated') row.append(abtn('NEXT SPEAKER ▸', () => control('next')));
        row.append(abtn('STOP', () => control('stop')));
      } else if (c.status === 'paused') {
        row.append(abtn('RESUME', () => control('resume')), abtn('STOP', () => control('stop')));
      } else if (c.status === 'ended') {
        row.append(abtn('CLEAR & RESET', () => control('clear')));
      }
      body.append(row);
    } else if (c && c.totalMs > 0) {
      row.append(abtn('START CAUCUS ▸', () => control('start', 'START FAILED')));
      body.append(esect('CONTROLS'), row);
    }
  }

  function renderSpeakers(body, c) {
    if (!c || c.type !== 'moderated') return;
    const speakerOp = async (payload, onDone) => {
      const { res, data } = await A.committeePost('speaker', payload);
      if (res.ok && data && data.ok) { Comm.caucus.speakers = data.speakers; onDone(); render(); return true; }
      return false;
    };
    const list = h('div', { class: 'ed-list' });
    const speakers = c.speakers || [];
    if (!speakers.length) list.append(hint('No speakers yet. Add delegations below.'));
    speakers.forEach((s, i) => list.append(h('div', { class: 'comm-speaker-item' },
      h('span', { class: 'comm-speaker-name', text: `#${i + 1} ${s.name}` }),
      h('span', { class: 'speaker-badge ' + s.status, text: s.status.toUpperCase() }),
      dbtn(() => speakerOp({ op: 'remove', index: i }, () => {})))));
    const input = tf('', () => {}, 'Delegation name…');
    const add = h('button', { class: 'btn ed-add', type: 'button' }, '+ ADD TO QUEUE');
    add.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return;
      add.disabled = true;
      const ok = await speakerOp({ op: 'add', name }, () => Sound.play('select'));
      if (!ok) { toast('COULD NOT ADD SPEAKER'); Sound.play('error'); add.disabled = false; }
    });
    body.append(esect('SPEAKERS QUEUE'), list, erow(input, add));
  }

  function renderDirectives(box) {
    const dirs = (Comm.directives || []).slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    box.innerHTML = '';
    box.append(hint(`${dirs.length} directive${dirs.length === 1 ? '' : 's'} submitted. This list updates automatically.`));
    if (!dirs.length) { box.append(h('p', { class: 'muted', text: 'No directives yet.' })); return; }
    dirs.forEach((d) => box.append(h('div', { class: 'comm-dir-card' },
      h('div', { class: 'comm-dir-header' }, h('span', { class: 'comm-dir-delegation', text: d.delegation }),
        dbtn(async () => {
          const { res, data } = await A.committeePost('del-directive', { id: d.id });
          if (res.ok && data && data.ok) { Sound.play('select'); Comm.directives = Comm.directives.filter((x) => x.id !== d.id); renderDirectives(box); }
          else toast('COULD NOT DELETE DIRECTIVE');
        })),
      h('div', { class: 'comm-dir-text', text: d.text }))));
  }

  function render() {
    const body = bodyEl();
    body.innerHTML = '';
    if (!Comm) { body.append(hint('Loading committee state…')); return; }
    if (!Comm.kvReady) {
      body.append(h('div', { class: 'comm-banner' }, '⚠ COMMITTEE FEATURES NEED THE VERCEL KV STORE. Connect it under Project → Storage, then redeploy once.'), abtn('REFRESH', load));
      return;
    }
    const c = Comm.caucus || null;
    renderSetup(body, c);
    renderControls(body, c);
    renderSpeakers(body, c);
    const code = A.status && A.status.delegateCode;
    const list = h('div', { dataset: { commDirectives: '' } });
    body.append(esect('PUBLIC DIRECTIVES'),
      hint(code ? `Delegate code: ${code}. Give this to delegates; the Committee page asks for it before they can post.` : 'Anyone can post: DELEGATE_CODE is not set on Vercel.'),
      abtn('REFRESH', load), list);
    renderDirectives(list);
  }

  A.onPanel.committee = () => { open = true; render(); load(); };
  A.onPanelLeave = () => { open = false; };
})(window.FORMA = window.FORMA || {});
