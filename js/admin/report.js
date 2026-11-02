/* FORMA MUN · Crisis Division — Admin: chair report
   The PDF goes to the private store, never the repository. It's sent in pieces because one request
   can't carry it all. The server keeps it locked until release. */
(function (F) {
  'use strict';
  const { $, h, toast, Sound } = F;
  const A = F.Admin;
  const { hint } = A.ui;

  const PIECE = 300000;              // whole multiples of 4, so the pieces join back up exactly
  const MAX_BYTES = 8 * 1024 * 1024;

  const toBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  };

  async function upload(file, msg) {
    msg.className = 'admin-msg';
    if (file.size > MAX_BYTES) { msg.className = 'admin-msg bad'; msg.textContent = 'THAT FILE IS OVER 8 MB'; Sound.play('error'); return; }
    const b64 = toBase64(await file.arrayBuffer());
    const total = Math.ceil(b64.length / PIECE);
    const id = 'r' + Date.now().toString(36);
    for (let index = 0; index < total; index++) {
      msg.textContent = `UPLOADING ${index + 1} OF ${total}…`;
      const { res, data } = await A.post('report-piece', { id, index, total, bytes: file.size, data: b64.slice(index * PIECE, (index + 1) * PIECE) }).catch(() => ({ res: { ok: false }, data: null }));
      if (!res.ok || !data || !data.ok) {
        msg.className = 'admin-msg bad';
        msg.textContent = data && data.code === 'not_a_pdf' ? 'THAT FILE IS NOT A PDF' : 'UPLOAD FAILED · TRY AGAIN';
        Sound.play('error');
        return;
      }
    }
    Sound.play('release');
    toast('CHAIR REPORT UPLOADED');
    if (A.reportChanged) A.reportChanged();
    await A.refresh();
  }

  async function open() {
    const tab = window.open('', '_blank');
    const { token } = A;
    const res = await fetch('/api/report?t=' + Date.now(), { cache: 'no-store', headers: { Authorization: 'Bearer ' + token.call(A) } }).catch(() => null);
    if (!res || !res.ok) { if (tab) tab.close(); toast('COULD NOT OPEN THE REPORT'); return; }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else location.assign(url);
  }

  async function remove() {
    if (!confirm('Remove the chair report from the site?')) return;
    const { res, data } = await A.post('delete-report');
    if (res.ok && data && data.ok) { toast('CHAIR REPORT REMOVED'); if (A.reportChanged) A.reportChanged(); await A.refresh(); } else toast('COULD NOT REMOVE IT');
  }

  function render() {
    const body = $('[data-report-body]');
    if (!body) return;
    body.innerHTML = '';
    const meta = A.status && A.status.report;
    const msg = h('p', { class: 'admin-msg', dataset: { reportMsg: '' } });
    const input = h('input', { id: 'report-file', name: 'report-file', class: 'input', type: 'file', accept: 'application/pdf', 'aria-label': 'Choose a PDF' });
    input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0], msg); });
    body.append(h('div', { class: 'notice-info' }, h('strong', null, 'LOCKED UNTIL RELEASE'),
      ' — this PDF names the scenario, so it stays private. Delegates get it at the reveal, on the Briefing and Rules pages.'));
    if (meta) {
      body.append(h('p', { dataset: { reportState: '' } }, h('strong', { class: 'ok', text: '✓ ON THE SITE' }), ` · ${(meta.bytes / 1024).toFixed(0)} KB · uploaded ${A.dateFmt.format(Date.parse(meta.uploadedAt))}`),
        h('div', { class: 'comm-ctrl-row' },
          h('button', { class: 'btn', type: 'button', dataset: { reportOpen: '' }, onclick: open }, 'OPEN REPORT ↗'),
          h('button', { class: 'btn', type: 'button', dataset: { reportRemove: '' }, onclick: remove }, 'REMOVE')),
        h('h3', { class: 'ed-section', text: 'REPLACE IT' }));
    } else {
      body.append(hint('No report uploaded yet. Choose the PDF below.'));
    }
    body.append(input, msg);
  }

  A.onPanel.report = render;
  A.renderReport = render;
})(window.FORMA = window.FORMA || {});
