// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import { SECTION_REGISTRY, tabEntries } from '../src/lib/section-registry.js';

installDom();

const { SECTION_PANELS } =
  await import('../src/pages/cora-case-review/section-panels.js');

/**
 * The point of the panel map: the Case Review render loop no longer
 * branches on Section id, so a Section added to the registry with no panel used
 * to be invisible — it got a tab and an empty panel. These two assertions are
 * the replacement for that branch chain's implicit exhaustiveness.
 */

test('every tab Section has a panel renderer', () => {
  assert.deepEqual(
    tabEntries()
      .map((entry) => entry.id)
      .sort(),
    Object.keys(SECTION_PANELS).sort()
  );
});

test('adding a tab Section without a panel breaks the correspondence', () => {
  const withNewSection = [
    ...SECTION_REGISTRY,
    {
      id: /** @type {any} */ ('reworkedThing'),
      tab: true,
      tabOrder: 10,
      summaryBlock: false,
      summaryOrder: 0,
      showInSummaryDefault: true,
    },
  ];
  const ids = tabEntries(withNewSection)
    .map((entry) => entry.id)
    .sort();
  assert.notDeepEqual(ids, Object.keys(SECTION_PANELS).sort());
  assert.equal(
    ids.filter((id) => !(id in SECTION_PANELS)).join(),
    'reworkedThing'
  );
});

test('conversation is not a panel — it is a floating overlay', () => {
  assert.equal('conversation' in SECTION_PANELS, false);
});

test('the remediation panel offers only the resolutions the Case Type declares', () => {
  /** @type {any} */
  const ctx = {
    snapshot: {
      catalogue: [
        {
          id: 'q1',
          text: 'Greeted the customer?',
          responseType: 'yes-no-na',
          failureValues: ['No'],
          deprecated: false,
        },
      ],
      answers: {
        q1: { value: 'No', freeFormRemediation: 'Write to the customer' },
      },
      access: { remediation: 'edit', conversation: 'edit' },
      sectionHeadings: { remediation: 'Remediation' },
      machine: { roles: ['assignedReviewer'] },
    },
    caseRow: { id: 1, status: 'Actions In Progress' },
    config: { remediationStatuses: ['complete', 'cancelled'] },
    route: { conversationHidden: true },
    dispatch: () => {},
    actions: { currentAnswers: () => ({}), editAnswers: () => {} },
  };

  const panel = /** @type {any} */ (SECTION_PANELS.remediation);
  const nodes = panel(ctx);
  const select = findByClass(
    { _children: nodes },
    'cora-tracking-status-select'
  );
  assert.deepEqual(
    select._children.map((/** @type {any} */ option) => option.value),
    ['', 'complete', 'cancelled']
  );
});
