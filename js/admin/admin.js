/* FORMA MUN · Crisis Division — Admin control room
   Module file. Talks only to /api/admin; the password is checked on the server and never
   appears in this file. The session token lives in sessionStorage (cleared when the tab closes). */
(function (F) {
  'use strict';
  const { CONFIG, $, $$, h, session, pad, tzFmt, toast, Sound } = F;

  const dateFmt = tzFmt({ weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const SPECIALS = ['projectile', 'stream', 'wave', 'dash', 'uppercut', 'counter', 'flash'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const LIMIT = 64 * 1024;

  function initAdmin() {
    const login = $('[data-admin-login]'), dash = $('[data-admin-dash]'), form = $('[data-login-form]'), msg = $('[data-login-msg]');
    let status = null, clockTimer = null, offset = 0;

    const token = () => session.get('adminToken', null);
    const api = async (action, opts = {}) => {
      const res = await fetch(CONFIG.adminEndpoint + '?action=' + action + '&t=' + Date.now(), Object.assign({ cache: 'no-store', headers: Object.assign({ Accept: 'application/json' }, token() ? { Authorization: 'Bearer ' + token() } : {}, opts.headers || {}) }, opts.init || {}));
      let data = null; try { data = await res.json(); } catch (e) { data = null; }
      return { res, data };
    };
    const show = (loggedIn) => { login.hidden = loggedIn; dash.hidden = !loggedIn; };

    function logout(text) {
      session.set('adminToken', null); clearInterval(clockTimer); show(false);
      if (text) { msg.textContent = text; }
      const u = $('#adm-user'); if (u) u.focus();
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); msg.textContent = 'CHECKING…'; msg.className = 'admin-msg';
      const btn = $('button[type="submit"]', form); btn.disabled = true;
      try {
        const { res, data } = await api('login', { init: { method: 'POST', body: JSON.stringify({ username: $('#adm-user').value, password: $('#adm-pass').value }) }, headers: { 'Content-Type': 'application/json' } });
        if (res.ok && data && data.token) {
          session.set('adminToken', data.token); $('#adm-pass').value = ''; msg.textContent = '';
          Sound.play('start'); show(true); refresh();
        } else {
          Sound.play('error'); msg.className = 'admin-msg bad';
          const code = data && data.code;
          msg.textContent = code === 'too_many_attempts' ? `TOO MANY ATTEMPTS · TRY AGAIN IN ${Math.ceil((data.retryInSec || 900) / 60)} MIN`
            : code === 'admin_not_configured' ? 'ADMIN NOT CONFIGURED · SET ADMIN_USERNAME AND ADMIN_PASSWORD ON VERCEL'
            : code === 'invalid_credentials' ? `WRONG USERNAME OR PASSWORD · ${data.attemptsLeft} ATTEMPT(S) LEFT`
            : location.protocol === 'file:' ? 'ADMIN NEEDS THE DEPLOYED SITE (NOT A LOCAL FILE)' : 'LOGIN FAILED';
        }
      } catch (err) { msg.className = 'admin-msg bad'; msg.textContent = location.protocol === 'file:' ? 'ADMIN NEEDS THE DEPLOYED SITE (NOT A LOCAL FILE)' : 'NO CONNECTION TO THE SERVER'; }
      btn.disabled = false;
    });

    async function refresh() {
      const { res, data } = await api('status').catch(() => ({ res: { ok: false, status: 0 }, data: null }));
      if (res.status === 401) { logout('SESSION EXPIRED · LOG IN AGAIN'); return; }
      if (!res.ok || !data) { toast('COULD NOT LOAD STATUS'); return; }
      status = data; offset = Date.parse(data.serverTime) - Date.now();
      render(); clearInterval(clockTimer); clockTimer = setInterval(tick, 500); tick();
    }
    function tick() {
      if (!status) return;
      const now = Date.now() + offset; const rel = Date.parse(status.releaseAt);
      $('[data-a="server"]').textContent = dateFmt.format(now);
      const left = Math.max(0, rel - now), s = Math.floor(left / 1000);
      $('[data-a="countdown"]').textContent = left > 0 ? `${pad(Math.floor(s / 86400))}d ${pad(Math.floor(s % 86400 / 3600))}h ${pad(Math.floor(s % 3600 / 60))}m ${pad(s % 60)}s` : 'RELEASED';
      const released = now >= rel;
      const st = $('[data-a="state"]'); st.textContent = released ? 'RELEASED · PUBLIC' : 'LOCKED'; st.className = 'big ' + (released ? 'ok' : 'bad');
    }
    function render() {
      const c = status.content || {};
      $('[data-a="release"]').textContent = status.releaseAt ? dateFmt.format(Date.parse(status.releaseAt)) + ' (' + CONFIG.timezoneLabel + ')' : 'INVALID RELEASE_AT';
      const cs = $('[data-a="content"]');
      cs.textContent = c.valid ? `OK · ${(c.bytes / 1024).toFixed(1)} KB of 64 KB` : (c.code === 'not_configured' ? 'NOT SET (CRISIS_CONTENT_B64)' : 'INVALID JSON');
      cs.className = 'big ' + (c.valid ? 'ok' : 'bad');
      $('[data-a="session"]').textContent = 'SESSION UNTIL ' + dateFmt.format(Date.parse(status.sessionExpiresAt));
      const counts = $('[data-a="counts"]'); counts.innerHTML = '';
      Object.entries(c.counts || {}).forEach(([k, v]) => counts.append(h('div', { class: 'count' }, h('b', { text: String(v) }), h('span', { text: k.toUpperCase() }))));
      warnings($('[data-a="warnings"]'), c.valid ? (c.warnings || []) : ['Content is missing or not valid JSON.']);
    }
    function warnings(box, list) {
      box.innerHTML = '';
      if (!list.length) { box.append(h('p', { class: 'ok', text: '✓ NO PROBLEMS FOUND' })); return; }
      box.append(h('ul', null, list.slice(0, 60).map((w) => h('li', { text: w }))));
      if (list.length > 60) box.append(h('p', { class: 'muted', text: `…and ${list.length - 60} more` }));
    }

    // ---- content tool: validate + base64-encode pasted JSON (runs in the browser only) ----
    const input = $('[data-a="json"]'), output = $('[data-a="b64"]'), report = $('[data-a="report"]'), size = $('[data-a="size"]');
    function check(c) {
      const warn = [], A = (v) => (Array.isArray(v) ? v : []), ids = new Set();
      if (!c.title) warn.push('Missing "title".');
      A(c.characters).forEach((ch, i) => {
        const n = (ch && ch.name) || `character #${i + 1}`;
        if (!ch || !ch.id) warn.push(`${n}: missing "id".`); else if (ids.has(ch.id)) warn.push(`${n}: duplicate id.`); else ids.add(ch.id);
        if (ch && ch.special && !SPECIALS.includes(ch.special.type)) warn.push(`${n}: special type must be one of ${SPECIALS.join(', ')}.`);
        if (ch && ch.special && ch.special.color && !HEX.test(ch.special.color)) warn.push(`${n}: special color must be #rrggbb.`);
      });
      A(c.factions).forEach((f) => A(f && f.members).forEach((m) => { if (!ids.has(m)) warn.push(`Faction "${f.name}": unknown member "${m}".`); }));
      A(c.timeline).forEach((t, i) => { if (t && t.kind && !['background', 'crisis'].includes(t.kind)) warn.push(`Timeline #${i + 1}: kind should be background or crisis.`); });
      return warn;
    }
    function encode(text) { const bytes = new TextEncoder().encode(text); let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); }
    $('[data-a="validate"]').addEventListener('click', () => {
      output.value = ''; size.textContent = '';
      let parsed;
      try { parsed = JSON.parse(input.value); } catch (e) { warnings(report, ['Not valid JSON: ' + e.message]); Sound.play('error'); return null; }
      const w = check(parsed); warnings(report, w); Sound.play(w.length ? 'error' : 'select');
      const compact = JSON.stringify(parsed); const b64 = encode(compact);
      output.value = b64; size.textContent = `${(b64.length / 1024).toFixed(1)} KB · ${b64.length <= LIMIT ? 'fits' : 'TOO BIG'} (Vercel limit ~64 KB)`;
      size.className = b64.length <= LIMIT ? 'ok' : 'bad';
      return parsed;
    });
    $('[data-a="load"]').addEventListener('click', async () => {
      const { res, data } = await api('content').catch(() => ({ res: { ok: false }, data: null }));
      if (res.status === 401) { logout('SESSION EXPIRED · LOG IN AGAIN'); return; }
      if (res.ok && data && data.content) { input.value = JSON.stringify(data.content, null, 2); toast('LOADED CURRENT SERVER CONTENT'); }
      else toast('NO CONTENT ON THE SERVER YET');
    });
    $('[data-a="copy"]').addEventListener('click', async () => {
      if (!output.value) { toast('VALIDATE FIRST'); return; }
      try { await navigator.clipboard.writeText(output.value); toast('COPIED · PASTE INTO CRISIS_CONTENT_B64'); }
      catch (e) { output.select(); toast('SELECTED · PRESS CTRL/CMD+C'); }
    });
    $('[data-a="preview"]').addEventListener('click', () => { location.href = 'index.html?preview=1'; });
    $('[data-a="refresh"]').addEventListener('click', () => { refresh(); Sound.play('select'); });
    $('[data-a="logout"]').addEventListener('click', () => { logout('LOGGED OUT'); Sound.play('move'); });

    if (token()) { show(true); refresh(); } else show(false);
  }

  F.pages = F.pages || {};
  F.pages.admin = initAdmin;
})(window.FORMA = window.FORMA || {});
