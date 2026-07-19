// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';
import {
  ACTIONS_ANSWERS,
  bindCompletion,
  completeCase,
  hasRemediationActions,
  makeCompletionContext,
  updateCompletion,
} from './helpers/cora-case-review-controllers.js';
import {
  completionControl,
  completionPatch,
} from '../src/pages/cora-case-review/completion-actions.js';

isolateBrowserGlobals();

// Capability: completion presentation and transitions.

test('updateCompletion: preserves completion button visibility and label', () => {
  const visible = makeCompletionContext({
    allAnswered: true,
    canComplete: true,
  });
  updateCompletion(/** @type {any} */ (visible.context));
  assert.equal(visible.completeButton.hidden, false);
  assert.equal(visible.completeButton.textContent, 'Complete Case');

  const unanswered = makeCompletionContext({
    allAnswered: false,
    canComplete: true,
  });
  updateCompletion(/** @type {any} */ (unanswered.context));
  assert.equal(unanswered.completeButton.hidden, true);

  const blocked = makeCompletionContext({
    allAnswered: true,
    canComplete: false,
  });
  updateCompletion(/** @type {any} */ (blocked.context));
  assert.equal(blocked.completeButton.hidden, true);
});

test('bindCompletion: disables during submit, uses transition patch, and re-enables', async () => {
  /** @type {(value?: unknown) => void} */
  let resolveSubmit = () => {};
  const { context, completeButton, completeCalls, patchFromTransition } =
    makeCompletionContext({
      completeCase: (
        /** @type {string} */ caseId,
        /** @type {any} */ client,
        /** @type {any} */ saveQueue,
        /** @type {any} */ patchFields
      ) =>
        new Promise((resolve) => {
          completeCalls.push({ caseId, client, saveQueue, patchFields });
          resolveSubmit = resolve;
        }),
    });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeButton.disabled, true);
  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields, patchFromTransition);

  resolveSubmit();
  await Promise.resolve();
  assert.equal(completeButton.disabled, false);
});

test('bindCompletion: does not submit when CaseMachine exposes no transition', () => {
  const { context, completeButton, completeCalls } = makeCompletionContext({
    transitionToCompleted: null,
  });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 0);
});

test('hasRemediationActions: true iff an Answer carries ≥1 Remediation Action', () => {
  assert.equal(
    hasRemediationActions(
      /** @type {any} */ ({ answersSignal: { get: () => ACTIONS_ANSWERS } })
    ),
    true
  );
  assert.equal(
    hasRemediationActions(
      /** @type {any} */ ({
        answersSignal: { get: () => ({ 'q-a': { value: 'Yes' } }) },
      })
    ),
    false
  );
  assert.equal(
    hasRemediationActions(/** @type {any} */ ({})),
    false,
    'no answers signal ⇒ no actions'
  );
});

test('updateCompletion: button reads "Send Actions" when the Case carries Remediation Actions (ADR-0023)', () => {
  const withActions = makeCompletionContext({
    allAnswered: true,
    canComplete: true,
    answers: ACTIONS_ANSWERS,
  });
  updateCompletion(/** @type {any} */ (withActions.context));
  assert.equal(withActions.completeButton.hidden, false);
  assert.equal(withActions.completeButton.textContent, 'Send Actions');
});

test('bindCompletion: routes down the actions path (transitionToActionsInProgress) when actions exist', () => {
  const { context, completeButton, completeCalls, patchFromActionsTransition } =
    makeCompletionContext({ answers: ACTIONS_ANSWERS });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.equal(
    completeCalls[0].patchFields,
    patchFromActionsTransition,
    'the Send Actions transition supplies the reportable PATCH'
  );
});

test('bindCompletion: no-actions path uses transitionToCompleted', () => {
  const { context, completeButton, completeCalls, patchFromTransition } =
    makeCompletionContext();

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields, patchFromTransition);
});

test('bindCompletion: actions path does not submit when its transition is absent', () => {
  const { context, completeButton, completeCalls } = makeCompletionContext({
    answers: ACTIONS_ANSWERS,
    transitionToActionsInProgress: null,
  });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 0);
});

test('updateCompletion: hidden until the Responsible Party is set at the bottom of Issues (ADR-0024)', () => {
  const noRp = makeCompletionContext({
    allAnswered: true,
    canComplete: true,
    responsibleParty: null,
  });
  updateCompletion(/** @type {any} */ (noRp.context));
  assert.equal(noRp.completeButton.hidden, true, 'no RP ⇒ button hidden');
});

test('updateCompletion: on the actions path the button reappears as "Complete Case" once tracking is complete', () => {
  const ready = makeCompletionContext({
    allAnswered: false,
    canComplete: false,
    canCompleteRemediation: true,
  });
  updateCompletion(/** @type {any} */ (ready.context));
  assert.equal(ready.completeButton.hidden, false);
  assert.equal(ready.completeButton.textContent, 'Complete Case');
});

test('bindCompletion: final-complete path uses transitionToFinalComplete (ADR-0024)', () => {
  const { context, completeButton, completeCalls } = makeCompletionContext({
    canCompleteRemediation: true,
  });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.deepEqual(completeCalls[0].patchFields, {
    status: 'Completed',
    completedAt: 'final-date',
  });
});

test('completeCase: flushes queued saves, patches with the stored ETag, and navigates on success', async () => {
  /** @type {any[]} */
  const patchCalls = [];
  const client = {
    patchCase(
      /** @type {string} */ caseId,
      /** @type {any} */ fields,
      /** @type {string} */ etag
    ) {
      patchCalls.push({ caseId, fields, etag });
      return Promise.resolve({ ok: true, status: 200 });
    },
  };
  const saveQueue = {
    flushCase: async () => true,
    getEtag: () => 'etag-1',
  };
  /** @type {any} */ (globalThis).location = { hash: '' };

  await completeCase({
    caseId: 'case-1',
    client: /** @type {any} */ (client),
    saveQueue: /** @type {any} */ (saveQueue),
    patchFields: { status: 'Completed' },
  });

  assert.deepEqual(patchCalls, [
    {
      caseId: 'case-1',
      fields: { status: 'Completed' },
      etag: 'etag-1',
    },
  ]);
  assert.equal(/** @type {any} */ (globalThis).location.hash, '#/dashboard');
});

test('completeCase: does not patch when required collaborators or flush success are missing', async () => {
  let patchCount = 0;
  const client = {
    patchCase() {
      patchCount++;
      return Promise.resolve({ ok: true, status: 200 });
    },
  };
  const saveQueue = {
    flushCase: async () => false,
    getEtag: () => 'etag-1',
  };

  await completeCase({
    caseId: 'case-1',
    client: null,
    saveQueue: /** @type {any} */ (saveQueue),
    patchFields: null,
  });
  await completeCase({
    caseId: 'case-1',
    client: /** @type {any} */ (client),
    saveQueue: null,
    patchFields: null,
  });
  await completeCase({
    caseId: 'case-1',
    client: /** @type {any} */ (client),
    saveQueue: /** @type {any} */ (saveQueue),
    patchFields: null,
  });

  assert.equal(patchCount, 0);
});

test('completionControl: lifecycle capability, answer state, and Responsible Party all gate visibility', () => {
  const caseRow = /** @type {any} */ ({ responsibleParty: 'owner' });
  const base = {
    machine: /** @type {any} */ ({
      canComplete: true,
      canCompleteRemediation: false,
    }),
    caseRow,
    answers: {},
    allAnswered: true,
  };
  assert.deepEqual(completionControl(base), {
    visible: true,
    label: 'Complete Case',
  });
  assert.equal(
    completionControl({ ...base, allAnswered: false }).visible,
    false
  );
  assert.equal(
    completionControl({
      ...base,
      caseRow: /** @type {any} */ ({ responsibleParty: null }),
    }).visible,
    false
  );
  assert.equal(completionControl({ ...base, machine: null }).visible, false);
  assert.deepEqual(
    completionControl({
      ...base,
      allAnswered: false,
      answers: ACTIONS_ANSWERS,
      machine: /** @type {any} */ ({
        canComplete: false,
        canCompleteRemediation: true,
      }),
    }),
    { visible: true, label: 'Complete Case' }
  );
});

test('completionPatch: invalid state has no fallback lifecycle mutation', () => {
  const transition = () => ({ status: 'Completed' });
  const base = {
    machine: /** @type {any} */ ({
      canComplete: true,
      canCompleteRemediation: false,
      transitionToCompleted: transition,
    }),
    caseRow: /** @type {any} */ ({ responsibleParty: 'owner' }),
    answers: {},
    allAnswered: true,
    computeOutcome: () => ({ outcome: 'pass' }),
    exportHash: 'bank-hash',
  };

  assert.equal(completionPatch({ ...base, machine: null }), null);
  assert.equal(completionPatch({ ...base, allAnswered: false }), null);
  assert.equal(
    completionPatch({
      ...base,
      caseRow: /** @type {any} */ ({ responsibleParty: null }),
    }),
    null
  );
  assert.equal(
    completionPatch({
      ...base,
      machine: /** @type {any} */ ({
        ...base.machine,
        canComplete: false,
      }),
    }),
    null
  );
  assert.equal(
    completionPatch({
      ...base,
      machine: /** @type {any} */ ({
        canComplete: true,
        canCompleteRemediation: false,
      }),
    }),
    null
  );
});

test('completionPatch: passes the evaluator, answers, and bank hash to the CaseMachine transition', () => {
  const answers = { q1: { value: 'Yes' } };
  const computeOutcome = () => ({ outcome: 'pass' });
  /** @type {any[]} */
  const calls = [];
  const machine = /** @type {any} */ ({
    canComplete: true,
    canCompleteRemediation: false,
    transitionToCompleted(/** @type {any[]} */ ...args) {
      calls.push({ self: this, args });
      return { status: 'Completed', questionBankVersion: args[2] };
    },
  });

  const patch = completionPatch({
    machine,
    caseRow: /** @type {any} */ ({ responsibleParty: 'owner' }),
    answers,
    allAnswered: true,
    computeOutcome,
    exportHash: 'bank-hash',
  });

  assert.deepEqual(patch, {
    status: 'Completed',
    questionBankVersion: 'bank-hash',
  });
  assert.equal(calls[0].self, machine);
  assert.deepEqual(calls[0].args, [computeOutcome, answers, 'bank-hash']);
});

test('completionPatch: final close is impossible without the CaseMachine transition', () => {
  const base = {
    machine: /** @type {any} */ ({ canCompleteRemediation: true }),
    caseRow: /** @type {any} */ ({ responsibleParty: 'owner' }),
    answers: {},
    allAnswered: false,
    computeOutcome: () => ({ outcome: 'pass' }),
    exportHash: null,
  };
  assert.equal(completionPatch(base), null);
  assert.deepEqual(
    completionPatch({
      ...base,
      machine: /** @type {any} */ ({
        canCompleteRemediation: true,
        transitionToFinalComplete: () => ({ status: 'Completed' }),
      }),
    }),
    { status: 'Completed' }
  );
});

test('completion compatibility adapters are inert without their required public state', () => {
  const base = makeCompletionContext();
  base.context.nodes.completeButton = /** @type {any} */ (null);
  assert.doesNotThrow(() => bindCompletion(/** @type {any} */ (base.context)));
  assert.doesNotThrow(() =>
    updateCompletion(/** @type {any} */ (base.context))
  );

  const missingRow = makeCompletionContext();
  missingRow.context.viewModel.caseRow = /** @type {any} */ (null);
  assert.doesNotThrow(() =>
    bindCompletion(/** @type {any} */ (missingRow.context))
  );
  assert.doesNotThrow(() =>
    updateCompletion(/** @type {any} */ (missingRow.context))
  );

  const missingConfig = makeCompletionContext();
  missingConfig.context.viewModel.config = /** @type {any} */ (null);
  assert.doesNotThrow(() =>
    bindCompletion(/** @type {any} */ (missingConfig.context))
  );
});
