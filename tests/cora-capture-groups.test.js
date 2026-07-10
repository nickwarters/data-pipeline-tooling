// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installDom,
  findByClass,
  findAllByClass,
  StubEl,
} from './_dom-stub.js';

installDom();

await import('../src/components/sections/cora-capture-groups.js');

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

/**
 * Create the `<cora-capture-groups>` element, seed its inputs and mount it — the
 * lifecycle a real parent drives when it appends the element to the DOM.
 * @param {any} groups @param {any} capture @param {boolean} canCapture
 */
function mount(groups, capture, canCapture) {
  const el = /** @type {any} */ (
    globalThis.document.createElement('cora-capture-groups')
  );
  el.groups = groups;
  el.capture = capture;
  el.canCapture = canCapture;
  el.connectedCallback();
  return el;
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

test('CORACaptureGroups: editable mode renders a header per group', () => {
  const el = mount(GROUPS, {}, true);
  const headers = findAllByClass(el, 'cora-capture-group-header');
  assert.deepEqual(
    headers.map((h) => h.textContent),
    ['Cause', 'Grading']
  );
});

test('CORACaptureGroups: an expanded group renders its field controls; a collapsed group hides them', () => {
  const el = mount(GROUPS, {}, true);
  // GROUPS[0] (Cause) collapsed:false -> fields shown; GROUPS[1] (Grading) collapsed:true -> hidden.
  const fields = findAllByClass(el, 'cora-capture-field');
  const labels = findAllByClass(el, 'cora-capture-label').map(
    (l) => l.textContent
  );
  assert.deepEqual(labels, ['Root cause', 'Detail']);
  assert.equal(fields.length, 2);
});

test('CORACaptureGroups: clicking a collapsed group header expands it (ephemeral)', () => {
  const el = mount(GROUPS, {}, true);
  const gradingHeader = findAllByClass(el, 'cora-capture-group-header')[1];
  gradingHeader._fire('click');
  const labels = findAllByClass(el, 'cora-capture-label').map(
    (l) => l.textContent
  );
  assert.deepEqual(labels, ['Root cause', 'Detail', 'Severity', 'Repeat?']);
});

test('CORACaptureGroups: clicking an expanded group header collapses it', () => {
  const el = mount(GROUPS, {}, true);
  const causeHeader = findAllByClass(el, 'cora-capture-group-header')[0];
  causeHeader._fire('click');
  const labels = findAllByClass(el, 'cora-capture-label').map(
    (l) => l.textContent
  );
  // Cause now collapsed; Grading still collapsed -> no field labels at all.
  assert.deepEqual(labels, []);
});

test('CORACaptureGroups: collapse state survives a re-render via update()', () => {
  const el = mount(GROUPS, {}, true);
  findAllByClass(el, 'cora-capture-group-header')[1]._fire('click'); // expand Grading
  el.update(GROUPS, { severity: 'High' }, true); // autosave-style re-render
  const labels = findAllByClass(el, 'cora-capture-label').map(
    (l) => l.textContent
  );
  assert.ok(
    labels.includes('Severity'),
    'Grading stayed expanded after re-render'
  );
});

test('CORACaptureGroups: text and textarea controls reflect the current capture value', () => {
  const el = mount(GROUPS, { rootCause: 'Rushed', detail: 'Long note' }, true);
  const inputs = findAllByClass(el, 'cora-capture-input');
  assert.equal(inputs[0]._tagName, 'input');
  assert.equal(inputs[0].value, 'Rushed');
  assert.equal(inputs[1]._tagName, 'textarea');
  assert.equal(inputs[1].value, 'Long note');
});

test('CORACaptureGroups: select renders a blank plus the options and reflects current value', () => {
  const el = mount(GROUPS, { severity: 'Med' }, true);
  findAllByClass(el, 'cora-capture-group-header')[1]._fire('click'); // expand Grading
  const select = findAllByTag(el, 'select')[0];
  const opts = findAllByTag(select, 'option').map((o) => o.value);
  assert.deepEqual(opts, ['', 'Low', 'Med', 'High']);
  assert.equal(select.value, 'Med');
});

test('CORACaptureGroups: radio renders one input per option with the current one checked', () => {
  const el = mount(GROUPS, { repeat: 'No' }, true);
  findAllByClass(el, 'cora-capture-group-header')[1]._fire('click'); // expand Grading
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

test('CORACaptureGroups: radio names are scoped per instance so separate Answers are independent groups', () => {
  const a = mount(GROUPS, {}, true);
  const b = mount(GROUPS, {}, true);
  findAllByClass(a, 'cora-capture-group-header')[1]._fire('click'); // expand Grading
  findAllByClass(b, 'cora-capture-group-header')[1]._fire('click');

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

test('CORACaptureGroups: changing a text control dispatches a bubbling cora-capture', () => {
  const el = mount(GROUPS, {}, true);
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-capture', (/** @type {any} */ e) => events.push(e));
  const input = findAllByClass(el, 'cora-capture-input')[0];
  input.value = 'Agent rushed';
  input._fire('change', { target: input });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].detail, {
    fieldKey: 'rootCause',
    value: 'Agent rushed',
  });
  assert.equal(events[0].bubbles, true);
});

test('CORACaptureGroups: selecting a radio option dispatches cora-capture with that option', () => {
  const el = mount(GROUPS, {}, true);
  findAllByClass(el, 'cora-capture-group-header')[1]._fire('click');
  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-capture', (/** @type {any} */ e) => events.push(e));
  const yesRadio = findAllByTag(el, 'input').filter(
    (i) => i.type === 'radio'
  )[0];
  yesRadio._fire('change');
  assert.deepEqual(events[0].detail, { fieldKey: 'repeat', value: 'Yes' });
});

test('CORACaptureGroups: read-only mode shows only populated fields as static text, no inputs', () => {
  const el = mount(GROUPS, { rootCause: 'Rushed', severity: 'High' }, false);
  assert.equal(
    findByClass(el, 'cora-capture-input'),
    null,
    'no editable controls when read-only'
  );
  const values = findAllByClass(el, 'cora-capture-value').map(
    (v) => v.textContent
  );
  assert.deepEqual(values, ['Root cause: Rushed', 'Severity: High']);
});

test('CORACaptureGroups: read-only mode omits a group with no populated fields', () => {
  const el = mount(GROUPS, { rootCause: 'Rushed' }, false);
  const headings = findAllByClass(el, 'cora-capture-group-heading').map(
    (h) => h.textContent
  );
  assert.deepEqual(
    headings,
    ['Cause'],
    'Grading group has no populated fields, so it is omitted'
  );
});

test('CORACaptureGroups: a group without an explicit collapsed flag defaults to expanded', () => {
  /** @type {any} */
  const groups = [
    { key: 'g', label: 'G', fields: [{ key: 'a', label: 'A', type: 'text' }] },
  ];
  const el = mount(groups, {}, true);
  assert.deepEqual(
    findAllByClass(el, 'cora-capture-label').map((l) => l.textContent),
    ['A']
  );
});

test('CORACaptureGroups: a non-string captured value renders as empty and is omitted read-only', () => {
  /** @type {any} */
  const capture = { rootCause: { loginName: 'jsmith', displayName: 'Jane' } };
  // Editable: the text control falls back to empty rather than rendering an object.
  const editable = mount(GROUPS, capture, true);
  assert.equal(findAllByClass(editable, 'cora-capture-input')[0].value, '');
  // Read-only: a non-string value is not "populated", so the group is omitted.
  const readOnly = mount(GROUPS, capture, false);
  assert.equal(findByClass(readOnly, 'cora-capture-value'), null);
});

test('CORACaptureGroups: a select field declared without options still renders the blank option', () => {
  /** @type {any} */
  const groups = [
    {
      key: 'g',
      label: 'G',
      collapsed: false,
      fields: [{ key: 's', label: 'S', type: 'select' }],
    },
  ];
  const el = mount(groups, {}, true);
  const opts = findAllByTag(el, 'option').map((o) => o.value);
  assert.deepEqual(opts, ['']);
});

test('CORACaptureGroups: a radio field declared without options renders no inputs', () => {
  /** @type {any} */
  const groups = [
    {
      key: 'g',
      label: 'G',
      collapsed: false,
      fields: [{ key: 'r', label: 'R', type: 'radio' }],
    },
  ];
  const el = mount(groups, {}, true);
  assert.equal(
    findAllByTag(el, 'input').filter((i) => i.type === 'radio').length,
    0
  );
});

test('CORACaptureGroups: update() before mount seeds the props the first render reads', () => {
  const el = /** @type {any} */ (
    globalThis.document.createElement('cora-capture-groups')
  );
  // Parent order: assign + update() run before the element is appended (mounted).
  el.update(GROUPS, { rootCause: 'Seed' }, true);
  el.connectedCallback();
  assert.equal(findAllByClass(el, 'cora-capture-group-header').length, 2);
  assert.equal(findAllByClass(el, 'cora-capture-input')[0].value, 'Seed');
});

// ===== focus / scroll preservation on value-only updates =====
// An autosave-driven re-render that only changes field values must NOT tear down
// the controls: rebuilding detaches the control the Reviewer is editing, which
// loses focus and — because it breaks the browser's scroll anchoring — throws
// the page back to the top on every capture edit. So a value-only update syncs
// values into the existing control nodes in place.

test('CORACaptureGroups: capture controls carry a stable per-field data-focus-key', () => {
  const el = mount(GROUPS, {}, true);
  const rootCause = findAllByClass(el, 'cora-capture-input')[0];
  const key = rootCause.getAttribute('data-focus-key');
  assert.ok(
    typeof key === 'string' && key.endsWith('rootCause'),
    'text control is keyed by its field'
  );
});

test('CORACaptureGroups: a value-only update reuses the same control node and reflects the new value', () => {
  const el = mount(GROUPS, { rootCause: 'First' }, true);
  const before = findAllByClass(el, 'cora-capture-input')[0];
  before.focus(); // Reviewer is editing this control
  assert.equal(before.value, 'First');

  el.update(GROUPS, { rootCause: 'Second' }, true);

  const after = findAllByClass(el, 'cora-capture-input')[0];
  assert.strictEqual(after, before, 'text control reused, not recreated');
  assert.equal(after.value, 'Second', 'reused control shows the new value');
  assert.equal(after._focused, true, 'focus is never lost');
});

test('CORACaptureGroups: a value-only update syncs radio checked state in place', () => {
  const el = mount(GROUPS, {}, true);
  findAllByClass(el, 'cora-capture-group-header')[1]._fire('click'); // expand Grading
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

test('CORACaptureGroups: a value-only update leaves a collapsed group untouched', () => {
  // GROUPS[1] (Grading) is collapsed, so it has no live controls; the value-only
  // sync must skip it without error and not surface its fields.
  const el = mount(GROUPS, { rootCause: 'First' }, true);
  el.update(GROUPS, { rootCause: 'Second', severity: 'High' }, true);
  const labels = findAllByClass(el, 'cora-capture-label').map(
    (l) => l.textContent
  );
  assert.deepEqual(labels, ['Root cause', 'Detail']);
});

test('CORACaptureGroups: a value-only update tolerates an optionless radio', () => {
  /** @type {any} */
  const groups = [
    {
      key: 'g',
      label: 'G',
      collapsed: false,
      fields: [{ key: 'r', label: 'R', type: 'radio' }],
    },
  ];
  const el = mount(groups, {}, true);
  // No inputs to sync — the update must be a no-op, not a crash.
  el.update(groups, { r: 'anything' }, true);
  assert.equal(
    findAllByTag(el, 'input').filter((i) => i.type === 'radio').length,
    0
  );
});

test('CORACaptureGroups: a structural change (edit→read-only) rebuilds', () => {
  const el = mount(GROUPS, { rootCause: 'X' }, true);
  assert.ok(findByClass(el, 'cora-capture-input'), 'editable controls present');

  el.update(GROUPS, { rootCause: 'X' }, false);
  assert.equal(
    findByClass(el, 'cora-capture-input'),
    null,
    'read-only rebuild replaces controls with static text'
  );
});

test('CORACaptureGroups: read-only → editable via update() rebuilds the controls', () => {
  const el = mount(GROUPS, { rootCause: 'X' }, false);
  assert.equal(findByClass(el, 'cora-capture-input'), null, 'starts read-only');

  el.update(GROUPS, { rootCause: 'X' }, true);
  assert.ok(
    findByClass(el, 'cora-capture-input'),
    'editable controls built when canCapture flips on'
  );
});

test('CORACaptureGroups: a structural change to the groups rebuilds rather than syncing', () => {
  const el = mount(GROUPS, {}, true);
  /** @type {any} */
  const extended = [
    {
      key: 'cause',
      label: 'Cause',
      collapsed: false,
      fields: [
        { key: 'rootCause', label: 'Root cause', type: 'text' },
        { key: 'detail', label: 'Detail', type: 'textarea' },
        { key: 'extra', label: 'Extra', type: 'text' },
      ],
    },
  ];
  el.update(extended, {}, true);
  const labels = findAllByClass(el, 'cora-capture-label').map(
    (l) => l.textContent
  );
  assert.deepEqual(
    labels,
    ['Root cause', 'Detail', 'Extra'],
    'the new field is rendered, so a rebuild happened'
  );
});

test('CORACaptureGroups: toggling a group keeps focus on its header so the scroll is anchored', () => {
  const el = mount(GROUPS, {}, true);
  const header = findAllByClass(el, 'cora-capture-group-header')[1]; // Grading
  assert.ok(
    header.getAttribute('data-focus-key'),
    'header carries a focus key'
  );
  header.focus(); // clicking a header focuses it in Edge Chromium
  header._fire('click'); // expand — rebuilds the element

  const rebuiltHeader = findAllByClass(el, 'cora-capture-group-header')[1];
  assert.equal(
    rebuiltHeader._focused,
    true,
    'focus is restored to the rebuilt header, holding the page scroll'
  );
});

test("CORACaptureGroups: toggling a group preserves the app scroll container's offsets", () => {
  // Mirrors the real bug: focusing the rebuilt header without preventScroll
  // scrolls the app's fixed-position scroll container. Simulate that side
  // effect on every focus() call, then assert the toggle's scroll-preserving
  // wrapper restores the container to where it was before the click.
  const container = { getAttribute: () => '', scrollLeft: 0, scrollTop: 500 };
  const originalQuerySelector = globalThis.document.querySelector;
  globalThis.document.querySelector = (/** @type {string} */ sel) =>
    sel === '#app[data-cora-root]' ? container : originalQuerySelector(sel);
  const originalFocus = StubEl.prototype.focus;
  StubEl.prototype.focus = function (/** @type {any} */ options) {
    originalFocus.call(this, options);
    container.scrollTop = 0; // the scroll jump the bug produces
  };
  try {
    const el = mount(GROUPS, {}, true);
    const header = findAllByClass(el, 'cora-capture-group-header')[1]; // Grading
    header._fire('click'); // expand — rebuilds the element and refocuses the header

    assert.equal(
      container.scrollTop,
      500,
      'app scroll container restored after the toggle rebuild'
    );
  } finally {
    globalThis.document.querySelector = originalQuerySelector;
    StubEl.prototype.focus = originalFocus;
  }
});

test('CORACaptureGroups: expanding a group builds its controls', () => {
  const el = mount(GROUPS, {}, true);
  // Grading starts collapsed -> no Severity control.
  assert.equal(
    findAllByTag(el, 'select').length,
    0,
    'collapsed group has no controls'
  );
  findAllByClass(el, 'cora-capture-group-header')[1]._fire('click'); // expand Grading
  assert.equal(
    findAllByTag(el, 'select').length,
    1,
    'expanding the group builds its controls'
  );
});
