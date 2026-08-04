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
  SECTIONS,
  SUMMARY_SECTIONS,
} from './helpers/section-access.js';

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
