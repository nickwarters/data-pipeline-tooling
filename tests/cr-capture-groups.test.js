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
    this.value = '';
    this.type = '';
    this.checked = false;
    this.hidden = false;
    /** @type {string} */
    this._tagName = '';
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
  getAttribute(/** @type {string} */ k) {
    return this._attrs[k] ?? null;
  }
  dispatchEvent(/** @type {any} */ e) {
    (this._listeners[e.type] ?? []).forEach((h) => h(e));
    return true;
  }
  /** @param {string} ev @param {any} [payload] */
  _fire(ev, payload) {
    (this._listeners[ev] ?? []).forEach((h) => h(payload ?? { target: this }));
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

const { CRCaptureGroups } =
  await import('../src/components/cr-capture-groups.js');

/** @typedef {import('../src/sharepoint-client.js').CaptureGroup} CaptureGroup */

/** @type {CaptureGroup[]} */
const GROUPS = [
  {
    key: 'cause',
    label: 'Cause',
    collapsed: false,
    fields: [
      { key: 'rootCause', label: 'Root cause', type: 'text' },
      { key: 'detail', label: 'Detail', type: 'textarea' },
    ],
  },
  {
    key: 'grade',
    label: 'Grading',
    collapsed: true,
    fields: [
      {
        key: 'severity',
        label: 'Severity',
        type: 'select',
        options: ['Low', 'Med', 'High'],
      },
      {
        key: 'repeat',
        label: 'Repeat?',
        type: 'radio',
        options: ['Yes', 'No'],
      },
    ],
  },
];

/** @param {any} root @param {string} cls @returns {any} */
function findByClass(root, cls) {
  for (const c of root._children ?? []) {
    if (c.className === cls) return c;
    const nested = findByClass(c, cls);
    if (nested) return nested;
  }
  return null;
}

/** @param {any} root @param {string} cls @returns {any[]} */
function findAllByClass(root, cls) {
  /** @type {any[]} */
  const out = [];
  function walk(/** @type {any} */ node) {
    for (const c of node._children ?? []) {
      if (c.className === cls) out.push(c);
      walk(c);
    }
  }
  walk(root);
  return out;
}

/** @param {any} root @param {string} tag @returns {any[]} */
function findAllByTag(root, tag) {
  /** @type {any[]} */
  const out = [];
  function walk(/** @type {any} */ node) {
    for (const c of node._children ?? []) {
      if (c._tagName === tag) out.push(c);
      walk(c);
    }
  }
  walk(root);
  return out;
}

// ===== TESTS =====

test('CRCaptureGroups: editable mode renders a header per group', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, {}, true);
  const headers = findAllByClass(el, 'cr-capture-group-header');
  assert.deepEqual(
    headers.map((h) => h.textContent),
    ['Cause', 'Grading']
  );
});

test('CRCaptureGroups: an expanded group renders its field controls; a collapsed group hides them', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, {}, true);
  // GROUPS[0] (Cause) collapsed:false -> fields shown; GROUPS[1] (Grading) collapsed:true -> hidden.
  const fields = findAllByClass(el, 'cr-capture-field');
  const labels = findAllByClass(el, 'cr-capture-label').map(
    (l) => l.textContent
  );
  assert.deepEqual(labels, ['Root cause', 'Detail']);
  assert.equal(fields.length, 2);
});

test('CRCaptureGroups: clicking a collapsed group header expands it (ephemeral)', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, {}, true);
  const gradingHeader = findAllByClass(el, 'cr-capture-group-header')[1];
  gradingHeader._fire('click');
  const labels = findAllByClass(el, 'cr-capture-label').map(
    (l) => l.textContent
  );
  assert.deepEqual(labels, ['Root cause', 'Detail', 'Severity', 'Repeat?']);
});

test('CRCaptureGroups: clicking an expanded group header collapses it', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, {}, true);
  const causeHeader = findAllByClass(el, 'cr-capture-group-header')[0];
  causeHeader._fire('click');
  const labels = findAllByClass(el, 'cr-capture-label').map(
    (l) => l.textContent
  );
  // Cause now collapsed; Grading still collapsed -> no field labels at all.
  assert.deepEqual(labels, []);
});

test('CRCaptureGroups: collapse state survives a re-render via update()', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, {}, true);
  findAllByClass(el, 'cr-capture-group-header')[1]._fire('click'); // expand Grading
  el.update(GROUPS, { severity: 'High' }, true); // autosave-style re-render
  const labels = findAllByClass(el, 'cr-capture-label').map(
    (l) => l.textContent
  );
  assert.ok(
    labels.includes('Severity'),
    'Grading stayed expanded after re-render'
  );
});

test('CRCaptureGroups: text and textarea controls reflect the current capture value', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, { rootCause: 'Rushed', detail: 'Long note' }, true);
  const inputs = findAllByClass(el, 'cr-capture-input');
  assert.equal(inputs[0]._tagName, 'input');
  assert.equal(inputs[0].value, 'Rushed');
  assert.equal(inputs[1]._tagName, 'textarea');
  assert.equal(inputs[1].value, 'Long note');
});

test('CRCaptureGroups: select renders a blank plus the options and reflects current value', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, { severity: 'Med' }, true);
  findAllByClass(el, 'cr-capture-group-header')[1]._fire('click'); // expand Grading
  const select = findAllByTag(el, 'select')[0];
  const opts = findAllByTag(select, 'option').map((o) => o.value);
  assert.deepEqual(opts, ['', 'Low', 'Med', 'High']);
  assert.equal(select.value, 'Med');
});

test('CRCaptureGroups: radio renders one input per option with the current one checked', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, { repeat: 'No' }, true);
  findAllByClass(el, 'cr-capture-group-header')[1]._fire('click'); // expand Grading
  const radios = findAllByTag(el, 'input').filter((i) => i.type === 'radio');
  assert.deepEqual(
    radios.map((r) => r.value),
    ['Yes', 'No']
  );
  assert.deepEqual(
    radios.map((r) => r.checked),
    [false, true]
  );
});

test('CRCaptureGroups: radio names are scoped per instance so separate Answers are independent groups', () => {
  const a = new CRCaptureGroups();
  const b = new CRCaptureGroups();
  a.update(GROUPS, {}, true);
  b.update(GROUPS, {}, true);
  /** @type {any} */ (a)._fire('click'); // no-op safety
  findAllByClass(a, 'cr-capture-group-header')[1]._fire('click'); // expand Grading
  findAllByClass(b, 'cr-capture-group-header')[1]._fire('click');

  const aRadios = findAllByTag(a, 'input').filter((i) => i.type === 'radio');
  const bRadios = findAllByTag(b, 'input').filter((i) => i.type === 'radio');

  // Yes/No within one instance must share a name (one working radio group)…
  assert.equal(
    aRadios[0].getAttribute('name'),
    aRadios[1].getAttribute('name'),
    'options within an instance share a radio-group name'
  );
  assert.ok(
    aRadios[0].getAttribute('name').endsWith('repeat'),
    'name is scoped to the field key'
  );
  // …but two instances must NOT, or selecting one Answer clears the other.
  assert.notEqual(
    aRadios[0].getAttribute('name'),
    bRadios[0].getAttribute('name'),
    'separate instances use distinct radio-group names'
  );
});

test('CRCaptureGroups: changing a text control dispatches a bubbling cr-capture', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, {}, true);
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-capture', (/** @type {any} */ e) => events.push(e));
  const input = findAllByClass(el, 'cr-capture-input')[0];
  input.value = 'Agent rushed';
  input._fire('change', { target: input });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, {
    fieldKey: 'rootCause',
    value: 'Agent rushed',
  });
  assert.equal(events[0].bubbles, true);
});

test('CRCaptureGroups: selecting a radio option dispatches cr-capture with that option', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, {}, true);
  findAllByClass(el, 'cr-capture-group-header')[1]._fire('click');
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cr-capture', (/** @type {any} */ e) => events.push(e));
  const yesRadio = findAllByTag(el, 'input').filter(
    (i) => i.type === 'radio'
  )[0];
  yesRadio._fire('change');
  assert.deepEqual(events[0].detail, { fieldKey: 'repeat', value: 'Yes' });
});

test('CRCaptureGroups: read-only mode shows only populated fields as static text, no inputs', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, { rootCause: 'Rushed', severity: 'High' }, false);
  assert.equal(
    findByClass(el, 'cr-capture-input'),
    null,
    'no editable controls when read-only'
  );
  const values = findAllByClass(el, 'cr-capture-value').map(
    (v) => v.textContent
  );
  assert.deepEqual(values, ['Root cause: Rushed', 'Severity: High']);
});

test('CRCaptureGroups: read-only mode omits a group with no populated fields', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, { rootCause: 'Rushed' }, false);
  const headings = findAllByClass(el, 'cr-capture-group-heading').map(
    (h) => h.textContent
  );
  assert.deepEqual(
    headings,
    ['Cause'],
    'Grading group has no populated fields, so it is omitted'
  );
});

test('CRCaptureGroups: connectedCallback renders from properties', () => {
  const el = new CRCaptureGroups();
  el.groups = GROUPS;
  el.capture = {};
  el.canCapture = true;
  el.connectedCallback();
  assert.equal(findAllByClass(el, 'cr-capture-group-header').length, 2);
});

test('CRCaptureGroups: a group without an explicit collapsed flag defaults to expanded', () => {
  const el = new CRCaptureGroups();
  /** @type {any} */
  const groups = [
    { key: 'g', label: 'G', fields: [{ key: 'a', label: 'A', type: 'text' }] },
  ];
  el.update(groups, {}, true);
  assert.deepEqual(
    findAllByClass(el, 'cr-capture-label').map((l) => l.textContent),
    ['A']
  );
});

test('CRCaptureGroups: a non-string captured value renders as empty and is omitted read-only', () => {
  const el = new CRCaptureGroups();
  /** @type {any} */
  const capture = { rootCause: { loginName: 'jsmith', displayName: 'Jane' } };
  // Editable: the text control falls back to empty rather than rendering an object.
  el.update(GROUPS, capture, true);
  assert.equal(findAllByClass(el, 'cr-capture-input')[0].value, '');
  // Read-only: a non-string value is not "populated", so the group is omitted.
  el.update(GROUPS, capture, false);
  assert.equal(findByClass(el, 'cr-capture-value'), null);
});

test('CRCaptureGroups: a select field declared without options still renders the blank option', () => {
  const el = new CRCaptureGroups();
  /** @type {any} */
  const groups = [
    {
      key: 'g',
      label: 'G',
      collapsed: false,
      fields: [{ key: 's', label: 'S', type: 'select' }],
    },
  ];
  el.update(groups, {}, true);
  const opts = findAllByTag(el, 'option').map((o) => o.value);
  assert.deepEqual(opts, ['']);
});

test('CRCaptureGroups: a radio field declared without options renders no inputs', () => {
  const el = new CRCaptureGroups();
  /** @type {any} */
  const groups = [
    {
      key: 'g',
      label: 'G',
      collapsed: false,
      fields: [{ key: 'r', label: 'R', type: 'radio' }],
    },
  ];
  el.update(groups, {}, true);
  assert.equal(
    findAllByTag(el, 'input').filter((i) => i.type === 'radio').length,
    0
  );
});

// ===== node reuse on value-only updates (scroll/focus preservation) =====
// An autosave-driven re-render that only changes field values must NOT tear down
// the controls: rebuilding detaches the control the Reviewer is editing, which
// loses focus and resets page scroll (the "thrown back to the top" bug).

test('CRCaptureGroups: a value-only update reuses the same control node and reflects the new value', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, { rootCause: 'First' }, true);
  const before = findAllByClass(el, 'cr-capture-input')[0];
  assert.equal(before.value, 'First');

  el.update(GROUPS, { rootCause: 'Second' }, true);
  const after = findAllByClass(el, 'cr-capture-input')[0];
  assert.strictEqual(after, before, 'text control reused, not recreated');
  assert.equal(after.value, 'Second', 'reused control shows the new value');
});

test('CRCaptureGroups: a value-only update syncs radio checked state in place', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, {}, true);
  findAllByClass(el, 'cr-capture-group-header')[1]._fire('click'); // expand Grading
  const radiosBefore = findAllByTag(el, 'input').filter(
    (i) => i.type === 'radio'
  );

  el.update(GROUPS, { repeat: 'Yes' }, true);
  const radiosAfter = findAllByTag(el, 'input').filter(
    (i) => i.type === 'radio'
  );
  assert.strictEqual(radiosAfter[0], radiosBefore[0], 'radio inputs reused');
  assert.deepEqual(
    radiosAfter.map((r) => r.checked),
    [true, false],
    'reused radios reflect the new value'
  );
});

test('CRCaptureGroups: a structural change (edit→read-only) still rebuilds', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, { rootCause: 'X' }, true);
  assert.ok(findByClass(el, 'cr-capture-input'), 'editable controls present');

  el.update(GROUPS, { rootCause: 'X' }, false);
  assert.equal(
    findByClass(el, 'cr-capture-input'),
    null,
    'read-only rebuild replaces controls with static text'
  );
});

test('CRCaptureGroups: expanding a group rebuilds (structure changed, not a value-only sync)', () => {
  const el = new CRCaptureGroups();
  el.update(GROUPS, {}, true);
  // Grading starts collapsed -> no Severity control.
  assert.equal(
    findAllByTag(el, 'select').length,
    0,
    'collapsed group has no controls'
  );
  findAllByClass(el, 'cr-capture-group-header')[1]._fire('click'); // expand Grading
  assert.equal(
    findAllByTag(el, 'select').length,
    1,
    'expanding the group builds its controls'
  );
});
