// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  diffBanks,
  simulateBankImpact,
} from '../src/pages/question-bank/question-bank-simulate.js';

/**
 * Baseline bank used across the scenarios: q-a gates q-b via showWhen; q-a
 * maps 'No' to the 'fail' Outcome, so 'No' is its derived failure value.
 *
 * @returns {any}
 */
function baselineBank() {
  return {
    label: 'Example',
    slug: 'example-review',
    outcomeOptions: [
      { id: 'pass', wording: 'Pass', severity: 0 },
      { id: 'fail', wording: 'Fail', severity: 100 },
    ],
    defaultOutcomeId: 'pass',
    questions: [
      {
        id: 'q-a',
        text: 'Was the customer greeted?',
        responseType: 'yes-no-na',
        optionOutcomes: { No: 'fail' },
        deprecated: false,
      },
      {
        id: 'q-b',
        text: 'Was the greeting scripted?',
        responseType: 'yes-no-na',
        showWhen: { 'q-a': { equals: 'Yes' } },
        deprecated: false,
      },
    ],
  };
}

/** @param {any} bank @param {(b: any) => void} mutate */
function draftFrom(bank, mutate) {
  const draft = structuredClone(bank);
  mutate(draft);
  return draft;
}

/** @param {Record<string, any>} answers */
function sampleCase(answers, id = 'case-1', title = 'Case 1') {
  return { id, title, answers };
}

// ── diffBanks ───────────────────────────────────────────────────────────────

test('diffBanks: no changes yields empty diff', () => {
  const base = baselineBank();
  const d = diffBanks(base, structuredClone(base));
  assert.deepEqual(d, {
    added: [],
    removed: [],
    changed: [],
    outcomeConfigChanged: false,
  });
});

test('diffBanks: reports added and removed (missing) questions', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions = b.questions.filter((/** @type {any} */ q) => q.id !== 'q-b');
    b.questions.push({
      id: 'q-new',
      text: 'New question?',
      responseType: 'yes-no-na',
      deprecated: false,
    });
  });
  const d = diffBanks(base, draft);
  assert.deepEqual(d.added, ['q-new']);
  assert.deepEqual(d.removed, ['q-b']);
  assert.deepEqual(d.changed, []);
});

test('diffBanks: newly deprecated counts as removed, un-deprecated as added', () => {
  const base = baselineBank();
  base.questions[1].deprecated = true;
  const draft = draftFrom(base, (b) => {
    b.questions[0].deprecated = true;
    b.questions[1].deprecated = false;
  });
  const d = diffBanks(base, draft);
  assert.deepEqual(d.added, ['q-b']);
  assert.deepEqual(d.removed, ['q-a']);
});

test('diffBanks: lists changed field names on modified questions', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions[0].optionOutcomes = { Yes: 'fail' };
    b.questions[0].text = 'Was the customer greeted warmly?';
  });
  const d = diffBanks(base, draft);
  assert.deepEqual(d.changed, [
    { id: 'q-a', fields: ['text', 'optionOutcomes', 'failureValues'] },
  ]);
});

test('diffBanks: flags outcome configuration changes', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.defaultOutcomeId = 'fail';
  });
  assert.equal(diffBanks(base, draft).outcomeConfigChanged, true);
});

test('diffBanks: outcome-type questions compare derived options', () => {
  const base = baselineBank();
  base.questions.push({
    id: 'q-outcome',
    text: 'Overall outcome?',
    responseType: 'outcome',
    deprecated: false,
  });
  const draft = draftFrom(base, (b) => {
    b.outcomeOptions.push({ id: 'refer', wording: 'Refer', severity: 50 });
  });
  const d = diffBanks(base, draft);
  assert.equal(d.outcomeConfigChanged, true);
  assert.deepEqual(d.changed, [
    { id: 'q-outcome', fields: ['options', 'optionOutcomes', 'failureValues'] },
  ]);
});

// ── simulateBankImpact ──────────────────────────────────────────────────────

test('simulate: identical banks report no impact', () => {
  const base = baselineBank();
  const result = simulateBankImpact(base, structuredClone(base), [
    sampleCase({ 'q-a': { value: 'Yes' }, 'q-b': { value: 'No' } }),
  ]);
  assert.equal(result.cases[0].changed, false);
  assert.deepEqual(result.totals, {
    casesChanged: 0,
    applicabilityGained: 0,
    applicabilityLost: 0,
    newlyRequired: 0,
    issuesAdded: 0,
    issuesRemoved: 0,
    outcomesChanged: 0,
  });
});

test('simulate: fixture result remains byte-for-byte golden', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (bank) => {
    bank.questions[0].optionOutcomes = { Yes: 'fail' };
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'Yes' } }, 'case-1', 'Case 1'),
  ]);

  assert.equal(
    JSON.stringify(result),
    JSON.stringify({
      diff: {
        added: [],
        removed: [],
        changed: [
          {
            id: 'q-a',
            fields: ['optionOutcomes', 'failureValues'],
          },
        ],
        outcomeConfigChanged: false,
      },
      cases: [
        {
          caseId: 'case-1',
          title: 'Case 1',
          applicabilityGained: [],
          applicabilityLost: [],
          newlyRequired: [],
          issuesAdded: [{ id: 'q-a', causedBy: ['q-a'] }],
          issuesRemoved: [],
          outcome: {
            before: 'pass',
            after: 'fail',
            changed: true,
            causedBy: ['q-a'],
          },
          changed: true,
        },
      ],
      totals: {
        casesChanged: 1,
        applicabilityGained: 0,
        applicabilityLost: 0,
        newlyRequired: 0,
        issuesAdded: 1,
        issuesRemoved: 0,
        outcomesChanged: 1,
      },
    })
  );
});

test('simulate: added question reports gained applicability + newly required Answer, caused by itself', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions.push({
      id: 'q-new',
      text: 'Was ID verified?',
      responseType: 'yes-no-na',
      deprecated: false,
    });
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'Yes' }, 'q-b': { value: 'Yes' } }),
  ]);
  const c = result.cases[0];
  assert.equal(c.changed, true);
  assert.deepEqual(c.applicabilityGained, [
    { id: 'q-new', causedBy: ['q-new'] },
  ]);
  assert.deepEqual(c.newlyRequired, [{ id: 'q-new', causedBy: ['q-new'] }]);
  assert.equal(result.totals.casesChanged, 1);
  assert.equal(result.totals.applicabilityGained, 1);
  assert.equal(result.totals.newlyRequired, 1);
});

test('simulate: an already-answered gained question is not newly required', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    delete b.questions[1].showWhen;
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'No' }, 'q-b': { value: 'Yes' } }),
  ]);
  const c = result.cases[0];
  assert.deepEqual(c.applicabilityGained, [{ id: 'q-b', causedBy: ['q-b'] }]);
  assert.deepEqual(c.newlyRequired, []);
});

test('simulate: empty multi-choice Answer counts as unanswered for newly required', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions.push({
      id: 'q-multi',
      text: 'Products discussed?',
      responseType: 'multi-choice',
      options: ['A', 'B'],
      deprecated: false,
    });
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'Yes' }, 'q-multi': { value: [] } }),
  ]);
  assert.deepEqual(result.cases[0].newlyRequired, [
    { id: 'q-multi', causedBy: ['q-multi'] },
  ]);
});

test('simulate: changed showWhen path reports lost applicability caused by the changed question', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions[1].showWhen = { 'q-a': { equals: 'No' } };
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'Yes' }, 'q-b': { value: 'Yes' } }),
  ]);
  const c = result.cases[0];
  assert.deepEqual(c.applicabilityLost, [{ id: 'q-b', causedBy: ['q-b'] }]);
  assert.equal(result.totals.applicabilityLost, 1);
});

test('simulate: downstream applicability changes attribute the upstream changed question', () => {
  const base = baselineBank();
  base.questions.push({
    id: 'q-c',
    text: 'Downstream?',
    responseType: 'yes-no-na',
    showWhen: { 'q-b': { answered: true } },
    deprecated: false,
  });
  const draft = draftFrom(base, (b) => {
    b.questions[1].showWhen = { 'q-a': { equals: 'No' } };
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'Yes' }, 'q-b': { value: 'Yes' } }),
  ]);
  const lostIds = result.cases[0].applicabilityLost.map((e) => e.id);
  assert.deepEqual(lostIds, ['q-b', 'q-c']);
  const qc = result.cases[0].applicabilityLost.find((e) => e.id === 'q-c');
  assert.deepEqual(qc?.causedBy, ['q-b']);
});

test('simulate: changed outcome mapping reports added and removed Issues', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions[0].optionOutcomes = { Yes: 'fail' };
  });
  const failing = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'No' } }, 'case-no'),
    sampleCase({ 'q-a': { value: 'Yes' } }, 'case-yes'),
    sampleCase({ 'q-a': { value: 'NA' } }, 'case-na'),
  ]);
  assert.deepEqual(failing.cases[0].issuesRemoved, [
    { id: 'q-a', causedBy: ['q-a'] },
  ]);
  assert.deepEqual(failing.cases[1].issuesAdded, [
    { id: 'q-a', causedBy: ['q-a'] },
  ]);
  // N/A is never an Issue under either bank.
  assert.deepEqual(failing.cases[2].issuesAdded, []);
  assert.deepEqual(failing.cases[2].issuesRemoved, []);
  assert.equal(failing.totals.issuesAdded, 1);
  assert.equal(failing.totals.issuesRemoved, 1);
});

test('simulate: multi-choice failure value matches any selected value', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions.push({
      id: 'q-multi',
      text: 'Concerns?',
      responseType: 'multi-choice',
      options: ['None', 'Vulnerability'],
      optionOutcomes: { Vulnerability: 'fail' },
      deprecated: false,
    });
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-multi': { value: ['Vulnerability', 'None'] } }),
  ]);
  assert.deepEqual(result.cases[0].issuesAdded, [
    { id: 'q-multi', causedBy: ['q-multi'] },
  ]);
});

test('simulate: changed optionOutcomes reports changed Outcome with attribution', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions[0].optionOutcomes = {};
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'No' } }),
  ]);
  const c = result.cases[0];
  assert.deepEqual(c.outcome, {
    before: 'fail',
    after: 'pass',
    changed: true,
    causedBy: ['q-a'],
  });
  assert.equal(result.totals.outcomesChanged, 1);
});

test('simulate: lost applicability prunes the Answer from Outcome computation', () => {
  const base = baselineBank();
  base.questions[1].optionOutcomes = { No: 'fail' };
  const draft = draftFrom(base, (b) => {
    b.questions[1].showWhen = { 'q-a': { equals: 'No' } };
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'Yes' }, 'q-b': { value: 'No' } }),
  ]);
  assert.deepEqual(result.cases[0].outcome, {
    before: 'fail',
    after: 'pass',
    changed: true,
    causedBy: ['q-b'],
  });
});

test('simulate: banks without outcome configuration report null Outcomes', () => {
  const base = baselineBank();
  delete base.outcomeOptions;
  delete base.defaultOutcomeId;
  const draft = structuredClone(base);
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'No' } }),
  ]);
  assert.deepEqual(result.cases[0].outcome, {
    before: null,
    after: null,
    changed: false,
    causedBy: [],
  });
});

test('simulate: invalid outcome configuration degrades to null instead of throwing', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.defaultOutcomeId = 'missing-id';
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'Yes' } }),
  ]);
  assert.equal(result.cases[0].outcome.before, 'pass');
  assert.equal(result.cases[0].outcome.after, null);
  assert.equal(result.cases[0].outcome.changed, true);
});

test('simulate: deprecated questions are excluded from the draft catalogue', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions[0].deprecated = true;
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'No' } }),
  ]);
  const c = result.cases[0];
  // q-b was never applicable (q-a answered 'No'), so only q-a is lost.
  assert.deepEqual(
    c.applicabilityLost.map((e) => e.id),
    ['q-a']
  );
  assert.deepEqual(c.issuesRemoved, [{ id: 'q-a', causedBy: ['q-a'] }]);
  assert.equal(c.outcome.changed, true);
});

test('simulate: sample Cases without answers simulate against an empty Answer set', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions.push({
      id: 'q-new',
      text: 'New?',
      responseType: 'yes-no-na',
      deprecated: false,
    });
  });
  const result = simulateBankImpact(base, draft, [{ id: 'case-x' }]);
  assert.equal(result.cases[0].caseId, 'case-x');
  assert.equal(result.cases[0].title, 'case-x');
  assert.deepEqual(result.cases[0].newlyRequired, [
    { id: 'q-new', causedBy: ['q-new'] },
  ]);
});

test('simulate: result carries the bank diff and case titles', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions[0].optionOutcomes = { No: 'fail', Yes: 'pass' };
  });
  const result = simulateBankImpact(base, draft, [
    sampleCase({}, 'case-9', 'Ninth Case'),
  ]);
  assert.deepEqual(result.diff.changed, [
    { id: 'q-a', fields: ['optionOutcomes'] },
  ]);
  assert.equal(result.cases[0].caseId, 'case-9');
  assert.equal(result.cases[0].title, 'Ninth Case');
});

test('simulate: is read-only — inputs are not mutated', () => {
  const base = baselineBank();
  const draft = draftFrom(base, (b) => {
    b.questions[0].optionOutcomes = { Yes: 'fail' };
    b.questions.push({
      id: 'q-new',
      text: 'New?',
      responseType: 'outcome',
      deprecated: false,
    });
  });
  const cases = [sampleCase({ 'q-a': { value: 'NA' }, 'q-b': { value: [] } })];
  const baseSnap = structuredClone(base);
  const draftSnap = structuredClone(draft);
  const casesSnap = structuredClone(cases);
  simulateBankImpact(base, draft, cases);
  assert.deepEqual(base, baseSnap);
  assert.deepEqual(draft, draftSnap);
  assert.deepEqual(cases, casesSnap);
});

test('simulate: attribution walks refs inside $or / $and showWhen groups', () => {
  const base = baselineBank();
  base.questions.push({
    id: 'q-grouped',
    text: 'Grouped?',
    responseType: 'yes-no-na',
    showWhen: {
      $or: [
        { 'q-a': { equals: 'Yes' } },
        { $and: [{ 'q-b': { equals: 'Yes' } }] },
      ],
    },
    deprecated: false,
  });
  const draft = draftFrom(base, (b) => {
    b.questions[1].showWhen = { 'q-a': { equals: 'No' } };
  });
  // Baseline: q-b is gated off (q-a is 'No'), its Answer is pruned, so
  // q-grouped's $or finds no true leaf. The draft re-applies q-b, whose kept
  // Answer satisfies the nested $and — q-grouped gains applicability, caused
  // by the changed q-b.
  const result = simulateBankImpact(base, draft, [
    sampleCase({ 'q-a': { value: 'No' }, 'q-b': { value: 'Yes' } }),
  ]);
  const grouped = result.cases[0].applicabilityGained.find(
    (e) => e.id === 'q-grouped'
  );
  assert.deepEqual(grouped?.causedBy, ['q-b']);
});
