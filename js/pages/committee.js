/* FORMA MUN · Crisis Division — Committee proceedings page
   Polls /api/committee every 5s; runs client-side countdowns every second.
   No login required — fully public. */
(function (F) {
  'use strict';
  const { CONFIG, $ } = F;

  const endpoint = CONFIG.committeeEndpoint || '/api/committee';
  let state = null;  // last fetched { caucus, directives, kvReady }
  let timerTick = null;
  let offset = 0;    // server clock minus device clock, so a wrong device clock can't skew timers

  // ── DOM refs ──────────────────────────────────────────────
  const kvBanner       = $('#kv-banner');
  const caucusEmpty    = $('#caucus-empty');
  const caucusInfo     = $('#caucus-info');
  const caucusType     = $('#caucus-type');
  const caucusChip     = $('#caucus-status-chip');
  const caucusTopic    = $('#caucus-topic');
  const caucusCountdown = $('#caucus-countdown');
  const speakerBlock   = $('#speaker-timer-block');
  const speakerName    = $('#speaker-name');
  const speakerCountdown = $('#speaker-countdown');
  const queueSection   = $('#queue-section');
  const speakersList   = $('#speakers-list');
  const directivesList = $('#directives-list');

  // ── Helpers ───────────────────────────────────────────────
  function pad2(n) { return String(Math.floor(n)).padStart(2, '0'); }
  function fmtMs(ms) {
    if (ms <= 0) return '00:00';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${pad2(h)}:${pad2(m % 60)}:${pad2(s % 60)}`;
    return `${pad2(m)}:${pad2(s % 60)}`;
  }
  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  // ── Fetch state ───────────────────────────────────────────
  async function fetchState() {
    try {
      const res = await fetch(endpoint + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;
      state = data;
      const st = Date.parse(data.serverTime);
      if (Number.isFinite(st)) offset = st - Date.now();
      renderState();
    } catch (e) { /* silent — keep showing last known state */ }
  }

  // ── Render full state ─────────────────────────────────────
  function renderState() {
    if (!state) return;
    if (kvBanner) kvBanner.hidden = !!state.kvReady;
    renderCaucus();
    renderDirectives();
  }

  // ── Render caucus section ─────────────────────────────────
  function renderCaucus() {
    const c = (state && state.caucus) || null;
    if (!c || c.status === 'idle' || !c.totalMs) {
      caucusEmpty.hidden = false;
      caucusInfo.hidden  = true;
      queueSection.hidden = true;
      return;
    }
    caucusEmpty.hidden = true;
    caucusInfo.hidden  = false;

    caucusType.textContent = c.type === 'unmoderated' ? 'UNMODERATED CAUCUS' : 'MODERATED CAUCUS';

    const statusLabels = { active: 'ACTIVE', paused: 'PAUSED', ended: 'ENDED', idle: 'IDLE' };
    caucusChip.textContent = statusLabels[c.status] || c.status.toUpperCase();
    caucusChip.className = 'caucus-status status-' + (c.status || 'idle');

    caucusTopic.textContent = c.topic || '';

    // Show speakers queue for moderated
    if (c.type === 'moderated' && c.speakers && c.speakers.length > 0) {
      queueSection.hidden = false;
      speakersList.innerHTML = '';
      c.speakers.forEach((s, i) => {
        const li = document.createElement('li');
        li.className = 'speaker-item';
        li.innerHTML =
          '<span class="speaker-num">#' + (i + 1) + '</span>' +
          '<span class="speaker-item-name">' + escHtml(s.name) + '</span>' +
          '<span class="speaker-badge ' + s.status + '">' + s.status.toUpperCase() + '</span>';
        speakersList.append(li);
      });
    } else {
      queueSection.hidden = true;
    }

    // Show per-speaker timer for moderated + active
    if (c.type === 'moderated' && c.currentSpeakerIdx >= 0 && c.status !== 'ended') {
      const sp = c.speakers && c.speakers[c.currentSpeakerIdx];
      speakerBlock.hidden = false;
      speakerName.textContent = sp ? sp.name.toUpperCase() : '—';
    } else {
      speakerBlock.hidden = true;
    }

    tickTimers();
  }

  // ── Per-second countdown tick ─────────────────────────────
  function tickTimers() {
    const c = state && state.caucus;
    if (!c || c.status === 'idle') return;

    const now = Date.now() + offset;
    const activePausedMs = (c.status === 'paused' && c.pausedAt) ? now - Date.parse(c.pausedAt) : 0;
    const totalPausedMs  = (c.accPausedMs || 0) + activePausedMs;
    const caucusElapsed  = c.startedAt ? now - Date.parse(c.startedAt) - totalPausedMs : 0;
    const caucusRemaining = Math.max(0, (c.totalMs || 0) - caucusElapsed);

    if (caucusCountdown) {
      caucusCountdown.textContent = c.status === 'ended' ? 'ENDED' : fmtMs(caucusRemaining);
      caucusCountdown.className = 'timer-display' + (caucusRemaining < 30000 && c.status === 'active' ? ' warn' : '') + (caucusRemaining === 0 && c.status === 'active' ? ' expired' : '');
    }

    if (!speakerBlock.hidden && c.currentSpeakerStartedAt && c.perSpeakerMs > 0) {
      const spElapsed = now - Date.parse(c.currentSpeakerStartedAt) - (totalPausedMs - (c.accPausedMsAtSpeakerStart || 0));
      const spRemaining = Math.max(0, c.perSpeakerMs - spElapsed);
      if (speakerCountdown) {
        speakerCountdown.textContent = c.status === 'ended' ? '—' : fmtMs(spRemaining);
        speakerCountdown.className = 'timer-display' + (spRemaining < 15000 && c.status === 'active' ? ' warn' : '');
      }
    }
  }

  // ── Render directives ─────────────────────────────────────
  function renderDirectives() {
    const dirs = (state && state.directives) || [];
    if (!dirs.length) {
      directivesList.innerHTML = '<div class="directive-empty">No public directives.</div>';
      return;
    }
    directivesList.innerHTML = '';
    // newest first
    const sorted = dirs.slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    sorted.forEach(d => {
      const card = document.createElement('div');
      card.className = 'directive-card';
      card.innerHTML =
        '<div class="directive-meta">' +
          '<span class="directive-delegation">' + escHtml(d.delegation) + '</span>' +
          '<span class="directive-time">' + fmtTime(d.time) + '</span>' +
        '</div>' +
        '<div class="directive-text">' + escHtml(d.text) + '</div>';
      directivesList.append(card);
    });
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Init ──────────────────────────────────────────────────
  // Every poll costs KV commands, so hidden tabs stop and quiet periods slow down.
  function schedulePoll() {
    const c = state && state.caucus;
    const live = c && (c.status === 'active' || c.status === 'paused');
    setTimeout(async () => {
      if (!document.hidden) await fetchState();
      schedulePoll();
    }, live ? 5000 : 15000);
  }

  function initCommittee() {
    fetchState().then(schedulePoll);
    if (F.Desk) F.Desk.init();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchState(); });
    setInterval(tickTimers, 1000);   // smooth countdown tick
  }

  F.pages = F.pages || {};
  F.pages.committee = initCommittee;
})(window.FORMA = window.FORMA || {});
