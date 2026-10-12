// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCase,
  makeConfig,
  makeCaseWithRemediation,
  evaluateAccess,
  remediationAudience,
  resolveRoles,
  sectionIds,
  caps,
} from './helpers/section-access.js';
import { configureAppSections } from './helpers/configure-sections.js';
import { CASE_STATUS } from '../src/lib/case-statuses.js';
import { conversationSideOf } from '../src/evaluators/case-lifecycle.js';
import { awaitingFrontlineAfterPost } from '../src/services/action-centre-flags.js';

configureAppSections();

// A frontline team stands where a named Responsible Party would, for every
// Case of its Case Type. These tests hold it to exactly that: wherever the
// Responsible Party's access, audience or Conversation side is decided, the
// team gets the same answer — no wider, no narrower.

const TEAM_CONFIG = makeConfig({
  frontlineTeam: { name: 'Payments Operations' },
});

/** Every Case shape the access rules branch on, from allocation to close. */
function everyCase() {
  return Object.values(CASE_STATUS).flatMap((status) => [
    makeCase({ status, responsibleParty: '' }),
    makeCaseWithRemediation({
      status,
      responsibleParty: '',
      reportableAt: '2026-07-01T00:00:00Z',
    }),
  ]);
}

test('a frontline team member sees every Section exactly as a Responsible Party would, at every status', () => {
  for (const caseRow of everyCase()) {
    for (const section of sectionIds()) {
      assert.equal(
        evaluateAccess(section, ['frontlineTeam'], caseRow, TEAM_CONFIG),
        evaluateAccess(section, ['responsibleParty'], caseRow, TEAM_CONFIG),
        `${section} on a ${caseRow.status} Case`
      );
    }
  }
});

test('a frontline team member reads the Summary once the actions are sent, and not before', () => {
  const before = makeCaseWithRemediation({ status: 'In-progress' });
  const sent = makeCaseWithRemediation({
    status: CASE_STATUS.ACTIONS_IN_PROGRESS,
    reportableAt: '2026-07-01T00:00:00Z',
  });
  assert.equal(
    evaluateAccess('summary', ['frontlineTeam'], before, TEAM_CONFIG),
    'hidden'
  );
  assert.equal(
    evaluateAccess('summary', ['frontlineTeam'], sent, TEAM_CONFIG),
    'read-only'
  );
  assert.equal(
    evaluateAccess('remediation', ['frontlineTeam'], sent, TEAM_CONFIG),
    'read-only'
  );
});

test('a frontline team member can reply in the Conversation while the actions are out', () => {
  const sent = makeCaseWithRemediation({
    status: CASE_STATUS.ACTIONS_IN_PROGRESS,
    reportableAt: '2026-07-01T00:00:00Z',
  });
  assert.equal(
    evaluateAccess('conversation', ['frontlineTeam'], sent, TEAM_CONFIG),
    'edit'
  );
});

test('a frontline team member is on the frontline side of the Conversation and the Remediation tab', () => {
  assert.equal(conversationSideOf(['frontlineTeam']), 'responsibleParty');
  assert.equal(remediationAudience(['frontlineTeam']), 'responsibleParty');
});

test('a reply from the frontline team clears Awaiting Frontline', () => {
  assert.deepEqual(
    awaitingFrontlineAfterPost(['frontlineTeam'], {
      author: { loginName: 'team-member', displayName: 'Team Member' },
      timestamp: '2026-07-02T09:00:00Z',
      body: 'Done.',
    }),
    { awaitingResponsibleParty: false, awaitingSince: null }
  );
});

test('the team group grants the role on its own Case Type only', () => {
  const caseRow = makeCase({ responsibleParty: '' });
  const member = caps({ frontlineTeamCaseTypes: [caseRow.caseType] });
  const otherTeam = caps({ frontlineTeamCaseTypes: ['some-other-type'] });
  assert.deepEqual(resolveRoles(caseRow, 'team-member', member, TEAM_CONFIG), [
    'frontlineTeam',
  ]);
  assert.deepEqual(
    resolveRoles(caseRow, 'team-member', otherTeam, TEAM_CONFIG),
    ['none']
  );
});

test('the team group grants nothing on a Case Type that declares no frontline team', () => {
  // The group is read for every Case Type at boot, before any config loads, so
  // a stray `FrontlineTeam - <type>` group on a Responsible Party Case Type
  // reaches the capabilities. The Case Type's own declaration is what stops it
  // opening every Case of that type.
  const caseRow = makeCase({ responsibleParty: '' });
  const member = caps({ frontlineTeamCaseTypes: [caseRow.caseType] });
  assert.deepEqual(resolveRoles(caseRow, 'team-member', member, makeConfig()), [
    'none',
  ]);
});
