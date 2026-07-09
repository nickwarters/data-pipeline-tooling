// @ts-check
import { defineView } from '../../lib/view.js';
import { h, unsafeHTML } from '../../lib/html.js';
import {
  baseline,
  baselineBank,
  cases,
  currentBank,
  diffCounts,
  drawerOpen,
  sampleCases,
  showToast,
} from '../../question-bank/question-bank-store.js';
import {
  compileBank,
  hashStr,
  highlight,
} from '../../question-bank/question-bank-compile.js';
import { simulateBankImpact } from '../../question-bank/question-bank-simulate.js';
import { simulatorEnabled } from '../../question-bank/question-bank-flags.js';

/**
 * Slide-out drawer showing the compiled current Question Bank JSON. Reads the shared
 * question-bank signals (`drawerOpen`, `currentBank`, `diffCounts`), so it
 * re-renders whenever they change.
 *
 * @returns {HTMLElement[]}
 */
export function CompileDrawer() {
  const open = drawerOpen.get();
  const bank = currentBank.get();
  const code = compileBank(bank);
  const d = diffCounts.get();

  const hashMeta = h('small', {}, 'hash: …');
  hashStr(code)
    .then((hash) => {
      hashMeta.textContent = `sha256:${hash} · ${code.length} chars · ${code.split('\n').length} lines`;
    })
    .catch(() => {
      hashMeta.textContent = 'hash: unavailable';
    });

  return [
    h('div', {
      class: 'drawer-backdrop' + (open ? ' open' : ''),
      onclick: () => drawerOpen.set(false),
    }),
    h(
      'aside',
      { class: 'drawer' + (open ? ' open' : '') },
      h(
        'div',
        { class: 'drawer-head' },
        h(
          'div',
          {},
          h('h3', {}, 'Compiled ', h('em', {}, 'bank'), '.'),
          h(
            'p',
            {},
            'Ready for review. This is the exact JSON artifact that will be PR’d into ',
            h(
              'code',
              { className: 'code-inline' },
              'case-types/banks/{slug}.txt'
            ),
            '.'
          )
        ),
        h(
          'button',
          { class: 'drawer-close', onclick: () => drawerOpen.set(false) },
          '×'
        )
      ),
      h(
        'div',
        { class: 'drawer-body' },
        h(
          'div',
          { class: 'diff-summary' },
          diffCard('diff-card added', String(d.added), 'Added'),
          diffCard('diff-card changed', String(d.changed), 'Changed'),
          diffCard('diff-card removed', String(d.deprecated), 'Deprecated')
        ),
        simulatorEnabled()
          ? SimulatePanel(
              baselineBank.get(),
              bank,
              sampleCases.get()[bank.slug] ?? []
            )
          : null,
        h('div', { class: 'code-block' }, unsafeHTML(highlight(code)))
      ),
      h(
        'div',
        { class: 'drawer-foot' },
        hashMeta,
        h(
          'div',
          { class: 'drawer-foot-actions' },
          h(
            'button',
            {
              class: 'pill-btn',
              onclick: async () => {
                const clip = /** @type {any} */ (globalThis).navigator
                  ?.clipboard;
                if (clip?.writeText) await clip.writeText(code);
                showToast('Bank JSON copied to clipboard');
              },
            },
            'Copy'
          ),
          h(
            'button',
            {
              class: 'pill-btn primary',
              onclick: () => {
                baseline.set(structuredClone(cases.get()));
                drawerOpen.set(false);
                showToast('Submitted for review');
              },
            },
            'Send for Review'
          )
        )
      )
    ),
  ];
}

export const CORACompileDrawer = defineView('cora-compile-drawer', {
  render() {
    return CompileDrawer();
  },
});

/**
 * Read-only impact simulation of the draft bank against sample Cases (issue
 * #202): applicability changes, newly required Answers, Issue changes, and
 * Outcome changes, each attributed to the Question Definitions that caused
 * them. Simulation never mutates Cases or publishes the bank.
 *
 * @param {import('../../question-bank/question-bank-source.js').QuestionBank} publishedBank
 * @param {import('../../question-bank/question-bank-source.js').QuestionBank} draftBank
 * @param {import('../../question-bank/question-bank-simulate.js').SampleCase[]} samples
 * @returns {HTMLElement}
 */
export function SimulatePanel(publishedBank, draftBank, samples) {
  const head = h('h4', {}, 'Impact simulation');
  if (!samples.length) {
    return h(
      'section',
      { class: 'sim-panel' },
      head,
      h(
        'p',
        { class: 'sim-empty' },
        'No sample Cases loaded yet — impact simulation unavailable.'
      )
    );
  }

  const result = simulateBankImpact(publishedBank, draftBank, samples);
  const t = result.totals;
  const summary = h(
    'p',
    { class: 'sim-summary' },
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
        { class: 'sim-case' },
        h('strong', {}, c.title),
        h('ul', {}, ...caseImpactLines(c).map((line) => h('li', {}, line)))
      )
    );

  return h(
    'section',
    { class: 'sim-panel' },
    head,
    summary,
    rows.length
      ? h('ul', { class: 'sim-cases' }, ...rows)
      : h('p', { class: 'sim-empty' }, 'No sample Case is affected.')
  );
}

/**
 * @param {import('../../question-bank/question-bank-simulate.js').CaseImpact} c
 * @returns {string[]}
 */
function caseImpactLines(c) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} label @param {import('../../question-bank/question-bank-simulate.js').AttributedChange[]} changes */
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

/**
 * @param {string} className
 * @param {string} count
 * @param {string} label
 */
function diffCard(className, count, label) {
  return h(
    'div',
    { class: className },
    h('div', { className: 'n' }, count),
    h('div', { className: 'l' }, label)
  );
}
