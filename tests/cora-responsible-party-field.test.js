// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByText,
  queryAllByRole,
  queryByRole,
} from './helpers/semantic-dom.js';

installDom();

const { RemediationSection, ResponsiblePartyField } =
  await import('../src/pages/cora-case-review/remediation-view.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */

/** @type {QuestionDefinition[]} */
const CATALOGUE = [
  {
    id: 'q1',
    text: 'Greeted?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
];

const PICKER_NAME = 'Search people for Responsible Party';

/** @param {Partial<Parameters<typeof RemediationSection>[0]>} overrides */
function props(overrides = {}) {
  return /** @type {Parameters<typeof RemediationSection>[0]} */ ({
    catalogue: CATALOGUE,
    // The field only shows once some failure asks for remediation, so the
    // default Answers are the state that shows it.
    answers: { q1: { value: 'No', remediationRequired: 'yes' } },
    responsibleParty: null,
    captureGroups: [],
    captureCollapsed: {},
    responsiblePartySearch: { query: '', people: [] },
    canEditIssues: false,
    dispatchCapture() {},
    dispatchCaptureToggle() {},
    dispatchRemediationAction() {},
    dispatchRemediationFreeForm() {},
    dispatchRemediationRequired() {},
    dispatchResponsibleParty() {},
    dispatchResponsiblePartySearch() {},
    ...overrides,
  });
}

/** @param {Node[]} nodes */
function host(nodes) {
  const root = document.createElement('div');
  for (const node of nodes) root.appendChild(/** @type {any} */ (node));
  return root;
}

test('a Case with no failures is not asked for a Responsible Party', () => {
  // Nobody is being sent anything, so there is nobody to name — and asking
  // would leave the completion control disabled against an invisible field.
  const root = host(
    RemediationSection(props({ answers: {}, canEditIssues: true }))
  );
  assert.ok(getByText(root, 'No failures.'), 'still says so');
  assert.equal(findByClass(root, 'cora-responsible-party-field'), null);
  assert.equal(queryByRole(root, 'combobox'), null);
  assert.equal(
    ResponsiblePartyField(props({ answers: {}, canEditIssues: true })),
    null
  );
});

test('the Responsible Party field follows the remediation decision', () => {
  /** @param {any} q1 */
  const field = (q1) =>
    ResponsiblePartyField(props({ answers: { q1 }, canEditIssues: true }));

  assert.equal(
    field({ value: 'No' }),
    null,
    'an undecided failure has asked for nothing yet'
  );
  assert.equal(
    field({ value: 'No', remediationRequired: 'no' }),
    null,
    'a failure decided No needs no recipient'
  );
  assert.ok(
    field({ value: 'No', remediationRequired: 'yes' }),
    'one Yes is enough'
  );
});

test('an already-named Responsible Party stays visible if the decision is withdrawn', () => {
  // The stored value still drives reporting, the Responsible Party dashboard
  // and Section access, so hiding it would hide a fact about the Case.
  const node = ResponsiblePartyField(
    props({
      answers: {},
      canEditIssues: true,
      responsibleParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
    })
  );
  const root = host(node ? [node] : []);
  assert.equal(
    findByClass(root, 'cora-responsible-party-current').textContent,
    'Jane Smith'
  );
});

test('the Responsible Party field is the last thing on the Issues tab', () => {
  const nodes = RemediationSection(
    props({
      answers: { q1: { value: 'No', remediationRequired: 'yes' } },
      canEditIssues: true,
    })
  );
  const last = /** @type {any} */ (nodes[nodes.length - 1]);
  assert.equal(last.className, 'cora-responsible-party-field');
});

test('a set Responsible Party reads back as plain text once the field is read-only', () => {
  const node = ResponsiblePartyField(
    props({
      responsibleParty: { loginName: 'jsmith', displayName: 'Jane Smith' },
    })
  );
  const root = host(node ? [node] : []);
  assert.equal(
    findByClass(root, 'cora-responsible-party-value').textContent,
    'Responsible Party: Jane Smith'
  );
  assert.equal(queryByRole(root, 'combobox'), null);
});

test('a read-only field with no Responsible Party renders nothing at all', () => {
  assert.equal(ResponsiblePartyField(props()), null);
});

test('typing in the Responsible Party picker asks the route to search', () => {
  /** @type {string[]} */
  const queries = [];
  const node = ResponsiblePartyField(
    props({
      canEditIssues: true,
      dispatchResponsiblePartySearch: (query) => queries.push(query),
    })
  );
  const root = host(node ? [node] : []);
  assert.ok(findByClass(root, 'cora-responsible-party-label'));
  const input = getByRole(root, 'combobox', { name: PICKER_NAME });
  input.value = 'Jane';
  fireEvent(input, 'input');
  assert.deepEqual(queries, ['Jane']);
});

test('choosing a search result hands the whole Party to the route', () => {
  /** @type {any[]} */
  const chosen = [];
  const person = { loginName: 'jsmith', displayName: 'Jane Smith' };
  const node = ResponsiblePartyField(
    props({
      canEditIssues: true,
      responsibleParty: { loginName: 'old', displayName: 'Old Owner' },
      responsiblePartySearch: { query: 'Jane', people: [person] },
      dispatchResponsibleParty: (party) => chosen.push(party),
    })
  );
  const root = host(node ? [node] : []);
  assert.equal(
    findByClass(root, 'cora-responsible-party-current').textContent,
    'Old Owner'
  );
  const [option] = queryAllByRole(root, 'option');
  fireEvent(option, 'click');
  assert.deepEqual(chosen, [person]);
});

test('a Responsible Party search that finds nobody offers no raw account', () => {
  // This one field resolves a Role and gates completion, and it is read-only
  // once the actions are sent, so a typo would be unrecoverable from the page.
  const node = ResponsiblePartyField(
    props({
      canEditIssues: true,
      responsiblePartySearch: { query: 'nobody', people: [] },
    })
  );
  const root = host(node ? [node] : []);
  assert.deepEqual(queryAllByRole(root, 'option'), []);
});
