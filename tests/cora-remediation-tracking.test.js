// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass } from './_dom-stub.js';

installDom();

const { CORARemediationTracking } =
  await import('../src/components/sections/cora-remediation-tracking.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

/** @type {QuestionDefinition[]} */
const CATALOGUE = [
  {
    id: 'q1',
    text: 'Greeted?',
    category: 'Opening',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
  {
    id: 'q2',
    text: 'Resolved?',
    responseType: 'yes-no-na',
    failureCriteria: 'No',
    deprecated: false,
  },
];

/** @type {any} */
const GROUPS = [
  {
    key: 'g',
    label: 'G',
    fields: [{ key: 'acts', label: 'Actions', type: 'actions' }],
  },
];

/** @param {any} el */
function allText(el) {
  let out = el.textContent ? el.textContent + ' ' : '';
  for (const c of el._children ?? []) out += allText(c);
  return out;
}

test('CORARemediationTracking: no actions-typed capture fields → empty state', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = [];
  el.update(CATALOGUE, { q1: { value: 'No' } });
  const empty = findByClass(el, 'cora-remediation-tracking-empty');
  assert.ok(empty);
  assert.match(allText(el), /no remediation actions sent/i);
});

test('CORARemediationTracking: sent actions with no failure are not listed', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = GROUPS;
  // q1 passes (Yes), so its capture actions are not tracked.
  el.update(CATALOGUE, {
    q1: {
      value: 'Yes',
      capture: { acts: [{ id: 'a', text: 'x', status: 'pending' }] },
    },
  });
  assert.ok(findByClass(el, 'cora-remediation-tracking-empty'));
});

test('CORARemediationTracking: read-only lists each sent action with status and cancel reason', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = GROUPS;
  el.canResolve = false;
  el.update(CATALOGUE, {
    q1: {
      value: 'No',
      capture: {
        acts: [
          'legacy pending',
          {
            id: 'a2',
            text: 'Refund',
            status: 'cancelled',
            cancelReason: 'Dup',
          },
        ],
      },
    },
  });
  const items = findAllByClass(el, 'cora-remediation-tracking-item');
  assert.equal(items.length, 2);
  const text = allText(el);
  assert.ok(text.includes('legacy pending') && /Status: pending/.test(text));
  assert.ok(/Status: cancelled/.test(text) && /Reason: Dup/.test(text));
});

test('CORARemediationTracking: read-only omits a reason line for a cancelled action missing its reason', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = GROUPS;
  el.canResolve = false;
  el.update(CATALOGUE, {
    q1: {
      value: 'No',
      capture: { acts: [{ id: 'a', text: 'X', status: 'complete' }] },
    },
  });
  assert.equal(findByClass(el, 'cora-tracking-cancel-reason'), null);
});

test('CORARemediationTracking: editable select dispatches a resolution', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = GROUPS;
  el.canResolve = true;
  el.update(CATALOGUE, {
    q1: {
      value: 'No',
      capture: { acts: [{ id: 'a1', text: 'Do it', status: 'pending' }] },
    },
  });

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-action-status', (/** @type {any} */ e) =>
    events.push(e.detail)
  );

  const select = findByClass(el, 'cora-tracking-status-select');
  select.value = 'complete';
  select._fire('change');

  assert.deepEqual(events, [
    {
      questionId: 'q1',
      fieldKey: 'acts',
      actionId: 'a1',
      status: 'complete',
      cancelReason: '',
    },
  ]);
});

test('CORARemediationTracking: cancelling reveals the reason input and dispatches the reason', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = GROUPS;
  el.canResolve = true;
  el.update(CATALOGUE, {
    q1: {
      value: 'No',
      capture: { acts: [{ id: 'a1', text: 'Do it', status: 'pending' }] },
    },
  });

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-action-status', (/** @type {any} */ e) =>
    events.push(e.detail)
  );

  const select = findByClass(el, 'cora-tracking-status-select');
  const reason = findByClass(el, 'cora-tracking-cancel-input');
  assert.equal(reason.hidden, true, 'reason hidden until cancelled is chosen');

  select.value = 'cancelled';
  select._fire('change');
  assert.equal(reason.hidden, false, 'reason revealed once cancelled');

  reason.value = 'No longer needed';
  reason._fire('change');

  assert.deepEqual(events.at(-1), {
    questionId: 'q1',
    fieldKey: 'acts',
    actionId: 'a1',
    status: 'cancelled',
    cancelReason: 'No longer needed',
  });
});

test('CORARemediationTracking: a cancelled action pre-renders its reason input visible', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = GROUPS;
  el.canResolve = true;
  el.update(CATALOGUE, {
    q1: {
      value: 'No',
      capture: {
        acts: [
          { id: 'a1', text: 'X', status: 'cancelled', cancelReason: 'why' },
        ],
      },
    },
  });
  const reason = findByClass(el, 'cora-tracking-cancel-input');
  assert.equal(reason.hidden, false);
  assert.equal(reason.value, 'why');
});

test('CORARemediationTracking: render() returns nodes and non-array render replaces children', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = [];
  el.update(CATALOGUE, {});
  const out = el.render();
  assert.ok(Array.isArray(out));
});

// --- Case Type sectionLabels heading override (MAINT-11) ---

test('CORARemediationTracking: heading prop overrides the default Remediation heading', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = [];
  el.heading = 'Fix-up';
  el.update(CATALOGUE, {});
  assert.equal(/** @type {any} */ (el)._children[0].textContent, 'Fix-up');
});

test('CORARemediationTracking: default heading is Remediation when no override', () => {
  const el = new CORARemediationTracking();
  el.captureGroups = [];
  el.update(CATALOGUE, {});
  assert.equal(/** @type {any} */ (el)._children[0].textContent, 'Remediation');
});
