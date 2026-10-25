/* FORMA MUN · Crisis Division — Release client (server clock is the authority)
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { CONFIG, DEFAULT_RELEASE_MS, DEMO, PREVIEW, $$, h, store, session, emit } = F;

  /* ---------------- Release client (server clock is the authority) ---------------- */
  const Release = {
    status: 'unknown',   // unknown | locked | released | pending
    link: 'checking',    // checking | online | offline | file | demo
    content: null,
    offset: 0,
    releaseMs: DEFAULT_RELEASE_MS,
    timer: null,
    inflight: false,
    fails: 0,
    lastCheck: 0,
    now() { return Date.now() + this.offset; },
    remaining() { return Math.max(0, this.releaseMs - this.now()); },
    schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.check(), Math.max(500, ms)); },
    setContent(content) {
      const first = !this.content;
      this.content = content; this.status = 'released';
      emit('forma:content', content);
      if (first) emit('forma:released');
    },
    async check() {
      if (this.link === 'demo' || this.inflight) return;
      if (location.protocol === 'file:' && !/^https?:\/\//i.test(CONFIG.endpoint)) { this.link = 'file'; emit('forma:status'); return; }
      this.inflight = true; this.lastCheck = Date.now();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const killer = setTimeout(() => ctrl && ctrl.abort(), CONFIG.requestTimeoutMs);
      const t0 = Date.now();
      try {
        const sep = CONFIG.endpoint.includes('?') ? '&' : '?';
        const res = await fetch(CONFIG.endpoint + sep + 't=' + t0, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined, headers: { Accept: 'application/json' } });
        const t1 = Date.now();
        let data = null;
        try { data = await res.json(); } catch (e) { throw new Error('invalid_json'); }
        if (!data || typeof data !== 'object' || typeof data.status !== 'string') throw new Error('invalid_shape');
        const st = Date.parse(data.serverTime);
        if (Number.isFinite(st)) this.offset = st - (t0 + t1) / 2;
        const ra = Date.parse(data.releaseAt);
        if (Number.isFinite(ra)) this.releaseMs = ra;
        this.fails = 0; this.link = 'online';
        if (data.status === 'released' && data.content && typeof data.content === 'object' && !Array.isArray(data.content)) {
          this.setContent(data.content);
          this.schedule(CONFIG.refreshAfterReleaseMs);
        } else if (data.status === 'locked') {
          this.status = 'locked';
          const left = this.releaseMs - this.now();
          this.schedule(left <= 0 ? 2000 : (left < 70000 ? left + 400 : Math.min(left - 60000, 5 * 60 * 1000)));
        } else if (data.status === 'pending') {
          if (!this.content) this.status = 'pending';
          this.schedule(15000);
        } else {
          throw new Error('server_error');
        }
      } catch (e) {
        this.fails += 1;
        this.link = 'offline';
        if (!this.content && this.status !== 'locked') this.status = 'unknown';
        const backoff = Math.min(60000, 2000 * Math.pow(2, Math.min(this.fails - 1, 5)));
        this.schedule(backoff);
      } finally {
        clearTimeout(killer); this.inflight = false; emit('forma:status');
      }
    },
    init() {
      if (DEMO) { this.startDemo(); return; }
      if (PREVIEW) { this.startPreview(); return; }
      this.check();
      document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - this.lastCheck > 3000) this.check(); });
      window.addEventListener('online', () => this.check());
    },
    // Admin preview: a logged-in admin can see the released site before release.
    // The token is checked by the server (/api/admin); nothing is readable without it.
    async startPreview() {
      this.link = 'demo';
      const token = session.get('adminToken', null);
      const banner = h('div', { class: 'demo-banner admin-banner', role: 'note' }, 'ADMIN PREVIEW · ONLY VISIBLE TO LOGGED-IN ADMINS · ', h('a', { href: 'admin.html', text: 'BACK TO ADMIN' }));
      document.body.prepend(banner);
      this.keepParam('preview=1');
      if (!token) { banner.textContent = 'ADMIN PREVIEW NEEDS A LOGIN · '; banner.append(h('a', { href: 'admin.html', text: 'LOG IN' })); emit('forma:status'); return; }
      try {
        const res = await fetch(CONFIG.adminEndpoint + '?action=content&t=' + Date.now(), { cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
        const data = await res.json();
        if (res.ok && data && data.content) { this.setContent(data.content); }
        else { banner.textContent = 'ADMIN PREVIEW: ' + (res.status === 401 ? 'SESSION EXPIRED · ' : 'CONTENT NOT AVAILABLE · '); banner.append(h('a', { href: 'admin.html', text: 'LOG IN AGAIN' })); }
      } catch (e) { banner.textContent = 'ADMIN PREVIEW: NO CONNECTION · '; }
      emit('forma:status');
    },
    keepParam(param) {
      $$('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (/^[a-z0-9-]+\.html(#.*)?$/i.test(href)) { const [p, hash] = href.split('#'); a.setAttribute('href', p + '?' + param + (hash ? '#' + hash : '')); }
      });
    },
    startDemo() {
      this.link = 'demo';
      const s = document.createElement('script');
      s.src = 'assets/demo/demo-content.js';
      s.onload = () => {
        if (window.FORMA_DEMO_CONTENT) { this.setContent(window.FORMA_DEMO_CONTENT); emit('forma:status'); }
      };
      s.onerror = () => { this.link = 'offline'; emit('forma:status'); };
      document.head.append(s);
      const banner = h('div', { class: 'demo-banner', role: 'note' }, 'DEMO MODE · PLACEHOLDER SAMPLE DATA · NOT THE REAL CRISIS · ', h('a', { href: location.pathname, text: 'EXIT DEMO' }));
      document.body.prepend(banner);
      this.keepParam('demo=1');
    }
  };

  Object.assign(F, { Release });
})(window.FORMA = window.FORMA || {});
