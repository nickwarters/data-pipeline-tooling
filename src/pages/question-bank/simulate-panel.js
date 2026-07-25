// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState } from '../../lib/empty-state.js';
import { simulateBankImpact } from './question-bank-simulate.js';

/**
 * Read-only impact simulation of the draft bank against sample Cases (issue
 * #202): applicability changes, newly required Answers, Issue changes, and
 * Outcome changes, each attributed to the Question Definitions that caused
 * them. Simulation never mutates Cases or publishes the bank.
 *
 * Lives with the bank editor subsystem (not the generic compile drawer
 * component) because it assembles the simulate module against the editor's
 * banks; the drawer receives the rendered panel via its `simulatePanel` prop
 * (issue #382).
 *
 * @param {import('./question-bank-source.js').QuestionBank} publishedBank
 * @param {import('./question-bank-source.js').QuestionBank} draftBank
 * @param {import('./question-bank-simulate.js').SampleCase[]} samples
 * @returns {HTMLElement}
 */
export function SimulatePanel(publishedBank, draftBank, samples) {
  const head = h('h4', {}, 'Impact simulation');
  if (!samples.length) {
    return h(
      'section',
      { className: 'sim-panel' },
      head,
      EmptyState(
        'No sample Cases loaded yet — impact simulation unavailable.',
        {
          className: 'sim-empty',
        }
      )
    );
  }

  const result = simulateBankImpact(publishedBank, draftBank, samples);
  const t = result.totals;
  const summary = h(
    'p',
    { className: 'sim-summary' },
    `${t.casesChanged} of ${samples.length} sample Cases affected · ` +
      `${t.newlyRequired} newly required Answers · ` +
      `${t.issuesAdded} Issues added · ${t.issuesRemoved} Issues removed · ` +
      `${t.outcomesChanged} Outcome changes`
  );

  const rows = result.cases
    .filter((c) => c.changed)
    .map((c) =>
      h(
        'li',
        { className: 'sim-case' },
        h('strong', {}, c.title),
        h('ul', {}, ...caseImpactLines(c).map((line) => h('li', {}, line)))
      )
    );

  return h(
    'section',
    { className: 'sim-panel' },
    head,
    summary,
    rows.length
      ? h('ul', { className: 'sim-cases' }, ...rows)
      : EmptyState('No sample Case is affected.', { className: 'sim-empty' })
  );
}

/**
 * @param {import('./question-bank-simulate.js').CaseImpact} c
 * @returns {string[]}
 */
function caseImpactLines(c) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} label @param {import('./question-bank-simulate.js').AttributedChange[]} changes */
  const push = (label, changes) => {
    for (const change of changes) {
      const cause = change.causedBy.length
        ? ` (caused by ${change.causedBy.join(', ')})`
        : '';
      lines.push(`${label}: ${change.id}${cause}`);
    }
  };
  push('Now applicable', c.applicabilityGained);
  push('No longer applicable', c.applicabilityLost);
  push('Newly required Answer', c.newlyRequired);
  push('New Issue', c.issuesAdded);
  push('Issue removed', c.issuesRemoved);
  if (c.outcome.changed) {
    const cause = c.outcome.causedBy.length
      ? ` (caused by ${c.outcome.causedBy.join(', ')})`
      : '';
    lines.push(
      `Outcome: ${c.outcome.before ?? '—'} → ${c.outcome.after ?? '—'}${cause}`
    );
  }
  return lines;
}
