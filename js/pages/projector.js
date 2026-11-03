/* FORMA MUN · Crisis Division — Projector
   A read-only screen for the room. It reads one public endpoint and has no login, so everything
   it could ever show is decided by what that endpoint sends. */
(function (F) {
  'use strict';
  const { CONFIG, $, h } = F;

  const POLL_MS = 3000;
  const STALE_MS = 15000;
  let state = null;
  let offset = 0;
  let lastGood = 0;

  const fmt = (ms) => {
    const s = Math.ceil(Math.max(0, ms) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  function clocks(c) {
    const now = Date.now() + offset;
    const activePause = c.status === 'paused' && c.pausedAt ? now - Date.parse(c.pausedAt) : 0;
    const paused = (c.accPausedMs || 0) + activePause;
    const left = c.totalMs - (now - Date.parse(c.startedAt) - paused);
    const speakerLeft = c.currentSpeakerStartedAt ? c.perSpeakerMs - (now - Date.parse(c.currentSpeakerStartedAt) - (paused - (c.accPausedMsAtSpeakerStart || 0))) : null;
    return { left, speakerLeft };
  }

  function tick() {
    const s = state;
    if (!s) return;
    const paint = (el, left) => {
      if (!el) return;
      el.textContent = left > 0 ? fmt(left) : 'TIME UP';
      el.classList.toggle('up', left <= 0);
      el.classList.toggle('warn', left > 0 && left <= 30000);
    };
    if (s.caucus && s.caucus.status !== 'ended') {
      const { left, speakerLeft } = clocks(s.caucus);
      paint($('[data-proj-clock]'), left);
      if (speakerLeft !== null && s.caucus.perSpeakerMs > 0) paint($('[data-proj-speaker-clock]'), speakerLeft);
    }
    if (s.countdown) paint($('[data-proj-countdown]'), s.countdown.status === 'paused' ? s.countdown.leftMs : Date.parse(s.countdown.endsAt) - (Date.now() + offset));
    const link = $('[data-proj-link]');
    const down = Date.now() - lastGood > STALE_MS;
    link.textContent = down ? 'RECONNECTING…' : 'LIVE';
    link.classList.toggle('bad', down);
  }

  function renderStage(stage, s) {
    stage.innerHTML = '';
    const c = s.caucus;
    if (c && c.status !== 'ended') {
      stage.append(h('p', { class: 'proj-kicker', text: `${c.type === 'moderated' ? 'MODERATED' : 'UNMODERATED'} CAUCUS${c.status === 'paused' ? ' · PAUSED' : ''}` }));
      if (c.topic) stage.append(h('p', { class: 'proj-topic', text: c.topic }));
      if (c.type === 'moderated' && c.current) {
        stage.append(h('p', { class: 'proj-speaker', dataset: { projSpeaker: '' }, text: c.current }));
        if (c.perSpeakerMs > 0) stage.append(h('p', { class: 'proj-clock', 'data-proj-speaker-clock': '' }, '--:--'));
        stage.append(h('p', { class: 'proj-small' }, 'CAUCUS TIME ', h('span', { 'data-proj-clock': '' }, '--:--')));
      } else {
        stage.append(h('p', { class: 'proj-clock', 'data-proj-clock': '' }, '--:--'));
      }
      if (c.next.length) stage.append(h('p', { class: 'proj-small', text: `UP NEXT: ${c.next.join(' · ')}` }));
      return;
    }
    if (s.vote) {
      const t = s.vote.tally;
      stage.append(h('p', { class: 'proj-kicker', text: s.vote.status === 'open' ? 'VOTING' : 'VOTE RESULT' }), h('p', { class: 'proj-topic', text: s.vote.question }));
      if (s.vote.status === 'closed') {
        stage.append(h('p', { class: 'proj-speaker ' + (s.vote.passed ? 'yes' : 'no'), dataset: { projResult: '' }, text: s.vote.passed ? 'PASSED' : 'FAILED' }),
          h('p', { class: 'proj-small', text: `${t.for} FOR · ${t.against} AGAINST · ${t.abstain} ABSTAINING` }));
      }
      return;
    }
    stage.append(h('p', { class: 'proj-kicker', text: s.session.phase || 'STAND BY' }));
  }

  function render() {
    const s = state;
    $('[data-proj-session]').textContent = `SESSION ${s.session.number}${s.session.phase ? ` · ${s.session.phase}` : ''}`;
    const banner = $('[data-proj-banner]');
    banner.textContent = s.session.banner || '';
    banner.hidden = !s.session.banner;
    renderStage($('[data-proj-stage]'), s);
    const side = $('[data-proj-side]');
    side.innerHTML = '';
    if (s.countdown) side.append(h('div', { class: 'proj-card' }, h('p', { class: 'proj-small', text: s.countdown.label }), h('p', { class: 'proj-mid', 'data-proj-countdown': '' }, '--:--')));
    s.updates.forEach((u) => side.append(h('div', { class: 'proj-card ' + u.priority, dataset: { projUpdate: '' } }, h('p', { class: 'proj-card-title', text: u.title }), h('p', { class: 'proj-card-text', text: u.detail }))));
    tick();
  }

  async function poll() {
    if (document.hidden) return;
    try {
      const res = await fetch(`${CONFIG.crisisEndpoint}?action=projector&t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      const st = Date.parse(data.serverTime);
      if (Number.isFinite(st)) offset = st - Date.now();
      lastGood = Date.now();
      delete data.serverTime;
      const changed = JSON.stringify(data) !== JSON.stringify(state);
      state = data;
      if (changed) render();
    } catch (e) { /* keeps the last view; tick shows RECONNECTING */ }
  }

  $('[data-proj-full]').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  poll();
  setInterval(poll, POLL_MS);
  setInterval(tick, 500);
})(window.FORMA = window.FORMA || {});
