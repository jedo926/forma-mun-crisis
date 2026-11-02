/* FORMA MUN · Crisis Division — Admin control room
   Module file. Talks only to /api/admin; the password is checked on the server and never
   appears in this file. The session token lives in sessionStorage (cleared when the tab closes). */
(function (F) {
  'use strict';
  const { CONFIG, $, $$, h, session, pad, tzFmt, toast, Sound } = F;

  const dateFmt = tzFmt({ weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const LIMIT = 64 * 1024;

  function initAdmin() {
    const login = $('[data-admin-login]'), dash = $('[data-admin-dash]'), form = $('[data-login-form]'), msg = $('[data-login-msg]');
    let status = null, clockTimer = null, offset = 0;

    const token = () => session.get('adminToken', null);
    const api = async (action, opts = {}) => {
      const res = await fetch(CONFIG.adminEndpoint + '?action=' + action + '&t=' + Date.now(),
        Object.assign({ cache: 'no-store', headers: Object.assign({ Accept: 'application/json' }, token() ? { Authorization: 'Bearer ' + token() } : {}, opts.headers || {}) }, opts.init || {}));
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
        const { res, data } = await api('login', {
          init: { method: 'POST', body: JSON.stringify({ username: $('#adm-user').value, password: $('#adm-pass').value }) },
          headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok && data && data.token) {
          session.set('adminToken', data.token); $('#adm-pass').value = ''; msg.textContent = '';
          Sound.play('start'); show(true); refresh(); loadContent();
        } else {
          Sound.play('error'); msg.className = 'admin-msg bad';
          const code = data && data.code;
          msg.textContent = code === 'too_many_attempts' ? `TOO MANY ATTEMPTS · TRY AGAIN IN ${Math.ceil((data.retryInSec || 900) / 60)} MIN`
            : code === 'admin_not_configured' ? 'ADMIN NOT CONFIGURED · SET ADMIN_USERNAME AND ADMIN_PASSWORD ON VERCEL'
            : code === 'invalid_credentials' ? `WRONG USERNAME OR PASSWORD · ${data.attemptsLeft} ATTEMPT(S) LEFT`
            : location.protocol === 'file:' ? 'ADMIN NEEDS THE DEPLOYED SITE (NOT A LOCAL FILE)' : 'LOGIN FAILED';
        }
      } catch (err) {
        msg.className = 'admin-msg bad';
        msg.textContent = location.protocol === 'file:' ? 'ADMIN NEEDS THE DEPLOYED SITE (NOT A LOCAL FILE)' : 'NO CONNECTION TO THE SERVER';
      }
      btn.disabled = false;
    });

    async function refresh() {
      const { res, data } = await api('status').catch(() => ({ res: { ok: false, status: 0 }, data: null }));
      if (res.status === 401) { logout('SESSION EXPIRED · LOG IN AGAIN'); return; }
      if (!res.ok || !data) { toast('COULD NOT LOAD STATUS'); return; }
      status = data; offset = Date.parse(data.serverTime) - Date.now();
      renderStatus(); clearInterval(clockTimer); clockTimer = setInterval(tick, 500); tick();
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
    function renderStatus() {
      const c = status.content || {};
      $('[data-a="release"]').textContent = status.releaseAt ? dateFmt.format(Date.parse(status.releaseAt)) + ' (' + CONFIG.timezoneLabel + ')' : 'INVALID RELEASE_AT';
      const cs = $('[data-a="content"]');
      cs.textContent = c.valid ? `OK · ${(c.bytes / 1024).toFixed(1)} KB of 64 KB` : (c.code === 'not_configured' ? 'NOT SET (CRISIS_CONTENT_B64)' : 'INVALID JSON');
      cs.className = 'big ' + (c.valid ? 'ok' : 'bad');
      $('[data-a="session"]').textContent = 'SESSION UNTIL ' + dateFmt.format(Date.parse(status.sessionExpiresAt));
      const counts = $('[data-a="counts"]'); counts.innerHTML = '';
      Object.entries(c.counts || {}).forEach(([k, v]) => counts.append(h('div', { class: 'count' }, h('b', { text: String(v) }), h('span', { text: k.toUpperCase() }))));
      warnBox($('[data-a="warnings"]'), c.valid ? (c.warnings || []) : ['Content is missing or not valid JSON.']);
      // KV status banner — show once per status refresh
      let kvBanner = $('[data-a="kv-banner"]');
      if (!kvBanner) { kvBanner = h('div', { class: 'admin-notice', dataset: { a: 'kv-banner' } }); $('[data-admin-dash]').insertBefore(kvBanner, $('[data-admin-editor]')); }
      kvBanner.innerHTML = '';
      if (!status.kvReady) {
        kvBanner.append(h('div', { class: 'notice-warn' },
          h('strong', null, '⚠ VERCEL KV NOT CONNECTED'),
          ' — PUBLISH CHANGES will require a manual copy-paste step. For instant publishing and committee features (caucus, directives), connect a KV store: ',
          h('strong', null, 'Vercel Dashboard → Project → Storage → Create KV Store'),
          '. Env vars are added automatically, then redeploy once.'
        ));
      }
    }
    function warnBox(box, list) {
      box.innerHTML = '';
      if (!list.length) { box.append(h('p', { class: 'ok', text: '✓ NO PROBLEMS FOUND' })); return; }
      box.append(h('ul', null, list.slice(0, 60).map((w) => h('li', { text: w }))));
      if (list.length > 60) box.append(h('p', { class: 'muted', text: `…and ${list.length - 60} more` }));
    }

    $('[data-a="preview"]').addEventListener('click', () => {
      const t = token();
      const url = 'index.html?preview=1' + (t ? '#at=' + encodeURIComponent(t) : '');
      // Use a temporary <a> click — more reliable across browsers than window.open
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
    $('[data-a="refresh"]').addEventListener('click', () => { refresh(); Sound.play('select'); });
    $('[data-a="logout"]').addEventListener('click', () => { logout('LOGGED OUT'); Sound.play('move'); });

    // ============================================================
    // CONTENT EDITOR
    // ============================================================
    const edRoot = $('[data-admin-editor]');
    let C = {};
    let contentReady = false;   // true once the server's content (or its absence) is confirmed
    let activeTab = 'updates';

    const TABS = [
      ['updates',    'UPDATES'],
      ['general',    'GENERAL'],
      ['characters', 'CHARACTERS'],
      ['factions',   'FACTIONS'],
      ['timeline',   'TIMELINE'],
      ['locations',  'LOCATIONS'],
      ['intel',      'INTEL'],
      ['committee',  'COMMITTEE']
    ];

    const ed = (sel) => $(sel, edRoot);

    // ---- small DOM helpers ----
    function lbl(text) { return h('span', { class: 'ed-lbl', text }); }
    function erow(...children) { return h('div', { class: 'ed-row' }, ...children); }
    function efull(...children) { return h('div', { class: 'ed-row ed-full' }, ...children); }
    function ecard(...children) { return h('div', { class: 'ed-card' }, ...children); }
    function hint(text) { return h('p', { class: 'muted ed-hint', text }); }
    function esect(text) { return h('h3', { class: 'ed-section', text }); }
    function dbtn(onClick) {
      const b = h('button', { class: 'ed-del', type: 'button', title: 'Remove this item' }, '✕');
      b.addEventListener('click', onClick);
      return b;
    }
    function abtn(label, onClick) {
      const b = h('button', { class: 'btn ed-add', type: 'button' }, '+ ' + label);
      b.addEventListener('click', onClick);
      return b;
    }
    function tf(val, onInput, placeholder) {
      const el = h('input', { class: 'input', type: 'text', placeholder: placeholder || '' });
      el.value = val || '';
      el.addEventListener('input', () => onInput(el.value));
      return el;
    }
    function ta(val, onInput, placeholder, cls) {
      const el = h('textarea', { class: 'input ' + (cls || 'ta-sm'), placeholder: placeholder || '' });
      el.value = val || '';
      el.addEventListener('input', () => onInput(el.value));
      return el;
    }
    function dd(options, current, onChange) {
      const el = h('select', { class: 'input dd-sm' });
      options.forEach(([v, lbl2]) => {
        const o = h('option', { value: v, text: lbl2 });
        if (v === current) o.selected = true;
        el.append(o);
      });
      el.addEventListener('change', () => onChange(el.value));
      return el;
    }
    function cpick(val, onChange) {
      const el = h('input', { class: 'cpick', type: 'color' });
      el.value = val || '#000000';
      el.addEventListener('input', () => onChange(el.value));
      return el;
    }

    // ---- tab rendering ----
    function renderTabs() {
      const bar = ed('[data-editor-tabs]');
      bar.innerHTML = '';
      TABS.forEach(([id, label]) => {
        const btn = h('button', { class: 'chip-btn ed-tab' + (id === activeTab ? ' active' : ''), type: 'button' }, label);
        btn.dataset.tab = id;
        btn.addEventListener('click', () => { activeTab = id; renderTabs(); renderTabBody(); });
        bar.append(btn);
      });
    }

    function renderTabBody() {
      const body = ed('[data-editor-body]');
      body.innerHTML = '';
      ({ updates: renderUpdates, general: renderGeneral, characters: renderCharacters, factions: renderFactions, timeline: renderTimeline, locations: renderLocations, intel: renderIntel, committee: renderCommittee }[activeTab] || (() => {}))(body);
    }

    // ---- UPDATES ----
    function renderUpdates(body) {
      C.updates = C.updates || [];
      body.append(hint('Live updates pushed to delegates as the crisis develops. Newest first.'));
      const list = h('div', { class: 'ed-list' });
      C.updates.forEach((u, i) => list.append(updateCard(u, i)));
      body.append(list);
      body.append(abtn('ADD UPDATE', () => {
        C.updates.unshift({ time: new Date().toISOString(), priority: 'medium', title: '', detail: '' });
        renderTabBody();
      }));
    }
    // datetime-local inputs hold local wall-clock time; stored times are ISO instants.
    function toLocalInput(iso) {
      const d = new Date(iso);
      return isNaN(d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    function updateCard(u, i) {
      const timeEl = h('input', { class: 'input', type: 'datetime-local' });
      timeEl.value = u.time ? toLocalInput(u.time) : '';
      timeEl.addEventListener('change', () => { u.time = timeEl.value ? new Date(timeEl.value).toISOString() : ''; });
      return ecard(
        erow(lbl('TIME'), timeEl, lbl('PRIORITY'), dd([['critical','CRITICAL'],['high','HIGH'],['medium','MEDIUM'],['low','LOW']], u.priority, v => { u.priority = v; }), dbtn(() => { C.updates.splice(i, 1); renderTabBody(); })),
        efull(lbl('HEADLINE'), tf(u.title, v => { u.title = v; }, 'Short update headline…')),
        efull(lbl('DETAILS'), ta(u.detail, v => { u.detail = v; }, 'Full update text…'))
      );
    }

    // ---- GENERAL ----
    function renderGeneral(body) {
      body.append(esect('COMMITTEE INFO'));
      body.append(
        efull(lbl('Title'), tf(C.title, v => { C.title = v; }, 'e.g. Operation Lazarus')),
        efull(lbl('Subtitle'), tf(C.subtitle, v => { C.subtitle = v; }, 'Short tagline shown under the title')),
        efull(lbl('Premise Note'), ta(C.premiseNote, v => { C.premiseNote = v; }, 'Brief note on the fictional premise'))
      );

      body.append(esect('BRIEFING DOCUMENT'));
      const B = C.briefing = C.briefing || {};
      body.append(
        efull(lbl('Committee Format'), tf(B.committeeFormat, v => { B.committeeFormat = v; }, 'e.g. Ad-hoc crisis committee')),
        efull(lbl('Overview  (blank line = new paragraph)'), ta((B.overview || []).join('\n\n'), v => { B.overview = splitParas(v); }, 'Overview paragraphs…', 'ta-lg')),
        efull(lbl('Context'), ta((B.context || []).join('\n\n'), v => { B.context = splitParas(v); }, 'Context paragraphs…', 'ta-lg')),
        efull(lbl('Debate Scope  (one item per line)'), ta((B.debateScope || []).join('\n'), v => { B.debateScope = v.split('\n').map(s => s.trim()).filter(Boolean); }, 'One scope item per line')),
        efull(lbl('Background'), ta((B.background || []).join('\n\n'), v => { B.background = splitParas(v); }, 'Background notes…', 'ta-lg'))
      );

      body.append(esect('MAP'));
      const M = C.map = C.map || {};
      body.append(
        erow(lbl('Map Label'), tf(M.label, v => { M.label = v; }, 'e.g. NEO-LEVANT SECTOR'), lbl('Note'), tf(M.note, v => { M.note = v; }, 'Small note shown under the map'))
      );

      body.append(esect('REVEAL CUTSCENE'));
      body.append(hint('Shown to delegates the moment the committee scenario unlocks.'));
      const CS = C.cutscene = C.cutscene || {};
      body.append(
        erow(lbl('Date Text'), tf(CS.date, v => { CS.date = v; }, 'e.g. 07 JAN 2027'), lbl('Tagline'), tf(CS.tagline, v => { CS.tagline = v; }, 'One dramatic reveal line')),
        efull(lbl('Disclaimer'), tf(CS.disclaimer, v => { CS.disclaimer = v; }, 'e.g. All events depicted are fictional'))
      );
    }
    function splitParas(v) { return v.split(/\n{2,}/).map(s => s.trim()).filter(Boolean); }

    // ---- CHARACTERS ----
    const HAIR_STYLES = [['slick','Slick'],['curly','Curly'],['mop','Mop'],['close','Close-cropped'],['crew','Crew cut'],['bun','Bun'],['long','Long'],['side_part','Side part'],['bald','Bald']];
    const OUTFIT_TYPES = [['suit','Suit'],['military','Military'],['robe','Robe']];
    function renderCharacters(body) {
      C.characters = C.characters || [];
      body.append(hint('One entry per character in the committee. The Short ID must be unique with no spaces.'));
      const list = h('div', { class: 'ed-list' });
      C.characters.forEach((ch, i) => list.append(charCard(ch, i)));
      body.append(list);
      body.append(abtn('ADD CHARACTER', () => {
        C.characters.push({ id: 'char' + Date.now(), name: '', role: '', affiliation: '', faction: '', bio: '', look: { skin: '#c68a5c', hair: { style: 'slick', color: '#1c1530' }, outfit: { type: 'suit', jacket: '#2a2c33', tie: '#1a1b22' } } });
        renderTabBody();
      }));
    }
    function charCard(ch, i) {
      const L = ch.look = ch.look || {};
      const Hr = L.hair = L.hair || {};
      const O = L.outfit = L.outfit || {};
      return ecard(
        erow(lbl('FULL NAME'), tf(ch.name, v => { ch.name = v; }, 'Character name'), lbl('SHORT ID'), tf(ch.id, v => { ch.id = v; }, 'unique-id'), dbtn(() => { C.characters.splice(i, 1); renderTabBody(); })),
        erow(lbl('ROLE / TITLE'), tf(ch.role, v => { ch.role = v; }, 'e.g. Minister of Defence'), lbl('AFFILIATION'), tf(ch.affiliation, v => { ch.affiliation = v; }, 'e.g. Republic of Lebanon')),
        erow(lbl('FACTION'), tf(ch.faction, v => { ch.faction = v; }, 'Faction name'), lbl('PORTRAIT FILE'), tf(ch.portrait, v => { ch.portrait = v; }, 'assets/images/photo.png')),
        efull(lbl('BIO'), ta(ch.bio, v => { ch.bio = v; }, 'Character biography…')),
        erow(
          lbl('SKIN'), cpick(L.skin || '#c68a5c', v => { L.skin = v; }),
          lbl('HAIR STYLE'), dd(HAIR_STYLES, Hr.style || 'slick', v => { Hr.style = v; }),
          lbl('HAIR COLOR'), cpick(Hr.color || '#1c1530', v => { Hr.color = v; }),
          lbl('OUTFIT'), dd(OUTFIT_TYPES, O.type || 'suit', v => { O.type = v; }),
          lbl('JACKET'), cpick(O.jacket || '#2a2c33', v => { O.jacket = v; }),
          lbl('TIE'), cpick(O.tie || '#1a1b22', v => { O.tie = v; })
        )
      );
    }

    // ---- FACTIONS ----
    function renderFactions(body) {
      C.factions = C.factions || [];
      body.append(hint('Groups or alliances in the scenario. Check boxes to assign characters to each faction.'));
      const list = h('div', { class: 'ed-list' });
      C.factions.forEach((f, i) => list.append(factionCard(f, i)));
      body.append(list);
      body.append(abtn('ADD FACTION', () => {
        C.factions.push({ id: 'f' + Date.now(), name: '', description: '', members: [], relations: [] });
        renderTabBody();
      }));
    }
    function factionCard(f, i) {
      const chars = C.characters || [];
      const membersWrap = h('div', { class: 'members-grid' });
      if (chars.length) {
        chars.forEach(ch => {
          const cbId = 'fcb' + i + ch.id;
          const cb = h('input', { type: 'checkbox', id: cbId });
          cb.checked = (f.members || []).includes(ch.id);
          cb.addEventListener('change', () => {
            f.members = f.members || [];
            if (cb.checked) { if (!f.members.includes(ch.id)) f.members.push(ch.id); }
            else f.members = f.members.filter(m => m !== ch.id);
          });
          membersWrap.append(h('label', { class: 'cb-lbl', for: cbId }, cb, ' ' + (ch.name || ch.id)));
        });
      } else {
        membersWrap.append(h('span', { class: 'muted', text: 'Add characters first, then assign them here.' }));
      }
      return ecard(
        erow(lbl('FACTION NAME'), tf(f.name, v => { f.name = v; }, 'Faction name'), dbtn(() => { C.factions.splice(i, 1); renderTabBody(); })),
        efull(lbl('DESCRIPTION'), ta(f.description, v => { f.description = v; }, 'Faction description…')),
        efull(lbl('MEMBERS'), membersWrap)
      );
    }

    // ---- TIMELINE ----
    function renderTimeline(body) {
      C.timeline = C.timeline || [];
      body.append(hint('Events on the crisis timeline. "Historical Background" = real history; "Crisis Event" = fictional divergence.'));
      const list = h('div', { class: 'ed-list' });
      C.timeline.forEach((t, i) => list.append(timelineCard(t, i)));
      body.append(list);
      body.append(abtn('ADD EVENT', () => {
        C.timeline.push({ date: '', title: '', kind: 'background', detail: '' });
        renderTabBody();
      }));
    }
    function timelineCard(t, i) {
      return ecard(
        erow(lbl('DATE'), tf(t.date, v => { t.date = v; }, 'e.g. 14 June 1453'), lbl('TYPE'), dd([['background','Historical Background'],['crisis','Crisis Event']], t.kind || 'background', v => { t.kind = v; }), dbtn(() => { C.timeline.splice(i, 1); renderTabBody(); })),
        efull(lbl('TITLE'), tf(t.title, v => { t.title = v; }, 'Event title')),
        efull(lbl('DETAIL'), ta(t.detail, v => { t.detail = v; }, 'Event description…'))
      );
    }

    // ---- LOCATIONS ----
    function renderLocations(body) {
      C.locations = C.locations || [];
      body.append(hint('Points on the crisis map. X and Y are percentages (0–100) of the map image size.'));
      const list = h('div', { class: 'ed-list' });
      C.locations.forEach((l, i) => list.append(locationCard(l, i)));
      body.append(list);
      body.append(abtn('ADD LOCATION', () => {
        C.locations.push({ id: 'loc' + Date.now(), name: '', type: 'SITE', x: 50, y: 50, description: '' });
        renderTabBody();
      }));
    }
    function locationCard(l, i) {
      const xEl = h('input', { class: 'input num-sm', type: 'number', min: '0', max: '100', step: '1', placeholder: '0–100' });
      xEl.value = l.x != null ? String(l.x) : '50';
      xEl.addEventListener('input', () => { l.x = Number(xEl.value); });
      const yEl = h('input', { class: 'input num-sm', type: 'number', min: '0', max: '100', step: '1', placeholder: '0–100' });
      yEl.value = l.y != null ? String(l.y) : '50';
      yEl.addEventListener('input', () => { l.y = Number(yEl.value); });
      return ecard(
        erow(lbl('NAME'), tf(l.name, v => { l.name = v; }, 'Location name'), lbl('TYPE'), tf(l.type, v => { l.type = v; }, 'e.g. SITE'), dbtn(() => { C.locations.splice(i, 1); renderTabBody(); })),
        erow(lbl('MAP X %'), xEl, lbl('MAP Y %'), yEl),
        efull(lbl('DESCRIPTION'), ta(l.description, v => { l.description = v; }, 'Location description…'))
      );
    }

    // ---- INTEL ----
    function renderIntel(body) {
      C.intel = C.intel || [];
      body.append(hint('Classified dossiers and documents shown to delegates.'));
      const list = h('div', { class: 'ed-list' });
      C.intel.forEach((it, i) => list.append(intelCard(it, i)));
      body.append(list);
      body.append(abtn('ADD DOSSIER', () => {
        C.intel.push({ codename: '', classification: 'CLASSIFIED', title: '', body: '' });
        renderTabBody();
      }));
    }
    function intelCard(it, i) {
      return ecard(
        erow(lbl('CODENAME'), tf(it.codename, v => { it.codename = v; }, 'e.g. OMEGA-01'), lbl('LEVEL'), dd([['CLASSIFIED','CLASSIFIED'],['CONFIDENTIAL','CONFIDENTIAL'],['DECLASSIFIED','DECLASSIFIED']], it.classification || 'CLASSIFIED', v => { it.classification = v; }), dbtn(() => { C.intel.splice(i, 1); renderTabBody(); })),
        efull(lbl('TITLE'), tf(it.title, v => { it.title = v; }, 'Document title')),
        efull(lbl('CONTENT'), ta(it.body, v => { it.body = v; }, 'Dossier content…', 'ta-lg'))
      );
    }

    // ---- COMMITTEE ----
    let Comm = null; // { caucus, directives, kvReady }

    function capi(action, opts) {
      return fetch(CONFIG.committeeEndpoint + '?action=' + action + '&t=' + Date.now(),
        Object.assign({ cache: 'no-store', headers: Object.assign({ Accept: 'application/json', Authorization: 'Bearer ' + token() }, opts && opts.headers || {}) }, opts && opts.init || {}))
        .then(res => res.json().then(data => ({ res, data })).catch(() => ({ res, data: null })));
    }

    function pad2c(n) { return String(Math.floor(n)).padStart(2, '0'); }
    function fmtMs(ms) {
      if (ms <= 0) return '00:00';
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      return `${pad2c(m)}:${pad2c(s % 60)}`;
    }

    async function loadCommittee() {
      const { res, data } = await capi('', {}).catch(() => ({ res: { ok: false }, data: null }));
      // GET with no action
      if (!res.ok || !data || !data.ok) { toast('COULD NOT LOAD COMMITTEE STATE'); return; }
      Comm = data;
      renderTabBody();
    }

    function renderCommittee(body) {
      const c = (Comm && Comm.caucus) || null;
      const dirs = (Comm && Comm.directives) || [];

      if (!Comm) {
        body.append(hint('Loading committee state…'));
        loadCommittee();
        return;
      }
      if (!Comm.kvReady) {
        body.append(h('div', { class: 'comm-banner' },
          '⚠ COMMITTEE FEATURES REQUIRE VERCEL KV — ',
          h('strong', null, 'Go to Vercel Dashboard → Project → Storage → Connect KV Store.'),
          ' The env vars are added automatically. Then redeploy.'
        ));
        body.append(abtn('REFRESH', loadCommittee));
        return;
      }

      // ---- CAUCUS SETUP ----
      body.append(esect('CAUCUS SETUP'));
      body.append(hint('Configure a new caucus. This resets all controls and speaker positions.'));

      let setupType    = (c && c.type) || 'moderated';
      let setupTopic   = (c && c.topic) || '';
      let setupTotMin  = c ? Math.floor((c.totalMs || 0) / 60000) : 5;
      let setupTotSec  = c ? Math.floor(((c.totalMs || 0) % 60000) / 1000) : 0;
      let setupSpkMin  = c ? Math.floor((c.perSpeakerMs || 0) / 60000) : 1;
      let setupSpkSec  = c ? Math.floor(((c.perSpeakerMs || 0) % 60000) / 1000) : 0;

      const typeEl = dd([['moderated','MODERATED CAUCUS'], ['unmoderated','UNMODERATED CAUCUS']], setupType, v => { setupType = v; updatePerSpkRow(); });
      const topicEl = tf(setupTopic, v => { setupTopic = v; }, 'Caucus topic…');
      const totMinEl = h('input', { class: 'input num-xs', type: 'number', min: '0', max: '999', step: '1', value: String(setupTotMin) });
      const totSecEl = h('input', { class: 'input num-xs', type: 'number', min: '0', max: '59', step: '1', value: String(setupTotSec) });
      const spkMinEl = h('input', { class: 'input num-xs', type: 'number', min: '0', max: '999', step: '1', value: String(setupSpkMin) });
      const spkSecEl = h('input', { class: 'input num-xs', type: 'number', min: '0', max: '59', step: '1', value: String(setupSpkSec) });
      totMinEl.addEventListener('input', () => { setupTotMin = parseInt(totMinEl.value) || 0; });
      totSecEl.addEventListener('input', () => { setupTotSec = parseInt(totSecEl.value) || 0; });
      spkMinEl.addEventListener('input', () => { setupSpkMin = parseInt(spkMinEl.value) || 0; });
      spkSecEl.addEventListener('input', () => { setupSpkSec = parseInt(spkSecEl.value) || 0; });

      const perSpkRow = erow(lbl('PER SPEAKER'), spkMinEl, lbl('min'), spkSecEl, lbl('sec'));
      perSpkRow.hidden = (setupType === 'unmoderated');

      function updatePerSpkRow() { perSpkRow.hidden = (setupType === 'unmoderated'); }
      typeEl.addEventListener('change', updatePerSpkRow);

      const setupMsg = h('span', { class: 'admin-msg' });
      const setupBtn = h('button', { class: 'btn mag', type: 'button' }, 'SET UP CAUCUS');
      setupBtn.addEventListener('click', async () => {
        setupBtn.disabled = true;
        setupMsg.textContent = 'SETTING UP…';
        const { res: r, data: d } = await capi('caucus', {
          init: { method: 'POST', body: JSON.stringify({ type: setupType, topic: setupTopic, totalMin: setupTotMin, totalSec: setupTotSec, perSpeakerMin: setupSpkMin, perSpeakerSec: setupSpkSec }) },
          headers: { 'Content-Type': 'application/json' }
        });
        if (r.ok && d && d.ok) { setupMsg.className = 'admin-msg ok'; setupMsg.textContent = '✓ CAUCUS READY'; Sound.play('select'); Comm.caucus = d.caucus; renderTabBody(); }
        else { setupMsg.className = 'admin-msg bad'; setupMsg.textContent = d && d.code === 'missing_duration' ? 'SET A TOTAL TIME FIRST' : 'FAILED · TRY AGAIN'; Sound.play('error'); setupBtn.disabled = false; }
      });

      body.append(ecard(
        efull(lbl('TYPE'), typeEl),
        efull(lbl('TOPIC'), topicEl),
        erow(lbl('TOTAL DURATION'), totMinEl, lbl('min'), totSecEl, lbl('sec')),
        perSpkRow,
        erow(setupMsg, setupBtn)
      ));

      // ---- CONTROLS ----
      if (c && c.status !== 'idle') {
        body.append(esect('CONTROLS'));
        const now = Date.now() + offset;
        const activePausedMs = (c.status === 'paused' && c.pausedAt) ? now - Date.parse(c.pausedAt) : 0;
        const totalPausedMs  = (c.accPausedMs || 0) + activePausedMs;
        const elapsed        = c.startedAt ? now - Date.parse(c.startedAt) - totalPausedMs : 0;
        const remaining      = Math.max(0, (c.totalMs || 0) - elapsed);

        const stateBar = h('div', { class: 'comm-state-bar' },
          `STATUS: ${c.status.toUpperCase()} · REMAINING: ${fmtMs(remaining)} · TYPE: ${c.type.toUpperCase()}`
        );
        body.append(stateBar);

        const ctrlRow = h('div', { class: 'comm-ctrl-row' });
        async function ctrl(op) {
          const { res: r, data: d } = await capi('control', {
            init: { method: 'POST', body: JSON.stringify({ op }) },
            headers: { 'Content-Type': 'application/json' }
          });
          if (r.ok && d && d.ok) { Sound.play('select'); Comm.caucus = d.caucus; renderTabBody(); }
          else { toast('CONTROL FAILED'); Sound.play('error'); }
        }
        if (c.status === 'active') {
          ctrlRow.append(abtn('PAUSE', () => ctrl('pause')));
          if (c.type === 'moderated') ctrlRow.append(abtn('NEXT SPEAKER ▸', () => ctrl('next')));
          ctrlRow.append(abtn('STOP', () => ctrl('stop')));
        } else if (c.status === 'paused') {
          ctrlRow.append(abtn('RESUME', () => ctrl('resume')));
          ctrlRow.append(abtn('STOP', () => ctrl('stop')));
        } else if (c.status === 'ended') {
          ctrlRow.append(abtn('CLEAR & RESET', () => ctrl('clear')));
        }
        body.append(ctrlRow);
      } else if (c && c.totalMs > 0) {
        // Idle but configured
        body.append(esect('CONTROLS'));
        const ctrlRow = h('div', { class: 'comm-ctrl-row' });
        async function startCaucus() {
          const { res: r, data: d } = await capi('control', {
            init: { method: 'POST', body: JSON.stringify({ op: 'start' }) },
            headers: { 'Content-Type': 'application/json' }
          });
          if (r.ok && d && d.ok) { Sound.play('start'); Comm.caucus = d.caucus; renderTabBody(); }
          else { toast('START FAILED'); Sound.play('error'); }
        }
        ctrlRow.append(abtn('START CAUCUS ▸', startCaucus));
        body.append(ctrlRow);
      }

      // ---- SPEAKERS (moderated only) ----
      if (c && c.type === 'moderated') {
        body.append(esect('SPEAKERS QUEUE'));
        const spkList = h('div', { class: 'ed-list' });
        const speakers = (c.speakers || []);
        if (speakers.length) {
          speakers.forEach((s, i) => {
            const item = h('div', { class: 'comm-speaker-item' },
              h('span', { class: 'comm-speaker-name', text: `#${i + 1} ${s.name}` }),
              h('span', { class: 'speaker-badge ' + s.status, text: s.status.toUpperCase() }),
              dbtn(async () => {
                const { res: r, data: d } = await capi('speaker', {
                  init: { method: 'POST', body: JSON.stringify({ op: 'remove', index: i }) },
                  headers: { 'Content-Type': 'application/json' }
                });
                if (r.ok && d && d.ok) { Comm.caucus.speakers = d.speakers; renderTabBody(); }
              })
            );
            spkList.append(item);
          });
        } else {
          spkList.append(h('p', { class: 'muted', text: 'No speakers yet. Add delegations below.' }));
        }
        body.append(spkList);

        const spkInput = tf('', () => {}, 'Delegation name…');
        const addSpkBtn = h('button', { class: 'btn ed-add', type: 'button' }, '+ ADD TO QUEUE');
        addSpkBtn.addEventListener('click', async () => {
          const name = spkInput.value.trim();
          if (!name) return;
          addSpkBtn.disabled = true;
          const { res: r, data: d } = await capi('speaker', {
            init: { method: 'POST', body: JSON.stringify({ op: 'add', name }) },
            headers: { 'Content-Type': 'application/json' }
          });
          if (r.ok && d && d.ok) { spkInput.value = ''; Sound.play('select'); Comm.caucus.speakers = d.speakers; renderTabBody(); }
          else { toast('COULD NOT ADD SPEAKER'); Sound.play('error'); addSpkBtn.disabled = false; }
        });
        body.append(erow(spkInput, addSpkBtn));
      }

      // ---- DIRECTIVES ----
      body.append(esect('PUBLIC DIRECTIVES'));
      body.append(hint(`${dirs.length} directive${dirs.length === 1 ? '' : 's'} submitted. Delegates post from the COMMITTEE page.`));
      const dirRefreshBtn = abtn('REFRESH', loadCommittee);
      body.append(dirRefreshBtn);

      if (!dirs.length) {
        body.append(h('p', { class: 'muted', text: 'No directives yet.' }));
      } else {
        const sorted = dirs.slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
        sorted.forEach(d => {
          const card = h('div', { class: 'comm-dir-card' },
            h('div', { class: 'comm-dir-header' },
              h('span', { class: 'comm-dir-delegation', text: d.delegation }),
              dbtn(async () => {
                const { res: r, data: rd } = await capi('del-directive', {
                  init: { method: 'POST', body: JSON.stringify({ id: d.id }) },
                  headers: { 'Content-Type': 'application/json' }
                });
                if (r.ok && rd && rd.ok) { Sound.play('select'); Comm.directives = Comm.directives.filter(x => x.id !== d.id); renderTabBody(); }
                else { toast('COULD NOT DELETE DIRECTIVE'); }
              })
            ),
            h('div', { class: 'comm-dir-text', text: d.text })
          );
          body.append(card);
        });
      }
    }

    // ---- LOAD & PUBLISH ----
    function b64encode(obj) {
      const json = JSON.stringify(obj);
      const bytes = new TextEncoder().encode(json);
      let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
      return btoa(bin);
    }

    function isSampleContent(content) {
      return !!(content && typeof content.title === 'string' && /^SAMPLE/i.test(content.title));
    }

    async function loadContent() {
      const { res, data } = await api('content').catch(() => ({ res: { ok: false }, data: null }));
      if (res.status === 401) { logout('SESSION EXPIRED · LOG IN AGAIN'); return; }
      if (res.ok && data && data.content) {
        C = JSON.parse(JSON.stringify(data.content));
        contentReady = true;
        renderTabBody();
        // Show a clear banner if the loaded content is still placeholder data
        let sampleBanner = $('[data-a="sample-banner"]');
        if (!sampleBanner) { sampleBanner = h('div', { dataset: { a: 'sample-banner' } }); edRoot.insertBefore(sampleBanner, edRoot.firstChild); }
        sampleBanner.innerHTML = '';
        if (isSampleContent(C)) {
          sampleBanner.append(h('div', { class: 'notice-info' },
            h('strong', null, '📋 SAMPLE DATA LOADED'),
            ' — This is placeholder content. Use the tabs below to enter your committee\'s real title, characters, briefing, factions, timeline, and intel. Click ',
            h('strong', null, 'PUBLISH CHANGES'),
            ' when done.'
          ));
        }
        toast('CONTENT LOADED');
        Sound.play('select');
      } else if (res.status === 404) {
        contentReady = true;
        toast('NO CONTENT ON SERVER YET · START ADDING CONTENT');
      } else {
        toast('COULD NOT LOAD CONTENT · TRY LOAD FROM SERVER AGAIN');
      }
    }

    async function publishContent() {
      const statusEl = ed('[data-editor-status]');
      const btn = ed('[data-editor-publish]');
      // Publishing replaces everything, so an editor that never loaded must not overwrite the server.
      if (!contentReady) {
        statusEl.className = 'admin-msg bad';
        statusEl.textContent = 'CONTENT NOT LOADED · CLICK LOAD FROM SERVER FIRST';
        Sound.play('error'); return;
      }
      btn.disabled = true;
      statusEl.className = 'admin-msg';
      statusEl.textContent = 'ENCODING…';

      let b64;
      try { b64 = b64encode(C); } catch (e) {
        statusEl.className = 'admin-msg bad'; statusEl.textContent = 'ENCODE ERROR: ' + e.message;
        Sound.play('error'); btn.disabled = false; return;
      }

      const kb = (b64.length / 1024).toFixed(1);
      if (b64.length > LIMIT) {
        statusEl.className = 'admin-msg bad';
        statusEl.textContent = `TOO LARGE (${kb} KB, limit 64 KB) · REMOVE SOME ITEMS AND TRY AGAIN`;
        Sound.play('error'); btn.disabled = false; return;
      }

      statusEl.textContent = 'SENDING TO SERVER…';
      let res, data;
      try {
        const r = await api('publish', { init: { method: 'POST', body: JSON.stringify({ b64 }) }, headers: { 'Content-Type': 'application/json' } });
        res = r.res; data = r.data;
      } catch (e) {
        statusEl.className = 'admin-msg bad'; statusEl.textContent = 'NETWORK ERROR · CHECK CONNECTION';
        Sound.play('error'); btn.disabled = false; return;
      }

      if (res.status === 401) { logout('SESSION EXPIRED · LOG IN AGAIN'); return; }

      if (res.ok && data && data.ok) {
        if (data.deployed) {
          statusEl.className = 'admin-msg ok';
          statusEl.textContent = data.instant
            ? `✓ PUBLISHED (${kb} KB) · LIVE IMMEDIATELY`
            : `✓ PUBLISHED (${kb} KB) · REDEPLOYING · CHANGES LIVE IN ~30 SECONDS`;
          Sound.play('release');
        } else {
          showManualPublish(statusEl, b64, kb);
        }
      } else {
        statusEl.className = 'admin-msg bad'; statusEl.textContent = 'PUBLISH FAILED · TRY AGAIN';
        Sound.play('error');
      }
      btn.disabled = false;
    }

    function showManualPublish(statusEl, b64, kb) {
      statusEl.className = '';
      statusEl.innerHTML = '';
      const box = h('div', { class: 'manual-box' });
      const copyBtn = h('button', { class: 'btn', type: 'button' }, 'COPY ENCODED VALUE');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(b64);
        } catch {
          const ta2 = document.createElement('textarea');
          ta2.style.cssText = 'position:absolute;left:-9999px'; ta2.value = b64;
          document.body.append(ta2); ta2.select(); document.execCommand('copy'); ta2.remove();
        }
        copyBtn.textContent = '✓ COPIED'; Sound.play('select');
        toast('COPIED · PASTE INTO VERCEL AS CRISIS_CONTENT_B64');
      });
      box.append(
        h('p', { class: 'manual-title', text: `Content encoded (${kb} KB). KV storage is not connected — choose one option:` }),
        h('p', { class: 'manual-option-head', text: 'OPTION A — Instant publish (recommended): Connect Vercel KV' }),
        h('ol', { class: 'manual-steps' },
          h('li', null, 'Go to Vercel Dashboard → your project → Storage tab'),
          h('li', null, 'Click ', h('strong', null, 'Create KV Store'), ' and connect it to your project'),
          h('li', null, 'Redeploy once — after that, PUBLISH CHANGES is instant every time')
        ),
        h('p', { class: 'manual-option-head', text: 'OPTION B — Manual (one-off): Paste into Vercel env vars' }),
        h('ol', { class: 'manual-steps' },
          h('li', null, 'Click ', h('strong', null, 'COPY ENCODED VALUE'), ' below'),
          h('li', null, 'Go to Vercel Dashboard → Project → Settings → Environment Variables'),
          h('li', null, 'Find ', h('code', null, 'CRISIS_CONTENT_B64'), ' and paste the copied value, then Save'),
          h('li', null, 'Go to Deployments → click Redeploy on the latest deployment'),
          h('li', null, 'Changes are live once the deployment finishes (~30 sec)')
        ),
        copyBtn
      );
      statusEl.append(box);
    }

    // ---- wire up editor ----
    renderTabs();
    renderTabBody();
    ed('[data-editor-load]').addEventListener('click', loadContent);
    ed('[data-editor-publish]').addEventListener('click', publishContent);

    if (token()) { show(true); refresh(); loadContent(); } else show(false);
  }

  F.pages = F.pages || {};
  F.pages.admin = initAdmin;
})(window.FORMA = window.FORMA || {});
