/* FORMA MUN · Crisis Division — Admin control room: shell
   Loads last. Each section of the panel is its own module in js/admin/. To add a section: add a
   button and a panel to admin.html, then register what it does in A.onPanel.<name>. */
(function (F) {
  'use strict';
  const { $, $$, session, Sound } = F;
  const A = F.Admin;

  // These sections save as they go, so the draft buttons would only confuse.
  // The report keeps PREVIEW, to check how it looks to delegates.
  const SAVES_ITSELF = ['committee', 'crisis', 'updates', 'report'];
  const NO_PREVIEW = ['committee', 'crisis', 'updates'];

  function showPanel(name) {
    const known = $$('[data-panel]').some((b) => b.dataset.panel === name);
    const target = known ? name : 'edit';
    if (A.onPanelLeave) A.onPanelLeave();
    $$('[data-panel]').forEach((b) => {
      const on = b.dataset.panel === target;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $$('[data-panel-id]').forEach((p) => { p.hidden = p.dataset.panelId !== target; });
    $('[data-editor-save]').hidden = $('[data-editor-publish]').hidden = SAVES_ITSELF.includes(target);
    $('[data-a="preview"]').hidden = NO_PREVIEW.includes(target);
    session.set('adminPanel', target);
    if (A.onPanel[target]) A.onPanel[target]();
  }

  function initAdmin() {
    A.editorInit();
    A.updatesInit();
    A.visualInit();
    A.openPanel = () => showPanel(session.get('adminPanel', 'edit'));
    A.goToPanel = (name) => { showPanel(name); window.scrollTo(0, 0); };
    $$('[data-panel]').forEach((b) => b.addEventListener('click', () => { showPanel(b.dataset.panel); Sound.play('move'); window.scrollTo(0, 0); }));
    A.dashInit();
  }

  F.pages = F.pages || {};
  F.pages.admin = initAdmin;
})(window.FORMA = window.FORMA || {});
