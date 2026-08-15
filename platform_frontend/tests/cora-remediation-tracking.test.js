// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  getByText,
  queryAllByRole,
  queryAllByText,
  queryByRole,
  textContent,
} from './helpers/semantic-dom.js';

installDom();

const { RemediationTracking } =
  await import('../src/pages/cora-case-review/remediation-tracking-view.js');

/** @typedef {import('../src/sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../src/sharepoint-client.js').Answer} Answer */

class CORARemediationTracking extends HTMLElement {
  constructor() {
    super();
    /** @type {QuestionDefinition[]} */
    this.catalogue = [];
    /** @type {Record<string, Answer>} */
    this.answers = {};
    /** @type {'reviewer' | 'responsibleParty'} */
    this.audience = 'reviewer';
    this.canResolve = false;
    this.conversationAvailable = true;
    /** @type {string | undefined} */
    this.heading = 'Remediation';
    /** @type {any} */
    this.caseRow = null;
    /** @type {any} */
    this.statuses = undefined;
  }

  /** @param {QuestionDefinition[]} catalogue @param {Record<string, Answer>} answers */
  update(catalogue, answers) {
    this.catalogue = catalogue;
    this.answers = answers;
    this.replaceChildren(...this.render());
  }

  render() {
    return RemediationTracking({
      catalogue: this.catalogue,
      answers: this.answers,
      audience: this.audience,
      canResolve: this.canResolve,
      conversationAvailable: this.conversationAvailable,
      heading: this.heading,
      statuses: this.statuses,
      caseRow: this.caseRow,
      dispatchStatus: (questionId, status, details) =>
        this.dispatchEvent(
          new CustomEvent('cora-remediation-status', {
            detail: { questionId, status, details },
            bubbles: true,
          })
        ),
      dispatchOpenConversation: () =>
        this.dispatchEvent(
          new CustomEvent('cora-open-conversation', { bubbles: true })
        ),
    });
  }
}

/** @type {QuestionDefinition[]} */
const CATALOGUE = [
  {
    id: 'q1',
    text: 'Greeted the customer?',
    category: 'Opening',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
  {
    id: 'q2',
    text: 'Explained the outcome?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
];

/** @type {Record<string, Answer>} */
const REMEDIATED = {
  q1: {
    value: 'No',
    remediationActions: [{ id: 'a1', text: 'Call the customer back' }],
    freeFormRemediation: 'Apologise in writing',
  },
  // Failed, but the Reviewer attached no remediation — never a row.
  q2: { value: 'No' },
};

test('RemediationTracking: no remediation on the Case → empty state', () => {
  const el = new CORARemediationTracking();
  el.update(CATALOGUE, { q1: { value: 'No' } });
  assert.ok(getByText(el, /no remediation actions sent/i));
});

test('RemediationTracking: one row per Question carrying remediation, listing its actions', () => {
  const el = new CORARemediationTracking();
  el.update(CATALOGUE, REMEDIATED);

  const list = queryAllByRole(el, 'list').find(
    (node) => node.parentNode === el
  );
  assert.ok(list, 'the remediation list is rendered');
  const items = queryAllByRole(list, 'listitem').filter(
    (node) => node.parentNode === list
  );
  assert.equal(
    items.length,
    1,
    'the failed Question with no remediation is omitted'
  );
  assert.equal(items[0].getAttribute('key'), 'q1');

  assert.ok(getByText(items[0], 'Greeted the customer?'));
  const actions = queryAllByRole(items[0], 'list').find(
    (node) => node.parentNode === items[0]
  );
  assert.ok(actions, 'the selected actions are a nested list');
  const actionItems = queryAllByRole(actions, 'listitem').filter(
    (node) => node.parentNode === actions
  );
  assert.equal(actionItems.length, 1);
  assert.equal(textContent(actionItems[0]), 'Call the customer back');
  assert.ok(getByText(items[0], 'Apologise in writing'));
  assert.equal(queryAllByText(el, 'Explained the outcome?').length, 0);
});

test('RemediationTracking: free-form remediation alone is a row, to both audiences', () => {
  // Remediation Actions are optional *within* a remediated Answer too: the
  // Reviewer may have typed free-form text and selected no actions at all.
  /** @type {Record<string, Answer>} */
  const answers = {
    q1: { value: 'No', freeFormRemediation: 'Write to the customer' },
  };

  for (const audience of /** @type {const} */ ([
    'reviewer',
    'responsibleParty',
  ])) {
    const el = new CORARemediationTracking();
    el.audience = audience;
    el.canResolve = audience === 'reviewer';
    el.update(CATALOGUE, answers);

    const list = queryAllByRole(el, 'list').find(
      (node) => node.parentNode === el
    );
    assert.ok(list, audience);
    const items = queryAllByRole(list, 'listitem').filter(
      (node) => node.parentNode === list
    );
    assert.equal(items.length, 1, audience);
    assert.ok(getByText(items[0], 'Write to the customer'), audience);
    // No actions list is rendered when there are none to list.
    assert.equal(queryAllByRole(items[0], 'list').length, 0);
  }
});

test('RemediationTracking: a passed Question with remediation attached is not a row', () => {
  const el = new CORARemediationTracking();
  el.update(CATALOGUE, {
    q1: {
      value: 'Yes',
      remediationActions: [{ id: 'a1', text: 'Stale' }],
    },
  });
  assert.ok(getByText(el, /no remediation actions sent/i));
});

// --- The reviewing side ---

test('RemediationTracking: an observer sees the resolution but no controls', () => {
  const el = new CORARemediationTracking();
  el.canResolve = false;
  el.update(CATALOGUE, {
    q1: {
      value: 'No',
      remediationActions: [{ id: 'a1', text: 'Call back' }],
      remediationStatus: { status: 'cancelled', details: 'Customer declined' },
    },
  });

  assert.equal(queryByRole(el, 'combobox'), null);
  assert.ok(getByText(el, 'Status: Cancelled'));
  assert.ok(getByText(el, 'Justification: Customer declined'));
});

test('RemediationTracking: an unresolved row reads as awaiting the Reviewer', () => {
  const el = new CORARemediationTracking();
  el.canResolve = false;
  el.update(CATALOGUE, REMEDIATED);
  assert.ok(getByText(el, 'Status: Awaiting the Reviewer'));
});

test('RemediationTracking: the Reviewer gets a three-value select per Question', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.update(CATALOGUE, REMEDIATED);

  const select = getByRole(el, 'combobox', {
    name: 'Remediation outcome for "Greeted the customer?"',
  });
  assert.deepEqual(
    queryAllByRole(select, 'option').map((option) => [
      option.value,
      textContent(option),
    ]),
    [
      ['', 'Not yet resolved'],
      ['complete', 'Complete'],
      ['partial', 'Partially complete'],
      ['cancelled', 'Cancelled'],
    ]
  );
});

test('RemediationTracking: choosing a resolution dispatches it for the Question', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.update(CATALOGUE, REMEDIATED);

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-status', (/** @type {any} */ e) =>
    events.push(e.detail)
  );

  const select = getByRole(el, 'combobox', {
    name: 'Remediation outcome for "Greeted the customer?"',
  });
  select.value = 'complete';
  fireEvent(select, 'change');

  assert.deepEqual(events, [
    { questionId: 'q1', status: 'complete', details: '' },
  ]);
});

test('RemediationTracking: the details box stays hidden for complete', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.update(CATALOGUE, REMEDIATED);
  assert.equal(
    getByRole(el, 'textbox', {
      name: 'Details for "Greeted the customer?"',
    }).hidden,
    true
  );

  el.update(CATALOGUE, {
    q1: { ...REMEDIATED.q1, remediationStatus: { status: 'complete' } },
  });
  assert.equal(
    getByRole(el, 'textbox', {
      name: 'Details for "Greeted the customer?"',
    }).hidden,
    true
  );
});

test('RemediationTracking: partially complete asks for details and flags them as required', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.update(CATALOGUE, {
    q1: { ...REMEDIATED.q1, remediationStatus: { status: 'partial' } },
  });

  const details = getByRole(el, 'textbox', {
    name: 'Details for "Greeted the customer?"',
  });
  assert.equal(details.hidden, false);
  assert.equal(details.getAttribute('placeholder'), 'Details (required)');
  assert.ok(getByText(el, /Details is required\./));
  assert.ok(
    getByText(el, /Record an outcome for every remediation above/),
    'the panel says the Case cannot be completed yet'
  );
});

test('RemediationTracking: cancelled asks for a justification instead', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.update(CATALOGUE, {
    q1: { ...REMEDIATED.q1, remediationStatus: { status: 'cancelled' } },
  });

  const details = getByRole(el, 'textbox', {
    name: 'Justification for "Greeted the customer?"',
  });
  assert.equal(details.getAttribute('placeholder'), 'Justification (required)');
  assert.ok(getByText(el, /Justification is required\./));
});

test('RemediationTracking: typing details dispatches them against the current status', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.update(CATALOGUE, {
    q1: { ...REMEDIATED.q1, remediationStatus: { status: 'partial' } },
  });

  /** @type {any[]} */
  const events = [];
  el.addEventListener('cora-remediation-status', (/** @type {any} */ e) =>
    events.push(e.detail)
  );

  const details = getByRole(el, 'textbox', {
    name: 'Details for "Greeted the customer?"',
  });
  details.value = 'Two of three actions done';
  fireEvent(details, 'input');

  assert.deepEqual(events, [
    {
      questionId: 'q1',
      status: 'partial',
      details: 'Two of three actions done',
    },
  ]);
});

test('RemediationTracking: a fully resolved Case drops the completion warning', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.update(CATALOGUE, {
    q1: { ...REMEDIATED.q1, remediationStatus: { status: 'complete' } },
  });
  assert.equal(
    queryAllByText(el, /Record an outcome for every remediation above/).length,
    0
  );
});

// --- The responsible-party side ---

test('RemediationTracking: the Responsible Party sees the breakdown but none of the fields', () => {
  const el = new CORARemediationTracking();
  el.audience = 'responsibleParty';
  el.canResolve = false;
  el.update(CATALOGUE, {
    q1: {
      ...REMEDIATED.q1,
      remediationStatus: { status: 'partial', details: 'Reviewer-only note' },
    },
  });

  const list = queryAllByRole(el, 'list').find(
    (node) => node.parentNode === el
  );
  assert.ok(list);
  const row = queryAllByRole(list, 'listitem').find(
    (node) => node.parentNode === list
  );
  assert.ok(row);
  assert.ok(getByText(row, 'Call the customer back'));
  assert.equal(queryByRole(row, 'combobox'), null);
  assert.equal(queryByRole(row, 'textbox'), null);
  assert.equal(
    queryAllByText(row, /Reviewer-only note/).length,
    0,
    "the Reviewer's details are not shown to the Responsible Party"
  );
  assert.ok(getByText(row, 'Status: Partially complete'));
});

test('RemediationTracking: the Responsible Party is pointed at the Conversation', () => {
  const el = new CORARemediationTracking();
  el.audience = 'responsibleParty';
  el.update(CATALOGUE, REMEDIATED);

  assert.ok(getByText(el, /Discuss this remediation.*Conversation/));

  let opened = 0;
  el.addEventListener('cora-open-conversation', () => (opened += 1));
  fireEvent(getByRole(el, 'button', { name: 'Open conversation' }), 'click');
  assert.equal(opened, 1);
});

test('RemediationTracking: a viewer without the Conversation gets guidance, not a dead button', () => {
  const el = new CORARemediationTracking();
  el.audience = 'responsibleParty';
  el.conversationAvailable = false;
  el.update(CATALOGUE, REMEDIATED);

  assert.equal(queryByRole(el, 'button', { name: 'Open conversation' }), null);
  assert.ok(getByText(el, /Conversation is not open to you/));
});

test('RemediationTracking: the reviewing side never gets the Conversation prompt', () => {
  const el = new CORARemediationTracking();
  el.audience = 'reviewer';
  el.update(CATALOGUE, REMEDIATED);
  assert.equal(queryByRole(el, 'button', { name: 'Open conversation' }), null);
  assert.equal(queryAllByText(el, /Discuss this remediation/).length, 0);
});

test('RemediationTracking: usable standalone — no dispatchers wired is a no-op, not a crash', () => {
  const nodes = RemediationTracking({
    catalogue: CATALOGUE,
    answers: {
      q1: { ...REMEDIATED.q1, remediationStatus: { status: 'partial' } },
    },
    audience: 'reviewer',
    canResolve: true,
  });
  const host = document.createElement('div');
  host.replaceChildren(...nodes);

  const select = getByRole(host, 'combobox', {
    name: 'Remediation outcome for "Greeted the customer?"',
  });
  select.value = 'complete';
  fireEvent(select, 'change');

  const details = getByRole(host, 'textbox', {
    name: 'Details for "Greeted the customer?"',
  });
  details.value = 'x';
  fireEvent(details, 'input');

  const party = RemediationTracking({
    catalogue: CATALOGUE,
    answers: REMEDIATED,
    audience: 'responsibleParty',
    canResolve: false,
    conversationAvailable: true,
  });
  const partyHost = document.createElement('div');
  partyHost.replaceChildren(...party);
  fireEvent(
    getByRole(partyHost, 'button', { name: 'Open conversation' }),
    'click'
  );
});

// --- SLA and headings (unchanged behaviour) ---

test('RemediationTracking: the Case Type may override the Remediation heading', () => {
  const el = new CORARemediationTracking();
  /** @param {string | undefined} heading */
  const headingText = (heading) => {
    el.heading = heading;
    el.update(CATALOGUE, {});
    return getByRole(el, 'heading').textContent;
  };
  assert.equal(headingText('Fix-up'), 'Fix-up');
  assert.equal(headingText(undefined), 'Remediation');
});

test('RemediationTracking: displays the stored SLA date and overdue evaluator result', () => {
  const el = new CORARemediationTracking();
  el.caseRow = {
    status: 'Actions In Progress',
    remediationDueDate: '2000-01-03',
  };
  el.update(CATALOGUE, {});

  assert.ok(getByText(el, 'Remediation due: 2000-01-03'));
  assert.ok(getByText(el, 'Overdue'));

  el.caseRow = { status: 'Completed', remediationDueDate: '2000-01-03' };
  el.update(CATALOGUE, {});
  assert.equal(queryAllByText(el, 'Overdue').length, 0);

  el.caseRow = null;
  el.update(CATALOGUE, {});
  assert.ok(getByText(el, 'Remediation due: —'));
});

test('RemediationTracking: render() returns nodes', () => {
  const el = new CORARemediationTracking();
  el.update(CATALOGUE, {});
  assert.ok(Array.isArray(el.render()));
});

test('RemediationTracking: the select offers only the resolutions the Case Type declares', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.statuses = ['complete', 'cancelled'];
  el.update(CATALOGUE, REMEDIATED);

  const select = findByClass(el, 'cora-tracking-status-select');
  assert.deepEqual(
    select._children.map((/** @type {any} */ option) => [
      option.value,
      option.textContent,
    ]),
    [
      ['', 'Not yet resolved'],
      ['complete', 'Complete'],
      ['cancelled', 'Cancelled'],
    ]
  );
});

test('RemediationTracking: a stored resolution the Case Type no longer offers is still shown and selected', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.statuses = ['complete', 'cancelled'];
  el.update(CATALOGUE, {
    ...REMEDIATED,
    q1: {
      .../** @type {any} */ (REMEDIATED.q1),
      remediationStatus: { status: 'partial', details: 'Letter drafted' },
    },
  });

  const select = findByClass(el, 'cora-tracking-status-select');
  assert.deepEqual(
    select._children.map((/** @type {any} */ option) => option.value),
    ['', 'complete', 'partial', 'cancelled']
  );
  assert.equal(select.value, 'partial');
});

test('RemediationTracking: an empty declared list still offers the whole vocabulary', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.statuses = [];
  el.update(CATALOGUE, REMEDIATED);

  const select = findByClass(el, 'cora-tracking-status-select');
  assert.deepEqual(
    select._children.map((/** @type {any} */ option) => option.value),
    ['', 'complete', 'partial', 'cancelled']
  );
});
