/* FORMA MUN · Crisis Division — Release client (server clock is the authority)
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { CONFIG, DEFAULT_RELEASE_MS, DEMO, PREVIEW, $$, h, arr, session, emit, toast } = F;

  /* ---------------- Release client (server clock is the authority) ---------------- */
  const Release = {
    status: 'unknown',   // unknown | locked | released | pending
    link: 'checking',    // checking | online | offline | file | demo
    content: null,
    version: null,
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
      const ids = (c) => arr(c && c.updates).map((u) => u && (u.id || u.title));
      const known = new Set(ids(this.content));
      const fresh = !first && ids(content).some((id) => !known.has(id));
      this.content = content; this.status = 'released';
      emit('forma:content', content);
      if (fresh) toast('NEW CRISIS UPDATE');
      if (first) emit('forma:released');
    },
    async check() {
      if (this.link === 'demo' || this.inflight) return;
      // Hidden tabs wait; coming back to the tab checks straight away.
      if (this.status === 'released' && document.hidden) { this.schedule(CONFIG.refreshAfterReleaseMs); return; }
      if (location.protocol === 'file:' && !/^https?:\/\//i.test(CONFIG.endpoint)) { this.link = 'file'; emit('forma:status'); return; }
      this.inflight = true; this.lastCheck = Date.now();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const killer = setTimeout(() => ctrl && ctrl.abort(), CONFIG.requestTimeoutMs);
      const t0 = Date.now();
      try {
        const sep = CONFIG.endpoint.includes('?') ? '&' : '?';
        const held = this.version ? '&v=' + encodeURIComponent(this.version) : '';
        const res = await fetch(CONFIG.endpoint + sep + 't=' + t0 + held, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined, headers: { Accept: 'application/json' } });
        const t1 = Date.now();
        let data = null;
        try { data = await res.json(); } catch (e) { throw new Error('invalid_json'); }
        if (!data || typeof data !== 'object' || typeof data.status !== 'string') throw new Error('invalid_shape');
        const st = Date.parse(data.serverTime);
        if (Number.isFinite(st)) this.offset = st - (t0 + t1) / 2;
        const ra = Date.parse(data.releaseAt);
        if (Number.isFinite(ra)) this.releaseMs = ra;
        this.fails = 0; this.link = 'online';
        if (data.status === 'released' && data.unchanged && this.content) {
          this.status = 'released';
          this.schedule(CONFIG.refreshAfterReleaseMs);
        } else if (data.status === 'released' && data.content && typeof data.content === 'object' && !Array.isArray(data.content)) {
          this.version = data.version || null;
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
    // Admin preview: a logged-in admin can see the released site before release, using the
    // saved draft or the published version. The server checks the token; nothing is readable without it.
    async startPreview() {
      this.link = 'demo';
      // A new tab receives the token in the URL hash. It always wins over an older stored one.
      const m = location.hash.match(/(?:^|[&#])at=([^&#]+)/);
      if (m) {
        session.set('adminToken', decodeURIComponent(m[1]));
        history.replaceState(null, '', location.pathname + location.search);
      }
      const token = session.get('adminToken', null);
      const label = h('span', { class: 'preview-label', text: 'ADMIN PREVIEW' });
      const bar = h('div', { class: 'demo-banner admin-banner preview-bar', role: 'note', dataset: { previewBar: '' } }, label);
      document.body.prepend(bar);
      if (!token) {
        session.set('previewMode', false);
        label.textContent = 'ADMIN PREVIEW NEEDS A LOGIN · ';
        bar.append(h('a', { href: 'admin.html', text: 'LOG IN' }));
        emit('forma:status');
        return;
      }
      session.set('previewMode', true);
      const view = session.get('previewView', 'draft');
      const go = (v) => { session.set('previewView', v); location.reload(); };
      const tab = (id, text) => h('button', { class: 'chip-btn' + (view === id ? ' active' : ''), type: 'button', 'aria-pressed': String(view === id), dataset: { previewView: id }, onclick: () => go(id) }, text);
      const reveal = h('button', { class: 'chip-btn', type: 'button', dataset: { previewReveal: '' }, hidden: true, onclick: () => F.playReveal(this.content) }, '▶ PLAY REVEAL');
      const exit = () => { session.set('previewMode', false); session.set('previewView', 'draft'); location.href = location.pathname; };
      bar.append(tab('draft', 'DRAFT'), tab('published', 'PUBLISHED'), tab('locked', 'LOCKED'), reveal,
        h('a', { href: 'admin.html', text: 'BACK TO ADMIN' }),
        h('button', { class: 'chip-btn', type: 'button', dataset: { previewExit: '' }, onclick: exit }, 'EXIT'));
      if (view === 'locked') { label.textContent = 'ADMIN PREVIEW · WHAT VISITORS SEE WHILE LOCKED'; emit('forma:status'); return; }
      try {
        const res = await fetch(CONFIG.adminEndpoint + '?action=content&t=' + Date.now() + (view === 'draft' ? '&draft=1' : ''), { cache: 'no-store', headers: { Authorization: 'Bearer ' + token } });
        const data = await res.json();
        if (res.ok && data && data.content) {
          label.textContent = view === 'published' ? 'ADMIN PREVIEW · PUBLISHED VERSION' : (data.fromDraft ? 'ADMIN PREVIEW · UNPUBLISHED DRAFT' : 'ADMIN PREVIEW · NO DRAFT SAVED, SHOWING PUBLISHED');
          this.setContent(data.content);
          F.SiteCopy.apply(data.site);
          reveal.hidden = false;
        } else {
          label.textContent = res.status === 401 ? 'ADMIN PREVIEW: SESSION EXPIRED · LOG IN AGAIN' : 'ADMIN PREVIEW: CONTENT NOT AVAILABLE';
        }
      } catch (e) { label.textContent = 'ADMIN PREVIEW: NO CONNECTION'; }
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
