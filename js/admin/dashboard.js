/* FORMA MUN · Crisis Division — Admin: login, session, release status and health */
(function (F) {
  'use strict';
  const { CONFIG, $, h, session, pad, tzFmt, toast, Sound } = F;
  const A = F.Admin;

  const dateFmt = tzFmt({ weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  let clockTimer = null;

  const show = (loggedIn) => {
    $('[data-admin-login]').hidden = loggedIn;
    $('[data-admin-dash]').hidden = !loggedIn;
  };

  function logout(text) {
    session.set('adminToken', null);
    clearInterval(clockTimer);
    A.status = null;
    show(false);
    const msg = $('[data-login-msg]');
    if (text) msg.textContent = text;
    A.onLogout.forEach((fn) => fn());
    const u = $('#adm-user');
    if (u) u.focus();
  }

  async function submitLogin(e) {
    e.preventDefault();
    const msg = $('[data-login-msg]');
    msg.textContent = 'CHECKING…'; msg.className = 'admin-msg';
    const btn = $('button[type="submit"]', e.target);
    btn.disabled = true;
    const local = location.protocol === 'file:' ? 'ADMIN NEEDS THE DEPLOYED SITE (NOT A LOCAL FILE)' : null;
    try {
      const { res, data } = await A.login($('#adm-user').value, $('#adm-pass').value);
      if (res.ok && data && data.token) {
        session.set('adminToken', data.token);
        $('#adm-pass').value = ''; msg.textContent = '';
        Sound.play('start');
        enter();
      } else {
        Sound.play('error'); msg.className = 'admin-msg bad';
        const code = data && data.code;
        msg.textContent = code === 'too_many_attempts' ? `TOO MANY ATTEMPTS · TRY AGAIN IN ${Math.ceil((data.retryInSec || 900) / 60)} MIN`
          : code === 'admin_not_configured' ? 'ADMIN NOT CONFIGURED · SET ADMIN_USERNAME AND ADMIN_PASSWORD ON VERCEL'
          : code === 'invalid_credentials' ? `WRONG USERNAME OR PASSWORD · ${data.attemptsLeft} ATTEMPT(S) LEFT`
          : local || 'LOGIN FAILED';
      }
    } catch (err) {
      msg.className = 'admin-msg bad';
      msg.textContent = local || 'NO CONNECTION TO THE SERVER';
    }
    btn.disabled = false;
  }

  function tick() {
    const s = A.status;
    if (!s) return;
    const now = A.now(); const rel = Date.parse(s.releaseAt);
    const left = Math.max(0, rel - now), sec = Math.floor(left / 1000);
    const released = now >= rel;
    $('[data-a="server"]').textContent = dateFmt.format(now);
    $('[data-a="countdown"]').textContent = left > 0 ? `${pad(Math.floor(sec / 86400))}d ${pad(Math.floor(sec % 86400 / 3600))}h ${pad(Math.floor(sec % 3600 / 60))}m ${pad(sec % 60)}s` : 'RELEASED';
    const st = $('[data-a="state"]');
    st.textContent = released ? 'RELEASED · PUBLIC' : 'LOCKED';
    st.className = 'big ' + (released ? 'ok' : 'bad');
    const chip = $('[data-a="top-state"]');
    chip.textContent = released ? 'RELEASED' : 'LOCKED · ' + $('[data-a="countdown"]').textContent;
    chip.className = 'top-state ' + (released ? 'ok' : 'bad');
  }

  function warnBox(box, list) {
    box.innerHTML = '';
    if (!list.length) { box.append(h('p', { class: 'ok', text: '✓ NO PROBLEMS FOUND' })); return; }
    box.append(h('ul', null, list.slice(0, 60).map((w) => h('li', { text: w }))));
    if (list.length > 60) box.append(h('p', { class: 'muted', text: `…and ${list.length - 60} more` }));
  }

  function render() {
    const s = A.status; const c = s.content || {};
    $('[data-a="release"]').textContent = s.releaseAt ? dateFmt.format(Date.parse(s.releaseAt)) + ' (' + CONFIG.timezoneLabel + ')' : 'INVALID RELEASE_AT';
    const cs = $('[data-a="content"]');
    cs.textContent = c.valid ? `OK · ${(c.bytes / 1024).toFixed(1)} KB of 64 KB` : (c.code === 'not_configured' ? 'NOT SET' : 'INVALID JSON');
    cs.className = 'big ' + (c.valid ? 'ok' : 'bad');
    $('[data-a="session"]').textContent = 'SESSION UNTIL ' + dateFmt.format(Date.parse(s.sessionExpiresAt));
    const counts = $('[data-a="counts"]');
    counts.innerHTML = '';
    Object.entries(c.counts || {}).forEach(([k, v]) => counts.append(h('div', { class: 'count' }, h('b', { text: String(v) }), h('span', { text: k.toUpperCase() }))));
    warnBox($('[data-a="warnings"]'), c.valid ? (c.warnings || []) : ['Content is missing or not valid JSON.']);
    const kv = $('[data-a="kv-banner"]');
    kv.innerHTML = '';
    if (!s.kvReady) {
      kv.append(h('div', { class: 'notice-warn' }, h('strong', null, '⚠ STORAGE NOT CONNECTED'),
        ' — saving, publishing, updates and committee controls need the Vercel KV store. Connect it under Project → Storage, then redeploy once.'));
    }
    $('[data-a="restore"]').disabled = !s.canRestore;
    if (A.renderReport) A.renderReport();
  }

  async function refresh() {
    const { res, data } = await A.get('status').catch(() => ({ res: { ok: false, status: 0 }, data: null }));
    if (res.status === 401) { logout('SESSION EXPIRED · LOG IN AGAIN'); return; }
    if (!res.ok || !data) { toast('COULD NOT LOAD STATUS'); return; }
    A.status = data;
    A.clockOffset = Date.parse(data.serverTime) - Date.now();
    render();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 500);
    tick();
  }

  async function restore() {
    if (!confirm('Go back to the previous published version? The current published version becomes the one you can restore to.')) return;
    const { res, data } = await A.post('restore');
    if (res.ok && data && data.ok) { toast('PREVIOUS VERSION RESTORED'); Sound.play('select'); refresh(); if (A.loadContent) A.loadContent(); }
    else if (res.status === 401) logout('SESSION EXPIRED · LOG IN AGAIN');
    else toast('NOTHING TO RESTORE');
  }

  function enter() {
    show(true);
    refresh();
    if (A.loadContent) A.loadContent();
    if (A.openPanel) A.openPanel();
  }

  function init() {
    $('[data-login-form]').addEventListener('submit', submitLogin);
    $('[data-a="refresh"]').addEventListener('click', () => { refresh(); Sound.play('select'); });
    $('[data-a="logout"]').addEventListener('click', () => { logout('LOGGED OUT'); Sound.play('move'); });
    $('[data-a="restore"]').addEventListener('click', restore);
    if (A.token()) enter(); else show(false);
  }

  Object.assign(A, { logout, refresh, dashInit: init, dateFmt });
})(window.FORMA = window.FORMA || {});
