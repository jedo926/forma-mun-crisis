/* FORMA MUN · Crisis Division — Pixel sprite engine
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';

  /* ---------------- Pixel sprite engine (original art) ----------------
     36×50 px characters built from layered parts (legs, arms, torso, head, hair, hat,
     props), then an automatic light/shadow pass (light from top-left) and an outline
     pass. Every look is data: skin, hair style + colour, facial hair, eyewear, hat,
     outfit and props. Nothing here describes any specific person. */
  const Sprite = (() => {
    const W = 36, H = 50, CX = 17;
    const OUTLINE = '#0b0a18', OUT = 99;
    const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim());
    const hex = (v, d) => (isHex(v) ? v.trim().toLowerCase() : d);
    function mix(a, b, t) {
      const n = parseInt(a.slice(1), 16), m = parseInt(b.slice(1), 16);
      const ch = (s) => Math.round(((n >> s) & 255) * (1 - t) + ((m >> s) & 255) * t);
      return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
    }
    const dk = (c, t = 0.3) => mix(c, '#000000', t);
    const lt = (c, t = 0.25) => mix(c, '#ffffff', t);
    const PART = { BLEG: 1, BARM: 2, LEG: 3, SHOE: 4, TORSO: 5, NECK: 6, HAIRB: 7, HEAD: 8, EAR: 9, HAIR: 10, HAT: 11, PROP: 12, ARM: 13, HAND: 14, BHAND: 15 };
    const HAIR = ['close', 'crew', 'side_part', 'slick', 'receding', 'bald', 'mop', 'wavy', 'tall', 'curly'];
    const FACIAL = ['mustache', 'thin_mustache', 'goatee', 'mustache_goatee', 'stubble'];
    const GLASSES = ['thick', 'wire'];
    const HATS = ['fedora', 'helmet'];
    const OUTFITS = ['suit', 'hoodie', 'tshirt'];
    const EXTRAS = ['cigar', 'camera', 'badge', 'armband'];
    const FRAMES = ['idle', 'walk', 'punch', 'kick', 'hit', 'win', 'block', 'jump'];

    // Arm = shoulder → elbow → fist. Leg = hip → foot. Facing right, canonical coords.
    const POSE = {
      idle:  { lean: 0,  legs: 'stand', back: [[12, 18], [11, 24], [16, 21]], front: [[22, 18], [25, 24], [27, 18]] },
      walk:  { lean: 0,  legs: 'walk',  back: [[12, 18], [11, 24], [16, 21]], front: [[22, 18], [25, 24], [27, 18]] },
      punch: { lean: 1,  legs: 'lunge', back: [[12, 18], [12, 24], [16, 22]], front: [[22, 18], [28, 18], [32, 18]] },
      kick:  { lean: -1, legs: 'kick',  back: [[12, 18], [10, 23], [14, 20]], front: [[22, 18], [24, 23], [26, 17]] },
      hit:   { lean: -2, legs: 'stand', back: [[12, 18], [9, 14], [7, 10]],   front: [[22, 18], [25, 13], [26, 9]] },
      win:   { lean: 0,  legs: 'stand', back: [[12, 18], [9, 24], [12, 28]],  front: [[22, 18], [24, 11], [24, 4]] },
      block: { lean: -1, legs: 'stand', back: [[12, 18], [15, 22], [20, 13]], front: [[22, 18], [25, 21], [25, 12]] },
      jump:  { lean: 0,  legs: 'tuck',  back: [[12, 18], [11, 23], [16, 20]], front: [[22, 18], [26, 22], [28, 16]] }
    };
    const LEGS = {
      stand: { back: [[15, 31], [13, 45]], front: [[20, 31], [22, 45]] },
      walk:  { back: [[15, 31], [17, 45]], front: [[20, 31], [18, 45]] },
      lunge: { back: [[15, 31], [10, 45]], front: [[20, 31], [26, 45]] },
      kick:  { back: [[15, 31], [14, 45]], front: [[20, 30], [31, 28]] },
      tuck:  { back: [[15, 31], [12, 40]], front: [[20, 31], [25, 38]] }
    };
    // Head silhouette rows [y, x0, x1].
    const HEAD = [[3, 15, 20], [4, 14, 21], [5, 13, 22], [6, 13, 22], [7, 13, 22], [8, 13, 22], [9, 13, 22], [10, 13, 22], [11, 13, 22], [12, 14, 22], [13, 15, 21], [14, 16, 20]];
    const HEAD_JOWLS = [[3, 15, 20], [4, 14, 21], [5, 13, 22], [6, 13, 22], [7, 13, 22], [8, 13, 22], [9, 13, 22], [10, 13, 22], [11, 13, 22], [12, 13, 22], [13, 14, 22], [14, 15, 21]];
    const HAIR_ROWS = {
      close: { front: [[3, 15, 20], [4, 14, 21], [5, 13, 21], [6, 13, 14], [7, 13, 14], [8, 13, 13]] },
      crew: { front: [[2, 15, 20], [3, 14, 21], [4, 13, 22], [5, 13, 21], [6, 13, 14], [7, 13, 14], [8, 13, 14]] },
      side_part: { front: [[1, 15, 21], [2, 14, 22], [3, 13, 22], [4, 13, 22], [5, 13, 20], [6, 13, 15], [7, 13, 14], [8, 13, 14], [9, 13, 14]], part: [[17, 2], [17, 3]] },
      slick: { front: [[2, 14, 21], [3, 13, 22], [4, 13, 22], [5, 13, 19], [6, 13, 15], [7, 13, 15], [8, 13, 14], [9, 13, 14], [10, 13, 14]], shine: [[18, 3], [19, 3], [20, 3]] },
      receding: { front: [[2, 14, 20], [3, 13, 21], [4, 13, 18], [5, 13, 16], [6, 13, 15], [7, 13, 15], [8, 13, 14], [9, 13, 14]] },
      bald: { front: [[6, 13, 14], [7, 13, 15], [8, 13, 15], [9, 13, 15], [10, 13, 14]] },
      mop: { back: [[6, 12, 14], [7, 12, 14], [8, 12, 14], [9, 12, 13], [10, 12, 13]], front: [[1, 14, 21], [2, 13, 23], [3, 12, 23], [4, 12, 23], [5, 12, 23], [6, 12, 16], [6, 18, 22]] },
      wavy: { front: [[0, 15, 16], [0, 19, 20], [1, 13, 22], [2, 12, 23], [3, 11, 23], [4, 12, 24], [5, 12, 23], [6, 12, 15], [6, 19, 20], [7, 12, 14], [8, 11, 14], [9, 12, 14], [10, 12, 13]], texture: 'wave' },
      tall: { front: [[-1, 15, 20], [0, 14, 21], [1, 14, 22], [2, 13, 22], [3, 13, 22], [4, 13, 22], [5, 13, 21], [6, 13, 14], [7, 13, 14], [8, 13, 14]] },
      curly: { disc: [17, 4, 9, 6], front: [[2, 13, 23], [3, 13, 23], [4, 13, 23], [5, 13, 22], [6, 13, 14], [6, 16, 16], [6, 18, 18], [6, 20, 21], [7, 12, 14], [8, 12, 14], [9, 11, 13], [10, 11, 13], [11, 12, 13]], texture: 'curl' }
    };
    const Q = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];

    function norm(look) {
      const L = look && typeof look === 'object' ? look : {};
      const hair = L.hair && typeof L.hair === 'object' ? L.hair : {};
      const o = L.outfit && typeof L.outfit === 'object' ? L.outfit : {};
      const type = OUTFITS.includes(o.type) ? o.type : 'suit';
      const jacket = hex(o.jacket, type === 'suit' ? '#2c2f3a' : '#1a1a22');
      return {
        skin: hex(L.skin, '#c68a5c'),
        hairStyle: HAIR.includes(hair.style) ? hair.style : 'crew',
        hair: hex(hair.color, '#1c1418'),
        facial: FACIAL.includes(L.facial) ? L.facial : null,
        brows: L.brows === 'thick' ? 'thick' : null,
        glasses: GLASSES.includes(L.glasses) ? L.glasses : null,
        hat: HATS.includes(L.hat) ? L.hat : null,
        hatColor: hex(L.hatColor, L.hat === 'helmet' ? '#e8ecf2' : '#4a4036'),
        hatCard: !!L.hatCard,
        ears: L.ears === 'big' ? 'big' : null,
        jowls: !!L.jowls,
        build: ['heavy', 'slim'].includes(L.build) ? L.build : null,
        extras: Array.isArray(L.extras) ? L.extras.filter((e) => EXTRAS.includes(e)) : [],
        outfit: {
          type, jacket,
          shirt: hex(o.shirt, '#eef0f4'),
          tie: hex(o.tie, '#2a1c24'),
          pants: hex(o.pants, type === 'suit' ? dk(jacket, 0.1) : '#2c3a5a'),
          shoes: o.shoes === 'sneaker' || (type !== 'suit' && o.shoes !== 'dress') ? 'sneaker' : 'dress'
        }
      };
    }

    function compose(L, frame, bob) {
      const c = new Array(W * H).fill(null); const p = new Int8Array(W * H);
      const put = (x, y, col, part) => { x = Math.round(x); y = Math.round(y) + 1; if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) return; const i = y * W + x; c[i] = col; p[i] = part; };
      const rect = (x, y, w, h2, col, part) => { for (let j = 0; j < h2; j++) for (let i = 0; i < w; i++) put(x + i, y + j, col, part); };
      const get = (x, y) => { y += 1; return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : p[y * W + x]; };
      const path = (pts, fn) => {
        const segs = []; let total = 0;
        for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; const n = Math.max(1, Math.ceil(segs[i - 1] * 2));
          for (let s = 0; s <= n; s++) { const t = s / n; fn(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, (acc + segs[i - 1] * t) / (total || 1)); }
          acc += segs[i - 1];
        }
      };
      const brush = (x, y, t, col, part) => { const o = Math.floor((t - 1) / 2); rect(Math.round(x) - o, Math.round(y) - o, t, t, col, part); };

      const pose = POSE[frame] || POSE.idle; const legs = LEGS[pose.legs];
      const lx = pose.lean, up = bob ? 1 : 0;
      const U = (pt) => [pt[0] + lx, pt[1] + up];
      const o = L.outfit; const skin = L.skin;
      const shoeCol = o.shoes === 'sneaker' ? '#e8ecf4' : '#18151d';
      const sleeveTo = o.type === 'tshirt' ? 0.36 : 1;
      const [t0, t1] = L.build === 'heavy' ? [10, 24] : (L.build === 'slim' ? [12, 22] : [11, 23]);
      const cx = CX + lx;

      const leg = (pts, pants, shoes, part, shoePart) => {
        path(pts, (x, y) => brush(x, y, 4, pants, part));
        const [fx, fy] = pts[pts.length - 1];
        if (fy < 40) { rect(fx, fy - 1, 4, 3, shoes, shoePart); if (o.shoes === 'sneaker') rect(fx + 3, fy - 1, 1, 3, '#9aa0b0', shoePart); }
        else { rect(fx - 2, 45, 6, 3, shoes, shoePart); if (o.shoes === 'sneaker') rect(fx - 2, 47, 6, 1, '#9aa0b0', shoePart); }
      };
      const arm = (pts, sleeve, skinCol, part, handPart, back) => {
        path(pts.map(U), (x, y, f) => {
          if (f < sleeveTo) brush(x, y, 4, sleeve, part);
          else if (o.type === 'suit' && f > 0.86) brush(x, y, 3, o.shirt, part);
          else brush(x, y, 3, o.type === 'tshirt' ? skinCol : sleeve, part);
        });
        const [hx, hy] = U(pts[pts.length - 1]);
        rect(hx - 1, hy - 1, 3, 3, skinCol, handPart);
        if (!back) put(hx + 1, hy - 1, lt(skinCol, 0.18), handPart);
      };

      // 1. back leg, back arm
      leg(legs.back, dk(o.pants, 0.22), dk(shoeCol, 0.15), PART.BLEG, PART.BLEG);
      arm(pose.back, dk(o.jacket, 0.24), dk(skin, 0.18), PART.BARM, PART.BHAND, true);
      if (L.extras.includes('armband')) path(pose.back.slice(0, 2).map(U), (x, y, f) => { if (f > 0.3 && f < 0.5) brush(x, y, 4, '#eef0f4', PART.BARM); });
      // 2. front leg + hips
      leg(legs.front, o.pants, shoeCol, PART.LEG, PART.SHOE);
      rect(13 + Math.min(0, lx), 30, 10, 3, o.pants, PART.LEG);
      // 3. hood behind neck, neck
      if (o.type === 'hoodie') rect(12 + lx, 13 + up, 10, 4, dk(o.jacket, 0.18), PART.TORSO);
      rect(cx - 1, 13 + up, 4, 4, dk(skin, 0.2), PART.NECK);
      // 4. torso
      const ty = 16 + up, tb = o.type === 'hoodie' ? 31 : 30;
      for (let y = ty; y <= tb + up && y <= 31; y++) {
        const inset = y === ty ? 1 : 0;
        rect(t0 + lx + inset, y, (t1 - t0 + 1) - inset * 2, 1, o.jacket, PART.TORSO);
      }
      if (L.build === 'heavy') { rect(t1 + lx + 1, 23 + up, 1, 6, o.jacket, PART.TORSO); }
      if (o.type === 'suit') {
        for (let r = 0; r < 6; r++) { const half = Math.max(1, 3 - Math.floor(r / 2)); rect(cx - half + 1, ty + r, half * 2, 1, o.shirt, PART.TORSO); }
        put(cx - 2, ty, lt(o.shirt, 0.3), PART.TORSO); put(cx + 3, ty, lt(o.shirt, 0.3), PART.TORSO);
        rect(cx, ty, 2, 1, dk(o.tie, 0.25), PART.TORSO);
        rect(cx, ty + 1, 2, 8, o.tie, PART.TORSO); for (let y = ty + 1; y < ty + 9; y++) put(cx + 1, y, dk(o.tie, 0.25), PART.TORSO);
        put(cx, ty + 9, o.tie, PART.TORSO);
        path([[cx - 3, ty], [cx - 1, ty + 6]], (x, y) => put(x, y, dk(o.jacket, 0.38), PART.TORSO));
        path([[cx + 4, ty], [cx + 2, ty + 6]], (x, y) => put(x, y, dk(o.jacket, 0.38), PART.TORSO));
        put(cx + 2, ty + 9, dk(o.jacket, 0.5), PART.TORSO); put(cx + 2, ty + 12, dk(o.jacket, 0.5), PART.TORSO);
        rect(t1 + lx - 3, ty + 3, 2, 1, '#eef0f4', PART.TORSO);
      } else if (o.type === 'hoodie') {
        path([[cx - 1, ty + 1], [cx - 1, ty + 5]], (x, y) => put(x, y, '#d8dce8', PART.TORSO));
        path([[cx + 2, ty + 1], [cx + 2, ty + 6]], (x, y) => put(x, y, '#d8dce8', PART.TORSO));
        rect(cx - 4, ty + 9, 9, 1, dk(o.jacket, 0.35), PART.TORSO);
        rect(cx - 4, ty + 9, 1, 4, dk(o.jacket, 0.35), PART.TORSO); rect(cx + 4, ty + 9, 1, 4, dk(o.jacket, 0.35), PART.TORSO);
        rect(t0 + lx, 30, t1 - t0 + 1, 1, dk(o.jacket, 0.3), PART.TORSO);
      } else {
        rect(cx - 1, ty, 4, 1, dk(skin, 0.1), PART.TORSO); rect(cx - 2, ty + 1, 6, 1, dk(o.jacket, 0.45), PART.TORSO);
      }
      if (o.type === 'suit') rect(t0 + lx, 30, t1 - t0 + 1, 1, dk(o.pants, 0.35), PART.TORSO);
      if (L.extras.includes('badge')) { put(cx - 3, ty + 4, '#ffd166', PART.PROP); put(cx - 4, ty + 5, '#ffd166', PART.PROP); put(cx - 3, ty + 5, '#fff1b0', PART.PROP); put(cx - 2, ty + 5, '#ffd166', PART.PROP); put(cx - 3, ty + 6, '#c99a2e', PART.PROP); }
      if (L.extras.includes('camera')) {
        path([[cx - 3, ty], [cx + 2, ty + 4]], (x, y) => put(x, y, '#141418', PART.PROP));
        rect(cx + 1, ty + 4, 6, 4, '#1c1c24', PART.PROP); rect(cx + 3, ty + 5, 2, 2, '#7a8cb0', PART.PROP); put(cx + 3, ty + 5, '#d8e4ff', PART.PROP); rect(cx + 1, ty + 3, 2, 1, '#2a2a34', PART.PROP);
      }
      // 5. hair (back layer), head, ear
      const HR = HAIR_ROWS[L.hairStyle] || HAIR_ROWS.crew;
      if (HR.disc) { const [dx, dy, rx, ry] = HR.disc; for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx + 0.6) + (y * y) / (ry * ry + 0.6) <= 1) put(dx + x + lx, dy + y + up, L.hair, PART.HAIRB); }
      (HR.back || []).forEach(([y, a, b]) => rect(a + lx, y + up, b - a + 1, 1, dk(L.hair, 0.1), PART.HAIRB));
      (L.jowls ? HEAD_JOWLS : HEAD).forEach(([y, a, b]) => rect(a + lx, y + up, b - a + 1, 1, skin, PART.HEAD));
      put(23 + lx, 9 + up, skin, PART.HEAD); put(23 + lx, 10 + up, dk(skin, 0.12), PART.HEAD);
      const earPx = L.ears === 'big' ? [[13, 7], [14, 7], [13, 8], [14, 8], [15, 8], [13, 9], [14, 9], [15, 9], [13, 10], [14, 10], [14, 11]] : [[14, 8], [14, 9], [15, 9], [14, 10]];
      earPx.forEach(([x, y]) => put(x + lx, y + up, dk(skin, 0.1), PART.EAR));
      // 6. hair front + texture
      const hairPx = [];
      (HR.front || []).forEach(([y, a, b]) => { for (let x = a; x <= b; x++) { put(x + lx, y + up, L.hair, PART.HAIR); hairPx.push([x + lx, y + up]); } });
      (HR.part || []).forEach(([x, y]) => put(x + lx, y + up, lt(L.hair, 0.3), PART.HAIR));
      (HR.shine || []).forEach(([x, y]) => put(x + lx, y + up, lt(L.hair, 0.35), PART.HAIR));
      if (HR.texture) {
        const all = hairPx.slice();
        if (HR.disc) { for (let y = -8; y < 12; y++) for (let x = 6; x < 30; x++) if (get(x, y) === PART.HAIRB) all.push([x, y]); }
        all.forEach(([x, y]) => {
          if (HR.texture === 'curl') { if ((x * 7 + y * 3) % 5 === 0) put(x, y, lt(L.hair, 0.3), get(x, y) || PART.HAIR); else if ((x * 3 + y * 5) % 7 === 0) put(x, y, dk(L.hair, 0.35), get(x, y) || PART.HAIR); }
          else if ((x + y * 2) % 4 === 0) put(x, y, dk(L.hair, 0.18), PART.HAIR);
        });
      }
      // 7. hats
      if (L.hat === 'fedora') {
        [[0, 15, 20], [1, 14, 21], [2, 14, 21]].forEach(([y, a, b]) => rect(a + lx, y + up, b - a + 1, 1, L.hatColor, PART.HAT));
        rect(14 + lx, 3 + up, 8, 1, dk(L.hatColor, 0.45), PART.HAT);
        rect(11 + lx, 4 + up, 15, 1, L.hatColor, PART.HAT);
        put(17 + lx, 0 + up, dk(L.hatColor, 0.3), PART.HAT);
        if (L.hatCard) { rect(19 + lx, 1 + up, 2, 2, '#f2efe6', PART.HAT); }
      } else if (L.hat === 'helmet') {
        [[0, 15, 20], [1, 13, 22], [2, 12, 23], [3, 12, 23], [4, 12, 23]].forEach(([y, a, b]) => rect(a + lx, y + up, b - a + 1, 1, L.hatColor, PART.HAT));
        rect(12 + lx, 5 + up, 14, 1, dk(L.hatColor, 0.2), PART.HAT);
        put(15 + lx, 1 + up, '#ffffff', PART.HAT); put(16 + lx, 1 + up, '#ffffff', PART.HAT);
      }
      // 8. front arm (in front of everything)
      arm(pose.front, o.jacket, skin, PART.ARM, PART.HAND, false);

      // ---- light / shadow pass (light from top-left) ----
      const shaded = c.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; const q = p[i]; if (!q || q === PART.PROP) continue;
        const col = c[i];
        const r1 = x + 1 < W ? p[i + 1] : 0, r2 = x + 2 < W ? p[i + 2] : 0, d1 = y + 1 < H ? p[i + W] : 0, l1 = x > 0 ? p[i - 1] : 0, u1 = y > 0 ? p[i - W] : 0;
        if (r1 !== q || d1 !== q) shaded[i] = dk(col, 0.3);
        else if (r2 !== q) shaded[i] = dk(col, 0.13);
        else if (l1 !== q || u1 !== q) shaded[i] = lt(col, 0.17);
      }
      for (let i = 0; i < c.length; i++) c[i] = shaded[i];

      // ---- face details (drawn after shading so they stay crisp) ----
      const F = (x, y, col) => { if (get(x + lx, y + up)) put(x + lx, y + up, col, get(x + lx, y + up)); };
      const browCol = L.hairStyle === 'bald' || L.hairStyle === 'receding' ? dk(L.hair, 0.15) : dk(L.hair, 0.05);
      {
        F(16, 8, '#f4f1ea'); F(17, 8, '#15101a'); F(20, 8, '#f4f1ea'); F(21, 8, '#15101a');
        [[16, 7], [17, 7], [20, 7], [21, 7]].forEach(([x, y]) => F(x, y, browCol));
        if (L.brows === 'thick') [[15, 7], [19, 7], [22, 7], [16, 6], [21, 6]].forEach(([x, y]) => F(x, y, browCol));
      }
      F(22, 10, dk(skin, 0.28));
      F(20, 12, dk(skin, 0.42)); F(21, 12, dk(skin, 0.42));
      if (L.jowls) { F(14, 12, dk(skin, 0.22)); F(15, 13, dk(skin, 0.22)); F(21, 13, dk(skin, 0.25)); }
      if (L.facial === 'stubble') for (let y = 11; y <= 14; y++) for (let x = 15; x <= 22; x++) if ((x + y) % 2 === 0 && get(x + lx, y + up) === PART.HEAD) F(x, y, mix(skin, L.hair, 0.35));
      if (L.facial === 'mustache' || L.facial === 'mustache_goatee') [[19, 11], [20, 11], [21, 11], [22, 11]].forEach(([x, y]) => F(x, y, L.hair));
      if (L.facial === 'thin_mustache') [[20, 11], [21, 11]].forEach(([x, y]) => F(x, y, L.hair));
      if (L.facial === 'goatee' || L.facial === 'mustache_goatee') [[20, 13], [21, 13], [20, 14]].forEach(([x, y]) => F(x, y, L.hair));
      if (L.glasses === 'thick') { for (let x = 15; x <= 22; x++) F(x, 7, '#141018'); [[15, 8], [18, 8], [19, 8], [22, 8]].forEach(([x, y]) => F(x, y, '#141018')); [[16, 9], [17, 9], [20, 9], [21, 9]].forEach(([x, y]) => F(x, y, '#8a8f9e')); }
      if (L.glasses === 'wire') { [[16, 7], [17, 7], [20, 7], [21, 7], [15, 8], [18, 8], [19, 8], [22, 8], [16, 9], [17, 9], [20, 9], [21, 9]].forEach(([x, y]) => F(x, y, '#c9cfdc')); }
      if (L.extras.includes('cigar')) { put(22 + lx, 12 + up, '#7a4a24', PART.PROP); put(23 + lx, 12 + up, '#7a4a24', PART.PROP); put(24 + lx, 12 + up, '#8a5a2e', PART.PROP); put(25 + lx, 12 + up, '#ff6a3d', PART.PROP); }

      // ---- outline pass ----
      const add = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (p[i]) continue;
        if ((x > 0 && p[i - 1] && p[i - 1] !== OUT) || (x < W - 1 && p[i + 1] && p[i + 1] !== OUT) || (y > 0 && p[i - W] && p[i - W] !== OUT) || (y < H - 1 && p[i + W] && p[i + W] !== OUT)) add.push(i);
      }
      add.forEach((i) => { c[i] = OUTLINE; p[i] = OUT; });
      return { c, p };
    }

    const cache = new Map();
    function render(model, opts = {}) {
      const frame = FRAMES.includes(opts.frame) ? opts.frame : 'idle';
      const bob = !!opts.bob, flip = !!opts.flip, scale = opts.scale || 3, rows = Math.min(H, opts.rows || H), flash = !!opts.flash;
      const key = [model.key, frame, bob, flip, scale, rows, flash].join('|');
      if (cache.has(key)) return cache.get(key);
      const L = model._look || (model._look = norm(model.look));
      const G = compose(L, frame, bob);
      const cv = document.createElement('canvas'); cv.width = W * scale; cv.height = rows * scale;
      const ctx = cv.getContext('2d');
      for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; const col = G.c[i]; if (!col) continue;
        let out = col;
        if (model.locked) out = G.p[i] === OUT ? '#7857FF' : '#17142e';
        if (flash) out = G.p[i] === OUT ? '#ffffff' : '#ffe6f6';
        ctx.fillStyle = out; ctx.fillRect((flip ? W - 1 - x : x) * scale, y * scale, scale, scale);
      }
      if (model.locked && !flash) {
        const gx = flip ? W - 1 - 19 : 15, gy = 21;
        ctx.fillStyle = '#00F5FF';
        Q.forEach((row, y) => { for (let x = 0; x < 5; x++) if (row[x] === '#') ctx.fillRect((gx + x) * scale, (gy + y) * scale, scale, scale); });
      }
      cache.set(key, cv);
      return cv;
    }
    function toCanvas(model, opts) {
      const src = render(model, opts); const cv = document.createElement('canvas');
      cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0);
      cv.setAttribute('aria-hidden', 'true');
      return cv;
    }
    return { W, H, CX, render, toCanvas, HAIR };
  })();

  Object.assign(F, { Sprite });
})(window.FORMA = window.FORMA || {});
