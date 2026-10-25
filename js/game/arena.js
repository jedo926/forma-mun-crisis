/* FORMA MUN · Crisis Division — Arena: attract mode + playable fighting game
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { PAGE, $, clamp, str, h, on, Settings, Sound, Sprite } = F;

  /* ======================================================================
     PAGE: HOME — intro, character select, attract mode + playable game
     ====================================================================== */
  const SPECIAL_TYPES = ['projectile', 'stream', 'wave', 'dash', 'uppercut', 'counter', 'flash'];
  function specialOf(model) {
    if (model.special === null) return null;
    const s = model.special && typeof model.special === 'object' ? model.special : (model.locked ? { name: '??? SIGNAL', type: 'projectile', color: '#00F5FF' } : null);
    if (!s || !SPECIAL_TYPES.includes(s.type)) return null;
    const col = typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#FF2BD6';
    return { name: str(s.name, 24).toUpperCase() || 'SPECIAL', type: s.type, color: col };
  }

  function Arena(canvas, hud) {
    const ctx = canvas.getContext('2d');
    const BW = 384, BH = 176, S = 2, FLOOR = 154, SW = Sprite.W * S, SH = Sprite.H * S;
    const SP_CD = 3.2, GRAV = 620;
    canvas.width = BW; canvas.height = BH;
    ctx.imageSmoothingEnabled = false;
    let raf = 0, last = 0, scroll = 0, shake = 0, flashT = 0, slow = 0, running = false, round = 1;
    let f1, f2, mode = 'fight', phase = 'attract', human = false, overT = 0, countT = 0, countStep = -1, endShown = false;
    const sparks = [], shots = [], words = [], ghosts = [];
    const held = Object.create(null); const pressed = Object.create(null);

    // --- background layers (drawn once) ---
    const sky = document.createElement('canvas'); sky.width = BW; sky.height = BH;
    (() => {
      const g = sky.getContext('2d');
      const bands = ['#070812', '#0c0a22', '#120c33', '#1a0f3d', '#250f46', '#33104a'];
      bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * 18, BW, 18); });
      g.fillStyle = '#33104a'; g.fillRect(0, 108, BW, BH - 108);
      for (let i = 0; i < 40; i++) { g.fillStyle = i % 3 ? '#7857FF' : '#F1F4FF'; g.fillRect((i * 97) % BW, (i * 37) % 70, 1, 1); }
      const cx = 192, cy = 70, r = 34;
      for (let y = -r; y <= r; y++) {
        if (y > 4 && ((y >> 2) % 2 === 0)) continue;
        const w = Math.floor(Math.sqrt(r * r - y * y));
        g.fillStyle = y < -12 ? '#ffd166' : (y < 6 ? '#ff7aa8' : '#FF2BD6');
        g.fillRect(cx - w, cy + y, w * 2, 1);
      }
    })();
    const makeCity = (seed, minH, maxH, body, edge, win) => {
      const c = document.createElement('canvas'); c.width = BW * 2; c.height = BH; const g = c.getContext('2d');
      let r = seed; const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
      let x = 0; const blds = [];
      while (x < BW) { const w = 14 + Math.floor(rnd() * 26); blds.push({ x, w, h: minH + Math.floor(rnd() * (maxH - minH)), ant: rnd() < 0.25 }); x += w + 2 + Math.floor(rnd() * 6); }
      [0, BW].forEach((off) => blds.forEach((b) => {
        const top = FLOOR - b.h;
        g.fillStyle = body; g.fillRect(b.x + off, top, b.w, b.h);
        g.fillStyle = edge; g.fillRect(b.x + off, top, b.w, 1);
        if (b.ant) g.fillRect(b.x + off + Math.floor(b.w / 2), top - 6, 1, 6);
        if (win) for (let wy = top + 4; wy < FLOOR - 4; wy += 5) for (let wx = b.x + 3; wx < b.x + b.w - 2; wx += 4) {
          if (((wx * 7 + wy * 13) % 5) === 0) { g.fillStyle = ((wx + wy) % 3) ? win : '#FF2BD6'; g.fillRect(wx + off, wy, 2, 2); }
        }
      }));
      return c;
    };
    const far = makeCity(7, 40, 90, '#1d1747', '#7857FF', null);
    const near = makeCity(42, 18, 60, '#0c0a1f', '#FF2BD6', '#00F5FF');

    function fighter(model, side) {
      return { model, sp: specialOf(model), x: side < 0 ? 110 : 274, y: 0, vy: 0, dir: side < 0 ? 1 : -1, hp: 100, st: 'idle', t: 0, cd: 0.6 + Math.random() * 0.6, spCd: 1.5, hitDone: false, kb: 0, stun: 0, ai: { t: 0, plan: null, hold: 0 }, shotsLeft: 0, shotT: 0 };
    }
    let bannerTimer;
    function banner(text, ms) {
      hud.banner.textContent = text; hud.banner.classList.add('show');
      clearTimeout(bannerTimer); if (ms) bannerTimer = setTimeout(() => hud.banner.classList.remove('show'), ms);
    }
    function hp() {
      if (!f1 || !f2) return;
      hud.h1.style.width = f1.hp + '%'; hud.h2.style.width = f2.hp + '%';
      hud.h1.classList.toggle('low', f1.hp < 30); hud.h2.classList.toggle('low', f2.hp < 30);
      hud.round.textContent = mode === 'debate' ? 'DEBATE' : 'RND ' + round;
      [[hud.s1, f1], [hud.s2, f2]].forEach(([el, f]) => { if (!el) return; el.parentElement.classList.toggle('none', !f.sp); el.style.width = (f.sp ? clamp(1 - f.spCd / SP_CD, 0, 1) * 100 : 0) + '%'; const ready = !!f.sp && f.spCd <= 0; if (ready && !el.classList.contains('ready') && human && f === f1 && phase === 'play') Sound.play('ready'); el.classList.toggle('ready', ready); });
    }
    function reset(m1, m2) {
      f1 = fighter(m1, -1); f2 = fighter(m2, 1); phase = human ? 'countdown' : 'attract'; overT = 0; slow = 0; endShown = false;
      sparks.length = 0; shots.length = 0; words.length = 0; ghosts.length = 0;
      hud.n1.textContent = (human ? 'YOU · ' : '') + m1.name; hud.n2.textContent = (human ? 'CPU · ' : '') + m2.name;
      if (hud.arena) hud.arena.classList.toggle('debate', mode === 'debate');
      if (hud.end) hud.end.hidden = true;
      hp();
    }
    function setFighters(m1, m2) {
      reset(m1, m2);
      if (!human) banner(mode === 'debate' ? 'DEBATE!' : 'ROUND ' + round + ' · FIGHT!', 1300);
      if (!running) draw();
    }

    // ---------- effects ----------
    function burst(o, col, n) {
      const sx = o.x - o.dir * 8, sy = FLOOR - 62 + o.y;
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 90; sparks.push({ x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35, c: col || (i % 3 ? '#ffffff' : (i % 2 ? '#FF3B52' : '#ffd166')) }); }
    }
    const DEBATE_WORDS = ['POINT!', 'OBJECTION!', 'REBUTTAL!', 'ORDER!', 'MOTION!', 'YIELD!', 'NO!', 'FACTS!'];
    function word(o, text, col, big) { words.push({ x: o.x, y: FLOOR - (big ? 116 : 92) + o.y, text, col: col || '#ffffff', life: big ? 1.1 : 0.7, big: !!big }); }

    // ---------- combat ----------
    const ATK = { punch: { dur: 0.28, at: 0.09, range: 52, dmg: 6 }, kick: { dur: 0.4, at: 0.16, range: 62, dmg: 9 } };
    function inReach(f, o, r) { const dx = (o.x - f.x) * f.dir; return dx > -6 && dx <= r && Math.abs(o.y - f.y) < 40; }
    function hit(a, o, dmg) {
      if (o.st === 'ko' || phase === 'over' || phase === 'countdown') return;
      if (o.st === 'special' && o.sp && o.sp.type === 'counter' && o.t < 0.9) {
        word(o, 'COUNTER!', o.sp.color, true); o.st = 'idle'; Sound.play('special'); hit(o, a, 10); a.stun = 0.6; return;
      }
      const blocked = o.st === 'block' && ((a.x - o.x) * o.dir > 0);
      if (blocked) { dmg *= 0.2; o.x -= o.dir * 6; burst(o, '#7ad7ff', 8); Sound.play('block'); }
      else {
        o.st = 'hit'; o.t = 0; o.stun = Math.max(o.stun || 0, 0.32); o.kb = 110; o.dir = a.x > o.x ? 1 : -1;
        burst(o, null, 18); shake = Math.max(shake, 0.15); Sound.sfx('punch');
        if (mode === 'debate') word(o, DEBATE_WORDS[Math.floor(Math.random() * DEBATE_WORDS.length)]);
      }
      o.hp = Math.max(0, Math.round(o.hp - dmg));
      if (o.hp <= 0) { o.st = 'ko'; o.t = 0; endRound(a); }
      hp();
    }
    function endRound(winner) {
      phase = 'over'; overT = 0; slow = 0.9; f1.winner = winner === f1; f2.winner = winner === f2;
      banner(mode === 'debate' ? 'OUT-ARGUED!' : 'K.O.', 0);
      if (mode === 'debate') Sound.play('release'); else Sound.sfx('ko');
    }
    function startSpecial(f) {
      f.st = 'special'; f.t = 0; f.hitDone = false; f.spCd = SP_CD; f.shotsLeft = f.sp.type === 'stream' ? 3 : 1; f.shotT = 0;
      word(f, f.sp.name, f.sp.color, true); Sound.play('special');
      if (f.sp.type === 'uppercut') f.vy = -250;
    }
    function special(f, o, dt) {
      const tp = f.sp.type, col = f.sp.color;
      if (tp === 'projectile' || tp === 'stream') {
        f.shotT -= dt;
        if (f.t > 0.14 && f.shotsLeft > 0 && f.shotT <= 0) { shots.push({ x: f.x + f.dir * 26, y: f.y - 58, vx: f.dir * 230, owner: f, dmg: tp === 'stream' ? 6 : 15, col, life: 2.2, kind: 'orb' }); f.shotsLeft -= 1; f.shotT = 0.13; }
        if (f.t > (tp === 'stream' ? 0.62 : 0.38)) f.st = 'idle';
      } else if (tp === 'wave') {
        if (!f.hitDone && f.t > 0.22) { f.hitDone = true; shots.push({ x: f.x + f.dir * 22, y: 0, vx: f.dir * 175, owner: f, dmg: 14, col, life: 1.8, kind: 'wave' }); shake = Math.max(shake, 0.12); }
        if (f.t > 0.45) f.st = 'idle';
      } else if (tp === 'dash') {
        if (f.t < 0.34) {
          f.x += f.dir * 270 * dt; if (Math.floor(f.t * 40) % 2 === 0) ghosts.push({ f, x: f.x, y: f.y, life: 0.18 });
          if (!f.hitDone && Math.abs(o.x - f.x) < 34 && Math.abs(o.y - f.y) < 40) { f.hitDone = true; hit(f, o, 14); }
        }
        if (f.t > 0.45) f.st = 'idle';
      } else if (tp === 'uppercut') {
        if (!f.hitDone && f.t < 0.35 && Math.abs(o.x - f.x) < 44 && Math.abs(o.y - f.y) < 50) { f.hitDone = true; hit(f, o, 15); if (o.st !== 'ko') o.vy = -200; }
        if (f.t > 0.5 && f.y >= 0) f.st = 'idle';
      } else if (tp === 'counter') {
        if (f.t > 0.9) f.st = 'idle';
      } else if (tp === 'flash') {
        if (!f.hitDone && f.t > 0.16) { f.hitDone = true; if (!Settings.lowMotion) flashT = 0.22; if (Math.abs(o.x - f.x) < 170) { hit(f, o, 7); o.stun = 0.9; } }
        if (f.t > 0.4) f.st = 'idle';
      } else f.st = 'idle';
    }
    function physics(f, dt) { f.vy += GRAV * dt; f.y += f.vy * dt; if (f.y > 0) { f.y = 0; f.vy = 0; } f.x = clamp(f.x, 30, BW - 30); }

    // ---------- control ----------
    const take = (k) => { const v = !!pressed[k]; pressed[k] = false; return v; };
    function humanIntent() {
      return { move: (held.right ? 1 : 0) - (held.left ? 1 : 0), jump: !!held.up, block: !!held.down, punch: take('punch'), kick: take('kick'), special: take('special') };
    }
    function aiIntent(f, o, dt) {
      const I = { move: 0, jump: false, block: false, punch: false, kick: false, special: false };
      const a = f.ai; a.t -= dt;
      if (a.hold > 0) { a.hold -= dt; return Object.assign(I, a.plan || {}); }
      if (a.t > 0) { if (a.plan && a.plan.move) I.move = a.plan.move; return I; }
      a.t = 0.12 + Math.random() * 0.14; a.plan = null;
      const dist = Math.abs(o.x - f.x); const toward = o.x > f.x ? 1 : -1;
      const lvl = human && f === f2 ? 0.75 : 1;
      if (['punch', 'kick', 'special'].includes(o.st) && dist < 66 && Math.random() < 0.33 * lvl) { a.plan = { block: true }; a.hold = 0.35; return Object.assign(I, a.plan); }
      if (f.sp && f.spCd <= 0) {
        const ranged = ['projectile', 'stream', 'wave', 'flash'].includes(f.sp.type);
        if ((ranged && dist > 80 && Math.random() < 0.5) || (!ranged && dist < 70 && Math.random() < 0.35)) { I.special = true; return I; }
      }
      if (dist > 56) { a.plan = { move: toward }; I.move = toward; if (Math.random() < 0.04) I.jump = true; return I; }
      if (dist < 28 && Math.random() < 0.5) { a.plan = { move: -toward }; I.move = -toward; return I; }
      if (f.cd <= 0) { const r = Math.random(); if (r < 0.45 * lvl) I.punch = true; else if (r < 0.75 * lvl) I.kick = true; }
      return I;
    }
    function step(f, o, dt, I) {
      f.t += dt; f.cd -= dt; if (phase !== 'countdown') f.spCd -= dt;
      const grounded = f.y >= 0;
      if (f.st === 'ko') { physics(f, dt); return; }
      if (f.st === 'hit') { f.x -= f.dir * f.kb * dt; f.kb *= 0.86; f.stun -= dt; if (f.stun <= 0) f.st = 'idle'; physics(f, dt); return; }
      if (f.st === 'punch' || f.st === 'kick') {
        const A = ATK[f.st];
        if (!f.hitDone && f.t >= A.at) { f.hitDone = true; if (inReach(f, o, A.range)) hit(f, o, A.dmg); }
        if (f.t >= A.dur) { f.st = 'idle'; f.cd = human && f === f1 ? 0.05 : 0.35 + Math.random() * 0.6; }
        physics(f, dt); return;
      }
      if (f.st === 'special') { special(f, o, dt); physics(f, dt); return; }
      if (phase === 'countdown' || phase === 'over') { f.st = phase === 'over' && f.winner ? 'win' : 'idle'; physics(f, dt); return; }
      f.dir = o.x > f.x ? 1 : -1;
      if (I.block && grounded) { f.st = 'block'; physics(f, dt); return; }
      if (I.special && f.sp && f.spCd <= 0) { startSpecial(f); physics(f, dt); return; }
      if (I.punch) { f.st = 'punch'; f.t = 0; f.hitDone = false; Sound.play('whoosh'); return; }
      if (I.kick) { f.st = 'kick'; f.t = 0; f.hitDone = false; Sound.play('whoosh'); return; }
      if (I.jump && grounded) { f.vy = -230; if (f === f1 && human) Sound.play('jump'); }
      if (I.move) f.x += I.move * 62 * dt;
      f.st = !grounded ? 'jump' : (I.move ? 'walk' : 'idle');
      physics(f, dt);
    }
    function update(dt) {
      if (slow > 0) { slow -= dt; dt *= 0.35; }
      scroll += dt * 8; shake = Math.max(0, shake - dt); flashT = Math.max(0, flashT - dt);
      if (phase === 'countdown') {
        countT += dt; const stepN = Math.min(3, Math.floor(countT / 0.8));
        if (stepN !== countStep) {
          countStep = stepN; const txt = ['3', '2', '1', 'FIGHT!'][stepN];
          if (hud.count) { hud.count.textContent = txt; hud.count.classList.remove('pop'); void hud.count.offsetWidth; hud.count.classList.add('pop'); hud.count.hidden = false; }
          if (stepN === 3) { Sound.sfx('fight'); Sound.play('go'); if (!Settings.lowMotion) shake = 0.25; } else Sound.play('count', 3 - stepN);
        }
        if (countT > 3.3) { phase = 'play'; if (hud.count) hud.count.hidden = true; }
      }
      const I1 = human ? humanIntent() : aiIntent(f1, f2, dt);
      const I2 = aiIntent(f2, f1, dt);
      step(f1, f2, dt, I1); step(f2, f1, dt, I2);
      if (Math.abs(f1.x - f2.x) < 32 && Math.abs(f1.y - f2.y) < 30) { const m = (32 - Math.abs(f1.x - f2.x)) / 2; const s = f1.x < f2.x ? -1 : 1; f1.x = clamp(f1.x + s * m, 30, BW - 30); f2.x = clamp(f2.x - s * m, 30, BW - 30); }
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i]; s.x += s.vx * dt; s.life -= dt;
        const tgt = s.owner === f1 ? f2 : f1;
        const yOk = s.kind === 'wave' ? tgt.y > -16 : Math.abs((tgt.y - 58) - s.y) < 30;
        if (Math.abs(tgt.x - s.x) < 14 && yOk && tgt.st !== 'ko') { hit(s.owner, tgt, s.dmg); s.life = 0; }
        if (s.life <= 0 || s.x < -10 || s.x > BW + 10) shots.splice(i, 1);
      }
      for (let i = sparks.length - 1; i >= 0; i--) { const p = sparks[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; if (p.life <= 0) sparks.splice(i, 1); }
      for (let i = words.length - 1; i >= 0; i--) { const w = words[i]; w.life -= dt; w.y -= 18 * dt; if (w.life <= 0) words.splice(i, 1); }
      for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].life -= dt; if (ghosts[i].life <= 0) ghosts.splice(i, 1); }
      if (phase === 'over') {
        overT += dt;
        const winner = f1.hp > 0 ? f1 : f2;
        if (overT > 1.5 && overT - dt <= 1.5) banner(winner.model.name + (mode === 'debate' ? ' WINS THE FLOOR' : ' WINS'), 0);
        if (human && overT > 2.1 && !endShown) { endShown = true; if (hud.end) { hud.banner.classList.remove('show'); hud.endTitle.textContent = winner === f1 ? 'YOU WIN!' : 'CPU WINS'; Sound.play(winner === f1 ? 'win' : 'lose'); if (hud.endSub) hud.endSub.textContent = winner.model.name + (mode === 'debate' ? ' wins the floor' : ' wins'); hud.end.hidden = false; const b = $('[data-again]', hud.end); if (b) b.focus(); } }
        if (!human && overT > 4.2) { round += 1; hud.banner.classList.remove('show'); setFighters(f1.model, f2.model); }
      }
      hp();
    }

    // ---------- drawing ----------
    function frameOf(f, time) {
      let frame = f.st, bob = false;
      if (frame === 'special') { const t = f.sp && f.sp.type; frame = t === 'wave' || t === 'uppercut' ? 'win' : (t === 'counter' ? 'block' : 'punch'); }
      if (frame === 'idle') bob = Math.floor(time / 0.32) % 2 === 1;
      if (frame === 'walk') frame = Math.floor(time / 0.16) % 2 ? 'walk' : 'idle';
      if (frame === 'win') bob = Math.floor(time / 0.25) % 2 === 1;
      if (frame === 'ko') frame = 'hit';
      if (mode === 'debate' && frame === 'kick') frame = 'win';
      return { frame, bob };
    }
    function drawFighter(f, time, alpha) {
      const flip = f.dir < 0; const { frame, bob } = frameOf(f, time);
      const flash = f.st === 'hit' && Math.floor(f.t / 0.05) % 2 === 0;
      const anchor = flip ? (Sprite.W - 1 - Sprite.CX) * S : Sprite.CX * S;
      if (alpha === undefined) { ctx.fillStyle = 'rgba(0,0,0,.55)'; const sw = Math.max(20, 44 + f.y / 3); ctx.fillRect(Math.round(f.x - sw / 2), FLOOR - 2, Math.round(sw), 4); }
      const img = Sprite.render(f.model, { frame, bob, flip, scale: S, flash });
      ctx.save(); if (alpha !== undefined) ctx.globalAlpha = alpha;
      if (f.st === 'ko' && mode === 'fight') {
        ctx.translate(Math.round(f.x), FLOOR - 4 + f.y); ctx.rotate((flip ? 1 : -1) * Math.PI / 2 * Math.min(1, f.t * 4));
        ctx.drawImage(img, -SW / 2, -SH + 2 * S);
      } else {
        const jump = f.st === 'win' ? (Math.floor(time / 0.25) % 2) * 3 : 0;
        ctx.drawImage(img, Math.round(f.x - anchor), Math.round(FLOOR - SH + 2 - jump + f.y));
      }
      ctx.restore();
      if (alpha !== undefined) return;
      if (f.st === 'block') { ctx.fillStyle = 'rgba(122,215,255,.8)'; for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(f.x + f.dir * 24), Math.round(FLOOR - 82 + f.y + i * 6), 2, 4); }
      if (f.st === 'special' && f.sp && f.sp.type === 'counter' && Math.floor(f.t * 12) % 2 === 0) { ctx.strokeStyle = f.sp.color; ctx.strokeRect(Math.round(f.x - 26) + 0.5, Math.round(FLOOR - SH + f.y) + 0.5, 52, SH - 4); }
    }
    function drawShot(s, time) {
      if (s.kind === 'wave') {
        for (let i = -10; i <= 10; i += 2) { const h2 = 6 + Math.round(6 * Math.abs(Math.sin((time * 12) + i))); ctx.fillStyle = i % 4 ? s.col : '#ffffff'; ctx.fillRect(Math.round(s.x + i), FLOOR - h2, 2, h2); }
        return;
      }
      const x = Math.round(s.x), y = Math.round(FLOOR + s.y);
      ctx.fillStyle = s.col; ctx.globalAlpha = 0.35; ctx.fillRect(x - Math.sign(s.vx) * 10 - 3, y - 2, 6, 4); ctx.globalAlpha = 1;
      ctx.fillRect(x - 4, y - 4, 8, 8); ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    function drawWord(w) {
      ctx.save(); ctx.globalAlpha = clamp(w.life * 2, 0, 1);
      ctx.font = (w.big ? '9px' : '7px') + " 'Press Start 2P', monospace"; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#070812'; ctx.strokeText(w.text, Math.round(w.x), Math.round(w.y));
      ctx.fillStyle = w.col; ctx.fillText(w.text, Math.round(w.x), Math.round(w.y)); ctx.restore();
    }
    function draw(time = 0) {
      ctx.save();
      if (shake > 0 && !Settings.lowMotion) ctx.translate(Math.round((Math.random() - 0.5) * 4), Math.round((Math.random() - 0.5) * 3));
      ctx.drawImage(sky, 0, 0);
      const fo = Math.floor(scroll * 0.5) % BW, no = Math.floor(scroll * 1.4) % BW;
      ctx.drawImage(far, -fo, -8); ctx.drawImage(near, -no, 0);
      ctx.fillStyle = '#0a0920'; ctx.fillRect(0, FLOOR, BW, BH - FLOOR);
      ctx.fillStyle = '#00F5FF'; ctx.fillRect(0, FLOOR, BW, 1);
      for (let i = 1; i < 8; i++) { const y = FLOOR + Math.round(Math.pow(i / 8, 1.8) * (BH - FLOOR)) + ((Math.floor(scroll * 2) % 3)); ctx.fillStyle = i % 2 ? 'rgba(0,245,255,.35)' : 'rgba(255,43,214,.35)'; ctx.fillRect(0, y, BW, 1); }
      for (let i = -12; i <= 12; i++) { ctx.strokeStyle = 'rgba(255,43,214,.3)'; ctx.beginPath(); ctx.moveTo(BW / 2 + i * 16 + 0.5, FLOOR); ctx.lineTo(BW / 2 + i * 60 + 0.5, BH); ctx.stroke(); }
      ghosts.forEach((g) => { const keep = { x: g.f.x, y: g.f.y }; g.f.x = g.x; g.f.y = g.y; drawFighter(g.f, time, g.life * 1.6); g.f.x = keep.x; g.f.y = keep.y; });
      if (f1 && f2) { drawFighter(f1, time); drawFighter(f2, time + 0.11); }
      shots.forEach((s) => drawShot(s, time));
      sparks.forEach((p) => { ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2); });
      words.forEach(drawWord);
      if (flashT > 0) { ctx.fillStyle = `rgba(255,255,255,${(flashT / 0.22) * 0.85})`; ctx.fillRect(0, 0, BW, BH); }
      ctx.restore();
    }
    function loop(t) {
      if (!running) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      if (!document.hidden) { update(dt); draw(t / 1000); }
      raf = requestAnimationFrame(loop);
    }
    function play() { if (running) return; if (Settings.lowMotion && !human) { draw(); return; } running = true; last = 0; raf = requestAnimationFrame(loop); }
    function stop() { running = false; cancelAnimationFrame(raf); draw(); }
    on('forma:settings', () => { if (Settings.lowMotion && !human) stop(); else play(); });
    document.addEventListener('visibilitychange', () => { last = 0; });

    return {
      setFighters, play, stop,
      setMode(m) { mode = m === 'debate' ? 'debate' : 'fight'; },
      get human() { return human; },
      startMatch(m1, m2) {
        human = true; countT = 0; countStep = -1; hud.banner.classList.remove('show');
        Object.keys(held).forEach((k) => { held[k] = false; }); Object.keys(pressed).forEach((k) => { pressed[k] = false; });
        reset(m1 || f1.model, m2 || f2.model); running = false; play();
      },
      endMatch() { human = false; if (hud.count) hud.count.hidden = true; if (hud.end) hud.end.hidden = true; setFighters(f1.model, f2.model); if (Settings.lowMotion) stop(); else play(); },
      key(name, down) { if (down && !held[name]) pressed[name] = true; held[name] = down; }
    };
  }

  Object.assign(F, { SPECIAL_TYPES, specialOf, Arena });
})(window.FORMA = window.FORMA || {});
