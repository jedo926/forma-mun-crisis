/* FORMA MUN · Crisis Division — Intro scene
   Module file. First-person view from the bedroom floor in the 90s: your hands hold a
   controller wired to a retro console and a big CRT TV, in a room at dusk. POWER ON zooms
   the camera into the TV screen, which becomes the start menu.
   All art is original and drawn at runtime (480×270, scaled up pixelated). No brands. */
(function (F) {
  'use strict';
  const { Settings } = F;

  const W = 480, H = 270;
  const TV = { x: 132, y: 56, w: 152, h: 116, sx: 146, sy: 67, sw: 124, sh: 82 };
  const SCREEN_CENTER = { x: TV.sx + TV.sw / 2, y: TV.sy + TV.sh / 2 };
  const FOCUS = { x: 0.45, y: 0.6 }; // keep the TV in frame when the screen crops the scene (must match css object-position)
  const GLYPH = {
    A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
    D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
    H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'], K: ['101', '110', '100', '110', '101'],
    L: ['100', '100', '100', '100', '111'], M: ['10001', '11011', '10101', '10001', '10001'], N: ['10001', '11001', '10101', '10011', '10001'],
    O: ['111', '101', '101', '101', '111'], P: ['110', '101', '110', '100', '100'], R: ['110', '101', '110', '101', '101'],
    S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'], U: ['101', '101', '101', '101', '111'],
    V: ['101', '101', '101', '101', '010'], Y: ['101', '101', '010', '010', '010'], 1: ['010', '110', '010', '010', '111'],
    ' ': ['000', '000', '000', '000', '000']
  };

  function IntroScene(canvas) {
    const ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H; ctx.imageSmoothingEnabled = false;
    let raf = 0, running = false, t0 = 0;

    // ---------- drawing helpers (work on any 2D context) ----------
    const K = (g) => ({
      r(x, y, w, h, c) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
      p(x, y, c) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), 1, 1); },
      ell(cx, cy, rx, ry, fn) { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) { const d = (x * x) / (rx * rx) + (y * y) / (ry * ry); if (d <= 1) { const c = fn(x, y, d); if (c) { g.fillStyle = c; g.fillRect(cx + x, cy + y, 1, 1); } } } },
      line(x0, y0, x1, y1, c, t = 1) { g.strokeStyle = c; g.lineWidth = t; g.beginPath(); g.moveTo(x0 + 0.5, y0 + 0.5); g.lineTo(x1 + 0.5, y1 + 0.5); g.stroke(); },
      curve(pts, c, t = 2) { g.strokeStyle = c; g.lineWidth = t; g.lineCap = 'round'; g.beginPath(); g.moveTo(pts[0], pts[1]); g.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); g.stroke(); },
      text(str, x, y, s, c) { g.fillStyle = c; let cx = 0; [...String(str)].forEach((ch) => { const gl = GLYPH[ch] || GLYPH[' ']; gl.forEach((row, ry) => { for (let rx = 0; rx < row.length; rx++) if (row[rx] === '1') g.fillRect(Math.round(x) + (cx + rx) * s, Math.round(y) + ry * s, s, s); }); cx += gl[0].length + 1; }); },
      textW(str, s) { return ([...String(str)].reduce((w, ch) => w + (GLYPH[ch] || GLYPH[' '])[0].length + 1, 0) - 1) * s; }
    });
    const hash = (x, y) => { let n = (x | 0) * 374761393 + (y | 0) * 668265263; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };

    // ---------- static room ----------
    const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    (() => {
      const g = bg.getContext('2d'); const d = K(g);
      // walls (dim, cool) with faint stripes, darker toward the ceiling
      d.r(0, 0, W, 174, '#272b46');
      for (let x = 0; x < W; x += 6) d.r(x, 0, 1, 174, '#2b2f4c');
      for (let y = 0; y < 30; y++) { g.fillStyle = `rgba(8,8,20,${0.5 - y / 60})`; g.fillRect(0, y, W, 1); }
      d.r(0, 168, W, 7, '#1a1c2e'); d.r(0, 168, W, 1, '#34385a');

      // window at dusk (right): sky gradient, houses, tree, power lines, blinds
      const wx = 376, ww = 104, wh = 118;
      const sky = ['#2c2460', '#3c2a70', '#5a3280', '#7a3a88', '#a2468a', '#c45a86', '#de7480', '#ee9078', '#f4a874'];
      for (let y = 0; y < wh; y++) d.r(wx, y, ww, 1, sky[Math.min(sky.length - 1, Math.floor(y / wh * sky.length))]);
      for (let i = 0; i < 14; i++) d.p(wx + 6 + (i * 37) % 96, 8 + (i * 13) % 40, '#f4f1ea');
      [[380, 86, 30, 32], [408, 80, 40, 38], [446, 90, 34, 28]].forEach(([x, y, w, h], k) => {
        d.r(x, y, w, h, '#2a2040'); for (let i = 0; i < w / 2; i++) d.r(x + i, y - i * 0.6, w - i * 2, 1, '#2a2040');
        d.r(x + 6, y + 8, 5, 5, k % 2 ? '#ffd28a' : '#ffb86a'); d.r(x + w - 12, y + 10, 5, 5, '#ffd28a'); d.r(x + w / 2 - 2, y + h - 9, 5, 9, '#1a1430');
      });
      d.ell(392, 70, 14, 18, (x, y) => (hash(x + 20, y + 20) > 0.2 ? (hash(x + 29, y) > 0.7 ? '#24183a' : '#1c1430') : null)); d.r(390, 80, 3, 38, '#1c1430');
      d.r(462, 24, 3, 94, '#1e1630'); d.r(452, 30, 24, 2, '#1e1630'); d.r(454, 36, 20, 1, '#1e1630');
      g.strokeStyle = '#1e1630'; g.lineWidth = 1; g.beginPath(); g.moveTo(376, 40); g.quadraticCurveTo(420, 50, 463, 31); g.moveTo(376, 46); g.quadraticCurveTo(420, 56, 463, 37); g.stroke();
      for (let y = 0; y < 40; y += 4) { d.r(wx, y, ww, 3, '#cfc6bc'); d.r(wx, y + 2, ww, 1, '#9f968e'); }
      d.r(wx - 6, 0, 6, 122, '#3a2a22'); d.r(wx - 6, 118, ww + 6, 6, '#3a2a22'); d.r(wx - 6, 118, ww + 6, 1, '#5a4434');

      // door with varsity jacket + light switch
      d.r(270, 0, 62, 170, '#4e3222'); d.r(270, 0, 3, 170, '#3a2418'); d.r(329, 0, 3, 170, '#3a2418');
      [[278, 12, 46, 60], [278, 84, 46, 78]].forEach(([x, y, w, h]) => { d.r(x, y, w, h, '#45291b'); d.r(x, y, w, 1, '#5e3e2a'); d.r(x, y, 1, h, '#5e3e2a'); });
      d.r(322, 96, 4, 4, '#c9a060'); d.r(322, 96, 4, 1, '#f0d090');
      d.r(296, 14, 2, 6, '#9a9aa4'); d.line(286, 22, 297, 16, '#9a9aa4'); d.line(308, 22, 297, 16, '#9a9aa4');
      d.r(284, 22, 28, 58, '#1c2848'); d.r(278, 26, 8, 52, '#d6dae4'); d.r(310, 26, 8, 52, '#d6dae4');
      d.r(278, 74, 8, 3, '#1c2848'); d.r(310, 74, 8, 3, '#1c2848'); d.r(292, 22, 12, 6, '#d6dae4'); d.r(297, 28, 2, 50, '#121a32');
      d.r(286, 40, 8, 8, '#d6dae4'); d.r(288, 42, 4, 4, '#1c2848'); d.r(284, 78, 28, 3, '#d6dae4');
      d.r(340, 68, 10, 16, '#d8ccb4'); d.r(343, 72, 4, 6, '#b8ac94');

      // dresser + VCR on top
      d.r(338, 112, 92, 62, '#4a2c1c'); d.r(338, 112, 92, 3, '#62402a');
      for (let i = 0; i < 3; i++) { d.r(342, 120 + i * 17, 84, 14, '#3e2416'); d.r(342, 120 + i * 17, 84, 1, '#5a3a26'); d.r(380, 125 + i * 17, 8, 3, '#c9a060'); }
      d.r(344, 98, 56, 14, '#18181e'); d.r(344, 98, 56, 1, '#34343e'); d.r(350, 103, 22, 3, '#0a0a0e'); d.r(380, 102, 10, 4, '#0b2a16'); d.r(381, 103, 2, 2, '#4aff8a'); d.r(384, 103, 2, 2, '#4aff8a');
      d.r(404, 100, 22, 12, '#2a2a32'); d.ell(410, 106, 3, 3, () => '#141418'); d.ell(420, 106, 3, 3, () => '#141418');

      // bed corner with plaid blanket
      d.r(430, 100, 50, 136, '#33200f');
      d.r(434, 92, 46, 14, '#d8dce8'); d.r(434, 104, 46, 2, '#a8acbc');
      for (let y = 104; y < 214; y++) for (let x = Math.round(424 + Math.max(0, (y - 180) / 3)); x < W; x++) {
        const vs = (x % 14) < 4, hs = (y % 14) < 4, fine = x % 14 === 9 || y % 14 === 9;
        let c = '#1d2b5a'; if (vs && hs) c = '#36508e'; else if (vs || hs) c = '#2a3f78'; if (fine) c = '#c8cee0';
        if (x < 432 + (y - 104) / 6) c = '#141e40';
        d.p(x, y, c);
      }
      for (let y = 120; y < 210; y += 22) for (let x = 432; x < W; x++) d.p(x, y + Math.round(Math.sin(x / 6) * 2), 'rgba(0,0,0,.35)');

      // bookshelf (left) with VHS tapes, robot figure, plant; lamp
      d.r(0, 64, 112, 170, '#5a3420'); d.r(4, 70, 104, 160, '#20140e');
      [70, 128, 186].forEach((y) => { d.r(0, y + 54, 112, 5, '#6a4028'); d.r(0, y + 54, 112, 1, '#84563a'); });
      d.r(0, 64, 112, 6, '#6a4028');
      const spines = ['#121218', '#1e2a4a', '#3a1218', '#14141c', '#2a2a32', '#1a1a22', '#3a2a10', '#0e1c2c'];
      for (let x = 6; x < 102; x += 9) { const c = spines[((x / 9) | 0) % spines.length]; d.r(x, 80, 8, 44, c); d.r(x + 1, 84, 6, 14, '#e8e4d8'); d.r(x + 1, 86 + ((x * 7) % 8), 6, 1, '#8a2a2a'); d.r(x + 2, 104, 4, 16, '#3a3a44'); }
      for (let x = 6; x < 74; x += 9) { const c = ['#9a1a22', '#c8bfb0', '#1a3a6a', '#7a1a1a', '#c4a040'][((x / 9) | 0) % 5]; d.r(x, 140, 8, 42, c); d.r(x + 1, 146, 6, 10, '#f0ece2'); d.r(x + 1, 160, 6, 2, '#1a1a1a'); }
      d.r(80, 150, 14, 14, '#c8202a'); d.r(83, 142, 8, 8, '#2a5ab0'); d.r(85, 144, 4, 2, '#ffe066'); d.r(76, 152, 4, 10, '#2a5ab0'); d.r(94, 152, 4, 10, '#2a5ab0'); d.r(82, 164, 4, 14, '#2a5ab0'); d.r(88, 164, 4, 14, '#2a5ab0'); d.r(80, 178, 14, 4, '#8a8a94');
      for (let x = 6; x < 106; x += 8) { const c = ['#9a1a22', '#1a3a6a', '#c8bfb0', '#2a6a3a', '#5a2a6a'][((x / 8) | 0) % 5]; d.r(x, 196, 7, 42, c); d.r(x + 1, 200, 5, 8, '#f0ece2'); }
      d.r(40, 52, 22, 12, '#a0522d'); d.r(40, 52, 22, 2, '#c06a3a');
      for (let i = 0; i < 40; i++) { const a = i * 2.399, r = 2 + (i % 9) * 1.6; d.r(51 + Math.cos(a) * r * 1.4, 44 + Math.sin(a) * r * 0.9, 3, 3, i % 3 ? '#2f8a3a' : '#4ab84a'); }
      d.r(0, 0, 44, 30, '#e8b86a'); d.r(0, 26, 44, 4, '#c88a40'); for (let x = 0; x < 44; x += 4) d.r(x, 0, 2, 26, '#f0c880');

      // posters (original): synthwave FORMA + basketball SLAM
      d.r(116, 0, 76, 56, '#0e0e14'); const sw = ['#1a0e3a', '#2a1050', '#4a1460', '#7a1a6a', '#b02a6a', '#e04a6a'];
      for (let y = 0; y < 48; y++) d.r(120, 4 + y, 68, 1, sw[Math.floor(y / 8)]);
      for (let y = -10; y <= 10; y++) { if (y > 2 && y % 3 === 0) continue; const w = Math.floor(Math.sqrt(100 - y * y)) * 1.6; d.r(154 - w, 32 + y, w * 2, 1, y < -3 ? '#ffd166' : '#ff7aa8'); }
      for (let i = 0; i < 6; i++) d.r(120, 42 + i * 2, 68, 1, '#ff2bd6');
      d.text('FORMA', 154 - d.textW('FORMA', 1) / 2, 8, 1, '#00F5FF');
      d.r(200, 0, 64, 62, '#0e0e14'); d.r(204, 4, 56, 54, '#141038');
      for (let i = 0; i < 16; i++) d.p(206 + (i * 29) % 52, 6 + (i * 17) % 48, '#f4f1ea');
      d.ell(232, 20, 11, 11, (x, y, q) => (q > 0.82 ? '#7a3010' : (x * x < 2 || y * y < 2 ? '#4a1a08' : (x + y < -6 ? '#f08a3a' : '#d0642a'))));
      d.text('SLAM', 232 - d.textW('SLAM', 2) / 2 + 1, 36, 2, '#7a1a1a'); d.text('SLAM', 232 - d.textW('SLAM', 2) / 2, 35, 2, '#ffe066');

      // floor: wood planks in perspective
      d.r(0, 175, W, 95, '#432617');
      const vy = 118, vx = 230;
      let y = 176, gap = 3, row = 0;
      while (y < H) { d.r(0, y, W, gap, row % 2 ? '#4a2b1a' : '#40251a'); d.r(0, y, W, 1, '#2e1a10'); y += Math.round(gap); gap += 1.2; row += 1; }
      for (let k = -14; k <= 14; k++) { const bx = vx + k * 46; g.strokeStyle = 'rgba(30,16,10,.55)'; g.beginPath(); g.moveTo(vx + (bx - vx) * (175 - vy) / (H - vy) + 0.5, 175); g.lineTo(bx + 0.5, H); g.stroke(); }
      for (let i = 0; i < 260; i++) d.p(hash(i, 3) * W, 176 + hash(i, 7) * 94, hash(i, 9) > 0.5 ? '#5a3826' : '#2e1a10');

      // rug (perspective, patterned)
      for (let ry = 196; ry < H; ry++) {
        const t = (ry - 196) / (H - 196); const L = 128 - t * 150, Rr = 392 + t * 130;
        for (let x = Math.max(0, Math.floor(L)); x < Math.min(W, Rr); x++) {
          const ex = Math.min(x - L, Rr - x), ey = ry - 196; const u = (x - L) / (Rr - L);
          let c;
          if (ex < 4 + t * 6 || ey < 3) c = '#1f2a5a';
          else if (ex < 7 + t * 10 || ey < 6) c = '#c9a060';
          else {
            const m = Math.abs(((u * 24) % 2) - 1) + Math.abs((((ry - 196) / (6 + t * 10)) % 2) - 1);
            c = m < 0.55 ? '#1f2a5a' : (m < 0.8 ? '#c9a060' : (hash(x, ry) > 0.55 ? '#7a1e2c' : '#8a2634'));
          }
          if (hash(x * 3, ry * 5) > 0.93) c = '#5a1420';
          d.p(x, ry, c);
        }
      }

      // basketball + cartridge stack (right)
      d.ell(376, 182, 13, 13, (x, y, q) => (q > 0.85 ? '#6a2a10' : (Math.abs(x) < 1 || Math.abs(y) < 1 ? '#3a1408' : (x + y < -8 ? '#e0803a' : '#c25e28'))));
      d.r(354, 222, 74, 12, '#26262e'); d.r(354, 222, 74, 1, '#40404a'); d.r(356, 212, 70, 11, '#2c2c34'); d.r(356, 212, 70, 1, '#46464f');
      d.r(370, 200, 46, 13, '#3a3a44'); d.r(374, 202, 38, 9, '#d8402a'); d.r(376, 203, 10, 7, '#ffd166'); d.r(388, 204, 20, 2, '#1a3a6a'); d.r(388, 207, 14, 2, '#f4f1ea');

      // TV (big CRT on the floor)
      const { x: tx, y: ty, w: tw, h: th } = TV;
      d.r(tx + 8, ty - 6, tw - 16, 8, '#18181e');
      d.r(tx, ty, tw, th, '#1d1d24'); d.r(tx, ty, tw, 2, '#3c3c48'); d.r(tx, ty, 2, th, '#30303a'); d.r(tx + tw - 3, ty, 3, th, '#121218'); d.r(tx, ty + th - 3, tw, 3, '#0e0e12');
      d.r(TV.sx - 6, TV.sy - 5, TV.sw + 12, TV.sh + 10, '#101014'); d.r(TV.sx - 6, TV.sy - 5, TV.sw + 12, 1, '#2a2a32');
      d.text('FMV', tx + tw / 2 - d.textW('FMV', 1) / 2, ty + th - 12, 1, '#55556a');
      d.r(tx + 14, ty + th - 14, 4, 4, '#c8202a'); d.r(tx + 20, ty + th - 14, 4, 4, '#e8e8f0'); d.r(tx + 26, ty + th - 14, 4, 4, '#e8c020');
      for (let i = 0; i < 10; i++) d.r(tx + tw - 50 + i * 4, ty + th - 13, 2, 2, '#0a0a0e');
      d.r(tx + 10, ty + th, tw - 20, 4, '#0a0a0e');

      // console (generic two-tone grey box) right of the TV
      d.r(284, 180, 70, 22, '#2c2a36'); d.r(282, 174, 74, 8, '#3c3a48'); d.r(282, 174, 74, 1, '#5a5868');
      d.r(300, 170, 38, 6, '#24222c'); d.r(300, 170, 38, 1, '#4a4858'); d.r(304, 172, 30, 2, '#14121a');
      d.r(284, 184, 70, 2, '#ff2bd6'); d.r(290, 191, 5, 3, '#00F5FF'); d.r(300, 191, 14, 2, '#4a4858'); d.r(336, 189, 14, 8, '#1a1820');
      d.r(286, 201, 66, 1, '#16141c');

      // snacks (left): unbranded cola can + chip bag + spilled chips
      d.r(2, 186, 32, 50, '#b81c2a'); d.r(2, 186, 6, 50, '#d8303c'); d.r(28, 186, 6, 50, '#7a0e18');
      d.ell(18, 186, 16, 4, (x, y) => (y < 0 ? '#d8dce4' : '#9aa0ac')); d.r(14, 184, 8, 2, '#6a7080');
      for (let x = 4; x < 32; x++) d.p(x, 208 + Math.round(Math.sin(x / 4) * 3), '#f4f1ea');
      d.text('COLA', 18 - d.textW('COLA', 1) / 2, 216, 1, '#f4f1ea');
      d.r(2, 232, 32, 4, '#5a0a12');
      for (let y = 206; y < 252; y++) { const L = 40 + Math.round(Math.sin(y / 3) * 2) + (y - 206) * 0.2, Rr = 124 - (y - 206) * 0.3; d.r(L, y, Rr - L, 1, y < 210 ? '#d0303c' : '#a8182a'); }
      d.r(46, 212, 60, 2, '#c02434'); d.text('CHIPS', 80 - d.textW('CHIPS', 2) / 2, 216, 2, '#f4f1ea');
      [[62, 232], [74, 236], [88, 230]].forEach(([x, y]) => { for (let i = 0; i < 8; i++) d.r(x + i / 2, y + i, 8 - i, 1, '#f0a020'); });
      [[118, 244], [132, 250], [126, 238], [144, 256]].forEach(([x, y], k) => { for (let i = 0; i < 6; i++) d.r(x + i / 2, y + i, 6 - i, 1, k % 2 ? '#e8901a' : '#f0a020'); });

      // cables: TV → controller, console → controller
      d.curve([tx + 22, ty + th - 10, 150, 205, 220, 190, 226, 222], '#141418', 2);
      d.curve([343, 197, 340, 214, 300, 206, 290, 222], '#141418', 2);

      // first-person: socks + knees in jeans
      const denim = (x, y, q) => { if (q > 0.9) return '#141e38'; if (x + y < -40 && q < 0.7) return hash(x + 700, y + 700) > 0.4 ? '#30446e' : '#2a3c64'; return hash(x + 500, y + 500) > 0.5 ? '#22325a' : '#1c2a4e'; };
      d.ell(88, 228, 26, 16, (x, y, q) => (q > 0.85 ? '#a8acb8' : (hash(x + 100, y + 40) > 0.5 ? '#e0e2ea' : '#cfd2dc')));
      d.ell(392, 226, 28, 17, (x, y, q) => (q > 0.85 ? '#a8acb8' : (hash(x + 109, y + 100) > 0.5 ? '#e0e2ea' : '#cfd2dc')));
      d.ell(30, 262, 96, 42, denim); d.ell(452, 262, 96, 42, denim);
      for (let i = 0; i < 18; i++) { d.r(8 + i * 6, 236 + (i % 3), 4, 1, '#30446e'); d.r(380 + i * 5, 234 + (i % 3), 4, 1, '#30446e'); }
    })();

    // ---------- animated parts ----------
    const d = K(ctx);
    function drawScreen(t) {
      const { sx, sy, sw, sh } = TV;
      const bands = ['#140c3a', '#1c0e46', '#260f52', '#33105c', '#421266'];
      for (let y = 0; y < sh; y++) d.r(sx, sy + y, sw, 1, bands[Math.min(bands.length - 1, Math.floor(y / sh * bands.length * 1.3))]);
      for (let i = 0; i < 18; i++) if (Math.sin(t * 2 + i) > -0.6) d.p(sx + (i * 41) % sw, sy + 14 + (i * 23) % 26, '#c9d1ff');
      for (let y = -9; y <= 9; y++) { if (y > 2 && y % 3 === 0) continue; const w = Math.floor(Math.sqrt(81 - y * y)) * 1.5; d.r(sx + sw / 2 - w, sy + 46 + y, w * 2, 1, y < -2 ? '#ffd166' : '#ff6fa8'); }
      const off = Math.floor(t * 10) % 40;
      for (let i = -1; i < 5; i++) { const bx = sx + i * 40 - off; [[0, 14, 10], [12, 20, 8], [22, 10, 12], [32, 17, 7]].forEach(([dx, h, w]) => { const x0 = Math.max(sx, bx + dx), x1 = Math.min(sx + sw, bx + dx + w); if (x1 > x0) { d.r(x0, sy + 60 - h, x1 - x0, h, '#160c30'); if ((dx + i) % 2) d.r(x0 + 1, sy + 62 - h, 1, 1, '#00F5FF'); } }); }
      d.r(sx, sy + 60, sw, 1, '#00F5FF');
      for (let i = 0; i < 6; i++) d.r(sx, sy + 62 + i * 3 + (Math.floor(t * 8) % 3), sw, 1, i % 2 ? 'rgba(255,43,214,.5)' : 'rgba(0,245,255,.5)');
      const sway = Math.sin(t * 4) * 3, jab = Math.floor(t * 5) % 3 === 0;
      const ax = sx + 36 + sway, bx = sx + sw - 44 - sway;
      d.r(ax, sy + 49, 5, 11, '#00c8d4'); d.r(ax + 1, sy + 45, 4, 4, '#c68a5c'); d.r(ax + 5, sy + 51, jab ? 6 : 2, 2, '#c68a5c'); d.r(ax, sy + 58, 2, 2, '#e8ecf4'); d.r(ax + 3, sy + 58, 2, 2, '#e8ecf4');
      d.r(bx, sy + 49, 5, 11, '#ff2bd6'); d.r(bx, sy + 45, 4, 4, '#a86f45'); d.r(bx - (jab ? 2 : 6), sy + 51, jab ? 2 : 6, 2, '#a86f45'); d.r(bx, sy + 58, 2, 2, '#e8ecf4'); d.r(bx + 3, sy + 58, 2, 2, '#e8ecf4');
      d.text('P1', sx + 4, sy + 3, 1, '#00F5FF'); d.r(sx + 13, sy + 4, 34, 3, '#00F5FF'); d.text('VS', sx + sw / 2 - 3, sy + 3, 1, '#ff3b52'); d.r(sx + sw - 50, sy + 4, 34, 3, '#ff2bd6'); d.text('CPU', sx + sw - 14, sy + 3, 1, '#ff2bd6');
      d.text('FORMA', sx + sw / 2 - d.textW('FORMA', 2) / 2 + 1, sy + 13, 2, '#ff2bd6'); d.text('FORMA', sx + sw / 2 - d.textW('FORMA', 2) / 2, sy + 12, 2, '#f4f8ff');
      d.text('MUN', sx + sw / 2 - d.textW('MUN', 1) / 2, sy + 25, 1, '#00F5FF');
      if (Math.floor(t * 2) % 2 === 0) { d.r(sx + sw / 2 - 25, sy + 69, 50, 9, 'rgba(7,8,18,.75)'); d.text('PRESS START', sx + sw / 2 - d.textW('PRESS START', 1) / 2, sy + 71, 1, '#ffe066'); }
      for (let y = 0; y < sh; y += 2) { ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(sx, sy + y, sw, 1); }
      const roll = (t * 26) % (sh + 12) - 6; ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(sx, sy + roll, sw, 5);
      const vg = ctx.createRadialGradient(SCREEN_CENTER.x, SCREEN_CENTER.y, 20, SCREEN_CENTER.x, SCREEN_CENTER.y, 80); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx.fillStyle = vg; ctx.fillRect(sx, sy, sw, sh);
      ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(sx + 4, sy + 4, 26, 6); ctx.fillRect(sx + 4, sy + 10, 12, 3);
    }
    function drawHands(t) {
      // generic rounded controller (site colours) held in both hands; thumbs press d-pad / buttons
      const cx = 176, cy = 216, beat = Math.floor(t * 6) % 4, push = Math.floor(t * 3.5) % 2;
      const body = (x, y, q) => (q > 0.86 ? '#121018' : (y < -8 ? '#4a4658' : (y > 8 ? '#26232f' : '#363242')));
      d.ell(cx + 22, cy + 26, 30, 24, body); d.ell(cx + 106, cy + 26, 30, 24, body); d.r(cx + 22, cy + 3, 84, 44, '#363242');
      d.r(cx + 22, cy + 3, 84, 2, '#4a4658'); d.r(cx + 22, cy + 45, 84, 2, '#1a1822');
      const dpx = cx + 22, dpy = cy + 24;
      d.ell(dpx, dpy, 12, 12, (x, y, q) => (q > 0.85 ? '#22202a' : '#2c2936'));
      d.r(dpx - 9, dpy - 3, 18, 6, '#0e0c12'); d.r(dpx - 3, dpy - 9, 6, 18, '#0e0c12'); d.r(dpx - 2, dpy - 8, 4, 1, '#3a3746'); d.r(dpx - 8, dpy - 2, 1, 4, '#3a3746');
      d.r(cx + 52, cy + 30, 10, 4, '#16141c'); d.r(cx + 66, cy + 30, 10, 4, '#16141c'); d.r(cx + 56, cy + 14, 16, 6, '#ff2bd6'); d.r(cx + 58, cy + 16, 12, 2, '#ffb0f2');
      const btn = (x, y, down, c1, c2) => d.ell(x, y + (down ? 1 : 0), 6, 6, (a, b2, q) => (q > 0.75 ? '#0e0c12' : (a + b2 < -3 ? c2 : c1)));
      btn(cx + 100, cy + 30, beat === 0, beat === 0 ? '#008a94' : '#00c8d4', '#9ffcff'); btn(cx + 114, cy + 20, beat === 2, beat === 2 ? '#a0168a' : '#ff2bd6', '#ffb0f2');
      const skin = '#e2aa7c', sk2 = '#c48a5c', sk3 = '#9a6440', hi = '#f0c49c';
      const hand = (hx, side) => d.ell(hx, cy + 54, 24, 40, (x, y, q) => {
        if (q > 0.9) return sk3; if (x * side > 10) return sk2; if (y < -26 && x * side < 0) return hi;
        if ((y + 40) % 9 === 0 && x * side > -6 && y > -30) return sk2; return skin;
      });
      hand(cx - 2, -1); hand(cx + 130, 1);
      const thx = dpx - 13 + (push ? 3 : 0), thy = dpy - 3 + (push ? -2 : 0);
      d.ell(thx, thy + 6, 9, 11, (x, y, q) => (q > 0.82 ? sk3 : (x > 4 ? sk2 : skin))); d.ell(thx + 3, thy - 2, 6, 5, (x, y, q) => (q > 0.8 ? sk3 : (y < -1 ? hi : skin))); d.r(thx + 4, thy - 5, 4, 2, '#f8d8b8');
      const tbx = beat === 2 ? cx + 112 : cx + 100, tby = (beat === 2 ? cy + 20 : cy + 30) + (beat % 2 ? -2 : 0);
      d.ell(tbx + 10, tby + 8, 9, 11, (x, y, q) => (q > 0.82 ? sk3 : (x < -4 ? sk2 : skin))); d.ell(tbx + 3, tby, 6, 5, (x, y, q) => (q > 0.8 ? sk3 : (y < -1 ? hi : skin))); d.r(tbx, tby - 3, 4, 2, '#f8d8b8');
    }
    function drawLights(t) {
      const fl = 0.85 + 0.15 * Math.sin(t * 11) * Math.sin(t * 2.7);
      let g = ctx.createRadialGradient(SCREEN_CENTER.x, SCREEN_CENTER.y + 40, 10, SCREEN_CENTER.x, SCREEN_CENTER.y + 40, 230);
      g.addColorStop(0, `rgba(110,140,255,${0.26 * fl})`); g.addColorStop(0.5, `rgba(90,90,220,${0.1 * fl})`); g.addColorStop(1, 'rgba(60,60,200,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      g = ctx.createRadialGradient(SCREEN_CENTER.x, 200, 4, SCREEN_CENTER.x, 200, 60); g.addColorStop(0, `rgba(170,190,255,${0.18 * fl})`); g.addColorStop(1, 'rgba(170,190,255,0)');
      ctx.fillStyle = g; ctx.fillRect(100, 170, 220, 60);
      g = ctx.createRadialGradient(20, 10, 4, 20, 10, 150); g.addColorStop(0, 'rgba(255,200,120,.35)'); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      g = ctx.createRadialGradient(430, 60, 10, 430, 60, 180); g.addColorStop(0, 'rgba(240,130,140,.16)'); g.addColorStop(1, 'rgba(240,130,140,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      g = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 300); g.addColorStop(0, 'rgba(4,4,14,0)'); g.addColorStop(1, 'rgba(4,4,14,.55)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 18; i++) { const x = (i * 53 + t * (4 + i % 3)) % 220 + 100, y = 60 + (i * 31 + Math.sin(t + i) * 8) % 110; ctx.fillStyle = 'rgba(200,210,255,.25)'; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); }
    }
    function drawWindowLights(t) { d.r(452, 102, 5, 5, Math.sin(t * 0.7) > 0.3 ? '#ffd28a' : '#2a2040'); }
    function frame(t) { ctx.drawImage(bg, 0, 0); drawWindowLights(t); drawScreen(t); drawHands(t); drawLights(t); }
    function loop(now) { if (!running) return; frame((now - t0) / 1000); raf = requestAnimationFrame(loop); }

    return {
      start() { if (running) return; t0 = performance.now(); if (Settings.lowMotion) { frame(0.2); return; } running = true; raf = requestAnimationFrame(loop); },
      stop() { running = false; cancelAnimationFrame(raf); },
      // TV screen centre in CSS pixels (handles object-fit: cover + object-position) for the camera zoom.
      screenOrigin() {
        const r = canvas.getBoundingClientRect(); const s = Math.max(r.width / W, r.height / H);
        const ox = (r.width - W * s) * FOCUS.x, oy = (r.height - H * s) * FOCUS.y;
        return { x: ox + SCREEN_CENTER.x * s, y: oy + SCREEN_CENTER.y * s, zoom: Math.max(r.width / (TV.sw * s), r.height / (TV.sh * s)) * 1.12 };
      }
    };
  }

  Object.assign(F, { IntroScene });
})(window.FORMA = window.FORMA || {});
