// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAllByClass, findByClass, installDom } from './_dom-stub.js';
import { makeCaseRow } from './helpers/fixtures.js';

installDom();

const { summaryView } =
  await import('../src/pages/cora-case-review/summary-view.js');
const { resolveSectionLabels } = await import('../src/lib/section-labels.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return makeCaseRow({
    id: 'c1',
    caseType: 'example-review',
    title: 'Case one',
    assignedReviewer: 'reviewer@example.com',
    responsibleParty: 'owner@example.com',
    notes: 'Reviewer note',
    etag: 'e1',
    ...overrides,
  });
}

const CATALOGUE =
  /** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */ ([
    {
      id: 'q-open',
      text: 'Greeted?',
      questionGroup: 'Opening',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      deprecated: false,
    },
    {
      id: 'q-needs',
      text: 'Needs found?',
      questionGroup: 'Discovery',
      responseType: 'yes-no-na',
      failureValues: ['No'],
      remediationActions: ['Retrain.'],
      deprecated: false,
    },
  ]);

const OPTIONS = [
  { id: 'pass', wording: 'Pass', severity: 0 },
  { id: 'fail', wording: 'Fail', severity: 100 },
];

/** @param {Partial<Parameters<typeof summaryView>[0]>} [overrides] */
function render(overrides = {}) {
  return summaryView({
    computeOutcome: () => ({ outcome: 'pass' }),
    answers: {},
    allAnswered: true,
    caseRow: makeCase(),
    catalogue: CATALOGUE,
    summarySections: [],
    captureGroups: [],
    detailFields: [],
    outcomeOptions: OPTIONS,
    ...overrides,
  });
}

/** @param {Node[]} nodes */
function rootOf(nodes) {
  const root = document.createElement('div');
  root.append(...nodes);
  return root;
}

test('summaryView renders live outcome and key dates', () => {
  const nodes = render({
    computeOutcome: () => ({ outcome: 'fail' }),
    caseRow: makeCase({ created: '2026-04-01', completedAt: null }),
  });
  const root = rootOf(nodes);

  assert.equal(nodes[0].textContent, 'Summary');
  assert.match(root.textContent, /Fail/);
  assert.match(root.textContent, /Created2026-04-01/);
  assert.match(root.textContent, /Completed on—/);
});

test('summaryView uses frozen and amended outcomes after the reportable milestone', () => {
  const frozen = rootOf(
    render({
      computeOutcome: () => ({ outcome: 'pass' }),
      caseRow: makeCase({
        status: 'Actions In Progress',
        outcomeAtCompletion: 'fail',
      }),
    })
  );
  assert.match(frozen.textContent, /Fail/);
  assert.doesNotMatch(frozen.textContent, /previously/);

  const amended = rootOf(
    render({
      caseRow: makeCase({
        status: 'Completed',
        outcomeAtCompletion: 'fail',
        amendedOutcome: {
          outcome: 'pass',
          justification: 'Correction',
          amendedBy: 'controls@example.com',
          amendedAt: '2026-07-01T00:00:00Z',
        },
      }),
    })
  );
  assert.match(amended.textContent, /Pass \(previously Fail\)/);
});

test('summaryView shows no marker for an amendment with no frozen snapshot to displace', () => {
  // A Case Type with no outcome evaluator becomes reportable without a snapshot
  // being stamped, so an amendment there displaced nothing to name.
  const root = rootOf(
    render({
      caseRow: makeCase({
        status: 'Completed',
        amendedOutcome: {
          outcome: 'pass',
          justification: 'Correction',
          amendedBy: 'controls@example.com',
          amendedAt: '2026-07-01T00:00:00Z',
        },
      }),
    })
  );
  assert.match(root.textContent, /Pass/);
  assert.doesNotMatch(root.textContent, /previously/);
});

test('summaryView falls back to live outcome when no snapshot exists', () => {
  const root = rootOf(
    render({
      computeOutcome: () => ({ outcome: 'fail' }),
      caseRow: makeCase({ status: 'Completed' }),
    })
  );
  assert.match(root.textContent, /Fail/);
});

test('summaryView follows the configured showInSummary sections and headings', () => {
  const root = rootOf(
    render({
      caseRow: makeCase({
        title: 'Roll-up case',
        details: { customerName: 'Jordan Lee' },
      }),
      detailFields: [{ key: 'customerName', label: 'Customer name' }],
      summarySections: ['details', 'questions', 'notes'],
      answers: {
        'q-open': { value: 'No' },
        'q-needs': { value: 'Yes' },
      },
      sectionLabels: resolveSectionLabels({
        sectionLabels: {
          details: 'Overview',
          questions: 'Assessment',
          issues: 'Findings',
          remediation: 'Fix-up',
          summary: 'Wrap-up',
          notes: 'Case Notes',
        },
      }),
    })
  );

  assert.match(root.textContent, /Wrap-up/);
  assert.match(root.textContent, /Overview/);
  assert.match(root.textContent, /Customer nameJordan Lee/);
  assert.match(root.textContent, /Assessment/);
  assert.match(root.textContent, /Opening: 0 pass, 1 fail/);
  assert.match(root.textContent, /Case NotesReviewer note/);
  assert.equal(findByClass(root, 'cora-summary-remediation'), null);
});

test('summaryView renders failures, selected remediation and read-only capture', () => {
  const root = rootOf(
    render({
      summarySections: ['issues'],
      captureGroups: [
        {
          key: 'cause',
          label: 'Cause',
          fields: [{ key: 'rootCause', label: 'Root cause', type: 'text' }],
        },
      ],
      answers: {
        'q-open': {
          value: 'No',
          capture: { rootCause: 'Rushed' },
        },
        'q-needs': {
          value: 'No',
          remediationActions: [{ id: 'ra-1', text: 'Retrain.' }],
        },
      },
    })
  );

  assert.match(root.textContent, /Remediation Actions: 1/);
  assert.match(root.textContent, /Opening: Greeted?/);
  assert.match(root.textContent, /Answer: No/);
  assert.match(root.textContent, /Retrain\./);
  assert.match(root.textContent, /Root cause: Rushed/);
  assert.equal(findAllByClass(root, 'cora-summary-capture').length, 1);
  assert.equal(root.querySelector('cora-capture-groups'), null);
});

test('summaryView reports empty failures without adding capture UI', () => {
  const root = rootOf(
    render({
      summarySections: ['issues'],
      answers: { 'q-open': { value: 'Yes' } },
    })
  );
  assert.match(root.textContent, /No failures\./);
  assert.equal(findAllByClass(root, 'cora-summary-capture').length, 0);
});

test('summaryView renders an ungrouped failure without invented actions or capture', () => {
  const root = rootOf(
    render({
      catalogue: /** @type {any} */ ([
        {
          id: 'q-bare',
          text: 'Ungrouped question',
          responseType: 'yes-no-na',
          failureValues: ['No'],
          deprecated: false,
        },
      ]),
      summarySections: ['issues'],
      captureGroups: [
        {
          key: 'cause',
          label: 'Cause',
          fields: [{ key: 'rootCause', label: 'Root cause', type: 'text' }],
        },
      ],
      answers: { 'q-bare': { value: 'No', capture: {} } },
    })
  );
  assert.match(root.textContent, /Ungrouped question/);
  assert.doesNotMatch(root.textContent, /General: Ungrouped question/);
  assert.equal(findAllByClass(root, 'cora-summary-capture').length, 0);
});

test('summaryView renders the empty remediation tracking state', () => {
  const root = rootOf(
    render({
      summarySections: ['remediation'],
      answers: { 'q-open': { value: 'No' } },
    })
  );
  assert.match(root.textContent, /Remediation due: —/);
  assert.match(root.textContent, /No remediation actions sent\./);
});

test('summaryView renders an ungrouped remediation row', () => {
  const root = rootOf(
    render({
      catalogue: /** @type {any} */ ([
        {
          id: 'q-bare',
          text: 'Ungrouped tracking',
          responseType: 'yes-no-na',
          failureValues: ['No'],
          deprecated: false,
        },
      ]),
      summarySections: ['remediation'],
      answers: {
        'q-bare': {
          value: 'No',
          remediationActions: [{ id: 'a1', text: 'Close loop' }],
          remediationStatus: { status: 'partial', details: 'Half done' },
        },
      },
    })
  );
  assert.match(root.textContent, /Ungrouped tracking/);
  assert.match(root.textContent, /Close loop/);
  assert.match(root.textContent, /Status: Partially complete/);
});

test('summaryView ignores sections without a summary block and works without a row', () => {
  const withUnknownSection = render({
    summarySections: /** @type {any} */ (['conversation']),
  });
  assert.equal(withUnknownSection.length, 3);

  const withoutRow = render({
    caseRow: null,
    summarySections: /** @type {any} */ (['conversation']),
  });
  assert.equal(withoutRow.length, 2);
  assert.equal(findByClass(rootOf(withoutRow), 'cora-summary-key-dates'), null);
});

// --- General Questions on the Summary -------------------------------
// A read-only roll-up of what the Reviewer wrote in the Review tab's General
// Questions. Display only: nothing here reaches summary-model, computeOutcome
// or completion gating — the assertions below pin that.

/** @type {import('../src/sharepoint-client.js').GeneralQuestionField[]} */
const GENERAL_QUESTIONS = [
  {
    key: 'reviewChannel',
    label: 'How was this reviewed?',
    type: 'select',
    options: ['Case file only', 'Call recording'],
  },
  { key: 'observations', label: 'Observations', type: 'textarea' },
];

test('summaryView rolls up answered General Questions, in configured order', () => {
  const root = rootOf(
    render({
      generalQuestions: GENERAL_QUESTIONS,
      answers: {
        'general:observations': { value: 'Handled well' },
        'general:reviewChannel': { value: 'Call recording' },
      },
    })
  );

  const block = findByClass(root, 'cora-summary-general-questions');
  assert.ok(block, 'the Summary carries a General Questions block');
  assert.match(block.textContent, /General Questions/);
  assert.equal(
    block.textContent,
    'General QuestionsHow was this reviewed?Call recordingObservationsHandled well'
  );
  // Read-only, like every other Summary block.
  assert.equal(block.querySelectorAll('input').length, 0);
  assert.equal(block.querySelectorAll('select').length, 0);
  assert.equal(block.querySelectorAll('textarea').length, 0);
});

test('summaryView omits unanswered General Questions, and the block when none is answered', () => {
  const partial = rootOf(
    render({
      generalQuestions: GENERAL_QUESTIONS,
      answers: { 'general:observations': { value: 'Handled well' } },
    })
  );
  assert.equal(
    findByClass(partial, 'cora-summary-general-questions').textContent,
    'General QuestionsObservationsHandled well'
  );

  const none = rootOf(render({ generalQuestions: GENERAL_QUESTIONS }));
  assert.equal(findByClass(none, 'cora-summary-general-questions'), null);

  const blank = rootOf(
    render({
      generalQuestions: GENERAL_QUESTIONS,
      answers: { 'general:observations': { value: '' } },
    })
  );
  assert.equal(findByClass(blank, 'cora-summary-general-questions'), null);
});

test('a non-string General Question value is not rolled up', () => {
  // Every General Question type — text, textarea, select, radio — writes a
  // string, so the roll-up states that contract rather than second-guessing it:
  // an array-valued `general:` answer (only reachable by hand-editing the blob)
  // is treated as unanswered, exactly as any other non-string value is.
  const root = rootOf(
    render({
      generalQuestions: GENERAL_QUESTIONS,
      answers: {
        'general:reviewChannel': /** @type {any} */ ({
          value: ['Call recording', 'Case file only'],
        }),
        'general:observations': { value: 'Handled well' },
      },
    })
  );
  const block = findByClass(root, 'cora-summary-general-questions');
  assert.equal(block.textContent, 'General QuestionsObservationsHandled well');
});

test('an answer whose General Question the Case Type no longer declares is not rolled up', () => {
  // The roll-up is catalogue-driven: it walks the *configured* fields, so an
  // orphaned `general:` answer (its field removed from the Case Type after the
  // Reviewer answered) stays in the blob but shows nowhere. Documented in
  // CONTEXT.md so "where did my answer go?" is a one-line answer, not archaeology.
  const root = rootOf(
    render({
      generalQuestions: GENERAL_QUESTIONS,
      answers: {
        'general:observations': { value: 'Handled well' },
        'general:retiredQuestion': { value: 'Answered before it was removed' },
      },
    })
  );
  const block = findByClass(root, 'cora-summary-general-questions');
  assert.equal(block.textContent, 'General QuestionsObservationsHandled well');
});

test('a Case Type declaring no General Questions gets no Summary block', () => {
  assert.equal(
    findByClass(rootOf(render({})), 'cora-summary-general-questions'),
    null
  );
});

test('the Summary block follows the Case Type placement, like the Review tab', () => {
  /** @param {'before'|'after'} [placement] */
  const classNames = (placement) =>
    render({
      generalQuestions: GENERAL_QUESTIONS,
      generalQuestionsPlacement: placement,
      summarySections: ['notes'],
      answers: { 'general:observations': { value: 'Handled well' } },
    })
      .slice(2) // past the Summary heading and the Outcome host
      .map((/** @type {any} */ node) => node.className);

  assert.deepEqual(classNames('before'), [
    'cora-summary-key-dates',
    'cora-summary-general-questions',
    'cora-summary-notes',
  ]);
  assert.deepEqual(classNames('after'), [
    'cora-summary-key-dates',
    'cora-summary-notes',
    'cora-summary-general-questions',
  ]);
  // Absent placement matches the Review tab's default.
  assert.deepEqual(classNames(), classNames('after'));
});

test('a General Question answer does not reach the Summary counts or the Outcome', () => {
  /** @param {Record<string, any>} answers */
  const summaryOf = (answers) =>
    rootOf(
      render({
        generalQuestions: GENERAL_QUESTIONS,
        summarySections: ['questions', 'issues'],
        answers,
        computeOutcome: (
          /** @type {Record<string, any>} */ candidateAnswers
        ) => ({
          outcome: Object.values(candidateAnswers).some(
            (answer) => answer.value === 'No'
          )
            ? 'fail'
            : 'pass',
        }),
      })
    );

  const base = { 'q-open': { value: 'Yes' } };
  const withGeneral = { ...base, 'general:observations': { value: 'No' } };
  assert.equal(
    findByClass(summaryOf(withGeneral), 'cora-summary-counts').textContent,
    findByClass(summaryOf(base), 'cora-summary-counts').textContent
  );
  assert.equal(
    findAllByClass(summaryOf(withGeneral), 'cora-summary-remediation')[0]
      .textContent,
    findAllByClass(summaryOf(base), 'cora-summary-remediation')[0].textContent
  );
});

test('the Summary remediation block reads the same model as the Remediation tab', () => {
  const root = rootOf(
    render({
      caseRow: makeCase({
        status: 'Actions In Progress',
        remediationDueDate: '2026-07-16',
      }),
      summarySections: ['remediation'],
      answers: {
        'q-open': {
          value: 'No',
          remediationActions: [{ id: 'ra-1', text: 'Re-issue letter' }],
          remediationStatus: { status: 'complete' },
        },
        'q-needs': {
          value: 'No',
          freeFormRemediation: 'Call the customer back',
        },
      },
    })
  );

  assert.match(root.textContent, /Remediation due: 2026-07-16/);
  assert.doesNotMatch(root.textContent, /No remediation actions sent\./);
  // Both kinds of remediation the Reviewer can attach, with the Remediation
  // tab's own resolution wording.
  assert.match(root.textContent, /Opening: Greeted\?/);
  assert.match(root.textContent, /Re-issue letter/);
  assert.match(root.textContent, /Status: Complete/);
  assert.match(root.textContent, /Call the customer back/);
  assert.match(root.textContent, /Status: Awaiting the Reviewer/);
});

/** @param {Partial<Parameters<typeof summaryView>[0]>} [overrides] */
function cancelledRemediation(overrides = {}) {
  return rootOf(
    render({
      caseRow: makeCase({ status: 'Actions In Progress' }),
      summarySections: ['remediation'],
      answers: {
        'q-open': {
          value: 'No',
          freeFormRemediation: 'Call back',
          remediationStatus: {
            status: 'cancelled',
            details: 'Customer declined contact',
          },
        },
      },
      ...overrides,
    })
  );
}

test('the Summary remediation block never leaks the Reviewer-only details text to the responsible-party audience', () => {
  const root = cancelledRemediation({ audience: 'responsibleParty' });
  assert.match(root.textContent, /Status: Cancelled/);
  assert.doesNotMatch(root.textContent, /Customer declined contact/);
});

test('the Summary withholds the resolution details when the caller names no audience', () => {
  // Fail closed: a caller that does not say who is reading gets the narrower of
  // the two renderings.
  const root = cancelledRemediation();
  assert.doesNotMatch(root.textContent, /Customer declined contact/);
});

test('the Summary shows the resolution details to reviewer-side audiences, as the tab does', () => {
  // The resolution model withholds the Reviewer's details/justification from the
  // `responsibleParty` audience *only*; the Remediation tab's own `!canResolve`
  // branch shows them to every reviewer-side observer. Withholding them from
  // Controls and the Case Type Owner as well cost them the `cancelReason` the
  // Summary used to carry, which is a narrowing nothing asks for.
  const root = cancelledRemediation({ audience: 'reviewer' });
  assert.match(root.textContent, /Status: Cancelled/);
  assert.match(root.textContent, /Justification: Customer declined contact/);
});
