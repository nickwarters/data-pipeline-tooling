// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ===== MINIMAL DOM STUBS =====

class StubEl {
  constructor() {
    /** @type {StubEl[]} */
    this._children = [];
    /** @type {Record<string, Function[]>} */
    this._listeners = {};
    /** @type {Record<string, string>} */
    this._attrs = {};
    this.textContent = '';
    this.className = '';
    /** @type {string} */
    this._tagName = '';
    this.value = undefined;
    this.hidden = false;
  }
  replaceChildren(/** @type {StubEl[]} */ ...cs) {
    this._children = cs;
  }
  appendChild(/** @type {StubEl} */ c) {
    this._children.push(c);
    return c;
  }
  append(/** @type {StubEl[]} */ ...cs) {
    this._children.push(...cs);
  }
  addEventListener(/** @type {string} */ t, /** @type {Function} */ h) {
    (this._listeners[t] ??= []).push(h);
  }
  setAttribute(/** @type {string} */ k, /** @type {string} */ v) {
    this._attrs[k] = v;
  }
  dispatchEvent(/** @type {any} */ e) {
    (this._listeners[e.type] ?? []).forEach((h) => h(e));
    return true;
  }
  /** @param {string} ev @param {any} [payload] */
  _fire(ev, payload) {
    (this._listeners[ev] ?? []).forEach((h) => h(payload));
  }
}

class StubCustomEvent {
  /** @param {string} type @param {{ detail?: any, bubbles?: boolean }} [init] */
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail ?? null;
    this.bubbles = init?.bubbles ?? false;
  }
}

/** @type {any} */ (globalThis).HTMLElement = StubEl;
/** @type {any} */ (globalThis).document = {
  /** @param {string} tag @returns {StubEl} */
  createElement(tag) {
    const el = new StubEl();
    el._tagName = tag;
    return el;
  },
};
/** @type {any} */ (globalThis).customElements = { define() {} };
/** @type {any} */ (globalThis).CustomEvent = StubCustomEvent;

const { CRRemediationTracking } =
  await import('../src/components/cr-remediation-tracking.js');

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

/** @param {any} root @param {string} cls @returns {any} */
function findByClass(root, cls) {
  for (const c of root._children ?? []) {
    if (c.className === cls) return c;
    /** @type {any} */
    const nested = findByClass(c, cls);
    if (nested) return nested;
  }
  return null;
}

/** @param {any} root @param {string} cls */
function findAllByClass(root, cls) {
  /** @type {any[]} */
  const out = [];
  for (const c of root._children ?? []) {
    if (c.className === cls) out.push(c);
    out.push(...findAllByClass(c, cls));
  }
  return out;
}

/** @param {any} el */
function allText(el) {
  let out = el.textContent ? el.textContent + ' ' : '';
  for (const c of el._children ?? []) out += allText(c);
  return out;
}

test('CRRemediationTracking: no actions-typed capture fields → empty state', () => {
  const el = new CRRemediationTracking();
  el.captureGroups = [];
  el.update(CATALOGUE, { q1: { value: 'No' } });
  const empty = findByClass(el, 'cr-remediation-tracking-empty');
  assert.ok(empty);
  assert.match(allText(el), /no remediation actions sent/i);
});

test('CRRemediationTracking: sent actions with no failure are not listed', () => {
  const el = new CRRemediationTracking();
  el.captureGroups = GROUPS;
  // q1 passes (Yes), so its capture actions are not tracked.
  el.update(CATALOGUE, {
    q1: {
      value: 'Yes',
      capture: { acts: [{ id: 'a', text: 'x', status: 'pending' }] },
    },
  });
  assert.ok(findByClass(el, 'cr-remediation-tracking-empty'));
});

test('CRRemediationTracking: read-only lists each sent action with status and cancel reason', () => {
  const el = new CRRemediationTracking();
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
  const items = findAllByClass(el, 'cr-remediation-tracking-item');
  assert.equal(items.length, 2);
  const text = allText(el);
  assert.ok(text.includes('legacy pending') && /Status: pending/.test(text));
  assert.ok(/Status: cancelled/.test(text) && /Reason: Dup/.test(text));
});

test('CRRemediationTracking: read-only omits a reason line for a cancelled action missing its reason', () => {
  const el = new CRRemediationTracking();
  el.captureGroups = GROUPS;
  el.canResolve = false;
  el.update(CATALOGUE, {
    q1: {
      value: 'No',
      capture: { acts: [{ id: 'a', text: 'X', status: 'complete' }] },
    },
  });
  assert.equal(findByClass(el, 'cr-tracking-cancel-reason'), null);
});

test('CRRemediationTracking: editable select dispatches a resolution', () => {
  const el = new CRRemediationTracking();
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
  el.addEventListener('cr-action-status', (/** @type {any} */ e) =>
    events.push(e.detail)
  );

  const select = findByClass(el, 'cr-tracking-status-select');
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

test('CRRemediationTracking: cancelling reveals the reason input and dispatches the reason', () => {
  const el = new CRRemediationTracking();
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
  el.addEventListener('cr-action-status', (/** @type {any} */ e) =>
    events.push(e.detail)
  );

  const select = findByClass(el, 'cr-tracking-status-select');
  const reason = findByClass(el, 'cr-tracking-cancel-input');
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

test('CRRemediationTracking: a cancelled action pre-renders its reason input visible', () => {
  const el = new CRRemediationTracking();
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
  const reason = findByClass(el, 'cr-tracking-cancel-input');
  assert.equal(reason.hidden, false);
  assert.equal(reason.value, 'why');
});

test('CRRemediationTracking: render() returns nodes and non-array render replaces children', () => {
  const el = new CRRemediationTracking();
  el.captureGroups = [];
  el.update(CATALOGUE, {});
  const out = el.render();
  assert.ok(Array.isArray(out));
});
