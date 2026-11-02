/* FORMA MUN · Crisis Division — Admin: scenario content editor + save / preview / publish
   This content is locked by the server until release. Everything a page reads has a control here;
   fields without a control are left untouched. */
(function (F) {
  'use strict';
  const { $, h, arr, toast, Sound } = F;
  const A = F.Admin;
  const { fieldAttrs, lbl, erow, efull, ecard, hint, esect, dbtn, abtn, tf, ta, dd, cpick, checkbox, paras, setOrClear, fold } = A.ui;

  const LIMIT = 128 * 1024; // base64 size the server accepts
  const TABS = [['general', 'GENERAL'], ['characters', 'CHARACTERS'], ['factions', 'FACTIONS'], ['timeline', 'TIMELINE'], ['locations', 'LOCATIONS'], ['intel', 'INTEL'], ['resources', 'RESOURCES']];
  let activeTab = 'general';
  let charFilter = '';

  const root = () => $('[data-admin-editor]');
  const bodyEl = () => $('[data-editor-body]');
  const C = () => A.content;
  const splitParas = (v) => v.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

  // ---- tabs ----
  function renderTabs() {
    const bar = $('[data-editor-tabs]');
    bar.innerHTML = '';
    TABS.forEach(([id, label]) => {
      bar.append(h('button', { class: 'chip-btn ed-tab' + (id === activeTab ? ' active' : ''), type: 'button', dataset: { tab: id }, onclick: () => { activeTab = id; renderTabs(); renderBody(); } }, label));
    });
  }
  function renderBody() {
    const body = bodyEl();
    body.innerHTML = '';
    ({ general: renderGeneral, characters: renderCharacters, factions: renderFactions, timeline: renderTimeline, locations: renderLocations, intel: renderIntel, resources: renderResources }[activeTab])(body);
  }
  /** A list with one card per item, and an add button. */
  function listTab(body, note, key, card, addLabel, blank) {
    const c = C();
    c[key] = c[key] || [];
    body.append(hint(note));
    body.append(h('div', { class: 'ed-list' }, c[key].map((item, i) => card(item, i))));
    body.append(abtn(addLabel, () => { c[key].push(blank()); renderBody(); }));
  }
  const remove = (key, i) => dbtn(() => { C()[key].splice(i, 1); renderBody(); });

  // ---- general ----
  function renderGeneral(body) {
    const c = C();
    body.append(esect('COMMITTEE INFO'),
      efull(lbl('TITLE'), tf(c.title, (v) => { c.title = v; }, 'Shown in the reveal and on the briefing')),
      efull(lbl('SUBTITLE'), tf(c.subtitle, (v) => { c.subtitle = v; }, 'Short line under the title')),
      efull(lbl('PREMISE NOTE'), ta(c.premiseNote, (v) => { c.premiseNote = v; }, 'Note on the fictional premise')));
    const B = c.briefing = c.briefing || {};
    const paraField = (key, placeholder) => ta(arr(B[key]).join('\n\n'), (v) => { B[key] = splitParas(v); }, placeholder, 'ta-lg');
    body.append(esect('BRIEFING DOCUMENT'),
      efull(lbl('COMMITTEE FORMAT'), tf(B.committeeFormat, (v) => { B.committeeFormat = v; }, 'e.g. Ad-hoc crisis committee')),
      efull(lbl('OVERVIEW (BLANK LINE = NEW PARAGRAPH)'), paraField('overview', 'Overview paragraphs…')),
      efull(lbl('CONTEXT'), paraField('context', 'Context paragraphs…')),
      efull(lbl('DEBATE SCOPE (ONE ITEM PER LINE)'), ta(arr(B.debateScope).join('\n'), (v) => { B.debateScope = v.split('\n').map((s) => s.trim()).filter(Boolean); }, 'One scope item per line')),
      efull(lbl('BACKGROUND'), paraField('background', 'Background notes…')));
    const M = c.map = c.map || {};
    body.append(esect('MAP'),
      erow(lbl('MAP LABEL'), tf(M.label, (v) => { M.label = v; }, 'Name of the map'), lbl('NOTE'), tf(M.note, (v) => { M.note = v; }, 'Small note under the map')),
      /^data:/.test(M.image || '')
        ? efull(lbl('MAP IMAGE'), h('div', { class: 'map-thumb' }, h('img', { src: M.image, alt: 'Current map' }),
          h('button', { class: 'btn', type: 'button', onclick: () => { delete M.image; A.markDirty(); renderBody(); } }, 'REMOVE MAP IMAGE')))
        : efull(lbl('MAP IMAGE (OPTIONAL)'), tf(M.image, setOrClear(M, 'image'), 'Image URL or path')));
    const CS = c.cutscene = c.cutscene || {};
    body.append(esect('REVEAL CUTSCENE'), hint('Plays for everyone the moment the timer reaches zero. Use PLAY REVEAL in the preview to watch it.'),
      erow(lbl('KICKER'), tf(CS.kicker, (v) => { CS.kicker = v; }, 'INCOMING TRANSMISSION'), lbl('DATE TEXT'), tf(CS.date, (v) => { CS.date = v; }, 'e.g. 07 JAN 2027')),
      efull(lbl('TAGLINE'), tf(CS.tagline, (v) => { CS.tagline = v; }, 'One dramatic reveal line')),
      efull(lbl('DISCLAIMER'), tf(CS.disclaimer, (v) => { CS.disclaimer = v; }, 'e.g. All events depicted are fictional')));
  }

  // ---- characters ----
  const opts = (list) => list.map((v) => [v, v.replace(/_/g, ' ').toUpperCase()]);
  const HAIR = opts(['close', 'crew', 'side_part', 'slick', 'receding', 'bald', 'mop', 'wavy', 'tall', 'curly']);
  const OUTFITS = opts(['suit', 'hoodie', 'tshirt']);
  const FACIAL = [['', 'NONE'], ...opts(['mustache', 'thin_mustache', 'goatee', 'mustache_goatee', 'stubble'])];
  const GLASSES = [['', 'NONE'], ...opts(['thick', 'wire'])];
  const HATS = [['', 'NONE'], ...opts(['fedora', 'helmet', 'party'])];
  const BUILDS = [['', 'NORMAL'], ...opts(['heavy', 'slim'])];
  const SPECIALS = [['', 'STANDARD MOVES ONLY'], ...opts(['projectile', 'stream', 'wave', 'dash', 'uppercut', 'counter', 'flash'])];
  const EXTRAS = ['cigar', 'camera', 'badge', 'armband'];

  function charForm(ch, i, titleEl) {
    const L = ch.look = ch.look || {};
    const Hr = L.hair = L.hair || {};
    const O = L.outfit = L.outfit || {};
    const form = ecard(
      erow(lbl('FULL NAME'), tf(ch.name, (v) => { ch.name = v; titleEl.textContent = v || 'UNNAMED'; }, 'Character name'), lbl('SHORT ID'), tf(ch.id, (v) => { ch.id = v; }, 'unique-id'), remove('characters', i)),
      erow(lbl('ROLE'), tf(ch.role, (v) => { ch.role = v; }, 'Title or position'), lbl('AFFILIATION'), tf(ch.affiliation, (v) => { ch.affiliation = v; }, 'Group or country')),
      erow(lbl('FACTION'), tf(ch.faction, (v) => { ch.faction = v; }, 'Faction name'), lbl('PORTRAIT'), tf(ch.portrait, setOrClear(ch, 'portrait'), 'Optional image URL or path')),
      efull(lbl('BIO'), paras(ch, 'bio', 'Character biography…', 'ta-lg')),
      esect('SPECIAL MOVE'));
    const S = () => (ch.special && typeof ch.special === 'object' ? ch.special : (ch.special = {}));
    form.append(
      erow(lbl('TYPE'), dd(SPECIALS, ch.special ? ch.special.type : '', (v) => { if (v) S().type = v; else ch.special = null; }),
        lbl('NAME'), tf(ch.special && ch.special.name, (v) => { S().name = v; }, 'Move name'),
        lbl('COLOUR'), cpick((ch.special && ch.special.color) || '#ffd166', (v) => { S().color = v; })),
      esect('PIXEL FIGHTER'),
      erow(lbl('SKIN'), cpick(L.skin || '#c68a5c', (v) => { L.skin = v; }),
        lbl('HAIR'), dd(HAIR, Hr.style || 'slick', (v) => { Hr.style = v; }),
        lbl('HAIR COLOUR'), cpick(Hr.color || '#1c1530', (v) => { Hr.color = v; }),
        lbl('BUILD'), dd(BUILDS, L.build || '', setOrClear(L, 'build'))),
      erow(lbl('FACIAL HAIR'), dd(FACIAL, L.facial || '', setOrClear(L, 'facial')),
        lbl('GLASSES'), dd(GLASSES, L.glasses || '', setOrClear(L, 'glasses')),
        lbl('HAT'), dd(HATS, L.hat || '', setOrClear(L, 'hat')),
        lbl('HAT COLOUR'), cpick(L.hatColor || '#4a4036', (v) => { L.hatColor = v; })),
      erow(lbl('OUTFIT'), dd(OUTFITS, O.type || 'suit', (v) => { O.type = v; }),
        lbl('JACKET'), cpick(O.jacket || '#2a2c33', (v) => { O.jacket = v; }),
        lbl('TIE'), cpick(O.tie || '#1a1b22', (v) => { O.tie = v; })),
      h('div', { class: 'members-grid' },
        checkbox('THICK BROWS', L.brows === 'thick', (v) => { if (v) L.brows = 'thick'; else delete L.brows; }),
        checkbox('BIG EARS', L.ears === 'big', (v) => { if (v) L.ears = 'big'; else delete L.ears; }),
        checkbox('JOWLS', L.jowls, (v) => { if (v) L.jowls = true; else delete L.jowls; }),
        checkbox('HAT CARD', L.hatCard, (v) => { if (v) L.hatCard = true; else delete L.hatCard; }),
        EXTRAS.map((x) => checkbox(x.toUpperCase(), arr(L.extras).includes(x), (v) => {
          const list = arr(L.extras).filter((e) => e !== x);
          if (v) list.push(x);
          if (list.length) L.extras = list; else delete L.extras;
        }))));
    return form;
  }
  function renderCharacters(body) {
    const c = C();
    c.characters = c.characters || [];
    const search = h('input', { id: 'char-search', name: 'char-search', autocomplete: 'off', class: 'input', type: 'search', placeholder: 'Search characters by name, role or faction…', 'aria-label': 'Search characters', dataset: { charSearch: '' } });
    search.value = charFilter;
    const list = h('div', { class: 'ed-list' });
    const paint = () => {
      list.innerHTML = '';
      const q = charFilter.trim().toLowerCase();
      c.characters.forEach((ch, i) => {
        if (q && ![ch.name, ch.role, ch.faction, ch.affiliation].join(' ').toLowerCase().includes(q)) return;
        list.append(fold(ch.name || 'UNNAMED', [ch.role, ch.faction].filter(Boolean).join(' · '), (titleEl) => charForm(ch, i, titleEl)));
      });
      if (!list.childNodes.length) list.append(hint('No characters match.'));
    };
    search.addEventListener('input', () => { charFilter = search.value; paint(); });
    body.append(hint(`${c.characters.length} characters. Open one to edit it. The Short ID must be unique, with no spaces.`), search, list);
    paint();
    body.append(abtn('ADD CHARACTER', () => {
      c.characters.push({ id: 'char' + Date.now(), name: '', role: '', affiliation: '', faction: '', bio: '', look: { skin: '#c68a5c', hair: { style: 'slick', color: '#1c1530' }, outfit: { type: 'suit', jacket: '#2a2c33', tie: '#1a1b22' } } });
      charFilter = '';
      renderBody();
    }));
  }

  // ---- factions ----
  function factionCard(f, i) {
    const chars = C().characters || [];
    const members = h('div', { class: 'members-grid' });
    if (!chars.length) members.append(h('span', { class: 'muted', text: 'Add characters first, then assign them here.' }));
    chars.forEach((ch) => members.append(checkbox(ch.name || ch.id, arr(f.members).includes(ch.id), (on) => {
      const list = arr(f.members).filter((m) => m !== ch.id);
      if (on) list.push(ch.id);
      f.members = list;
    })));
    return ecard(
      erow(lbl('FACTION NAME'), tf(f.name, (v) => { f.name = v; }, 'Faction name'), remove('factions', i)),
      efull(lbl('DESCRIPTION'), paras(f, 'description', 'Faction description…')),
      efull(lbl('MEMBERS'), members));
  }
  const renderFactions = (body) => listTab(body, 'Groups or alliances in the scenario. Tick the members of each one.', 'factions', factionCard, 'ADD FACTION',
    () => ({ id: 'f' + Date.now(), name: '', description: '', members: [], relations: [] }));

  // ---- timeline ----
  const timelineCard = (t, i) => ecard(
    erow(lbl('DATE'), tf(t.date, (v) => { t.date = v; }, 'Date label'), lbl('TYPE'), dd([['background', 'HISTORICAL BACKGROUND'], ['crisis', 'CRISIS EVENT']], t.kind || 'background', (v) => { t.kind = v; }), remove('timeline', i)),
    efull(lbl('TITLE'), tf(t.title, (v) => { t.title = v; }, 'Event title')),
    efull(lbl('DETAIL'), paras(t, 'detail', 'Event description…')));
  const renderTimeline = (body) => listTab(body, '"Historical Background" is real history. "Crisis Event" is the fictional divergence.', 'timeline', timelineCard, 'ADD EVENT',
    () => ({ date: '', title: '', kind: 'background', detail: '' }));

  // ---- locations ----
  function coord(l, key) {
    const el = h('input', Object.assign(fieldAttrs(), { class: 'input num-sm', type: 'number', min: '0', max: '100', step: '1', placeholder: '0–100' }));
    el.value = l[key] != null ? String(l[key]) : '50';
    el.addEventListener('input', () => { l[key] = Number(el.value); });
    return el;
  }
  const locationCard = (l, i) => ecard(
    erow(lbl('NAME'), tf(l.name, (v) => { l.name = v; }, 'Location name'), lbl('TYPE'), tf(l.type, (v) => { l.type = v; }, 'e.g. SITE'), remove('locations', i)),
    erow(lbl('MAP X %'), coord(l, 'x'), lbl('MAP Y %'), coord(l, 'y')),
    efull(lbl('DESCRIPTION'), paras(l, 'description', 'Location description…')));
  const renderLocations = (body) => listTab(body, 'Points on the map. X and Y are percentages (0–100) of the map size.', 'locations', locationCard, 'ADD LOCATION',
    () => ({ id: 'loc' + Date.now(), name: '', type: 'SITE', x: 50, y: 50, description: '' }));

  // ---- intel ----
  const LEVELS = [['CLASSIFIED', 'CLASSIFIED'], ['CONFIDENTIAL', 'CONFIDENTIAL'], ['DECLASSIFIED', 'DECLASSIFIED']];
  const intelCard = (it, i) => ecard(
    erow(lbl('CODENAME'), tf(it.codename, (v) => { it.codename = v; }, 'e.g. OMEGA-01'), lbl('LEVEL'), dd(LEVELS, it.classification || 'CLASSIFIED', (v) => { it.classification = v; }), remove('intel', i)),
    efull(lbl('TITLE'), tf(it.title, (v) => { it.title = v; }, 'Document title')),
    efull(lbl('CONTENT'), paras(it, 'body', 'Dossier content…', 'ta-lg')));
  const renderIntel = (body) => listTab(body, 'Dossiers and documents shown to delegates after release.', 'intel', intelCard, 'ADD DOSSIER',
    () => ({ codename: '', classification: 'CLASSIFIED', title: '', body: '' }));

  // ---- resources ----
  const resourceCard = (r, i) => ecard(
    erow(lbl('TITLE'), tf(r.title, (v) => { r.title = v; }, 'Document title'), lbl('TYPE'), tf(r.type, (v) => { r.type = v; }, 'e.g. PDF'), remove('resources', i)),
    efull(lbl('LINK'), tf(r.url, (v) => { r.url = v; }, 'https://…')),
    efull(lbl('NOTE'), tf(r.note, (v) => { r.note = v; }, 'Optional short note')));
  const renderResources = (body) => listTab(body, 'Links shown on the Rules page after release. A resource needs a title and a link to appear.', 'resources', resourceCard, 'ADD RESOURCE',
    () => ({ title: '', type: 'PDF', url: '', note: '' }));

  // ---- working state ----
  function setSaveState(text, cls) {
    const el = $('[data-editor-status]');
    el.textContent = text;
    el.className = 'admin-msg ' + (cls || '');
  }
  function markDirty() {
    if (A.dirty) return;
    A.dirty = true;
    setSaveState('UNSAVED CHANGES', 'warn');
  }
  function b64encode(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function encoded() {
    const b64 = b64encode(A.content);
    if (b64.length > LIMIT) { setSaveState(`TOO LARGE (${(b64.length / 1024).toFixed(0)} KB, LIMIT ${LIMIT / 1024} KB) · REMOVE SOME TEXT`, 'bad'); Sound.play('error'); return null; }
    return b64;
  }
  const expired = (res) => { if (res.status === 401) { A.logout('SESSION EXPIRED · LOG IN AGAIN'); return true; } return false; };
  const noStorage = (res) => res.status === 503;

  function renderDraftBanner(fromDraft, savedAt) {
    const box = $('[data-a="draft-banner"]');
    box.innerHTML = '';
    if (!fromDraft) return;
    box.append(h('div', { class: 'notice-info' }, h('strong', null, 'DRAFT LOADED'),
      ` — saved ${A.dateFmt.format(Date.parse(savedAt))}. Visitors don't see it until you publish. `,
      h('button', { class: 'chip-btn', type: 'button', dataset: { discardDraft: '' }, onclick: discard }, 'DISCARD DRAFT')));
  }

  async function loadContent() {
    const { res, data } = await A.get('content', { query: '&raw=1&draft=1' }).catch(() => ({ res: { ok: false }, data: null }));
    if (expired(res)) return;
    if (res.ok && data && data.content) {
      A.content = JSON.parse(JSON.stringify(data.content));
      A.site = Object.assign({}, data.site);
      A.contentReady = true;
      A.dirty = false;
      setSaveState(data.fromDraft ? 'DRAFT' : 'SAME AS PUBLISHED', data.fromDraft ? 'warn' : 'ok');
      renderDraftBanner(data.fromDraft, data.savedAt);
      renderBody();
      if (A.renderSite) A.renderSite();
      if (A.onContent) A.onContent();
    } else if (res.status === 404) {
      A.contentReady = true;
      setSaveState('NO CONTENT ON THE SERVER YET');
      renderBody();
    } else {
      toast('COULD NOT LOAD CONTENT · TRY AGAIN');
    }
  }

  async function saveDraft() {
    if (!A.contentReady) { setSaveState('CONTENT NOT LOADED YET', 'bad'); return false; }
    const b64 = encoded();
    if (!b64) return false;
    setSaveState('SAVING…');
    const { res, data } = await A.post('save-draft', { b64, site: A.site }).catch(() => ({ res: { ok: false }, data: null }));
    if (expired(res)) return false;
    if (res.ok && data && data.ok) {
      A.dirty = false;
      setSaveState('DRAFT SAVED · ' + A.dateFmt.format(Date.parse(data.savedAt)), 'ok');
      renderDraftBanner(true, data.savedAt);
      A.refresh();
      return true;
    }
    setSaveState(noStorage(res) ? 'STORAGE NOT CONNECTED' : 'SAVE FAILED · TRY AGAIN', 'bad');
    Sound.play('error');
    return false;
  }

  async function publish(confirmPublic) {
    if (!A.contentReady) { setSaveState('CONTENT NOT LOADED YET · PRESS RELOAD', 'bad'); Sound.play('error'); return; }
    if (A.status && A.status.released && !confirmPublic && !confirm('The site is released. Publishing changes what delegates see now. Continue?')) return;
    const b64 = encoded();
    if (!b64) return;
    const btn = $('[data-editor-publish]');
    btn.disabled = true;
    setSaveState('PUBLISHING…');
    const { res, data } = await A.post('publish', { b64, site: A.site, confirmPublic: !!confirmPublic }).catch(() => ({ res: { ok: false }, data: null }));
    btn.disabled = false;
    if (expired(res)) return;
    if (res.status === 409 && data && data.code === 'public_leak') {
      setSaveState('NOT PUBLISHED', 'bad');
      if (confirm(`Public page text mentions scenario names: ${data.leaks.join(', ')}.\n\nThat text is visible to everyone before release. Publish anyway?`)) publish(true);
      return;
    }
    if (res.ok && data && data.ok) {
      A.dirty = false;
      Sound.play('release');
      setSaveState(A.status && A.status.released ? '✓ PUBLISHED · LIVE NOW' : '✓ PUBLISHED · PUBLIC TEXT LIVE, SCENARIO AT RELEASE', 'ok');
      renderDraftBanner(false);
      A.refresh();
      return;
    }
    setSaveState(noStorage(res) ? 'STORAGE NOT CONNECTED' : 'PUBLISH FAILED · TRY AGAIN', 'bad');
    Sound.play('error');
  }

  async function discard() {
    if (!confirm('Throw away the saved draft and all unsaved changes, and go back to the published version?')) return;
    await A.post('discard-draft');
    A.dirty = false;
    toast('DRAFT DISCARDED');
    A.refresh();
    loadContent();
  }

  function reload() {
    if (A.dirty && !confirm('Discard your unsaved changes and reload?')) return;
    A.dirty = false;
    loadContent();
  }

  function init() {
    renderTabs();
    renderBody();
    $('[data-editor-load]').addEventListener('click', reload);
    $('[data-editor-publish]').addEventListener('click', () => publish(false));
    $('[data-editor-save]').addEventListener('click', saveDraft);
    const watch = (el) => {
      ['input', 'change'].forEach((type) => el.addEventListener(type, (e) => { if (!e.target.matches('[data-char-search], [data-site-search]')) markDirty(); }));
      el.addEventListener('click', (e) => { if (e.target.closest('.ed-add, .ed-del')) markDirty(); });
    };
    watch(root());
    watch($('[data-site-body]'));
    window.addEventListener('beforeunload', (e) => { if (A.dirty) e.preventDefault(); });
    A.onLogout.push(() => { A.dirty = false; A.contentReady = false; });
  }

  A.onPanel.content = renderBody;
  Object.assign(A, { loadContent, editorInit: init, markDirty, renderEditor: renderBody });
})(window.FORMA = window.FORMA || {});
