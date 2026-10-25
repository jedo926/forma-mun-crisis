/* FORMA MUN · Crisis Division — Modal dialog
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $$, h, Sound } = F;

  /* ---------------- Modal ---------------- */
  const Modal = {
    node: null, prevFocus: null, onClose: null,
    open(title, body, onClose) {
      this.close(true);
      this.prevFocus = document.activeElement; this.onClose = onClose || null;
      const titleId = 'modal-title-' + Date.now();
      const closeBtn = h('button', { class: 'chip-btn modal-close', type: 'button', 'aria-label': 'Close', onclick: () => this.close() }, 'ESC ✕');
      const box = h('div', { class: 'modal-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, closeBtn, h('h2', { id: titleId, text: title }), body);
      this.node = h('div', { class: 'modal', onclick: (e) => { if (e.target === this.node) this.close(); } }, box);
      this.node.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const f = $$('a[href], button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])', box);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
      document.body.append(this.node);
      closeBtn.focus();
      Sound.play('select');
    },
    close(silent) {
      if (!this.node) return;
      this.node.remove(); this.node = null;
      if (this.onClose) { const f = this.onClose; this.onClose = null; f(); }
      if (!silent && this.prevFocus && this.prevFocus.focus) this.prevFocus.focus();
    }
  };

  Object.assign(F, { Modal });
})(window.FORMA = window.FORMA || {});
