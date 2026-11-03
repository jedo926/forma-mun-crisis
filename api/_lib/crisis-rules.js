/**
 * Crisis Room rules: the procedure this committee uses, and the sums that depend on it.
 * No storage here, so every rule can be tested directly.
 *
 * These defaults are only a starting point. Chairs change them in the Settings tab.
 */

const DEFAULT_RULES = {
  quorumPercent: 50,
  submission: 'always',       // when delegates may submit: 'always' | 'unmoderated' | 'closed'
  thresholds: [
    // Passes when "for" reaches num/den of the base. strict means it must go over, not just reach it.
    { id: 'simple', label: 'Simple majority', num: 1, den: 2, base: 'voting', strict: true },
    { id: 'two-thirds', label: 'Two-thirds', num: 2, den: 3, base: 'voting', strict: false }
  ],
  motionTypes: [
    { id: 'moderated', label: 'Moderated caucus', kind: 'moderated', needsVote: true, threshold: 'simple' },
    { id: 'unmoderated', label: 'Unmoderated caucus', kind: 'unmoderated', needsVote: true, threshold: 'simple' },
    { id: 'extension', label: 'Extend the caucus', kind: 'extension', needsVote: true, threshold: 'simple' },
    { id: 'suspension', label: 'Suspend the session', kind: 'other', needsVote: true, threshold: 'simple' },
    { id: 'adjournment', label: 'Adjourn', kind: 'other', needsVote: true, threshold: 'two-thirds' }
  ]
};

const KINDS = ['moderated', 'unmoderated', 'extension', 'other'];
const BASES = ['voting', 'eligible'];
const SUBMISSION = ['always', 'unmoderated', 'closed'];
const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/** Cleans a rules form. Returns { rules } or { problems: [plain sentences] }; nothing is guessed. */
function checkRules(input) {
  const problems = [];
  const thresholds = (Array.isArray(input && input.thresholds) ? input.thresholds : []).map((t) => ({
    id: slug(t.id || t.label), label: text(t.label, 60), num: parseInt(t.num), den: parseInt(t.den),
    base: BASES.includes(t.base) ? t.base : 'voting', strict: !!t.strict
  }));
  if (!thresholds.length) problems.push('Add at least one voting threshold.');
  thresholds.forEach((t) => {
    if (!t.id || !t.label) problems.push('Every threshold needs a name.');
    if (!(t.num > 0 && t.den > 0 && t.num <= t.den)) problems.push(`${t.label || 'A threshold'} needs a fraction of at most 1, such as 2 of 3.`);
  });
  const motionTypes = (Array.isArray(input && input.motionTypes) ? input.motionTypes : []).map((m) => ({
    id: slug(m.id || m.label), label: text(m.label, 60), kind: KINDS.includes(m.kind) ? m.kind : 'other',
    needsVote: !!m.needsVote, threshold: slug(m.threshold)
  }));
  if (!motionTypes.length) problems.push('Add at least one motion type.');
  motionTypes.forEach((m) => {
    if (!m.id || !m.label) problems.push('Every motion type needs a name.');
    if (m.needsVote && !thresholds.some((t) => t.id === m.threshold)) problems.push(`${m.label || 'A motion'} needs a voting threshold.`);
  });
  if (new Set(motionTypes.map((m) => m.id)).size !== motionTypes.length) problems.push('Two motion types have the same name.');
  if (new Set(thresholds.map((t) => t.id)).size !== thresholds.length) problems.push('Two thresholds have the same name.');
  const quorumPercent = parseInt(input && input.quorumPercent);
  if (!(quorumPercent >= 0 && quorumPercent <= 100)) problems.push('Quorum must be between 0 and 100 percent.');
  const submission = SUBMISSION.includes(input && input.submission) ? input.submission : null;
  if (!submission) problems.push('Choose when delegates may submit directives.');
  if (problems.length) return { problems: [...new Set(problems)] };
  return { rules: { quorumPercent, submission, thresholds, motionTypes } };
}

/** How many must be present: rounded up, so 50% of 5 is 3. */
const quorumNeeded = (total, percent) => Math.ceil((total * percent) / 100);

/** The fixed tallies for a vote, or a problem. Counts can't exceed the voters frozen when it opened. */
function checkTally(tally, eligibleCount) {
  const count = (k) => parseInt(tally && tally[k]);
  const yes = count('for'), no = count('against'), abstain = count('abstain');
  if (![yes, no, abstain].every((n) => Number.isInteger(n) && n >= 0)) return { problem: 'bad_tally' };
  if (yes + no + abstain > eligibleCount) return { problem: 'too_many_votes' };
  return { tally: { for: yes, against: no, abstain, missing: eligibleCount - yes - no - abstain } };
}

/** The result under one threshold. Whole-number sums, so 2 of 3 is never lost to rounding. */
function decide(threshold, tally, eligibleCount) {
  const base = threshold.base === 'eligible' ? eligibleCount : tally.for + tally.against;
  if (base <= 0) return false;
  const left = tally.for * threshold.den, right = base * threshold.num;
  return threshold.strict ? left > right : left >= right;
}

/** What a chair may do to a directive in each status. Corrections go through their own check. */
const DIRECTIVE_MOVES = {
  submitted: ['review', 'approve', 'reject', 'revise', 'hold'],
  review: ['approve', 'reject', 'revise', 'hold'],
  hold: ['review', 'approve', 'reject', 'revise']
};
const DECISION_STATUS = { review: 'review', approve: 'approved', reject: 'rejected', revise: 'revision', hold: 'hold' };
const NEEDS_REASON = ['reject', 'revise', 'hold'];
const CORRECTABLE = ['approved', 'rejected', 'completed', 'partial', 'failed'];
const OUTCOMES = ['completed', 'partial', 'failed'];

const canDecide = (status, decision) => (DIRECTIVE_MOVES[status] || []).includes(decision);

module.exports = { DEFAULT_RULES, checkRules, quorumNeeded, checkTally, decide, canDecide, DECISION_STATUS, NEEDS_REASON, CORRECTABLE, OUTCOMES, slug };
