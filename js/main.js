/* FORMA MUN · Crisis Division — Boot
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { PAGE, on, Settings, Music, Release, UI, initReleaseFx, initChrome } = F;

  /* ---------------- Boot ----------------
     Every module registers itself on window.FORMA; page modules register in FORMA.pages. */
  function boot() {
    Music.init();
    Settings.apply();
    initChrome();
    initReleaseFx();
    const init = (F.pages || {})[PAGE];
    try { if (init) init(); } catch (e) { console.error('[FORMA] page init failed', e); }
    UI.start();
    Release.init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

})(window.FORMA = window.FORMA || {});
