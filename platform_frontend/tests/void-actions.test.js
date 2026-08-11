// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, findByClass } from './_dom-stub.js';
import { fireEvent } from './helpers/semantic-dom.js';
import { CaseMachine } from '../src/lib/case-machine.js';
import {
  voidControl,
  voidControlView,
  voidPatch,
} from '../src/pages/cora-case-review/void-actions.js';
import { VOID_REASONS } from '../src/lib/void-reasons.js';
import { makeCaseRow, makePermissions } from './helpers/fixtures.js';

installDom();

// Capability: the Reviewer's Void control and the patch behind it.

const CAPABILITIES = makePermissions({ isReviewer: false, isVisitor: true });

/** @type {import('../src/sharepoint-client.js').CaseTypeConfig} */
const CONFIG = {
  questions: [],
  computeOutcome: () => ({ outcome: 'pass' }),
  outcomeOptions: [{ id: 'pass', wording: 'Pass', severity: 0 }],
  defaultOutcomeId: 'pass',
};

/**
 * @param {import('../src/lib/case-statuses.js').CaseStatus} status
 * @param {string} [viewer]
 */
function machineFor(status, viewer = 'u1') {
  const caseRow = makeCaseRow({
    id: 'c1',
    caseType: 'example-review',
    title: 'Case',
    status,
    assignedReviewer: 'u1',
    responsibleParty: 'u2',
    etag: 'e1',
  });
  return new CaseMachine(caseRow, { id: viewer }, CAPABILITIES, CONFIG);
}

test('voidControlView preserves the disclosure markup and callback props', () => {
  let toggled = 0;
  let selected = '';
  let confirmed = 0;
  const control = voidControl({
    machine: machineFor('In-progress'),
    config: CONFIG,
    reasonKey: 'duplicate',
  });
  const node = voidControlView({
    control,
    disclosureOpen: true,
    pending: false,
    onToggle: () => {
      toggled += 1;
    },
    onReasonSelected: (reasonKey) => {
      selected = reasonKey;
    },
    onConfirm: () => {
      confirmed += 1;
    },
  });
  const root = findByClass({ _children: [node] }, 'cora-void');
  const disclosure = root.querySelector('.cora-void-btn');
  assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
  assert.equal(
    root.querySelector('.cora-void-consequence').textContent,
    'Voiding closes this Case for good. It records no Outcome, it cannot be reopened, and the Conversation stops accepting messages.'
  );
  fireEvent(disclosure, 'click');
  const select = root.querySelector('.cora-void-reason');
  assert.deepEqual(
    Array.from(select.querySelectorAll('option')).map((option) => option.value),
    ['', ...VOID_REASONS.map((reason) => reason.key)]
  );
  select.value = 'withdrawn';
  fireEvent(select, 'change');
  assert.equal(root.querySelector('.cora-void-confirm').disabled, false);
  fireEvent(root.querySelector('.cora-void-confirm'), 'click');
  assert.equal(toggled, 1);
  assert.equal(selected, 'withdrawn');
  assert.equal(confirmed, 1);

  const pending = voidControlView({
    control,
    disclosureOpen: true,
    pending: true,
    onToggle: () => {},
    onReasonSelected: () => {},
    onConfirm: () => {},
  });
  assert.equal(
    findByClass({ _children: [pending] }, 'cora-void').querySelector(
      '.cora-void-confirm'
    ).disabled,
    true
  );
});

test('voidControl: hidden for a viewer who cannot void the Case', () => {
  assert.equal(
    voidControl({ machine: machineFor('In-progress', 'u9'), config: CONFIG })
      .visible,
    false
  );
  assert.equal(voidControl({ machine: null, config: CONFIG }).visible, false);
});

test('voidControl: visible to the Assigned Reviewer while the review is live', () => {
  for (const status of /** @type {const} */ ([
    'In-progress',
    'Actions In Progress',
  ])) {
    assert.equal(
      voidControl({ machine: machineFor(status), config: CONFIG }).visible,
      true,
      status
    );
  }
});

test('voidControl: hidden once the Case has reached a terminal state', () => {
  for (const status of /** @type {const} */ (['Completed', 'Void'])) {
    assert.equal(
      voidControl({ machine: machineFor(status), config: CONFIG }).visible,
      false,
      status
    );
  }
});

test('voidControl: offers the Case Type reasons, or the whole vocabulary', () => {
  assert.deepEqual(
    voidControl({ machine: machineFor('In-progress'), config: CONFIG }).reasons,
    VOID_REASONS
  );
  assert.deepEqual(
    voidControl({
      machine: machineFor('In-progress'),
      config: { ...CONFIG, voidReasons: ['withdrawn'] },
    }).reasons.map((r) => r.key),
    ['withdrawn']
  );
});

test('voidControl: disabled until a reason is chosen', () => {
  const machine = machineFor('In-progress');
  assert.equal(voidControl({ machine, config: CONFIG }).disabled, true);
  assert.equal(
    voidControl({ machine, config: CONFIG, reasonKey: '' }).disabled,
    true
  );
  const chosen = voidControl({
    machine,
    config: CONFIG,
    reasonKey: 'duplicate',
  });
  assert.equal(chosen.disabled, false);
  assert.equal(chosen.reason, 'duplicate');
});

test('voidPatch: null when the viewer cannot void the Case', () => {
  assert.equal(
    voidPatch({
      machine: machineFor('In-progress', 'u9'),
      config: CONFIG,
      reasonKey: 'duplicate',
    }),
    null
  );
  assert.equal(
    voidPatch({ machine: null, config: CONFIG, reasonKey: 'duplicate' }),
    null
  );
});

test('voidPatch: null for a reason the Case Type does not offer', () => {
  assert.equal(
    voidPatch({
      machine: machineFor('In-progress'),
      config: { ...CONFIG, voidReasons: ['withdrawn'] },
      reasonKey: 'duplicate',
    }),
    null
  );
});

test('voidPatch: null for a key outside the vocabulary, and for no key at all', () => {
  assert.equal(
    voidPatch({
      machine: machineFor('In-progress'),
      config: CONFIG,
      reasonKey: 'not-a-reason',
    }),
    null
  );
  assert.equal(
    voidPatch({ machine: machineFor('In-progress'), config: CONFIG }),
    null
  );
});

test('voidPatch: an offered reason returns the CaseMachine transition', () => {
  const fields = voidPatch({
    machine: machineFor('Actions In Progress'),
    config: CONFIG,
    reasonKey: 'superseded',
  });

  assert.equal(fields?.status, 'Void');
  assert.equal(fields?.voidReason, 'superseded');
  assert.equal(fields?.voidedBy, 'u1');
  assert.equal(typeof fields?.voidedAt, 'string');
});
