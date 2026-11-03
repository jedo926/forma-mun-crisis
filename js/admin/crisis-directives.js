/* FORMA MUN · Crisis Division — Admin: Crisis Room, DIRECTIVES tab
   List on the left of the workflow, one directive at a time on the right of it. The checklist
   is only a reminder: approval and outcome are always the chair's own decision. */
(function (F) {
  'use strict';
  const { h, toast, fmtStamp, Sound } = F;
  const A = F.Admin;
  const R = A.crisis;
  const { lbl, efull, ecard, hint, esect, pbtn, ta, dd, checkbox } = A.ui;

  const CHECKS = [['clarity', 'Clear'], ['authority', 'Within their authority'], ['feasibility', 'Feasible'], ['resources', 'Resources exist'], ['timeline', 'Timeline works'], ['consistency', 'Fits known facts'], ['dependencies', 'Dependencies met'], ['risks', 'Risks understood']];
  const FIELDS = [['objective', 'OBJECTIVE'], ['background', 'BACKGROUND'], ['actions', 'REQUESTED ACTIONS'], ['resources', 'RESOURCES'], ['authority', 'RESPONSIBLE AUTHORITY'], ['timeline', 'TIMELINE'], ['target', 'TARGET'], ['risks', 'RISKS']];
  const GROUPS = [['waiting', 'TO REVIEW', ['submitted', 'review', 'hold']], ['changes', 'WITH DELEGATE', ['revision']], ['approved', 'AWAITING OUTCOME', ['approved']], ['closed', 'FINISHED', ['rejected', 'withdrawn', 'completed', 'partial', 'failed']]];

  let group = 'waiting';
  let openId = null;
  let review = { reason: '', note: '', checks: {} };
  let outcome = { result: 'completed', text: '', shared: false };
  let versions = { id: null, list: [] };

  /** Loads the history before drawing, because a redraw moments later would swallow a click. */
  async function pickUp(d) {
    const { res, data } = await A.crisisGet('versions', { query: '&id=' + encodeURIComponent(d.id) }).catch(() => ({ res: { ok: false }, data: null }));
    openId = d.id;
    review = { reason: '', note: '', checks: {} };
    outcome = { result: 'completed', text: '', shared: false };
    versions = { id: d.id, list: res.ok && data && data.ok ? data.versions : [] };
    R.render();
  }

  const decide = (d, decision, done, correction) => R.act('directive-decide', { id: d.id, version: d.version, decision, reason: review.reason, note: review.note, checklist: review.checks, correction }, done)
    .then((r) => { if (r) { review = { reason: '', note: '', checks: {} }; if (decision !== 'review') openId = null; R.render(); } });

  function reviewForm(d) {
    const needReason = (decision, done) => () => {
      if (!review.reason.trim()) { toast('WRITE THE REASON FIRST · THE DELEGATE SEES IT'); Sound.play('error'); return; }
      decide(d, decision, done);
    };
    const reason = ta(review.reason, (v) => { review.reason = v; }, 'What the delegate will read. Needed to reject, ask for changes or hold.');
    reason.dataset.reviewReason = '';
    const button = (label, attr, fn, cls) => { const b = pbtn(label, fn, cls); b.dataset.decide = attr; return b; };
    return ecard(lbl('CHECKLIST (A REMINDER ONLY)'),
      h('div', { class: 'members-grid' }, CHECKS.map(([k, label]) => checkbox(label.toUpperCase(), review.checks[k], (v) => { review.checks[k] = v; }))),
      efull(lbl('MESSAGE TO THE DELEGATE'), reason),
      efull(lbl('PRIVATE NOTE FOR CHAIRS'), ta(review.note, (v) => { review.note = v; }, 'Never shown to the delegate.')),
      h('div', { class: 'comm-ctrl-row comm-mid' },
        button('APPROVE ✓', 'approve', () => decide(d, 'approve', 'APPROVED'), 'mag'),
        button('ASK FOR CHANGES', 'revise', needReason('revise', 'SENT BACK')),
        button('REJECT', 'reject', needReason('reject', 'REJECTED')),
        d.status !== 'hold' ? button('HOLD', 'hold', needReason('hold', 'ON HOLD')) : null));
  }

  function outcomeForm(d) {
    const text = ta(outcome.text, (v) => { outcome.text = v; }, 'What actually happened? Approval does not mean it worked.');
    text.dataset.outcomeText = '';
    const save = pbtn('RECORD OUTCOME', async () => {
      const r = await R.act('directive-outcome', { id: d.id, result: outcome.result, text: outcome.text, shared: outcome.shared }, 'OUTCOME RECORDED');
      if (r) { outcome = { result: 'completed', text: '', shared: false }; R.render(); }
    }, 'mag');
    save.dataset.outcomeSave = '';
    return ecard(lbl('RESULT'), dd([['completed', 'WORKED'], ['partial', 'PARTLY WORKED'], ['failed', 'FAILED']], outcome.result, (v) => { outcome.result = v; }),
      efull(lbl('WHAT HAPPENED'), text),
      checkbox('TELL THE DELEGATE', outcome.shared, (v) => { outcome.shared = v; }),
      h('div', { class: 'comm-ctrl-row' }, save));
  }

  function correctForm(d) {
    const box = ta(review.reason, (v) => { review.reason = v; }, 'Why is this decision being changed? The delegate sees this.');
    const go = (decision) => () => {
      if (!review.reason.trim()) { toast('WRITE THE REASON FIRST'); Sound.play('error'); return; }
      if (window.confirm('Change this official decision? The earlier one stays on the record.')) decide(d, decision, 'DECISION CORRECTED', true);
    };
    return ecard(lbl('CORRECT THE DECISION'), box, h('div', { class: 'comm-ctrl-row' },
      d.status !== 'approved' ? pbtn('CHANGE TO APPROVED', go('approve')) : null, d.status !== 'rejected' ? pbtn('CHANGE TO REJECTED', go('reject')) : null, pbtn('ASK FOR CHANGES', go('revise'))));
  }

  function detail(body, d) {
    const back = pbtn('◂ BACK TO LIST', () => { openId = null; R.render(); });
    back.dataset.directiveBack = '';
    body.append(back, h('div', { class: 'comm-live', dataset: { directiveDetail: d.ref } },
      h('p', { class: 'comm-stage', text: `${d.ref} · VERSION ${d.version}` }), h('p', { class: 'comm-topic', text: d.title }),
      h('p', { class: 'comm-sub', text: `${d.authorName} · ${d.type} · sent ${fmtStamp(d.submittedAt)}` }),
      h('div', null, R.badge(d.status)),
      d.sponsors.length ? h('p', { class: 'comm-sub', text: `Sponsors: ${d.sponsors.join(', ')}` }) : null));
    FIELDS.forEach(([k, label]) => { if (d.fields[k]) body.append(esect(label), h('p', { class: 'crisis-text', text: d.fields[k] })); });
    if (d.status === 'revision') body.append(hint('Sent back to the delegate. This is the last version they submitted.'));
    if (['submitted', 'review', 'hold'].includes(d.status)) {
      if (d.status === 'submitted') body.append(pbtn('MARK AS BEING REVIEWED', () => decide(d, 'review')));
      body.append(esect('YOUR DECISION'), reviewForm(d));
    }
    if (['approved', 'completed', 'partial', 'failed'].includes(d.status)) body.append(esect('OUTCOME'), outcomeForm(d));
    if (d.outcomes.length) {
      body.append(esect('OUTCOMES ON RECORD'));
      d.outcomes.forEach((o) => body.append(R.row({}, h('span', { class: 'crisis-main' }, o.text, h('span', { class: 'crisis-sub', text: `${o.actor} · ${fmtStamp(o.time)} · ${o.shared ? 'told the delegate' : 'not shared'}` })), R.badge(o.result))));
    }
    if (d.decisions.length) {
      body.append(esect('DECISIONS ON RECORD'));
      d.decisions.forEach((e) => body.append(R.row({}, h('span', { class: 'crisis-main' }, `${e.actor}: ${e.decision}${e.correction ? ' (correction)' : ''} · version ${e.version}`,
        e.reason ? h('span', { class: 'crisis-sub', text: e.reason }) : null, e.note ? h('span', { class: 'crisis-sub', text: `Private: ${e.note}` }) : null,
        h('span', { class: 'crisis-sub', text: fmtStamp(e.time) })))));
    }
    if (versions.list.length > 1) {
      body.append(esect('EARLIER VERSIONS'));
      versions.list.slice(1).forEach((v) => {
        const node = h('details', { class: 'ed-fold' }, h('summary', null, h('span', { class: 'fold-title', text: `VERSION ${v.version}` }), h('span', { class: 'fold-sub', text: fmtStamp(v.submittedAt) })));
        node.append(h('div', { class: 'ed-card' }, FIELDS.map(([k, label]) => (v.fields[k] ? [lbl(label), h('p', { class: 'crisis-text', text: v.fields[k] })] : null))));
        body.append(node);
      });
    }
    if (['approved', 'rejected', 'completed', 'partial', 'failed'].includes(d.status)) body.append(esect('MADE A MISTAKE?'), correctForm(d));
  }

  R.views.directives = (body) => {
    const dirs = R.state.directives;
    const open = dirs.find((d) => d.id === openId);
    if (open) { detail(body, open); return; }
    openId = null;
    body.append(h('div', { class: 'comm-tabs' }, GROUPS.map(([id, label, statuses]) => h('button', {
      class: 'chip-btn' + (id === group ? ' active' : ''), type: 'button', 'aria-pressed': String(id === group), dataset: { directiveGroup: id },
      onclick: () => { group = id; R.render(); }
    }, `${label} (${dirs.filter((d) => statuses.includes(d.status)).length})`))));
    const statuses = GROUPS.find(([id]) => id === group)[2];
    const shown = dirs.filter((d) => statuses.includes(d.status));
    if (!shown.length) body.append(hint(dirs.length ? 'Nothing here right now.' : 'No directives yet. Delegates send them from the Committee page with their login code.'));
    shown.forEach((d) => body.append(R.row({ dataset: { directive: d.ref } },
      h('span', { class: 'crisis-ref', text: d.ref }),
      h('span', { class: 'crisis-main' }, h('b', { text: d.title }), h('span', { class: 'crisis-sub', text: `${d.authorName} · version ${d.version} · ${fmtStamp(d.submittedAt)}` })),
      R.badge(d.status),
      h('span', { class: 'comm-row-tools' }, h('button', { class: 'chip-btn', type: 'button', dataset: { directiveOpen: d.ref }, onclick: () => pickUp(d) }, 'OPEN ▸')))));
  };
})(window.FORMA = window.FORMA || {});
