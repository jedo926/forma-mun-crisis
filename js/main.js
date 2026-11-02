/* FORMA MUN · Crisis Division — Boot
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { PAGE, DEMO, PREVIEW, on, Settings, Music, Release, UI, initReleaseFx, initChrome } = F;

  /* ---------------- Vercel Web Analytics + Speed Insights ----------------
     Public pages only. The admin panel and previews stay out: a preview URL can briefly carry the
     login token, and an admin's own testing shouldn't count as visits. Only Vercel serves these. */
  function loadTracking() {
    const onVercel = /(^|.)vercel.app$/.test(location.hostname);
    if (!onVercel || PAGE === 'admin' || PREVIEW || DEMO) return;
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
    ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js'].forEach((src) => {
      const s = document.createElement('script');
      s.src = src; s.defer = true;
      document.head.append(s);
    });
  }

  /* ---------------- Boot ----------------
     Every module registers itself on window.FORMA; page modules register in FORMA.pages. */
  function boot() {
    if (F.EMBED) Settings.sound = false;   // no sound from a frame in the admin panel
    Music.init();
    Settings.apply();
    initChrome();
    initReleaseFx();
    const init = (F.pages || {})[PAGE];
    try { if (init) init(); } catch (e) { console.error('[FORMA] page init failed', e); }
    UI.start();
    if (F.SiteCopy) F.SiteCopy.load();
    Release.init();
    loadTracking();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

})(window.FORMA = window.FORMA || {});
