/* FORMA MUN · Crisis Division — Admin: DELEGATES tab
   A saved list that lasts across caucuses: attendance, who has spoken, directives sent.
   It is kept apart from the caucus and never sent to the public page, because names can reveal
   the scenario before release. */
(function (F) {
  'use strict';
  const { h, arr, toast, Sound } = F;
  const A = F.Admin;
  const C = A.comm;
  const { hint, dbtn, abtn, pbtn, tf } = A.ui;

  const key = (name) => String(name).trim().toLowerCase();
  let query = '';
  let notSpoken = false;
  let pasteOpen = false;
  let pasteText = '';
  let renaming = null;      // id of the delegate being renamed

  /** Replaces the list with the server's, unless a newer change is still on its way. */
  function take(r) {
    if (C.idle()) C.delegates = r.delegates;
    C.render();
  }

  async function op(payload, failText) {
    const r = await C.send('delegate', payload);
    if (!r.ok) { C.fail(r, failText || 'THAT DID NOT WORK · TRY AGAIN'); return null; }
    take(r);
    return r;
  }

  async function addDelegates(names) {
    const r = await op({ op: 'add', names }, 'COULD NOT ADD DELEGATES · TRY AGAIN');
    if (!r) return false;
    Sound.play(r.added.length ? 'select' : 'error');
    const parts = [];
    if (r.added.length) parts.push(`${r.added.length} ADDED`);
    if (r.skipped.length) parts.push(`${r.skipped.length} ALREADY SAVED`);
    if (r.full) parts.push('LIST IS FULL (200)');
    toast(parts.join(' · '));
    return true;
  }

  async function togglePresent(d) {
    d.present = !d.present;       // shows at once, so roll call feels instant
    Sound.play('move');
    C.render();
    const r = await C.send('delegate', { op: 'update', id: d.id, present: d.present });
    if (r.ok) { take(r); return; }
    d.present = !d.present;
    C.render();
    C.fail(r, `COULD NOT UPDATE ${d.name.toUpperCase()}`);
  }

  function nameCell(d) {
    if (renaming !== d.id) {
      return h('button', { class: 'comm-name-btn', type: 'button', title: 'Click to rename', 'aria-label': `Rename ${d.name}`, dataset: { rename: d.name }, onclick: () => { renaming = d.id; C.render(); } }, d.name);
    }
    let value = d.name, done = false;
    const close = async (save) => {
      if (done) return;
      done = true;
      renaming = null;
      if (!save || !value.trim() || value.trim() === d.name) { C.render(); return; }
      const r = await C.send('delegate', { op: 'update', id: d.id, name: value });
      if (!r.ok) { C.fail(r, r.code === 'duplicate' ? 'THAT NAME IS ALREADY SAVED' : 'COULD NOT RENAME'); C.render(); return; }
      take(r);
    };
    const input = tf(d.name, (v) => { value = v; }, 'Delegate name');
    input.setAttribute('aria-label', `New name for ${d.name}`);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
      if (e.key === 'Escape') close(false);
    });
    input.addEventListener('blur', () => close(true));
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return input;
  }

  function row(d, directives, queued) {
    const c = C.data.caucus;
    const canQueue = c && c.type === 'moderated' && c.totalMs > 0 && c.status !== 'ended';
    const inQueue = queued.has(key(d.name));
    const sent = directives[key(d.name)] || 0;
    return h('div', { class: 'comm-delegate', dataset: { delegateRow: d.name } },
      h('button', {
        class: 'comm-toggle' + (d.present ? ' on' : ''), type: 'button', 'aria-pressed': String(!!d.present), 'aria-label': `${d.name}: ${d.present ? 'present' : 'absent'}`,
        dataset: { toggle: d.name }, onclick: () => togglePresent(d)
      }, d.present ? 'PRESENT' : 'ABSENT'),
      h('span', { class: 'comm-delegate-name' }, nameCell(d)),
      h('span', { class: 'comm-stat', text: `SPOKE ${d.spoke || 0} · DIRECTIVES ${sent}` }),
      h('span', { class: 'comm-row-tools' },
        canQueue ? (inQueue ? h('span', { class: 'comm-stat', text: '✓ IN QUEUE' }) : abtn('QUEUE', () => C.addSpeakers([d.name]))) : null,
        dbtn(() => { if (confirm(`Remove ${d.name} from the delegate list?`)) op({ op: 'remove', id: d.id }, 'COULD NOT REMOVE'); })));
  }

  function importCharacters() {
    const names = arr(A.content && A.content.characters).map((ch) => ch.name).filter(Boolean);
    if (!A.contentReady || !names.length) { toast('NO CHARACTERS FOUND · ADD THEM UNDER ALL CONTENT'); Sound.play('error'); return; }
    addDelegates(names);
  }

  C.views.delegates = (body) => {
    const all = C.delegates;
    const directives = {};
    (C.data.directives || []).forEach((d) => { const k = key(d.delegation); directives[k] = (directives[k] || 0) + 1; });
    const queued = C.queuedNames();
    const known = new Set(all.map((d) => key(d.name)));
    const here = all.filter((d) => d.present).length;

    body.append(h('div', { class: 'comm-count', dataset: { commPresent: '' } }, h('b', { text: `${here} / ${all.length}` }), ' PRESENT'));

    const tools = h('div', { class: 'comm-ctrl-row' });
    if (!pasteOpen) {
      const add = abtn('ADD DELEGATES', () => { pasteOpen = true; C.render(); });
      add.dataset.addDelegates = '';
      tools.append(add);
    }
    tools.append(pbtn('IMPORT FROM CHARACTERS', importCharacters));
    if (all.length) {
      tools.append(pbtn('ALL PRESENT', () => op({ op: 'all-present' })));
      tools.append(pbtn('NEW SESSION', () => {
        if (confirm('Start a new session? Everyone is marked absent and spoken counts go back to zero. The names stay.')) op({ op: 'new-session' });
      }));
    }
    body.append(tools);

    if (pasteOpen) {
      body.append(C.pasteBox({
        text: pasteText, onText: (v) => { pasteText = v; }, known: (n) => known.has(key(n)), addLabel: 'SAVE DELEGATES',
        onAdd: async (names) => { pasteOpen = false; const before = pasteText; pasteText = ''; if (!await addDelegates(names)) { pasteOpen = true; pasteText = before; C.render(); } },
        onCancel: () => { pasteOpen = false; pasteText = ''; C.render(); }
      }));
    }

    if (!all.length) {
      body.append(hint('No delegates saved yet. Press ADD DELEGATES and paste your list, or import the character names. You only do this once.'));
      return;
    }

    const list = h('div', { class: 'comm-queue' });
    const paint = () => {
      const q = key(query);
      const match = all.filter((d) => (!q || key(d.name).includes(q)) && (!notSpoken || !d.spoke));
      list.innerHTML = '';
      if (!match.length) list.append(hint('No delegates match.'));
      list.append(...match.map((d) => row(d, directives, queued)));
    };
    const filter = h('button', {
      class: 'chip-btn' + (notSpoken ? ' active' : ''), type: 'button', 'aria-pressed': String(notSpoken),
      onclick: () => { notSpoken = !notSpoken; C.render(); }
    }, 'NOT SPOKEN YET');
    body.append(h('div', { class: 'ed-row comm-filter' }, C.search('Search delegates…', query, (v) => { query = v; paint(); }), filter), list);
    paint();
  };
})(window.FORMA = window.FORMA || {});
