// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_CENTRE_REASONS,
  reasonById,
  reasonsForCapabilities,
  activeFilter,
  headlineFilter,
  worstFirstOrder,
  daysWaiting,
  waitingInfo,
  matchedReasonIds,
  secondaryReasons,
} from '../src/services/action-centre-model.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */

/** @param {Partial<CaseRow>} [over] @returns {CaseRow} */
function caseRow(over = {}) {
  return /** @type {CaseRow} */ ({
    id: 'c1',
    caseType: 'complaints',
    title: 'c1',
    status: 'In-progress',
    assignedReviewer: '',
    responsibleParty: '',
    answers: {},
    conversation: [],
    notes: '',
    completedAt: null,
    etag: 'e1',
    ...over,
  });
}

/** @param {Partial<Capabilities>} [over] @returns {Capabilities} */
function caps(over = {}) {
  return {
    isReviewer: false,
    listAccessCaseTypes: [],
    isAdviser: false,
    ownedCaseTypes: [],
    ownedJourneyCaseTypes: [],
    isControls: false,
    isReviewerManager: false,
    isResponsiblePartyManager: false,
    isMaintainer: false,
    isVisitor: false,
    ...over,
  };
}

/**
 * `reasonById` narrowed to a definite Reason for tests (asserts existence).
 * @param {string} id
 * @returns {import('../src/services/action-centre-model.js').Reason}
 */
function reason(id) {
  const r = reasonById(id);
  assert.ok(r, `unknown reason: ${id}`);
  return r;
}

const NOW = new Date('2026-07-04T00:00:00Z');

test('ACTION_CENTRE_REASONS: fixed priority order and labels', () => {
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.id),
    ['overdue', 'awaitingRp', 'appeals', 'reopened']
  );
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.label),
    ['Overdue', 'Awaiting RP', 'Appeals to work', 'Reopened']
  );
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.role),
    ['Reviewer', 'Reviewer', 'Controls', 'Owner']
  );
});

test('reasonById: found and not found', () => {
  assert.equal(reasonById('appeals')?.label, 'Appeals to work');
  assert.equal(reasonById('nope'), undefined);
});

test('reasonsForCapabilities: reviewer sees overdue + awaiting RP', () => {
  const ids = reasonsForCapabilities(caps({ isReviewer: true })).map(
    (r) => r.id
  );
  assert.deepEqual(ids, ['overdue', 'awaitingRp']);
});

test('reasonsForCapabilities: controls sees appeals', () => {
  const ids = reasonsForCapabilities(caps({ isControls: true })).map(
    (r) => r.id
  );
  assert.deepEqual(ids, ['appeals']);
});

test('reasonsForCapabilities: owner sees reopened', () => {
  const ids = reasonsForCapabilities(
    caps({ ownedCaseTypes: ['complaints'] })
  ).map((r) => r.id);
  assert.deepEqual(ids, ['reopened']);
});

test('reasonsForCapabilities: multi-role user sees the union', () => {
  const ids = reasonsForCapabilities(
    caps({ isReviewer: true, isControls: true, ownedCaseTypes: ['complaints'] })
  ).map((r) => r.id);
  assert.deepEqual(ids, ['overdue', 'awaitingRp', 'appeals', 'reopened']);
});

test('reasonsForCapabilities: a visitor sees no reasons', () => {
  assert.deepEqual(reasonsForCapabilities(caps({ isVisitor: true })), []);
});

test('activeFilter: awaiting RP narrows to overdue under Needs-action-now', () => {
  const awaiting =
    /** @type {import('../src/services/action-centre-model.js').Reason} */ (
      reason('awaitingRp')
    );
  assert.deepEqual(activeFilter(awaiting, false), {
    awaitingResponsibleParty: true,
  });
  assert.deepEqual(activeFilter(awaiting, true), {
    awaitingResponsibleParty: true,
    overdue: true,
  });
});

test('headlineFilter: ORs each visible reason under the active toggle', () => {
  const reasons = reasonsForCapabilities(
    caps({ isReviewer: true, isControls: true })
  );
  assert.deepEqual(headlineFilter(reasons, false), {
    anyOf: [
      { overdue: true },
      { awaitingResponsibleParty: true },
      { hasOpenAppeal: true },
    ],
  });
  assert.deepEqual(headlineFilter(reasons, true), {
    anyOf: [
      { overdue: true },
      { awaitingResponsibleParty: true, overdue: true },
      { hasOpenAppeal: true },
    ],
  });
});

test('worstFirstOrder: oldest on the reason clock first', () => {
  assert.deepEqual(worstFirstOrder(reason('overdue')), {
    orderBy: 'dueDate',
    orderDir: 'asc',
  });
});

test('daysWaiting: whole days from the reason clock', () => {
  const overdue = reason('overdue');
  const c = caseRow({ dueDate: '2026-06-25T00:00:00Z' });
  assert.equal(daysWaiting(c, overdue, NOW), 9);
});

test('daysWaiting: missing clock reads as 0', () => {
  const overdue = reason('overdue');
  assert.equal(daysWaiting(caseRow({ dueDate: null }), overdue, NOW), 0);
});

test('daysWaiting: a future clock never goes negative', () => {
  const overdue = reason('overdue');
  const c = caseRow({ dueDate: '2026-08-01T00:00:00Z' });
  assert.equal(daysWaiting(c, overdue, NOW), 0);
});

test('waitingInfo: overdue label and always-breached (slaDays 0)', () => {
  const overdue = reason('overdue');
  const info = waitingInfo(
    caseRow({ dueDate: '2026-06-25T00:00:00Z' }),
    overdue,
    NOW
  );
  assert.deepEqual(info, { days: 9, label: '9 days over', breached: true });
});

test('waitingInfo: reopened breaches at its SLA, not before', () => {
  const reopened = reason('reopened');
  const breached = waitingInfo(
    caseRow({ reopenedAt: '2026-06-29T00:00:00Z' }),
    reopened,
    NOW
  );
  assert.deepEqual(breached, { days: 5, label: '5 days', breached: true });

  const within = waitingInfo(
    caseRow({ reopenedAt: '2026-07-02T00:00:00Z' }),
    reopened,
    NOW
  );
  assert.deepEqual(within, { days: 2, label: '2 days', breached: false });
});

test('waitingInfo: singular day is not pluralised', () => {
  const reopened = reason('reopened');
  const info = waitingInfo(
    caseRow({ reopenedAt: '2026-07-03T00:00:00Z' }),
    reopened,
    NOW
  );
  assert.equal(info.label, '1 day');
});

test('waitingLabel: awaiting RP and appeals phrasing', () => {
  assert.equal(
    waitingInfo(
      caseRow({ awaitingSince: '2026-06-22T00:00:00Z' }),
      reason('awaitingRp'),
      NOW
    ).label,
    '12 days no reply'
  );
  assert.equal(
    waitingInfo(
      caseRow({ appealRaisedAt: '2026-06-28T00:00:00Z' }),
      reason('appeals'),
      NOW
    ).label,
    'raised 6 days ago'
  );
});

test('subLine: reviewer sub-line shows RP and assignee', () => {
  const overdue = reason('overdue');
  assert.equal(
    overdue.subLine(
      caseRow({ responsibleParty: 'A. Bello', assignedReviewer: 'J. Okoro' })
    ),
    'A. Bello · assigned to J. Okoro'
  );
});

test('subLine: reviewer sub-line drops the empty RP part', () => {
  const overdue = reason('overdue');
  assert.equal(
    overdue.subLine(
      caseRow({ responsibleParty: '', assignedReviewer: 'M. Diallo' })
    ),
    'assigned to M. Diallo'
  );
});

test('subLine: reviewer sub-line with no assignee shows only the RP', () => {
  const overdue = reason('overdue');
  assert.equal(
    overdue.subLine(
      caseRow({ responsibleParty: 'A. Bello', assignedReviewer: '' })
    ),
    'A. Bello'
  );
});

test('subLine: reopened is a static note', () => {
  assert.equal(
    reason('reopened').subLine(caseRow()),
    'appeal upheld · back under review'
  );
});

test('matchedReasonIds: reads the hoisted flags in priority order', () => {
  const c = caseRow({ overdue: true, reopened: true });
  assert.deepEqual(matchedReasonIds(c), ['overdue', 'reopened']);
  assert.deepEqual(matchedReasonIds(caseRow()), []);
});

test('secondaryReasons: the other reasons a case qualifies for', () => {
  const c = caseRow({ overdue: true, awaitingResponsibleParty: true });
  const secondary = secondaryReasons(c, 'awaitingRp');
  assert.deepEqual(
    secondary.map((r) => r.id),
    ['overdue']
  );
  assert.deepEqual(
    secondaryReasons(c, 'overdue').map((r) => r.id),
    ['awaitingRp']
  );
  assert.deepEqual(secondaryReasons(caseRow({ overdue: true }), 'overdue'), []);
});
