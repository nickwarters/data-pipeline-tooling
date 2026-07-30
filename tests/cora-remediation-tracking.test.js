// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';

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

/** @param {any} el */
function allText(el) {
  let out = el.textContent ? el.textContent + ' ' : '';
  for (const c of el._children ?? []) out += allText(c);
  return out;
}

test('RemediationTracking: no remediation on the Case → empty state', () => {
  const el = new CORARemediationTracking();
  el.update(CATALOGUE, { q1: { value: 'No' } });
  assert.ok(findByClass(el, 'cora-empty cora-remediation-tracking-empty'));
  assert.match(allText(el), /no remediation actions sent/i);
});

test('RemediationTracking: one row per Question carrying remediation, listing its actions', () => {
  const el = new CORARemediationTracking();
  el.update(CATALOGUE, REMEDIATED);

  const items = findAllByClass(el, 'cora-remediation-tracking-item');
  assert.equal(
    items.length,
    1,
    'the failed Question with no remediation is omitted'
  );
  assert.equal(items[0].getAttribute('key'), 'q1');

  const text = allText(el);
  assert.match(text, /Greeted the customer\?/);
  assert.match(text, /Call the customer back/);
  assert.match(text, /Apologise in writing/);
  assert.doesNotMatch(text, /Explained the outcome\?/);
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

    assert.equal(
      findAllByClass(el, 'cora-remediation-tracking-item').length,
      1,
      audience
    );
    assert.match(allText(el), /Write to the customer/, audience);
    // No actions list is rendered when there are none to list.
    assert.equal(findAllByClass(el, 'cora-tracking-actions').length, 0);
    assert.equal(findAllByClass(el, 'cora-tracking-action').length, 1);
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
  assert.ok(findByClass(el, 'cora-empty cora-remediation-tracking-empty'));
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

  assert.equal(findByClass(el, 'cora-tracking-status-select'), null);
  assert.match(allText(el), /Status: Cancelled/);
  assert.match(allText(el), /Justification: Customer declined/);
});

test('RemediationTracking: an unresolved row reads as awaiting the Reviewer', () => {
  const el = new CORARemediationTracking();
  el.canResolve = false;
  el.update(CATALOGUE, REMEDIATED);
  assert.match(allText(el), /Status: Awaiting the Reviewer/);
});

test('RemediationTracking: the Reviewer gets a three-value select per Question', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
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

  const select = findByClass(el, 'cora-tracking-status-select');
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
  assert.equal(findByClass(el, 'cora-tracking-details-input').hidden, true);

  el.update(CATALOGUE, {
    q1: { ...REMEDIATED.q1, remediationStatus: { status: 'complete' } },
  });
  assert.equal(findByClass(el, 'cora-tracking-details-input').hidden, true);
});

test('RemediationTracking: partially complete asks for details and flags them as required', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.update(CATALOGUE, {
    q1: { ...REMEDIATED.q1, remediationStatus: { status: 'partial' } },
  });

  const details = findByClass(el, 'cora-tracking-details-input');
  assert.equal(details.hidden, false);
  assert.equal(details.getAttribute('placeholder'), 'Details (required)');
  assert.match(allText(el), /Details is required\./);
  assert.match(
    allText(el),
    /Record an outcome for every remediation above/,
    'and the panel says the Case cannot be completed yet'
  );
});

test('RemediationTracking: cancelled asks for a justification instead', () => {
  const el = new CORARemediationTracking();
  el.canResolve = true;
  el.update(CATALOGUE, {
    q1: { ...REMEDIATED.q1, remediationStatus: { status: 'cancelled' } },
  });

  const details = findByClass(el, 'cora-tracking-details-input');
  assert.equal(details.getAttribute('placeholder'), 'Justification (required)');
  assert.match(allText(el), /Justification is required\./);
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

  const details = findByClass(el, 'cora-tracking-details-input');
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
  assert.equal(findByClass(el, 'cora-remediation-gate'), null);
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

  assert.match(allText(el), /Call the customer back/);
  assert.equal(findByClass(el, 'cora-tracking-status-select'), null);
  assert.equal(findByClass(el, 'cora-tracking-details-input'), null);
  assert.doesNotMatch(
    allText(el),
    /Reviewer-only note/,
    "the Reviewer's details are not shown to the Responsible Party"
  );
  assert.match(allText(el), /Status: Partially complete/);
});

test('RemediationTracking: the Responsible Party is pointed at the Conversation', () => {
  const el = new CORARemediationTracking();
  el.audience = 'responsibleParty';
  el.update(CATALOGUE, REMEDIATED);

  const prompt = findByClass(el, 'cora-remediation-conversation-prompt');
  assert.ok(prompt);
  assert.match(allText(prompt), /Conversation/);

  let opened = 0;
  el.addEventListener('cora-open-conversation', () => (opened += 1));
  fireEvent(
    findByClass(el, 'cora-btn cora-remediation-conversation-btn'),
    'click'
  );
  assert.equal(opened, 1);
});

test('RemediationTracking: a viewer without the Conversation gets guidance, not a dead button', () => {
  const el = new CORARemediationTracking();
  el.audience = 'responsibleParty';
  el.conversationAvailable = false;
  el.update(CATALOGUE, REMEDIATED);

  assert.equal(
    findByClass(el, 'cora-btn cora-remediation-conversation-btn'),
    null
  );
  assert.ok(findByClass(el, 'cora-remediation-conversation-unavailable'));
});

test('RemediationTracking: the reviewing side never gets the Conversation prompt', () => {
  const el = new CORARemediationTracking();
  el.audience = 'reviewer';
  el.update(CATALOGUE, REMEDIATED);
  assert.equal(findByClass(el, 'cora-remediation-conversation-prompt'), null);
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

  const select = findByClass(host, 'cora-tracking-status-select');
  select.value = 'complete';
  fireEvent(select, 'change');

  const details = findByClass(host, 'cora-tracking-details-input');
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
    findByClass(partyHost, 'cora-btn cora-remediation-conversation-btn'),
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
    return /** @type {any} */ (el)._children[0].textContent;
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

  assert.match(allText(el), /Remediation due: 2000-01-03/);
  assert.match(allText(el), /Overdue/);

  el.caseRow = { status: 'Completed', remediationDueDate: '2000-01-03' };
  el.update(CATALOGUE, {});
  assert.doesNotMatch(allText(el), /Overdue/);

  el.caseRow = null;
  el.update(CATALOGUE, {});
  assert.match(allText(el), /Remediation due: —/);
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
