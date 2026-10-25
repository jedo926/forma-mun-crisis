/* FORMA MUN · Crisis Division — Home page: intro, character select, PLAY
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { CONFIG, NAV, DEMO, PREVIEW, $, $$, pad, clamp, h, store, session, isTyping, on, Settings, Sound, Music, UI, Sprite, DEFAULT_CHARS, homeRoster, Modal, Arena } = F;

  function initHome() {
    // ---- Intro / boot sequence (once per session; skippable) ----
    const intro = $('#intro');
    if (intro) {
      const leave = () => {
        if (intro.hidden) return;
        session.set('introSeen', true); Sound.play('start');
        if (Settings.lowMotion) { intro.hidden = true; afterIntro(); return; }
        intro.classList.add('leaving'); setTimeout(() => { intro.hidden = true; if (typeof scene !== 'undefined' && scene) scene.stop(); afterIntro(); }, 450);
      };
      // Power-on screen: the tap is the user gesture browsers need before audio can play.
      const cam = $('[data-scene-cam]', intro); const sceneCanvas = $('[data-scene-canvas]', intro);
      const scene = sceneCanvas && F.IntroScene ? F.IntroScene(sceneCanvas) : null;
      // POWER ON: the tap that allows music, then the camera zooms into the TV screen.
      const power = (withSound) => {
        if (intro.classList.contains('zooming') || intro.classList.contains('booting')) return;
        if (withSound) { Settings.sound = true; store.set('sound', true); Sound.unlock(); Settings.apply(); Sound.play('zoom'); Music.fadeIn(); }
        const boot = () => {
          intro.classList.remove('flash'); intro.classList.add('booting'); if (scene) scene.stop();
          if (withSound) { Sound.play('boot'); [800, 1100, 1400].forEach((ms) => setTimeout(() => { for (let i = 0; i < 6; i++) setTimeout(() => Sound.play('type'), i * 40); }, ms)); }
          const enter = $('[data-intro-enter].start', intro); setTimeout(() => enter && enter.focus({ preventScroll: true }), 50);
        };
        if (Settings.lowMotion || !scene || !cam) { boot(); return; }
        const o = scene.screenOrigin();
        cam.style.transformOrigin = o.x + 'px ' + o.y + 'px';
        intro.classList.add('zooming');
        const r = cam.getBoundingClientRect();
        requestAnimationFrame(() => { cam.style.transform = 'translate(' + Math.round(r.width / 2 - o.x) + 'px, ' + Math.round(r.height / 2 - o.y) + 'px) scale(' + o.zoom.toFixed(2) + ')'; });
        setTimeout(() => intro.classList.add('flash'), 1350);
        setTimeout(boot, 1650);
      };
      if (scene && !(session.get('introSeen', false) || DEMO || PREVIEW)) scene.start();
      if (session.get('introSeen', false) || DEMO || PREVIEW) { intro.hidden = true; }
      else {
        intro.hidden = false;
        $$('[data-power]', intro).forEach((b) => b.addEventListener('click', () => power(b.dataset.power === 'sound')));
        $$('[data-intro-enter]', intro).forEach((b) => b.addEventListener('click', () => { if (!intro.classList.contains('booting') && b.classList.contains('skip')) { leave(); return; } leave(); }));
        intro.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); leave(); return; }
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!intro.classList.contains('booting') && !intro.classList.contains('zooming') && document.activeElement && document.activeElement.dataset.power) { power(document.activeElement.dataset.power === 'sound'); } else leave(); }
        });
        const btn = $('[data-power="sound"]', intro) || $('[data-intro-enter]', intro); if (btn) btn.focus();
      }
    }
    function afterIntro() { const t = $('.tile[aria-selected="true"]') || $('.tile'); if (t) t.focus({ preventScroll: true }); }

    // ---- Arena ----
    const canvas = $('#stage');
    const arenaEl = $('.arena');
    const hud = { arena: arenaEl, n1: $('[data-p1-name]'), n2: $('[data-p2-name]'), h1: $('[data-p1-hp]'), h2: $('[data-p2-hp]'), s1: $('[data-p1-sp]'), s2: $('[data-p2-sp]'), banner: $('[data-banner]'), round: $('[data-round]'), count: $('[data-count]'), end: $('[data-end]'), endTitle: $('[data-end-title]'), endSub: $('[data-end-sub]') };
    const arena = canvas ? Arena(canvas, hud) : null;

    // ---- Character select ----
    const grid = $('#roster');
    const card = { name: $('[data-sel-name]'), role: $('[data-sel-role]'), aff: $('[data-sel-aff]'), tag: $('[data-sel-tag]'), link: $('[data-sel-link]') };
    let roster = [], p1 = 0, p2 = 1;
    function fill(i) {
      const m = roster[i]; if (!m) return;
      card.name.textContent = m.locked ? 'UNKNOWN ENTITY' : m.name;
      card.role.textContent = m.locked ? 'CLASSIFIED' : (m.role || '—');
      card.aff.textContent = m.locked ? 'CLASSIFIED' : (m.affiliation || '—');
      card.tag.textContent = m.locked ? 'SLOT ' + pad(i + 1) + ' · SIGNAL RESTRICTED' : (m.isDefault ? 'DEFAULT FIGHTER · ALWAYS UNLOCKED' : 'PLAYER 1 · SELECTED');
      if (card.link) card.link.setAttribute('href', m.isDefault ? 'chairs.html' + (DEMO ? '?demo=1' : '') : 'characters.html' + (DEMO ? '?demo=1' : '') + (m.locked ? '' : '#' + m.id));
      if (card.link) card.link.textContent = m.isDefault ? 'MEET THE CHAIRS' : 'VIEW DOSSIER';
    }
    function pickCpu() {
      if (roster.length < 2) return 0;
      let j; do { j = Math.floor(Math.random() * roster.length); } while (j === p1);
      return j;
    }
    function startFight() {
      if (!arena) return;
      const a = roster[p1] || DEFAULT_CHARS[0]; const b = roster[p2] || DEFAULT_CHARS[1];
      // Default fighters and anonymous silhouettes fight. Released characters square off
      // (no hits / K.O.) unless CONFIG.fightAfterRelease is true.
      const released = (m) => !m.locked && !m.isDefault;
      arena.setMode(!CONFIG.fightAfterRelease && (released(a) || released(b)) ? 'debate' : 'fight');
      if (arena.human) return;
      arena.setFighters(a, b); arena.play();
    }
    function select(i, rollCpu = true) {
      p1 = i; $$('.tile', grid).forEach((t, k) => t.setAttribute('aria-selected', String(k === i)));
      fill(i); Sound.play('select');
      if (!rollCpu) { startFight(); return; }
      // CPU roulette
      const target = pickCpu(); let steps = Settings.lowMotion ? 0 : 7; const tiles = $$('.tile', grid);
      const spin = () => {
        tiles.forEach((t) => t.classList.remove('p2'));
        if (steps <= 0) { p2 = target; tiles[p2] && tiles[p2].classList.add('p2'); startFight(); return; }
        const r = pickCpu(); tiles[r] && tiles[r].classList.add('p2'); Sound.play('move'); steps -= 1; setTimeout(spin, 70);
      };
      spin();
    }
    let wasReleased = false;
    function build() {
      roster = homeRoster();
      const rel = roster.length > DEFAULT_CHARS.length && !roster[DEFAULT_CHARS.length].locked;
      if (rel && !wasReleased) { p1 = DEFAULT_CHARS.length; }
      wasReleased = rel;
      grid.innerHTML = '';
      roster.forEach((m, i) => {
        const art = Sprite.toCanvas(m, { frame: 'idle', scale: 3, rows: 31 });
        const tile = h('button', { class: 'tile' + (m.locked ? ' locked' : '') + (m.isDefault ? ' default' : ''), type: 'button', role: 'option', 'aria-selected': 'false', 'aria-label': m.locked ? 'Unknown entity ' + pad(i + 1) : m.name, dataset: { index: i } },
          art, h('span', { class: 'tname', text: m.locked ? '??????' : m.name }));
        tile.addEventListener('click', () => select(i));
        tile.addEventListener('mouseenter', () => { fill(i); Sound.play('hover'); });
        tile.addEventListener('focus', () => fill(i));
        grid.append(tile);
      });
      p1 = clamp(p1, 0, roster.length - 1); p2 = roster.length > 1 ? (rel ? (p1 + 1 < roster.length ? p1 + 1 : 0) : (p1 === 0 ? 1 : 0)) : 0;
      $$('.tile', grid).forEach((t, k) => { t.setAttribute('aria-selected', String(k === p1)); t.classList.toggle('p2', k === p2); });
      fill(p1); startFight();
    }
    // Arrow-key navigation across the grid.
    grid.addEventListener('keydown', (e) => {
      const tiles = $$('.tile', grid); const i = tiles.indexOf(document.activeElement); if (i < 0) return;
      const cols = Math.max(1, tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length);
      const map = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
      if (!(e.key in map)) return;
      e.preventDefault(); const n = clamp(i + map[e.key], 0, tiles.length - 1); tiles[n].focus(); Sound.play('move');
    });
    // ---- PLAY: full screen, 3-2-1-FIGHT, player vs CPU ----
    const playBtn = $('[data-play]');
    const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up', w: 'up', W: 'up', ' ': 'up', ArrowDown: 'down', s: 'down', S: 'down', j: 'punch', J: 'punch', z: 'punch', Z: 'punch', k: 'kick', K: 'kick', x: 'kick', X: 'kick', l: 'special', L: 'special', c: 'special', C: 'special' };
    const playing = () => arenaEl && arenaEl.classList.contains('playing');
    function enterPlay() {
      if (!arena || playing()) return;
      Sound.unlock(); if (document.activeElement) document.activeElement.blur();
      arenaEl.classList.add('playing', 'fsmode'); document.body.classList.add('no-scroll');
      const req = arenaEl.requestFullscreen || arenaEl.webkitRequestFullscreen;
      const fallback = () => arenaEl.classList.add('fs');
      if (req) { try { const p = req.call(arenaEl); if (p && p.catch) p.catch(fallback); } catch (e) { fallback(); } } else fallback();
      arena.startMatch(roster[p1], roster[p2]);
    }
    function exitPlay() {
      if (!playing()) return;
      arenaEl.classList.remove('playing', 'fs', 'fsmode'); document.body.classList.remove('no-scroll');
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      if ((document.fullscreenElement || document.webkitFullscreenElement) && ex) { try { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
      arena.endMatch(); if (playBtn) playBtn.focus({ preventScroll: true });
    }
    if (playBtn) playBtn.addEventListener('click', enterPlay);
    $$('[data-exit]').forEach((b) => b.addEventListener('click', exitPlay));
    $$('[data-again]').forEach((b) => b.addEventListener('click', () => { Sound.play('start'); arena.startMatch(); }));
    const onFsChange = () => { if (!(document.fullscreenElement || document.webkitFullscreenElement) && playing() && !arenaEl.classList.contains('fs')) exitPlay(); };
    document.addEventListener('fullscreenchange', onFsChange); document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('keydown', (e) => {
      if (!playing()) { if ((e.key === 'p' || e.key === 'P') && !isTyping(e.target) && !Modal.node && !e.metaKey && !e.ctrlKey) enterPlay(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exitPlay(); return; }
      const k = KEYMAP[e.key]; if (!k) return;
      e.preventDefault(); e.stopPropagation(); arena.key(k, true);
    }, true);
    document.addEventListener('keyup', (e) => { if (!playing()) return; const k = KEYMAP[e.key]; if (k) { e.preventDefault(); arena.key(k, false); } }, true);
    $$('[data-touch] [data-k]').forEach((b) => {
      const k = b.dataset.k;
      const down = (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* older Safari */ } b.classList.add('on'); arena.key(k, true); };
      const up = (e) => { e.preventDefault(); b.classList.remove('on'); arena.key(k, false); };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    // Stop iPad/iPhone scroll, pinch-zoom and double-tap zoom while a match is running.
    const guard = (e) => { if (playing()) e.preventDefault(); };
    arenaEl.addEventListener('touchmove', guard, { passive: false });
    arenaEl.addEventListener('touchstart', (e) => { if (playing() && e.touches.length > 1) e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange'].forEach((ev) => document.addEventListener(ev, guard, { passive: false }));
    let lastTap = 0; arenaEl.addEventListener('touchend', (e) => { const n = Date.now(); if (playing() && n - lastTap < 350) e.preventDefault(); lastTap = n; }, { passive: false });

    // ---- PRESS START → main menu modal ----
    $$('[data-open-menu]').forEach((b) => b.addEventListener('click', () => {
      const body = h('ul', { class: 'menu-list' }, NAV.filter((n) => n.menu).map((n) => h('li', null,
        h('a', { href: n.file + (DEMO ? '?demo=1' : (PREVIEW ? '?preview=1' : '')) }, h('span', { text: n.num + ' · ' + n.menu }), h('span', { class: 'st', dataset: { menuStatus: n.pre }, text: n.pre })))));
      Sound.play('start');
      Modal.open('MAIN MENU · SELECT STAGE', body);
      UI.status();
      const links = $$('.menu-list a', Modal.node);
      Modal.node.addEventListener('keydown', (e) => {
        const i = links.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, links.length - 1); links[n].focus(); Sound.play('move'); }
      });
      if (links[0]) links[0].focus();
    }));

    build();
    on('forma:content', build);
  }

  F.pages = F.pages || {};
  F.pages.home = initHome;
})(window.FORMA = window.FORMA || {});
