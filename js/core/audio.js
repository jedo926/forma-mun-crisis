/* FORMA MUN · Crisis Division — Settings, sound effects, music
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $$, reducedMotionQuery, store, session, emit, on, toast } = F;

  /* ---------------- Settings (sound + effects) ---------------- */
  const Settings = {
    sound: store.get('sound', false),
    musicMuted: store.get('musicMuted', false),
    fxLow: store.get('fxLow', null),
    get lowMotion() { return this.fxLow === null ? reducedMotionQuery.matches : this.fxLow; },
    apply() {
      document.documentElement.classList.toggle('fx-low', this.lowMotion);
      $$('[data-toggle-sound]').forEach((b) => { b.setAttribute('aria-pressed', String(this.sound)); b.textContent = this.sound ? 'SND ON' : 'SND OFF'; });
      $$('[data-toggle-music]').forEach((b) => { b.setAttribute('aria-pressed', String(!this.musicMuted)); b.textContent = this.musicMuted ? 'MUSIC OFF' : 'MUSIC ON'; });
      $$('[data-toggle-fx]').forEach((b) => { b.setAttribute('aria-pressed', String(!this.lowMotion)); b.textContent = this.lowMotion ? 'FX LOW' : 'FX FULL'; });
      Music.sync();
      emit('forma:settings');
    },
    toggleSound() {
      this.sound = !this.sound; store.set('sound', this.sound);
      if (this.sound) { Sound.unlock(); Sound.play('select'); }
      this.apply(); toast(this.sound ? 'SOUND ON' : 'SOUND MUTED');
    },
    toggleMusic() {
      this.musicMuted = !this.musicMuted; store.set('musicMuted', this.musicMuted);
      this.apply(); toast(this.musicMuted ? 'MUSIC OFF' : 'MUSIC ON');
    },
    toggleFx() {
      this.fxLow = !this.lowMotion; store.set('fxLow', this.fxLow);
      this.apply(); toast(this.lowMotion ? 'REDUCED EFFECTS' : 'FULL EFFECTS');
    }
  };

  /* ---------------- Sound: original synthesized chiptune SFX (WebAudio) ---------------- */
  const Sound = {
    ctx: null,
    files: { fight: 'assets/audio/sfx-fight.mp3', punch: 'assets/audio/sfx-punch.mp3', ko: 'assets/audio/sfx-ko.mp3' },
    cache: {},
    buffers: {}, loading: {},
    // Decode the sample files into WebAudio buffers once (works on iPad/iPhone after the first tap).
    preload() {
      if (!this.ctx || location.protocol === 'file:') return;
      Object.entries(this.files).forEach(([name, url]) => {
        if (this.buffers[name] || this.loading[name]) return;
        this.loading[name] = fetch(url).then((r) => r.arrayBuffer()).then((b) => new Promise((res, rej) => this.ctx.decodeAudioData(b, res, rej)))
          .then((buf) => { this.buffers[name] = buf; }).catch(() => { /* fall back to <audio> */ });
      });
    },
    sfx(name) {
      if (!Settings.sound || !this.files[name]) return;
      const vol = name === 'punch' ? 0.55 : 0.9;
      try {
        if (this.ctx && this.buffers[name]) {
          const src = this.ctx.createBufferSource(); const g = this.ctx.createGain(); g.gain.value = vol;
          src.buffer = this.buffers[name]; src.connect(g).connect(this.ctx.destination); src.start(); return;
        }
        if (!this.cache[name]) { this.cache[name] = new Audio(this.files[name]); this.cache[name].preload = 'auto'; }
        const a = this.cache[name].cloneNode(); a.volume = vol;
        const p = a.play(); if (p && p.catch) p.catch(() => {});
      } catch (e) { /* audio unavailable */ }
    },
    unlock() {
      try {
        if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.ctx = new AC(); }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.preload();
      } catch (e) { this.ctx = null; }
    },
    tone(freq, dur, opts = {}) {
      const c = this.ctx; if (!c) return;
      const t = c.currentTime + (opts.delay || 0);
      const o = c.createOscillator(); const g = c.createGain();
      o.type = opts.type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
      g.gain.setValueAtTime(opts.vol || 0.04, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol = 0.06, delay = 0) {
      const c = this.ctx; if (!c) return;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = c.createBufferSource(); const g = c.createGain(); g.gain.value = vol;
      s.buffer = buf; s.connect(g).connect(c.destination); s.start(c.currentTime + delay);
    },
    play(name, arg) {
      if (!Settings.sound) return;
      this.unlock(); if (!this.ctx) return;
      switch (name) {
        case 'move': this.tone(660, 0.05, { vol: 0.025 }); break;
        case 'select': this.tone(880, 0.08, { to: 1320 }); break;
        case 'start': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, { delay: i * 0.08 })); break;
        case 'whoosh': this.noise(0.08, 0.025); break;
        case 'hit': this.noise(0.12, 0.08); this.tone(180, 0.1, { to: 70, vol: 0.05 }); break;
        case 'ko': this.tone(440, 0.7, { to: 55, type: 'sawtooth', vol: 0.05 }); this.noise(0.4, 0.06, 0.05); break;
        case 'block': this.tone(1400, 0.05, { vol: 0.03 }); this.tone(900, 0.06, { vol: 0.025, delay: 0.03 }); break;
        case 'hover': this.tone(1200, 0.025, { vol: 0.012 }); break;
        case 'count': { const f = { 3: 392, 2: 523, 1: 659 }[arg] || 440; this.tone(f, 0.22, { vol: 0.06 }); this.tone(f * 2, 0.12, { vol: 0.03, delay: 0.02 }); this.tone(70, 0.25, { to: 40, type: 'sine', vol: 0.18 }); this.noise(0.05, 0.05); break; }
        case 'go': [523, 659, 784, 1047].forEach((f) => this.tone(f, 0.5, { vol: 0.035 })); this.tone(1568, 0.35, { vol: 0.025, delay: 0.08 }); this.noise(0.6, 0.08); this.tone(90, 0.5, { to: 35, type: 'sine', vol: 0.22 }); break;
        case 'jump': this.tone(330, 0.12, { to: 880, vol: 0.03 }); break;
        case 'ready': this.tone(1319, 0.06, { vol: 0.03 }); this.tone(1760, 0.1, { vol: 0.03, delay: 0.06 }); break;
        case 'win': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.16, { delay: i * 0.12, vol: 0.05 })); break;
        case 'lose': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.28, { delay: i * 0.2, type: 'triangle', vol: 0.06 })); break;
        case 'boot': [131, 196, 262, 392, 523].forEach((f, i) => this.tone(f, 0.3, { delay: i * 0.11, vol: 0.05 })); this.noise(0.8, 0.03, 0.1); break;
        case 'cutscene': this.tone(55, 1.6, { to: 40, type: 'sawtooth', vol: 0.06 }); this.tone(110, 1.2, { type: 'triangle', vol: 0.05, delay: 0.1 }); this.noise(0.9, 0.04, 0.05); break;
        case 'zoom': this.tone(110, 1.5, { to: 1760, type: 'sawtooth', vol: 0.035 }); this.tone(220, 1.5, { to: 2640, vol: 0.02 }); this.noise(1.4, 0.03, 0.2); break;
        case 'type': this.tone(1800 + Math.random() * 400, 0.02, { vol: 0.012 }); break;
        case 'special': this.tone(300, 0.25, { to: 1100, vol: 0.05 }); this.noise(0.15, 0.03, 0.05); break;
        case 'error': this.tone(200, 0.18, { to: 120, type: 'sawtooth', vol: 0.04 }); break;
        case 'release': [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.18, { delay: i * 0.1, vol: 0.05 })); break;
        default: break;
      }
    }
  };


  /* ---------------- Background music (assets/audio/bg-music.mp3) ----------------
     Muted until the visitor turns sound on. Playback position carries over between
     pages so the track doesn't restart on every navigation. */
  const Music = {
    el: null,
    init() {
      try {
        const a = new Audio('assets/audio/bg-music.mp3');
        a.loop = true; a.volume = 0.35; a.preload = 'none';
        const t = Number(session.get('musicTime', 0)) || 0;
        if (t > 0) a.addEventListener('loadedmetadata', () => { if (t < a.duration) a.currentTime = t; }, { once: true });
        const save = () => { if (!a.paused || a.currentTime) session.set('musicTime', a.currentTime); };
        window.addEventListener('pagehide', save);
        setInterval(save, 2000);
        document.addEventListener('visibilitychange', () => { if (document.hidden) a.pause(); else this.sync(); });
        this.el = a;
      } catch (e) { this.el = null; }
    },
    fadeIn() {
      const a = this.el; if (!a || !Settings.sound || Settings.musicMuted) return;
      a.volume = 0; this.sync(); let v = 0;
      const iv = setInterval(() => { v = Math.min(0.35, v + 0.035); a.volume = v; if (v >= 0.35) clearInterval(iv); }, 120);
    },
    sync() {
      const a = this.el; if (!a) return;
      if (Settings.sound && !Settings.musicMuted && !document.hidden) { const p = a.play(); if (p && p.catch) p.catch(() => { /* waits for a user gesture */ }); }
      else a.pause();
    }
  };

  Object.assign(F, { Settings, Sound, Music });
})(window.FORMA = window.FORMA || {});
