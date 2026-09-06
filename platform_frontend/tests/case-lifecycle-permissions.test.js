// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canCompleteCase,
  canEditIssues,
  canToggleConversation,
  canVoidCase,
  mayResolveRemediation,
} from '../src/evaluators/case-lifecycle.js';
import { createCaseLifecycleView } from '../src/lib/case-lifecycle-view.js';
import { makeCaseRow, makePermissions } from './helpers/fixtures.js';
import { configureAppSections } from './helpers/configure-sections.js';

configureAppSections();

// Capability: what a viewer may do to a Case, derived from the resolved Section
// access map rather than computed inside the lifecycle model.
//
// These predicates take `access` as data, which is what let the model stop
// knowing about Sections at all. It also makes the guards separable: a test can
// hand one `edit` on every Section and watch a freeze still say no, which used
// to need reaching into a constructed machine and mutating its matrix.

const NO_CAPABILITIES = makePermissions({
  isReviewer: false,
  isVisitor: true,
});

const BASE_ROW = makeCaseRow({
  id: 'c1',
  caseType: 'example-review',
  title: 'Test Case',
  assignedReviewer: 'u1',
  responsibleParty: 'u2',
  etag: 'e1',
});

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const EMPTY_CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  defaultOutcomeId: 'pass',
};

const ACTIONS_CONFIG = EMPTY_CONFIG;

/** @type {import('../src/sharepoint-client.js').QuestionDefinition[]} */
const CATALOGUE = ['q-a', 'q-needs', 'q-welcome'].map((id) => ({
  id,
  text: id,
  responseType: /** @type {const} */ ('yes-no-na'),
  failureValues: ['No'],
  deprecated: false,
}));

/**
 * The composed view, exactly as the loader composes it — the same function, so
 * these tests cannot put the two halves together differently from production.
 *
 * @param {import('../src/lib/case-statuses.js').CaseStatus} status
 * @param {import('../src/sharepoint-client.js').CaseTypeConfig} [config]
 * @param {Partial<import('../src/sharepoint-client.js').CaseRow>} [overrides]
 */
function viewFor(
  status,
  config = EMPTY_CONFIG,
  overrides = {},
  catalogue = CATALOGUE
) {
  return createCaseLifecycleView({
    caseRow: { ...BASE_ROW, status, ...overrides },
    currentUserId: 'u1',
    capabilities: NO_CAPABILITIES,
    config,
    catalogue,
  });
}

test('Case permissions: completing freezes at the reportable milestone', () => {
  assert.equal(viewFor('In-progress').machine.canComplete, true);
  assert.equal(viewFor('Actions In Progress').machine.canComplete, false);
  assert.equal(viewFor('Completed').machine.canComplete, false);
});

test('Case permissions: a voided Case can be neither completed nor edited', () => {
  const machine = viewFor('Void').machine;
  assert.equal(machine.canComplete, false);
  assert.equal(machine.canEditIssues, false);

  // Every Section already answers `read-only` on a voided Case, so both would
  // be false whatever guard stood beside them. Handing the predicates `edit`
  // outright leaves the freeze as the only thing that can say no — which is the
  // rule being claimed. Asking it this way is what the predicates being pure
  // buys: it used to need reaching into a constructed machine and mutating the
  // matrix it had computed for itself.
  const caseRow = { ...BASE_ROW, status: /** @type {any} */ ('Void') };
  const access = { questions: 'edit', issues: 'edit' };
  assert.equal(
    canCompleteCase({ access, caseRow, currentUserId: 'u1' }),
    false,
    'the freeze guard, not the access map'
  );
  assert.equal(
    canEditIssues({ access, caseRow }),
    false,
    'the freeze guard, not the access map'
  );
});

test('Case permissions: the Conversation opens unless every viewer is shut out of it', () => {
  assert.equal(
    canToggleConversation({ access: { conversation: 'edit' } }),
    true
  );
  assert.equal(
    canToggleConversation({ access: { conversation: 'read-only' } }),
    true
  );
  assert.equal(
    canToggleConversation({ access: { conversation: 'hidden' } }),
    false
  );
});

test('Case permissions: only the Assigned Reviewer of a live Case may void it', () => {
  // The one permission with no Section in it: voiding is a lifecycle fact.
  assert.equal(
    canVoidCase({
      caseRow: { ...BASE_ROW, status: /** @type {any} */ ('In-progress') },
      currentUserId: 'u1',
    }),
    true
  );

  assert.equal(viewFor('In-progress').machine.canVoid, true);
  assert.equal(viewFor('Actions In Progress').machine.canVoid, true);
  assert.equal(viewFor('Completed').machine.canVoid, false);
  assert.equal(viewFor('Void').machine.canVoid, false);
  assert.equal(
    viewFor('In-progress', EMPTY_CONFIG, { assignedReviewer: 'u9' }).machine
      .canVoid,
    false
  );
});

test('Case permissions: Issues editing needs no Case Type opt-in and freezes at reportable', () => {
  // No configuration flag stands between a Case Type and its Issue Capture
  // Fields: the Assigned Reviewer of a pre-reportable Case may edit them.
  assert.equal(viewFor('In-progress').machine.canEditIssues, true);
  assert.equal(viewFor('Actions In Progress').machine.canEditIssues, false);
  assert.equal(viewFor('Completed').machine.canEditIssues, false);

  // Someone else's Case: the Issues tab is not theirs to edit.
  assert.equal(
    viewFor('In-progress', EMPTY_CONFIG, { assignedReviewer: 'u9' }).machine
      .canEditIssues,
    false
  );
});

test('Case permissions: permits the final close only for the Assigned Reviewer of an Actions In Progress Case', () => {
  // The *content* half of the gate — every Question's remediation resolved —
  // lives in completionControl/completionPatch, which see the live Answers.
  /** @type {Record<string, import('../src/sharepoint-client.js').Answer>} */
  const answers = {
    'q-a': {
      value: 'No',
      remediationActions: [{ id: 'a1', text: 'Call back' }],
    },
  };

  assert.equal(
    viewFor('Actions In Progress', ACTIONS_CONFIG, { answers }).machine
      .mayResolveRemediation,
    true
  );
  assert.equal(
    viewFor('In-progress', ACTIONS_CONFIG, { answers }).machine
      .mayResolveRemediation,
    false,
    'nothing to close before the actions are sent'
  );
  assert.equal(
    viewFor('Completed', ACTIONS_CONFIG, { answers }).machine
      .mayResolveRemediation,
    false,
    'and nothing to close once the Case is closed'
  );
  assert.equal(
    viewFor('Actions In Progress', ACTIONS_CONFIG, {
      answers,
      assignedReviewer: 'other',
    }).machine.mayResolveRemediation,
    false
  );

  // And the same read directly, so the composition is not the only way in.
  assert.equal(
    mayResolveRemediation({
      access: { remediation: 'edit' },
      caseRow: {
        ...BASE_ROW,
        status: /** @type {any} */ ('Actions In Progress'),
      },
      currentUserId: 'u1',
    }),
    true
  );
});

test('Case permissions: a Section with nothing to show is hidden, not merely empty', () => {
  // A Question that has left the catalogue takes its remediation with it, so
  // the Section it would have been resolved on is not offered at all. The other
  // half — that nothing is stamped as having had remediation — is the lifecycle
  // model's, and lives with it.
  const orphaned = {
    'q-gone': {
      value: 'No',
      remediationActions: [{ id: 'a1', text: 'Call back' }],
    },
  };

  assert.equal(
    viewFor('Actions In Progress', EMPTY_CONFIG, { answers: orphaned }, [])
      .access.remediation,
    'hidden'
  );
});
