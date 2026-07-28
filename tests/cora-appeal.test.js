// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass, findAllByClass } from './_dom-stub.js';

installDom();

// DOM stubs must be in place before any src import.

const { AppealSection } =
  await import('../src/pages/cora-case-review/appeal-view.js');
const { raiseAppeal } =
  await import('../src/pages/cora-case-review/appeal-actions.js');

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */

/** @returns {CaseRow} */
function makeCase(overrides = {}) {
  return {
    id: 'c1',
    caseType: 'example-review',
    title: 'T',
    status: 'Completed',
    assignedReviewer: 'u1',
    responsibleParty: 'u-rp',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: '2026-06-10T00:00:00Z',
    etag: 'e1',
    ...overrides,
  };
}

function makeQueue() {
  /** @type {{ id: string, field: string, value: any }[]} */
  const enqueued = [];
  return {
    enqueued,
    enqueue(
      /** @type {string} */ id,
      /** @type {string} */ field,
      /** @type {any} */ value
    ) {
      enqueued.push({ id, field, value });
    },
  };
}

/** Render the shipped view directly into a DOM query root. */
function renderAppeal(overrides = {}, queue = makeQueue()) {
  const props = {
    caseRow: /** @type {CaseRow | null} */ (null),
    access: /** @type {'edit'|'read-only'|'hidden'} */ ('read-only'),
    currentUser: /** @type {any} */ (null),
    catalogue: /** @type {any[]} */ ([]),
    answers: /** @type {Record<string, any>} */ ({}),
    heading: 'Appeal',
    ...overrides,
  };
  const el = document.createElement('main');
  const render = () => {
    el.replaceChildren(
      ...AppealSection({
        ...props,
        onRaise: ({ rationale, citedAnswerKeys }) => {
          if (!props.caseRow) return;
          const result = raiseAppeal({
            caseRow: props.caseRow,
            appellant: props.currentUser?.id ?? '',
            rationale,
            citedAnswerKeys,
            id: 'appeal-new',
            at: '2026-06-12T00:00:00Z',
          });
          props.caseRow = result.caseRow;
          queue.enqueue('c1', 'appeals', result.appeals);
          render();
        },
      })
    );
  };
  render();
  return { el, props, queue, render };
}

function makeEditable(caseOverrides = {}) {
  return renderAppeal({
    caseRow: makeCase(caseOverrides),
    access: 'edit',
    currentUser: { id: 'u-rp', displayName: 'RP' },
  });
}

// --- Rendering ---

test('CORAAppeal: renders an Appeal heading first', () => {
  const { el } = renderAppeal();
  assert.equal(/** @type {any} */ (el)._children[0].textContent, 'Appeal');
});

test('CORAAppeal: edit access on a Completed Case shows the raise form', () => {
  const { el } = makeEditable();
  assert.ok(findByClass(el, 'cora-appeal-form'), 'raise form rendered');
  assert.ok(
    findByClass(el, 'cora-appeal-rationale'),
    'rationale input rendered'
  );
  assert.ok(findByClass(el, 'cora-appeal-submit'), 'submit button rendered');
});

test('CORAAppeal: read-only access shows no form and a placeholder when there are no Appeals', () => {
  const { el } = renderAppeal({ caseRow: makeCase() });
  assert.equal(
    findByClass(el, 'cora-appeal-form'),
    null,
    'no form for a read-only viewer'
  );
  assert.ok(
    findByClass(el, 'cora-empty cora-appeal-empty'),
    'placeholder shown'
  );
});

test('CORAAppeal: with no caseRow there are no Appeals to list', () => {
  const { el } = renderAppeal();
  assert.ok(findByClass(el, 'cora-empty cora-appeal-empty'));
});

// --- Citations (failed Answers) ---

const FAIL_CATALOGUE = [
  {
    id: 'q-greet',
    text: 'Greeted?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
  {
    id: 'q-close',
    text: 'Closed well?',
    responseType: 'yes-no-na',
    failureValues: ['No'],
    deprecated: false,
  },
];

test('CORAAppeal: the form offers a citation checkbox only for failed Answers', () => {
  const { el, props, render } = makeEditable();
  props.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  props.answers = { 'q-greet': { value: 'No' }, 'q-close': { value: 'Yes' } };
  render();
  const boxes = findAllByClass(el, 'cora-appeal-cite');
  assert.equal(
    boxes.length,
    1,
    'only the failed Answer is offered for citation'
  );
});

test('CORAAppeal: the citations list is introduced with a heading and guidance when there are failed Answers', () => {
  const { el, props, render } = makeEditable();
  props.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  props.answers = { 'q-greet': { value: 'No' }, 'q-close': { value: 'No' } };
  render();
  const heading = findByClass(el, 'cora-appeal-cite-heading');
  const intro = findByClass(el, 'cora-appeal-cite-intro');
  assert.ok(heading, 'a citations heading is rendered');
  assert.ok(intro, 'guidance wording is rendered');
  assert.match(intro.textContent, /disagree with/i);
});

test('CORAAppeal: the citations heading sits between the rationale and the citation checkboxes', () => {
  const { el, props, render } = makeEditable();
  props.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  props.answers = { 'q-greet': { value: 'No' }, 'q-close': { value: 'No' } };
  render();
  const form = findByClass(el, 'cora-appeal-form');
  const classes = form._children.map((/** @type {any} */ c) => c.className);
  const rationaleIdx = classes.indexOf('cora-appeal-rationale');
  const headingIdx = classes.indexOf('cora-appeal-cite-heading');
  const firstCiteIdx = classes.indexOf('cora-appeal-cite');
  assert.ok(
    rationaleIdx > -1 && rationaleIdx < headingIdx,
    'heading follows the rationale'
  );
  assert.ok(
    headingIdx > -1 && headingIdx < firstCiteIdx,
    'heading precedes the citation checkboxes'
  );
});

test('CORAAppeal: the citations heading and guidance are omitted when there are no failed Answers', () => {
  const { el, props, render } = makeEditable();
  props.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  props.answers = { 'q-greet': { value: 'Yes' }, 'q-close': { value: 'Yes' } };
  render();
  assert.equal(findByClass(el, 'cora-appeal-cite-heading'), null);
  assert.equal(findByClass(el, 'cora-appeal-cite-intro'), null);
});

// --- Raise flow ---

test('CORAAppeal: raising with a rationale enqueues an additive appeals save with state raised', () => {
  const { el, queue } = makeEditable();
  const rationale = findByClass(el, 'cora-appeal-rationale');
  rationale.value = '  The greeting was actually present.  ';
  findByClass(el, 'cora-appeal-submit')._listeners['click'][0]();

  assert.equal(queue.enqueued.length, 1);
  assert.equal(queue.enqueued[0].id, 'c1');
  assert.equal(queue.enqueued[0].field, 'appeals');
  const saved = queue.enqueued[0].value;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].state, 'raised');
  assert.equal(saved[0].appellant, 'u-rp');
  assert.equal(
    saved[0].rationale,
    'The greeting was actually present.',
    'rationale is trimmed'
  );
  assert.ok(saved[0].id, 'an id is assigned');
  assert.ok(saved[0].at, 'a timestamp is stamped');
  assert.equal(
    saved[0].citedAnswerKeys,
    undefined,
    'no citations when none selected'
  );
});

test('CORAAppeal: raising appends to existing resolved Appeals (full history kept)', () => {
  const prior = {
    id: 'a0',
    appellant: 'u-rp',
    at: '2026-01-01T00:00:00Z',
    rationale: 'old',
    state: 'resolved',
  };
  const { el, queue } = makeEditable({ appeals: [prior] });
  findByClass(el, 'cora-appeal-rationale').value = 'second appeal';
  findByClass(el, 'cora-appeal-submit')._listeners['click'][0]();
  const saved = queue.enqueued[0].value;
  assert.equal(saved.length, 2, 'prior Appeal retained');
  assert.equal(saved[0].id, 'a0');
  assert.equal(saved[1].rationale, 'second appeal');
});

test('CORAAppeal: an empty rationale shows a validation error and does not save', () => {
  const { el, queue } = makeEditable();
  findByClass(el, 'cora-appeal-rationale').value = '   ';
  findByClass(el, 'cora-appeal-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued.length, 0, 'nothing persisted');
  assert.equal(
    findByClass(el, 'cora-appeal-error').hidden,
    false,
    'error is revealed'
  );
});

test('CORAAppeal: a missing rationale value (null) is treated as empty', () => {
  const { el, queue } = makeEditable();
  const rationale = findByClass(el, 'cora-appeal-rationale');
  rationale.value = /** @type {any} */ (null);
  findByClass(el, 'cora-appeal-submit')._listeners['click'][0]();
  assert.equal(queue.enqueued.length, 0);
});

test('CORAAppeal: citing disputed failed Answers records their keys on the Appeal', () => {
  const { el, props, queue, render } = makeEditable();
  props.catalogue = /** @type {any} */ (FAIL_CATALOGUE);
  props.answers = { 'q-greet': { value: 'No' }, 'q-close': { value: 'No' } };
  render();

  findByClass(el, 'cora-appeal-rationale').value = 'both wrong';
  const boxes = findAllByClass(el, 'cora-appeal-cite').map(
    (w) => w._children[0]
  );
  boxes[0].checked = true; // cite q-greet only
  findByClass(el, 'cora-appeal-submit')._listeners['click'][0]();

  const saved = queue.enqueued[0].value;
  assert.deepEqual(
    saved[0].citedAnswerKeys,
    ['q-greet'],
    'only the checked Answer is cited'
  );
});

test('CORAAppeal: a raised Appeal does not set Answer values (case-level only)', () => {
  const { el, props, queue } = makeEditable({
    answers: { 'q-greet': { value: 'No' } },
  });
  findByClass(el, 'cora-appeal-rationale').value = 'dispute';
  findByClass(el, 'cora-appeal-submit')._listeners['click'][0]();
  // Only the `appeals` field is ever written — never `answers`.
  assert.deepEqual(
    queue.enqueued.map((e) => e.field),
    ['appeals']
  );
  assert.deepEqual(
    props.caseRow?.answers,
    { 'q-greet': { value: 'No' } },
    'frozen Answers untouched'
  );
});

test('CORAAppeal: after raising, the form is replaced by an open-Appeal note (one open at a time)', () => {
  const { el } = makeEditable();
  findByClass(el, 'cora-appeal-rationale').value = 'dispute';
  findByClass(el, 'cora-appeal-submit')._listeners['click'][0]();
  assert.equal(
    findByClass(el, 'cora-appeal-form'),
    null,
    'form removed once an Appeal is open'
  );
  assert.ok(findByClass(el, 'cora-appeal-open-note'), 'open-Appeal note shown');
  assert.ok(
    findByClass(el, 'cora-appeal-item'),
    'the raised Appeal appears in the history'
  );
});

test('CORAAppeal: an existing open Appeal blocks the form even before raising', () => {
  const open = {
    id: 'a1',
    appellant: 'u-rp',
    at: '2026-06-10T00:00:00Z',
    rationale: 'pending',
    state: 'underReview',
  };
  const { el } = makeEditable({ appeals: [open] });
  assert.equal(findByClass(el, 'cora-appeal-form'), null);
  assert.ok(findByClass(el, 'cora-appeal-open-note'));
});

test('CORAAppeal: an Appeal item renders its state, rationale and cited Answers', () => {
  const { el } = renderAppeal({
    caseRow: makeCase({
      appeals: [
        {
          id: 'a1',
          appellant: 'u-rp',
          at: '2026-06-10T00:00:00Z',
          rationale: 'wrong outcome',
          citedAnswerKeys: ['q-greet'],
          state: 'raised',
        },
      ],
    }),
  });
  const item = findByClass(el, 'cora-appeal-item');
  assert.ok(
    findByClass(item, 'cora-appeal-state').textContent.includes('raised')
  );
  assert.equal(
    findByClass(item, 'cora-appeal-item-rationale').textContent,
    'wrong outcome'
  );
  assert.ok(
    findByClass(item, 'cora-appeal-item-cited').textContent.includes('q-greet')
  );
});

test('CORAAppeal: a resolved Appeal item renders its verdict and resolver rationale', () => {
  const { el } = renderAppeal({
    caseRow: makeCase({
      appeals: [
        {
          id: 'a1',
          appellant: 'u-rp',
          at: '2026-06-10T00:00:00Z',
          rationale: 'wrong',
          state: 'resolved',
          resolution: {
            verdict: 'agreed',
            rationale: 'Reviewer misread the transcript.',
            resolver: 'u-qa',
            at: '2026-06-11T00:00:00Z',
          },
        },
      ],
    }),
  });
  const item = findByClass(el, 'cora-appeal-item');
  assert.ok(
    findByClass(item, 'cora-appeal-resolution').textContent.includes('agreed'),
    'verdict shown'
  );
  assert.ok(
    findByClass(item, 'cora-appeal-resolution').textContent.includes(
      'Reviewer misread the transcript.'
    ),
    'resolver rationale shown'
  );
});

test('CORAAppeal: an open Appeal item omits the resolution line', () => {
  const { el } = renderAppeal({
    caseRow: makeCase({
      appeals: [
        {
          id: 'a1',
          appellant: 'u-rp',
          at: '2026-06-10T00:00:00Z',
          rationale: 'pending',
          state: 'raised',
        },
      ],
    }),
  });
  assert.equal(findByClass(el, 'cora-appeal-resolution'), null);
});

test('CORAAppeal: an Appeal item without citations omits the cited-Answers line', () => {
  const { el } = renderAppeal({
    caseRow: makeCase({
      appeals: [
        {
          id: 'a1',
          appellant: 'u-rp',
          at: '2026-06-10T00:00:00Z',
          rationale: 'no citations',
          state: 'raised',
        },
      ],
    }),
  });
  assert.equal(findByClass(el, 'cora-appeal-item-cited'), null);
});

test('CORAAppeal: raising without a saveQueue or caseRow does not throw', () => {
  const { el } = renderAppeal({ access: 'edit' });
  const rationale = findByClass(el, 'cora-appeal-rationale');
  rationale.value = 'orphan appeal';
  assert.doesNotThrow(() => {
    findByClass(el, 'cora-appeal-submit')._listeners['click'][0]();
  });
});

// --- Case Type sectionLabels heading override ---

test('CORAAppeal: heading prop overrides the default Appeal heading', () => {
  const { el } = renderAppeal({ heading: 'Challenge' });
  assert.equal(/** @type {any} */ (el)._children[0].textContent, 'Challenge');
});
