/* FORMA MUN · Crisis Division — Configuration + site map
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';

  /* ---------------- Configuration ---------------- */
  const CONFIG = {
    releaseAt: '2027-01-07T22:00:00+03:00', // 22:00 Riyadh. Must match RELEASE_AT on Vercel
    timezone: 'Asia/Riyadh',
    timezoneLabel: 'RIYADH',
    // Relative path works on Vercel. To test release from a file:// copy, set this to
    // your deployed URL, e.g. 'https://your-project.vercel.app/api/release'.
    endpoint: '/api/release',
    adminEndpoint: '/api/admin',
    requestTimeoutMs: 8000,
    lockedSlots: 12,          // number of "?" silhouettes before release (display only)
    refreshAfterReleaseMs: 5 * 60 * 1000,
    // Released (non-default) characters square off by default: taunts, no hits / K.O.
    // Set to true to let them fully fight.
    fightAfterRelease: false,
    cutsceneMs: 7500
  };
  // Site map: drives the header nav, the home menu and page titles. Add a page here + its HTML file.
  const NAV = [
    { id: 'home', file: 'index.html', num: '00', label: 'HOME' },
    { id: 'briefing', file: 'briefing.html', num: '01', label: 'BRIEFING', menu: 'CRISIS BRIEFING', pre: 'LOCKED' },
    { id: 'characters', file: 'characters.html', num: '02', label: 'CHARACTERS', menu: 'CHARACTERS', pre: 'LOCKED' },
    { id: 'factions', file: 'factions.html', num: '03', label: 'FACTIONS', menu: 'FACTIONS', pre: 'LOCKED' },
    { id: 'timeline', file: 'timeline.html', num: '04', label: 'TIMELINE', menu: 'TIMELINE', pre: 'LOCKED' },
    { id: 'updates', file: 'updates.html', num: '05', label: 'UPDATES', menu: 'CRISIS UPDATES', pre: 'SAMPLE' },
    { id: 'locations', file: 'locations.html', num: '06', label: 'LOCATIONS', menu: 'LOCATIONS', pre: 'LOCKED' },
    { id: 'rules', file: 'rules.html', num: '07', label: 'RULES', menu: 'RULES & RESOURCES', pre: 'OPEN' },
    { id: 'intel', file: 'intel.html', num: '08', label: 'INTEL', menu: 'CLASSIFIED INTEL', pre: 'RESTRICTED' },
    { id: 'chairs', file: 'chairs.html', num: '09', label: 'CHAIRS', menu: 'ABOUT THE CHAIRS', pre: 'OPEN' }
  ];
  const DEFAULT_RELEASE_MS = Date.parse(CONFIG.releaseAt);
  const PAGE = document.body.dataset.page || 'home';
  const QS = new URLSearchParams(location.search);
  const DEMO = QS.get('demo') === '1';
  const PREVIEW = QS.get('preview') === '1';
  const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  if (IS_TOUCH) document.documentElement.classList.add('touch');

  Object.assign(F, { CONFIG, NAV, DEFAULT_RELEASE_MS, PAGE, QS, DEMO, PREVIEW, IS_TOUCH });
})(window.FORMA = window.FORMA || {});
