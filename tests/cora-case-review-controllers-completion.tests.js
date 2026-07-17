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

test('bindCompletion: falls back to default completion patch when no transition exists', () => {
  const { context, completeButton, completeCalls } = makeCompletionContext({
    transitionToCompleted: null,
  });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields.status, 'Completed');
  assert.equal(typeof completeCalls[0].patchFields.completedAt, 'string');
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

test('bindCompletion: actions path falls back to default patch when the transition is absent', () => {
  const { context, completeButton, completeCalls } = makeCompletionContext({
    answers: ACTIONS_ANSWERS,
    transitionToActionsInProgress: null,
  });

  bindCompletion(/** @type {any} */ (context));
  completeButton._listeners.click[0]({ target: completeButton });

  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].patchFields.status, 'Completed');
  assert.equal(typeof completeCalls[0].patchFields.completedAt, 'string');
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
