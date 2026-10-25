/* FORMA MUN · Crisis Division — About the chairs page
   Module file. Loaded as a classic script (works from file:// too); shares state via window.FORMA. */
(function (F) {
  'use strict';
  const { $, $$, h, on, toast, Settings, Sound, Sprite, DEFAULT_CHARS } = F;

  /* ---------------- Chairs ---------------- */
  function initChairs() {
    $$('.chair').forEach((card, i) => {
      const m = DEFAULT_CHARS[i]; const port = $('.portrait', card); if (!m || !port) return;
      const cv = Sprite.toCanvas(m, { scale: 3 }); let f = 0;
      port.after(h('div', { class: 'ingame' }, cv, h('div', null, h('span', { class: 'label vio', text: 'IN-GAME FIGHTER' }), h('p', { class: 'muted', style: 'margin:10px 0 0', text: 'Always unlocked on the home screen. Pick ' + m.name.split(' ')[0] + ' and fight.' }))));
      if (!Settings.lowMotion) setInterval(() => { f += 1; const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(Sprite.render(m, { scale: 3, frame: f % 8 === 7 ? 'win' : 'idle', bob: f % 2 === 1 }), 0, 0); }, 380);
    });
    $$('.portrait img').forEach((img) => {
      const fail = () => img.parentElement.classList.add('missing');
      img.addEventListener('error', fail); if (img.complete && img.naturalWidth === 0) fail();
    });
    $$('[data-chair-select]').forEach((b) => b.addEventListener('click', () => {
      const card = b.closest('.chair'); Sound.play('start');
      card.animate && !Settings.lowMotion && card.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'steps(3)' });
      toast(b.dataset.chairSelect + ' SELECTED');
    }));
  }

  F.pages = F.pages || {};
  F.pages.chairs = initChairs;
})(window.FORMA = window.FORMA || {});
