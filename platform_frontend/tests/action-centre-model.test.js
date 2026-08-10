// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_CENTRE_REASONS,
  reasonsForCapabilities,
  visibleReasons,
  activeFilter,
  headlineFilter,
  worstFirstOrder,
  waitingInfo,
  secondaryReasons,
  pickGlobalWorst,
  mergeWorstFirstWindow,
} from '../src/services/action-centre-model.js';
import { makeCaseRow, makePermissions } from './helpers/fixtures.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';

/** @typedef {import('../src/sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../src/services/permissions.js').Capabilities} Capabilities */

// The sub-line tests read the people fields straight off the row, so the
// baseline row here carries nobody until a test names someone.
/** @param {Partial<CaseRow>} [over] @returns {CaseRow} */
function caseRow(over = {}) {
  return makeCaseRow({
    id: 'c1',
    title: 'c1',
    assignedReviewer: '',
    responsibleParty: '',
    etag: 'e1',
    ...over,
  });
}

// Each reason is unlocked by one capability, so the baseline grants none.
/** @param {Partial<Capabilities>} [over] @returns {Capabilities} */
function caps(over = {}) {
  return makePermissions({ isReviewer: false, ...over });
}

/**
 * A reason from the table, narrowed to a definite Reason for tests.
 * @param {string} id
 * @returns {import('../src/services/action-centre-model.js').Reason}
 */
function reason(id) {
  const r = ACTION_CENTRE_REASONS.find((candidate) => candidate.id === id);
  assert.ok(r, `unknown reason: ${id}`);
  return r;
}

const NOW = new Date('2026-07-04T00:00:00Z');

test('ACTION_CENTRE_REASONS: fixed priority order, labels, roles, tones', () => {
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.id),
    ['overdue', 'awaitingFrontline', 'reviewRequired', 'appeals']
  );
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.label),
    ['Overdue', 'Awaiting Frontline', 'Review Required', 'Appeals to work']
  );
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.role),
    ['Reviewer', 'Reviewer', 'Reviewer', 'Controls']
  );
  assert.deepEqual(
    ACTION_CENTRE_REASONS.map((r) => r.tone),
    ['overdue', 'awaiting', 'review', 'appeal']
  );
});

test('reasonsForCapabilities: reviewer sees the three reviewer reasons', () => {
  const ids = reasonsForCapabilities(caps({ isReviewer: true })).map(
    (r) => r.id
  );
  assert.deepEqual(ids, ['overdue', 'awaitingFrontline', 'reviewRequired']);
});

// Appeals are switched off in this build, so the reason stays in the table —
// its labels, clock and cadence are still asserted above — but no capability
// qualifies for it and Controls gets an empty worklist rather than a group that
// is permanently empty. Restore this to `['appeals']` when the switch goes.
test('reasonsForCapabilities: controls sees no appeals group while appeals are off', () => {
  const ids = reasonsForCapabilities(caps({ isControls: true })).map(
    (r) => r.id
  );
  assert.deepEqual(ids, []);
});

// Owning a Case Type is no longer a reason to act: Reopened was the only
// Owner-scoped group and it queried a flag no transition ever wrote. An Owner
// with no other role therefore gets an empty worklist rather than a group that
// is permanently empty, and the dashboard drops the panel entirely.
test('reasonsForCapabilities: owning a Case Type is no reason on its own', () => {
  assert.deepEqual(
    reasonsForCapabilities(caps({ ownedCaseTypes: ['complaints'] })),
    []
  );
});

test('reasonsForCapabilities: multi-role user sees the union', () => {
  const ids = reasonsForCapabilities(
    caps({ isReviewer: true, isControls: true, ownedCaseTypes: ['complaints'] })
  ).map((r) => r.id);
  // 'appeals' is absent only because the feature switch is off; restore it to
  // the tail of this list when the switch goes.
  assert.deepEqual(ids, ['overdue', 'awaitingFrontline', 'reviewRequired']);
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

test('activeFilter: the Controls reason stays unscoped', () => {
  assert.deepEqual(activeFilter(reason('appeals'), 'u1'), {
    hasOpenAppeal: true,
  });
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

test('waitingInfo: counts whole days from the reason clock', () => {
  const c = caseRow({ dueDate: '2026-06-25T00:00:00Z' });
  assert.equal(waitingInfo(c, reason('overdue'), NOW).days, 9);
});

test('waitingInfo: a missing clock reads as 0 days', () => {
  assert.equal(
    waitingInfo(caseRow({ dueDate: null }), reason('overdue'), NOW).days,
    0
  );
});

test('waitingInfo: a future clock never goes negative', () => {
  const c = caseRow({ dueDate: '2026-08-01T00:00:00Z' });
  assert.equal(waitingInfo(c, reason('overdue'), NOW).days, 0);
});

test('waitingInfo: with no SLA given, Overdue breaches the day it lands', () => {
  const overdue = reason('overdue');
  assert.equal(overdue.defaultSlaDays, 0);
  const info = waitingInfo(
    caseRow({ dueDate: '2026-06-25T00:00:00Z' }),
    overdue,
    NOW
  );
  assert.deepEqual(info, { days: 9, label: '9 days over', breached: true });
});

test('waitingInfo: with no SLA given, a reason breaches at its own default', () => {
  const appeals = reason('appeals');
  const at = (/** @type {number} */ days) =>
    new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  const breached = waitingInfo(
    caseRow({ appealRaisedAt: at(appeals.defaultSlaDays) }),
    appeals,
    NOW
  );
  assert.equal(breached.days, appeals.defaultSlaDays);
  assert.equal(breached.breached, true);

  const within = waitingInfo(
    caseRow({ appealRaisedAt: at(appeals.defaultSlaDays - 1) }),
    appeals,
    NOW
  );
  assert.equal(within.days, appeals.defaultSlaDays - 1);
  assert.equal(within.breached, false);
});

test('waitingInfo: an explicit SLA widens and narrows the breach', () => {
  const appeals = reason('appeals');
  const row = caseRow({ appealRaisedAt: '2026-06-29T00:00:00Z' }); // 5 days

  assert.equal(waitingInfo(row, appeals, NOW, 30).breached, false);
  assert.equal(waitingInfo(row, appeals, NOW, 2).breached, true);
  // The age and the wording are unaffected — only the judgement moves.
  assert.equal(waitingInfo(row, appeals, NOW, 30).label, 'raised 5 days ago');
});

test('waitingInfo: singular day is not pluralised', () => {
  const info = waitingInfo(
    caseRow({ appealRaisedAt: '2026-07-03T00:00:00Z' }),
    reason('appeals'),
    NOW
  );
  assert.equal(info.label, 'raised 1 day ago');
});

test('waitingInfo: an Actions In Progress row in Awaiting Frontline is judged against its remediationDueDate, not the cadence', () => {
  const info = waitingInfo(
    caseRow({
      status: CASE_STATUS.ACTIONS_IN_PROGRESS,
      awaitingSince: '2026-06-26T00:00:00Z', // 8 days ago, past the 7-day cadence
      remediationDueDate: '2026-07-10',
    }),
    reason('awaitingFrontline'),
    NOW
  );
  assert.equal(info.breached, false);
  assert.equal(info.label, 'due in 6 days');
  assert.equal(info.days, 8);
});

test('waitingInfo: an Actions In Progress row past its remediationDueDate is breached', () => {
  const info = waitingInfo(
    caseRow({
      status: CASE_STATUS.ACTIONS_IN_PROGRESS,
      awaitingSince: '2026-06-26T00:00:00Z',
      remediationDueDate: '2026-07-01',
    }),
    reason('awaitingFrontline'),
    NOW
  );
  assert.equal(info.breached, true);
  assert.equal(info.label, '3 days over');
});

test('waitingInfo: an Actions In Progress row due today is not breached', () => {
  const info = waitingInfo(
    caseRow({
      status: CASE_STATUS.ACTIONS_IN_PROGRESS,
      awaitingSince: '2026-06-26T00:00:00Z',
      remediationDueDate: '2026-07-04',
    }),
    reason('awaitingFrontline'),
    NOW
  );
  assert.equal(info.breached, false);
  assert.equal(info.label, 'due today');
});

test('waitingInfo: the remediationDueDate label is not pluralised for a single day', () => {
  assert.equal(
    waitingInfo(
      caseRow({
        status: CASE_STATUS.ACTIONS_IN_PROGRESS,
        awaitingSince: '2026-06-26T00:00:00Z',
        remediationDueDate: '2026-07-05',
      }),
      reason('awaitingFrontline'),
      NOW
    ).label,
    'due in 1 day'
  );
  assert.equal(
    waitingInfo(
      caseRow({
        status: CASE_STATUS.ACTIONS_IN_PROGRESS,
        awaitingSince: '2026-06-26T00:00:00Z',
        remediationDueDate: '2026-07-03',
      }),
      reason('awaitingFrontline'),
      NOW
    ).label,
    '1 day over'
  );
});

test('waitingInfo: an Actions In Progress row with no remediationDueDate falls back to the cadence rule', () => {
  const info = waitingInfo(
    caseRow({
      status: CASE_STATUS.ACTIONS_IN_PROGRESS,
      awaitingSince: '2026-06-26T00:00:00Z', // 8 days ago
    }),
    reason('awaitingFrontline'),
    NOW
  );
  assert.equal(info.breached, true);
  assert.equal(info.label, '8 days no reply');
});

test('waitingInfo: a Conversation-flagged row keeps the 7-day cadence', () => {
  const breached = waitingInfo(
    caseRow({
      status: CASE_STATUS.IN_PROGRESS,
      awaitingSince: '2026-06-27T00:00:00Z', // 7 days ago
    }),
    reason('awaitingFrontline'),
    NOW
  );
  assert.equal(breached.breached, true);
  assert.equal(breached.label, '7 days no reply');

  const within = waitingInfo(
    caseRow({
      status: CASE_STATUS.IN_PROGRESS,
      awaitingSince: '2026-06-28T00:00:00Z', // 6 days ago
    }),
    reason('awaitingFrontline'),
    NOW
  );
  assert.equal(within.breached, false);
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

test('secondaryReasons: reads the hoisted flags in priority order', () => {
  const c = caseRow({
    overdue: true,
    reviewRequired: true,
    hasOpenAppeal: true,
  });
  assert.deepEqual(
    secondaryReasons(c, 'overdue').map((r) => r.id),
    ['reviewRequired', 'appeals']
  );
  assert.deepEqual(secondaryReasons(caseRow(), 'overdue'), []);
});

test('mergeWorstFirstWindow: missing clocks sort first and equal clocks keep their order', () => {
  const early = caseRow({ id: 'e', dueDate: '2020-01-01T00:00:00Z' });
  const tied = caseRow({ id: 't', dueDate: '2020-01-01T00:00:00Z' });
  const late = caseRow({ id: 'l', dueDate: '2020-06-01T00:00:00Z' });
  const missingA = caseRow({ id: 'm1', dueDate: null });
  const missingB = caseRow({ id: 'm2', dueDate: null });

  assert.deepEqual(
    mergeWorstFirstWindow(
      [[late, early], [tied], [missingA, missingB]],
      reason('overdue'),
      0,
      5
    ).map((c) => c.id),
    ['m1', 'm2', 'e', 't', 'l']
  );
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
