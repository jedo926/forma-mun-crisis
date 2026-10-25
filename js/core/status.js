/* FORMA MUN · Crisis Division — Countdown + status widgets
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { DEMO, PREVIEW, $$, pad, h, on, clockFmt, Settings, Release } = F;

  /* ---------------- Status + countdown widgets ---------------- */
  const UI = {
    lastSec: -1,
    tick() {
      const left = Release.remaining();
      const sec = Math.floor(left / 1000);
      const parts = { d: pad(Math.floor(sec / 86400)), h: pad(Math.floor((sec % 86400) / 3600)), m: pad(Math.floor((sec % 3600) / 60)), s: pad(sec % 60) };
      if (sec !== this.lastSec) {
        this.lastSec = sec;
        $$('[data-cd]').forEach((n) => {
          const v = parts[n.dataset.cd];
          if (n.textContent !== v) { n.textContent = v; if (!Settings.lowMotion) { n.classList.remove('tick'); void n.offsetWidth; n.classList.add('tick'); } }
        });
        $$('[data-cd-inline]').forEach((n) => { n.textContent = `${parts.d}:${parts.h}:${parts.m}:${parts.s}`; });
        $$('[data-local-clock]').forEach((n) => { n.textContent = clockFmt.format(Release.now()); });
      }
      // Local zero only triggers a server check. It never reveals anything.
      if (left <= 0 && Release.status !== 'released' && Release.link !== 'file' && Release.link !== 'demo' && Date.now() - Release.lastCheck > 2500) Release.check();
      this.status();
    },
    status() {
      const r = Release; const left = r.remaining();
      let rel, relCls;
      if (r.status === 'released') { rel = 'DECLASSIFIED'; relCls = 'rel'; }
      else if (r.status === 'pending') { rel = 'RELEASED · CONTENT PENDING'; relCls = 'warn'; }
      else if (left <= 0) { rel = 'AWAITING SERVER CONFIRMATION'; relCls = 'warn'; }
      else { rel = 'LOCKED'; relCls = 'bad'; }
      const linkMap = {
        checking: ['CHECKING…', 'warn'], online: ['ONLINE', 'ok'], offline: ['NO SIGNAL · RETRYING', 'bad'],
        file: ['FILE MODE · DEPLOY FOR RELEASE', 'warn'], demo: [PREVIEW ? 'ADMIN PREVIEW' : 'DEMO DATA', 'warn']
      };
      const [linkText, linkCls] = linkMap[r.link] || linkMap.checking;
      $$('[data-release-status]').forEach((n) => { n.textContent = rel; n.previousElementSibling && n.previousElementSibling.classList.contains('dot') && (n.previousElementSibling.className = 'dot ' + relCls); });
      $$('[data-link-status]').forEach((n) => { n.textContent = linkText; n.previousElementSibling && n.previousElementSibling.classList.contains('dot') && (n.previousElementSibling.className = 'dot ' + linkCls); });
      $$('[data-signal-status]').forEach((n) => {
        const txt = r.status === 'released' ? 'ACQUIRED' : (left <= 0 && r.status !== 'released' ? 'AWAITING SERVER' : 'UNKNOWN');
        n.textContent = txt; n.classList.toggle('ok', r.status === 'released');
      });
      $$('[data-unlock-label]').forEach((n) => { n.textContent = r.status === 'released' ? 'TRANSMISSION RECEIVED' : 'TRANSMISSION UNLOCKS'; });
      $$('.signal-status .val').forEach((n) => n.classList.toggle('blink', r.status !== 'released'));
      const released = r.status === 'released';
      $$('[data-lock-chip]').forEach((n) => {
        if (n.dataset.mode === 'sample') return;
        n.textContent = released ? 'DECLASSIFIED' : (n.dataset.lockedText || 'LOCKED');
        n.classList.toggle('open', released);
      });
      $$('[data-menu-status]').forEach((n) => {
        if (released) { n.textContent = 'OPEN'; n.className = 'st open'; }
        else { n.textContent = n.dataset.menuStatus; n.className = 'st ' + (n.dataset.menuStatus === 'OPEN' ? 'open' : n.dataset.menuStatus === 'SAMPLE' ? 'standby' : ''); }
      });
    },
    start() {
      this.tick();
      setInterval(() => this.tick(), 250);
      on('forma:status', () => this.status());
      on('forma:content', () => this.status());
    }
  };

  Object.assign(F, { UI });
})(window.FORMA = window.FORMA || {});
