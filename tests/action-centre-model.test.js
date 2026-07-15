// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_CENTRE_REASONS,
  reasonById,
  reasonsForCapabilities,
  visibleReasons,
  activeFilter,
  headlineFilter,
  worstFirstOrder,
  daysWaiting,
  waitingInfo,
  matchedReasonIds,
  secondaryReasons,
  reasonOrderComparator,
  pickGlobalWorst,
  mergeWorstFirstWindow,
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

test('ACTION_CENTRE_REASONS: fixed priority order, labels, roles, tones', () => {
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.id),
    ['overdue', 'awaitingFrontline', 'reviewRequired', 'appeals', 'reopened']
  );
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.label),
    [
      'Overdue',
      'Awaiting Frontline',
      'Review Required',
      'Appeals to work',
      'Reopened',
    ]
  );
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.role),
    ['Reviewer', 'Reviewer', 'Reviewer', 'Controls', 'Owner']
  );
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.tone),
    ['overdue', 'awaiting', 'review', 'appeal', 'reopened']
  );
});

test('reasonById: found and not found', () => {
  assert.equal(reasonById('appeals')?.label, 'Appeals to work');
  assert.equal(reasonById('nope'), undefined);
});

test('reasonsForCapabilities: reviewer sees the three reviewer reasons', () => {
  const ids = reasonsForCapabilities(caps({ isReviewer: true })).map(
    (r) => r.id
  );
  assert.deepEqual(ids, ['overdue', 'awaitingFrontline', 'reviewRequired']);
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
  assert.deepEqual(ids, [
    'overdue',
    'awaitingFrontline',
    'reviewRequired',
    'appeals',
    'reopened',
  ]);
});

test('reasonsForCapabilities: a visitor sees no reasons', () => {
  assert.deepEqual(reasonsForCapabilities(caps({ isVisitor: true })), []);
});

test('visibleReasons: "Needs action now" hides the tail-only Review Required', () => {
  const reasons = reasonsForCapabilities(caps({ isReviewer: true }));
  assert.deepEqual(
    visibleReasons(reasons, true).map((r) => r.id),
    ['overdue', 'awaitingFrontline'],
    'the within-SLA backlog is hidden'
  );
  assert.deepEqual(
    visibleReasons(reasons, false).map((r) => r.id),
    ['overdue', 'awaitingFrontline', 'reviewRequired'],
    'All reveals Review Required'
  );
});

test('activeFilter: reviewer reasons are scoped to the current reviewer', () => {
  assert.deepEqual(activeFilter(reason('overdue'), 'u1'), {
    overdue: true,
    assignedReviewer: 'u1',
  });
  assert.deepEqual(activeFilter(reason('reviewRequired'), 'u1'), {
    reviewRequired: true,
    assignedReviewer: 'u1',
  });
});

test('activeFilter: Controls/Owner reasons stay unscoped', () => {
  assert.deepEqual(activeFilter(reason('appeals'), 'u1'), {
    hasOpenAppeal: true,
  });
  assert.deepEqual(activeFilter(reason('reopened'), 'u1'), { reopened: true });
});

test('headlineFilter: ORs each visible reason under the current reviewer', () => {
  const reasons = [reason('overdue'), reason('awaitingFrontline')];
  assert.deepEqual(headlineFilter(reasons, 'u1'), {
    anyOf: [
      { overdue: true, assignedReviewer: 'u1' },
      { awaitingResponsibleParty: true, assignedReviewer: 'u1' },
    ],
  });
});

test('worstFirstOrder: oldest on the reason clock first', () => {
  assert.deepEqual(worstFirstOrder(reason('overdue')), {
    orderBy: 'dueDate',
    orderDir: 'asc',
  });
  assert.deepEqual(worstFirstOrder(reason('reviewRequired')), {
    orderBy: 'created',
    orderDir: 'asc',
  });
});

test('daysWaiting: whole days from the reason clock', () => {
  const c = caseRow({ dueDate: '2026-06-25T00:00:00Z' });
  assert.equal(daysWaiting(c, reason('overdue'), NOW), 9);
});

test('daysWaiting: missing clock reads as 0', () => {
  assert.equal(
    daysWaiting(caseRow({ dueDate: null }), reason('overdue'), NOW),
    0
  );
});

test('daysWaiting: a future clock never goes negative', () => {
  const c = caseRow({ dueDate: '2026-08-01T00:00:00Z' });
  assert.equal(daysWaiting(c, reason('overdue'), NOW), 0);
});

test('waitingInfo: overdue label and always-breached (slaDays 0)', () => {
  const info = waitingInfo(
    caseRow({ dueDate: '2026-06-25T00:00:00Z' }),
    reason('overdue'),
    NOW
  );
  assert.deepEqual(info, { days: 9, label: '9 days over', breached: true });
});

test('waitingInfo: reopened breaches at its SLA, not before', () => {
  const breached = waitingInfo(
    caseRow({ reopenedAt: '2026-06-29T00:00:00Z' }),
    reason('reopened'),
    NOW
  );
  assert.deepEqual(breached, { days: 5, label: '5 days', breached: true });

  const within = waitingInfo(
    caseRow({ reopenedAt: '2026-07-02T00:00:00Z' }),
    reason('reopened'),
    NOW
  );
  assert.deepEqual(within, { days: 2, label: '2 days', breached: false });
});

test('waitingInfo: singular day is not pluralised', () => {
  const info = waitingInfo(
    caseRow({ reopenedAt: '2026-07-03T00:00:00Z' }),
    reason('reopened'),
    NOW
  );
  assert.equal(info.label, '1 day');
});

test('waitingLabel: awaiting frontline, review required, and appeals phrasing', () => {
  assert.equal(
    waitingInfo(
      caseRow({ awaitingSince: '2026-06-22T00:00:00Z' }),
      reason('awaitingFrontline'),
      NOW
    ).label,
    '12 days no reply'
  );
  assert.equal(
    waitingInfo(
      caseRow({ created: '2026-06-30T00:00:00Z' }),
      reason('reviewRequired'),
      NOW
    ).label,
    '4 days open'
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
  assert.equal(
    reason('overdue').subLine(
      caseRow({ responsibleParty: 'A. Bello', assignedReviewer: 'J. Okoro' })
    ),
    'A. Bello · assigned to J. Okoro'
  );
});

test('subLine: reviewer sub-line drops the empty RP part', () => {
  assert.equal(
    reason('overdue').subLine(
      caseRow({ responsibleParty: '', assignedReviewer: 'M. Diallo' })
    ),
    'assigned to M. Diallo'
  );
});

test('subLine: reviewer sub-line with no assignee shows only the RP', () => {
  assert.equal(
    reason('overdue').subLine(
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
  const c = caseRow({ overdue: true, reviewRequired: true, reopened: true });
  assert.deepEqual(matchedReasonIds(c), [
    'overdue',
    'reviewRequired',
    'reopened',
  ]);
  assert.deepEqual(matchedReasonIds(caseRow()), []);
});

test('reasonOrderComparator: ascending on the reason clock, missing clock sorts first', () => {
  const cmp = reasonOrderComparator(reason('overdue'));
  const early = caseRow({ id: 'e', dueDate: '2020-01-01T00:00:00Z' });
  const late = caseRow({ id: 'l', dueDate: '2020-06-01T00:00:00Z' });
  const missing = caseRow({ id: 'm', dueDate: null });
  assert.ok(cmp(early, late) < 0);
  assert.ok(cmp(late, early) > 0);
  assert.equal(cmp(early, /** @type {CaseRow} */ ({ ...early })), 0);
  assert.ok(cmp(missing, early) < 0, 'a missing clock sorts as earliest');
  assert.ok(cmp(late, missing) > 0, 'missing clock on the right side too');
});

test('pickGlobalWorst: the earliest candidate on the reason clock wins', () => {
  const r = reason('overdue');
  const a = caseRow({ id: 'a', dueDate: '2020-01-05T00:00:00Z' });
  const b = caseRow({ id: 'b', dueDate: '2020-01-01T00:00:00Z' });
  const c = caseRow({ id: 'c', dueDate: '2020-01-03T00:00:00Z' });
  assert.equal(pickGlobalWorst([a, b, c], r)?.id, 'b');
});

test('pickGlobalWorst: null candidates (an empty list) are skipped', () => {
  const r = reason('overdue');
  const a = caseRow({ id: 'a', dueDate: '2020-01-05T00:00:00Z' });
  assert.equal(pickGlobalWorst([null, a, null], r)?.id, 'a');
});

test('pickGlobalWorst: all-null candidates yield null', () => {
  assert.equal(pickGlobalWorst([null, null], reason('overdue')), null);
});

test('pickGlobalWorst: an empty candidate list yields null', () => {
  assert.equal(pickGlobalWorst([], reason('overdue')), null);
});

test('mergeWorstFirstWindow: merges per-source rows, sorts worst-first, and slices the window', () => {
  const r = reason('overdue');
  const a = [
    caseRow({ id: 'a1', dueDate: '2020-01-01T00:00:00Z' }),
    caseRow({ id: 'a2', dueDate: '2020-01-05T00:00:00Z' }),
  ];
  const b = [
    caseRow({ id: 'b1', dueDate: '2020-01-03T00:00:00Z' }),
    caseRow({ id: 'b2', dueDate: '2020-01-02T00:00:00Z' }),
  ];
  assert.deepEqual(
    mergeWorstFirstWindow([a, b], r, 0, 4).map((c) => c.id),
    ['a1', 'b2', 'b1', 'a2']
  );
  assert.deepEqual(
    mergeWorstFirstWindow([a, b], r, 2, 4).map((c) => c.id),
    ['b1', 'a2']
  );
});

test('mergeWorstFirstWindow: an empty set of sources yields an empty window', () => {
  assert.deepEqual(mergeWorstFirstWindow([], reason('overdue'), 0, 4), []);
});

test('secondaryReasons: the other reasons a case qualifies for', () => {
  const c = caseRow({ overdue: true, awaitingResponsibleParty: true });
  assert.deepEqual(
    secondaryReasons(c, 'awaitingFrontline').map((r) => r.id),
    ['overdue']
  );
  assert.deepEqual(
    secondaryReasons(c, 'overdue').map((r) => r.id),
    ['awaitingFrontline']
  );
  assert.deepEqual(secondaryReasons(caseRow({ overdue: true }), 'overdue'), []);
});
