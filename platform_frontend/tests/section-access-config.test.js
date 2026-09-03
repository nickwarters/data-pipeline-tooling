// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCase,
  makeConfig,
  makeCaseWithRemediation,
  openAppeal,
  evaluateAccess,
  showInSummary,
  summarySectionsFor,
  SECTIONS,
  SUMMARY_SECTIONS,
} from './helpers/section-access.js';

/** @typedef {import('../src/services/section-access.js').Section} Section */
/** @typedef {import('../src/services/section-access.js').Role} Role */
/** @typedef {import('../src/services/section-access.js').Mode} Mode */

/**
 * The viewer's resolved mode per Section, as `CaseMachine` hands it to the
 * loader.
 * @param {Role[]} roles
 * @param {import('../src/sharepoint-client.js').CaseRow} caseRow
 * @param {import('../src/sharepoint-client.js').CaseTypeConfig} cfg
 * @returns {Record<Section, Mode>}
 */
function accessFor(roles, caseRow, cfg) {
  return /** @type {Record<Section, Mode>} */ (
    Object.fromEntries(
      SECTIONS.map((s) => [s, evaluateAccess(s, roles, caseRow, cfg)])
    )
  );
}

// Capability: case-type configuration and summary visibility.

// --- none role ---

test('none role → hidden everywhere', () => {
  const cfg = makeConfig();
  const c = makeCaseWithRemediation({
    status: 'Completed',
    appeals: [openAppeal()],
  });
  for (const s of SECTIONS) {
    assert.equal(evaluateAccess(s, ['none'], c, cfg), 'hidden', `section ${s}`);
  }
});

// --- Case Type opt-out (per-Section config object) ---

test('evaluateAccess: section omitted from the sections config object → hidden regardless of role', () => {
  const cfg = makeConfig({
    sections: { questions: {}, remediation: {}, summary: {} },
  });
  const c = makeCase();
  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], c, cfg),
    'hidden'
  );
  assert.equal(evaluateAccess('notes', ['assignedReviewer'], c, cfg), 'hidden');
  assert.equal(
    evaluateAccess('questions', ['assignedReviewer'], c, cfg),
    'edit'
  );
});

test('evaluateAccess: a section present in the config object keeps its role-based mode', () => {
  const cfg = makeConfig({ sections: { notes: { showInSummary: true } } });
  assert.equal(
    evaluateAccess('notes', ['assignedReviewer'], makeCase(), cfg),
    'edit'
  );
});

test('evaluateAccess: sections undefined → defaults to all enabled', () => {
  const cfg = makeConfig();
  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], makeCase(), cfg),
    'edit'
  );
});

test('evaluateAccess: empty sections object → all hidden', () => {
  const cfg = makeConfig({ sections: {} });
  const c = makeCase();
  for (const s of SECTIONS) {
    assert.equal(
      evaluateAccess(s, ['assignedReviewer'], c, cfg),
      'hidden',
      `section ${s}`
    );
  }
});

// --- Conversation allowMessagesWhen ---

test('evaluateAccess: conversation allowMessagesWhen restricts to read-only for unlisted statuses', () => {
  const cfg = makeConfig({
    sections: { conversation: { allowMessagesWhen: ['Actions In Progress'] } },
  });
  const cInProgress = makeCase({ status: 'In-progress' });
  const cActions = makeCase({ status: 'Actions In Progress' });
  const cCompleted = makeCase({ status: 'Completed' });

  for (const role of /** @type {const} */ ([
    'assignedReviewer',
    'responsibleParty',
    'responsiblePartyManager',
  ])) {
    assert.equal(
      evaluateAccess('conversation', [role], cInProgress, cfg),
      'read-only',
      role
    );
    assert.equal(
      evaluateAccess('conversation', [role], cActions, cfg),
      'edit',
      role
    );
    assert.equal(
      evaluateAccess('conversation', [role], cCompleted, cfg),
      'read-only',
      role
    );
  }
});

test('evaluateAccess: conversation without allowMessagesWhen defaults to edit', () => {
  const cfg = makeConfig({ sections: { conversation: {} } });
  const c = makeCase({ status: 'In-progress' });
  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], c, cfg),
    'edit'
  );
  assert.equal(
    evaluateAccess('conversation', ['responsibleParty'], c, cfg),
    'edit'
  );
  assert.equal(
    evaluateAccess('conversation', ['responsiblePartyManager'], c, cfg),
    'edit'
  );
});

test('evaluateAccess: Responsible Party initiates and Reviewer can reply after the first message', () => {
  const cfg = makeConfig({
    sections: {
      conversation: {
        allowMessagesWhen: ['Actions In Progress'],
        initiatedBy: 'responsibleParty',
      },
    },
  });
  const unopened = makeCase({
    status: 'Actions In Progress',
    conversation: [],
  });

  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], unopened, cfg),
    'read-only'
  );
  assert.equal(
    evaluateAccess('conversation', ['responsibleParty'], unopened, cfg),
    'edit'
  );
  assert.equal(
    evaluateAccess('conversation', ['responsiblePartyManager'], unopened, cfg),
    'edit'
  );

  const opened = makeCase({
    ...unopened,
    conversation: [
      {
        author: { loginName: 'frontline', displayName: 'Frontline' },
        timestamp: '2026-08-30T09:00:00Z',
        body: 'The actions are complete.',
      },
    ],
  });
  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], opened, cfg),
    'edit'
  );
});

test('evaluateAccess: Reviewer initiates and frontline can reply after the first message', () => {
  const cfg = makeConfig({
    sections: {
      conversation: {
        allowMessagesWhen: ['In-progress'],
        initiatedBy: 'reviewer',
      },
    },
  });
  const unopened = makeCase({ status: 'In-progress', conversation: [] });

  assert.equal(
    evaluateAccess('conversation', ['assignedReviewer'], unopened, cfg),
    'edit'
  );
  assert.equal(
    evaluateAccess('conversation', ['responsibleParty'], unopened, cfg),
    'read-only'
  );

  const opened = makeCase({
    ...unopened,
    conversation: [
      {
        author: { loginName: 'reviewer', displayName: 'Reviewer' },
        timestamp: '2026-08-30T09:00:00Z',
        body: 'Could you clarify this point?',
      },
    ],
  });
  assert.equal(
    evaluateAccess('conversation', ['responsibleParty'], opened, cfg),
    'edit'
  );
  assert.equal(
    evaluateAccess('conversation', ['responsiblePartyManager'], opened, cfg),
    'edit'
  );
});

test('evaluateAccess: a missing or malformed Conversation is treated as an empty thread', () => {
  const cfg = makeConfig({
    sections: { conversation: { initiatedBy: 'reviewer' } },
  });
  for (const conversation of [undefined, null, {}, 'not a thread']) {
    const c = makeCase(/** @type {any} */ ({ conversation }));
    assert.equal(
      evaluateAccess('conversation', ['responsibleParty'], c, cfg),
      'read-only'
    );
    assert.equal(
      evaluateAccess('conversation', ['assignedReviewer'], c, cfg),
      'edit'
    );
  }
});

test('evaluateAccess: dual-side roles use the Reviewer side to initiate', () => {
  const c = makeCase({ conversation: [] });
  const roles =
    /** @type {import('../src/services/section-access.js').Role[]} */ ([
      'assignedReviewer',
      'responsibleParty',
    ]);
  assert.equal(
    evaluateAccess(
      'conversation',
      roles,
      c,
      makeConfig({
        sections: { conversation: { initiatedBy: 'reviewer' } },
      })
    ),
    'edit'
  );
  assert.equal(
    evaluateAccess(
      'conversation',
      roles,
      c,
      makeConfig({
        sections: { conversation: { initiatedBy: 'responsibleParty' } },
      })
    ),
    'read-only'
  );
});

test('evaluateAccess: a terminal Case closes the Conversation even with no allowMessagesWhen gate', () => {
  const cfg = makeConfig({ sections: { conversation: {} } });
  for (const status of /** @type {const} */ (['Completed', 'Void'])) {
    const c = makeCase({ status });
    for (const role of /** @type {const} */ ([
      'assignedReviewer',
      'responsibleParty',
      'responsiblePartyManager',
    ])) {
      assert.equal(
        evaluateAccess('conversation', [role], c, cfg),
        'read-only',
        `${status} / ${role}`
      );
    }
  }
});

test('evaluateAccess: allowMessagesWhen cannot reopen the Conversation on a terminal Case', () => {
  const cfg = makeConfig({
    sections: { conversation: { allowMessagesWhen: ['Completed', 'Void'] } },
  });
  for (const status of /** @type {const} */ (['Completed', 'Void'])) {
    assert.equal(
      evaluateAccess(
        'conversation',
        ['assignedReviewer'],
        makeCase({ status }),
        cfg
      ),
      'read-only',
      status
    );
  }
});

// --- showInSummary ---

test('SUMMARY_SECTIONS lists the Sections that can appear as Summary blocks', () => {
  assert.deepEqual(
    [...SUMMARY_SECTIONS],
    ['details', 'questions', 'issues', 'remediation', 'notes']
  );
});

test('showInSummary: defaults — notes off, every other block Section on, when sections undefined', () => {
  const cfg = makeConfig();
  assert.equal(showInSummary('details', cfg), true);
  assert.equal(showInSummary('questions', cfg), true);
  assert.equal(showInSummary('issues', cfg), true);
  assert.equal(showInSummary('remediation', cfg), true);
  assert.equal(showInSummary('notes', cfg), false);
});

test('showInSummary: explicit flag overrides the default', () => {
  const cfg = makeConfig({
    sections: {
      notes: { showInSummary: true },
      questions: { showInSummary: false },
    },
  });
  assert.equal(showInSummary('notes', cfg), true);
  assert.equal(showInSummary('questions', cfg), false);
});

test('showInSummary: a Section absent from the config object is never in Summary', () => {
  const cfg = makeConfig({ sections: { questions: {} } });
  assert.equal(showInSummary('details', cfg), false);
  assert.equal(showInSummary('notes', cfg), false);
  assert.equal(showInSummary('questions', cfg), true);
});

// --- showInSummary as a role list ---

test('showInSummary: a role list shows the block to a viewer holding one of them', () => {
  const cfg = makeConfig({
    sections: { issues: { showInSummary: ['controls', 'caseTypeOwner'] } },
  });
  assert.equal(showInSummary('issues', cfg, ['controls']), true);
  // Any one of the viewer's roles matching is enough.
  assert.equal(
    showInSummary('issues', cfg, ['assignedReviewer', 'caseTypeOwner']),
    true
  );
});

test('showInSummary: a role list hides the block from a viewer holding none of them', () => {
  const cfg = makeConfig({
    sections: { issues: { showInSummary: ['controls'] } },
  });
  assert.equal(showInSummary('issues', cfg, ['assignedReviewer']), false);
});

test('showInSummary: a role list resolves false when no roles are supplied', () => {
  // Fail closed: a viewer whose roles were not passed is composed no
  // role-scoped block.
  const cfg = makeConfig({
    sections: { issues: { showInSummary: ['controls'] } },
  });
  assert.equal(showInSummary('issues', cfg), false);
});

// --- summarySectionsFor: composing the Summary from access + config ---

test('summarySectionsFor: Case Details is composed for the Responsible Party once they read the Summary', () => {
  // The Details tab is hidden from the Responsible Party; the Case Details
  // fields reach them as the first block of the Summary instead.
  const cfg = makeConfig();
  const c = makeCase({ status: 'Actions In Progress' });
  const access = accessFor(['responsibleParty'], c, cfg);
  assert.equal(access.details, 'hidden');
  assert.equal(access.summary, 'read-only');
  assert.deepEqual(summarySectionsFor(access, cfg, ['responsibleParty']), [
    'details',
  ]);
});

test('summarySectionsFor: the Responsible Party Manager reads Case Details through a Completed Summary', () => {
  const cfg = makeConfig();
  const c = makeCase({ status: 'Completed' });
  const access = accessFor(['responsiblePartyManager'], c, cfg);
  assert.equal(access.details, 'hidden');
  assert.deepEqual(
    summarySectionsFor(access, cfg, ['responsiblePartyManager']),
    ['details']
  );
});

test('summarySectionsFor: no Summary, no Case Details block', () => {
  // While In-progress the Responsible Party has no Summary, and a block folded
  // into a Summary that is not there is composed for nobody.
  const cfg = makeConfig();
  const c = makeCase({ status: 'In-progress' });
  const access = accessFor(['responsibleParty'], c, cfg);
  assert.equal(access.summary, 'hidden');
  assert.deepEqual(summarySectionsFor(access, cfg, ['responsibleParty']), []);
});

test('summarySectionsFor: membership still governs a Section read through the Summary', () => {
  // A Case Type that leaves `details` out of `sections` has no Case Details
  // anywhere — the fold puts an existing block on the Summary, it does not
  // conjure one.
  const cfg = makeConfig({ sections: { summary: {}, conversation: {} } });
  const c = makeCase({ status: 'Actions In Progress' });
  const access = accessFor(['responsibleParty'], c, cfg);
  assert.deepEqual(summarySectionsFor(access, cfg, ['responsibleParty']), []);
});

test('summarySectionsFor: a Case Type can still switch Case Details off the Summary', () => {
  const cfg = makeConfig({
    sections: { details: { showInSummary: false }, summary: {} },
  });
  const c = makeCase({ status: 'Actions In Progress' });
  const access = accessFor(['responsibleParty'], c, cfg);
  assert.deepEqual(summarySectionsFor(access, cfg, ['responsibleParty']), []);
});

test('summarySectionsFor: every other block still needs its own tab visible', () => {
  // Naming the Responsible Party on the Questions list cannot show them a
  // Section the matrix hides — the role list narrows and never widens.
  const cfg = makeConfig({
    sections: {
      details: {},
      questions: { showInSummary: ['responsibleParty'] },
      notes: { showInSummary: true },
      summary: {},
    },
  });
  const c = makeCase({ status: 'Actions In Progress' });
  const access = accessFor(['responsibleParty'], c, cfg);
  assert.equal(access.questions, 'hidden');
  assert.equal(access.notes, 'hidden');
  assert.deepEqual(summarySectionsFor(access, cfg, ['responsibleParty']), [
    'details',
  ]);
});

test('summarySectionsFor: a reviewer-side viewer is composed the blocks they can see, in render order', () => {
  const cfg = makeConfig({
    sections: {
      details: {},
      questions: {},
      issues: {},
      notes: { showInSummary: true },
      summary: {},
    },
  });
  const c = makeCase({ status: 'In-progress' });
  const access = accessFor(['assignedReviewer'], c, cfg);
  assert.deepEqual(summarySectionsFor(access, cfg, ['assignedReviewer']), [
    'details',
    'questions',
    'issues',
    'notes',
  ]);
});
