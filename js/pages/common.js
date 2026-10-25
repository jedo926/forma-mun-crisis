/* FORMA MUN · Crisis Division — Helpers shared by content pages
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $, str, h } = F;

  /* ======================================================================
     Generic page helpers
     ====================================================================== */
  function showReleased(content) {
    const lockedView = $('[data-locked-view]'); const relView = $('[data-released-view]');
    if (lockedView) lockedView.hidden = !!content;
    if (relView) relView.hidden = !content;
    return relView;
  }
  function premise(content) {
    const p = str(content.premiseNote, 1200) || 'Crisis developments in this committee are fictional.';
    return h('div', { class: 'panel premise', role: 'note' }, h('span', { class: 'label mag', text: 'FICTIONAL PREMISE' }), h('p', { style: 'margin-top:12px', text: p }));
  }
  function emptyNote(text) { return h('div', { class: 'empty', text }); }

  Object.assign(F, { showReleased, premise, emptyNote });
})(window.FORMA = window.FORMA || {});
