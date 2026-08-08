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

const PERSON_GROUPS =
  /** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */ ([
    {
      key: 'blame',
      label: 'Blame',
      fields: [{ key: 'attributedTo', label: 'Attributed to', type: 'person' }],
    },
  ]);

const PERSON = { loginName: 'corp\\jsmith', displayName: 'Jane Smith' };

/**
 * @param {Record<string, any>} overrides
 * @returns {any}
 */
function personProps(overrides) {
  return {
    groups: PERSON_GROUPS,
    capture: {},
    canCapture: true,
    namePrefix: 'q1-',
    collapsed: new Map(),
    peopleSearch: {},
    onToggle() {},
    onCapture() {},
    onPersonQuery() {},
    ...overrides,
  };
}

/** @param {Node[]} nodes */
function rootOf(nodes) {
  const root = document.createElement('div');
  root.append(...nodes);
  return root;
}

test('CaptureGroups renders typed editable controls carrying their current values', () => {
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
      peopleSearch: {},
      onToggle() {},
      onCapture() {},
      onPersonQuery() {},
    })
  );
  assert.equal(getByRole(root, 'textbox', { name: 'Text' }).value, 'Rushed');
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
      peopleSearch: {},
      onToggle: (key, collapsed) => actions.push(['toggle', key, collapsed]),
      onCapture: (key, value) => actions.push(['capture', key, value]),
      onPersonQuery() {},
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
      peopleSearch: {},
      onToggle() {},
      onCapture() {},
      onPersonQuery() {},
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
      peopleSearch: {},
      onToggle() {},
      onCapture() {},
      onPersonQuery() {},
    })
  );
  assert.match(root.textContent, /CauseText: Rushed/);
  assert.doesNotMatch(root.textContent, /Notes:/);
  assert.equal(root.querySelector('input'), null);
});

test('CaptureGroups renders a person field as a people picker, not a text box', () => {
  /** @type {any[]} */
  const queries = [];
  /** @type {any[]} */
  const captured = [];
  const root = rootOf(
    CaptureGroups(
      personProps({
        peopleSearch: {
          attributedTo: { query: 'Ja', people: [PERSON], status: 'success' },
        },
        onPersonQuery: (/** @type {any} */ key, /** @type {any} */ query) =>
          queries.push([key, query]),
        onCapture: (/** @type {any} */ key, /** @type {any} */ value) =>
          captured.push([key, value]),
      })
    )
  );

  const input = getByRole(root, 'combobox', {
    name: 'Search people for Attributed to',
  });
  assert.equal(input.value, 'Ja');

  input.value = 'Jan';
  fireEvent(input, 'input');
  assert.deepEqual(queries, [['attributedTo', 'Jan']]);

  fireEvent(getByRole(root, 'option', { name: /Jane Smith/ }), 'click');
  assert.deepEqual(captured, [['attributedTo', PERSON]]);
});

test('CaptureGroups never offers a person the directory has not resolved', () => {
  // The picker used to offer the typed text as an account whenever it had no
  // matches — which included the debounce window, the request itself, and a
  // request that failed outright.
  for (const status of /** @type {const} */ (['loading', 'error'])) {
    const root = rootOf(
      CaptureGroups(
        personProps({
          peopleSearch: {
            attributedTo: { query: 'someone', people: [], status },
          },
        })
      )
    );
    assert.deepEqual(queryAllByRole(root, 'option'), [], status);
  }

  const answered = rootOf(
    CaptureGroups(
      personProps({
        peopleSearch: {
          attributedTo: { query: 'someone', people: [], status: 'success' },
        },
      })
    )
  );
  assert.deepEqual(queryAllByRole(answered, 'option'), []);
  assert.equal(
    answered.querySelector('.cora-people-picker-status')?.textContent ?? null,
    'No matches'
  );
});

test('CaptureGroups collapses a chosen person to their name plus a clear control', () => {
  /** @type {any[]} */
  const captured = [];
  const root = rootOf(
    CaptureGroups(
      personProps({
        capture: { attributedTo: PERSON },
        onCapture: (/** @type {any} */ key, /** @type {any} */ value) =>
          captured.push([key, value]),
      })
    )
  );

  assert.equal(queryAllByRole(root, 'combobox').length, 0);
  assert.match(root.textContent, /Jane Smith/);
  fireEvent(
    getByRole(root, 'button', { name: 'Clear Attributed to' }),
    'click'
  );
  assert.deepEqual(captured, [['attributedTo', null]]);
});

test('CaptureGroups shows a person read-only, and keeps their group', () => {
  const root = rootOf(
    CaptureGroups(
      personProps({ capture: { attributedTo: PERSON }, canCapture: false })
    )
  );
  assert.match(root.textContent, /Attributed to: Jane Smith/);
});

test('CaptureGroups reads back a bare string left on a person field', () => {
  // A Case saved before person fields existed holds plain text under the key.
  const legacy = { attributedTo: 'Jane Smith' };
  const readOnly = rootOf(
    CaptureGroups(personProps({ capture: legacy, canCapture: false }))
  );
  assert.match(readOnly.textContent, /Attributed to: Jane Smith/);

  const editable = rootOf(CaptureGroups(personProps({ capture: legacy })));
  assert.match(editable.textContent, /Jane Smith/);
  assert.equal(queryAllByRole(editable, 'combobox').length, 0);
});

test('CaptureGroups omits empty read-only groups', () => {
  assert.deepEqual(
    CaptureGroups({
      groups: GROUPS,
      capture: {},
      canCapture: false,
      namePrefix: '',
      collapsed: new Map(),
      peopleSearch: {},
      onToggle() {},
      onCapture() {},
      onPersonQuery() {},
    }),
    []
  );
});

test('CaptureGroups renders only the fields their siblings reveal', () => {
  const groups =
    /** @type {import('../src/sharepoint-client.js').CaptureGroup[]} */ ([
      {
        key: 'cause',
        label: 'Cause',
        fields: [
          { key: 'origin', label: 'Origin', type: 'text' },
          {
            key: 'salesTeam',
            label: 'Sales team',
            type: 'text',
            showWhen: { origin: { equals: 'Sales' } },
          },
        ],
      },
    ]);
  /** @param {any} capture @param {boolean} canCapture */
  const render = (capture, canCapture) =>
    rootOf(
      CaptureGroups(
        /** @type {any} */ ({
          groups,
          capture,
          canCapture,
          namePrefix: '',
          collapsed: new Map(),
          peopleSearch: {},
          onToggle() {},
          onCapture() {},
          onPersonQuery() {},
        })
      )
    );

  assert.doesNotMatch(
    render({ origin: 'Ops' }, true).textContent,
    /Sales team/
  );
  assert.match(render({ origin: 'Sales' }, true).textContent, /Sales team/);
  // A Case saved before the rule was authored keeps the stale value; it is the
  // rendering, not the storage, that hides it.
  assert.doesNotMatch(
    render({ origin: 'Ops', salesTeam: 'North' }, false).textContent,
    /Sales team/
  );
});
