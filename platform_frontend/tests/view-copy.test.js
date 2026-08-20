// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_DATA_YET } from '../src/lib/empty-state.js';
import { COPY as OUTCOME_COPY } from '../src/pages/cora-case-review/outcome-view.js';
import { COPY as REMEDIATION_COPY } from '../src/pages/cora-case-review/remediation-tracking-view.js';
import { COPY as MY_STATS_COPY } from '../src/pages/cora-my-stats.js';
import { COPY as TEAM_STATS_COPY } from '../src/pages/cora-team-stats.js';
import { COPY as ACTION_CENTRE_COPY } from '../src/pages/dashboard/action-centre-view.js';
import { COPY as CONTROLS_COPY } from '../src/pages/dashboard/controls-view.js';
import { COPY as HEADLINE_COPY } from '../src/pages/my-stats/headline-strip-view.js';

test('view COPY objects expose the exact user-facing strings', () => {
  assert.equal(NO_DATA_YET, 'No data yet.');
  assert.deepEqual(OUTCOME_COPY, {
    awaitingAnswers: 'Awaiting answers…',
  });
  assert.deepEqual(REMEDIATION_COPY, {
    noActionsSent: 'No remediation actions sent.',
    remediationDueNone: 'Remediation due: —',
    awaitingReviewer: 'Status: Awaiting the Reviewer',
  });
  assert.deepEqual(MY_STATS_COPY, {
    loadingSubject: 'Loading your report',
    noReport: 'No report has been published for you yet.',
    noDataYet: 'No data yet.',
  });
  assert.deepEqual(TEAM_STATS_COPY, {
    noDataYet: 'No data yet.',
  });
  assert.deepEqual(ACTION_CENTRE_COPY, {
    heading: 'Action Centre',
    empty: 'Nothing in your worklist right now.',
  });
  assert.deepEqual(CONTROLS_COPY, {
    heading: 'Outstanding Appeals',
  });
  assert.deepEqual(HEADLINE_COPY, {
    heading: 'Headline figures',
  });
});
