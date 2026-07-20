// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
} from './helpers/semantic-dom.js';

installDom();

const { CaptureGroups } =
  await import('../src/components/sections/cora-capture-groups.js');

const GROUPS =
  /** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */ ([
    {
      key: 'cause',
      label: 'Cause',
      fields: [
        { key: 'text', label: 'Text', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
        {
          key: 'severity',
          label: 'Severity',
          type: 'select',
          options: ['Low', 'High'],
        },
        {
          key: 'repeat',
          label: 'Repeat?',
          type: 'radio',
          options: ['Yes', 'No'],
        },
      ],
    },
    { key: 'hidden', label: 'Hidden', collapsed: true, fields: [] },
  ]);

/** @param {Node[]} nodes */
function rootOf(nodes) {
  const root = document.createElement('div');
  root.append(...nodes);
  return root;
}

test('CaptureGroups renders typed editable controls with current values and scoped focus keys', () => {
  const root = rootOf(
    CaptureGroups({
      groups: GROUPS,
      capture: {
        text: 'Rushed',
        notes: 'Details',
        severity: 'High',
        repeat: 'Yes',
      },
      canCapture: true,
      namePrefix: 'q1-',
      collapsed: new Map(),
      onToggle() {},
      onCapture() {},
    })
  );
  assert.equal(
    /** @type {any} */ (
      root.querySelector('[data-focus-key="capture:q1-text"]')
    )?.value,
    'Rushed'
  );
  assert.equal(root.querySelector('textarea')?.value, 'Details');
  assert.equal(root.querySelector('select')?.value, 'High');
  assert.equal(getByRole(root, 'radio', { name: 'Yes' }).checked, true);
  assert.equal(
    getByRole(root, 'button', { name: 'Hidden' }).getAttribute('aria-expanded'),
    'false'
  );
});

test('CaptureGroups reports collapse and field edits through callbacks', () => {
  /** @type {any[]} */
  const actions = [];
  const root = rootOf(
    CaptureGroups({
      groups: GROUPS,
      capture: {},
      canCapture: true,
      namePrefix: 'q1-',
      collapsed: new Map(),
      onToggle: (key, collapsed) => actions.push(['toggle', key, collapsed]),
      onCapture: (key, value) => actions.push(['capture', key, value]),
    })
  );
  fireEvent(getByRole(root, 'button', { name: 'Cause' }), 'click');
  const text = /** @type {any} */ (root.querySelector('.cora-capture-input'));
  text.value = 'Training gap';
  fireEvent(text, 'change');
  const no = getByRole(root, 'radio', { name: 'No' });
  no.checked = true;
  fireEvent(no, 'change');
  assert.deepEqual(actions, [
    ['toggle', 'cause', true],
    ['capture', 'text', 'Training gap'],
    ['capture', 'repeat', 'No'],
  ]);
});

test('CaptureGroups honours a store-owned collapse override', () => {
  const root = rootOf(
    CaptureGroups({
      groups: GROUPS,
      capture: {},
      canCapture: true,
      namePrefix: '',
      collapsed: new Map([
        ['cause', true],
        ['hidden', false],
      ]),
      onToggle() {},
      onCapture() {},
    })
  );
  assert.equal(queryAllByRole(root, 'radio').length, 0);
  assert.equal(
    getByRole(root, 'button', { name: 'Cause' }).getAttribute('aria-expanded'),
    'false'
  );
  assert.equal(
    getByRole(root, 'button', { name: 'Hidden' }).getAttribute('aria-expanded'),
    'true'
  );
});

test('CaptureGroups read-only mode shows only populated string values', () => {
  const root = rootOf(
    CaptureGroups({
      groups: GROUPS,
      capture: {
        text: 'Rushed',
        notes: /** @type {any} */ ({ ignored: true }),
      },
      canCapture: false,
      namePrefix: '',
      collapsed: new Map(),
      onToggle() {},
      onCapture() {},
    })
  );
  assert.match(root.textContent, /CauseText: Rushed/);
  assert.doesNotMatch(root.textContent, /Notes:/);
  assert.equal(root.querySelector('input'), null);
});

test('CaptureGroups omits empty read-only groups', () => {
  assert.deepEqual(
    CaptureGroups({
      groups: GROUPS,
      capture: {},
      canCapture: false,
      namePrefix: '',
      collapsed: new Map(),
      onToggle() {},
      onCapture() {},
    }),
    []
  );
});
