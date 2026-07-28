// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editRemediationDetail } from '../src/pages/cora-case-review/remediation-actions.js';

test('action: Remediation Detail edits preserve Answers and reuse evaluator clearing semantics', () => {
  const answers = {
    q1: {
      value: 'No',
      remediationDetails: { rootCause: 'Rushed', severity: 'High' },
    },
    q2: { value: 'Yes' },
  };

  const edited = editRemediationDetail({
    answers,
    questionId: 'q1',
    key: 'rootCause',
    value: '',
    canEdit: true,
    fields: [{ key: 'rootCause', label: 'Root cause', type: 'text' }],
  });

  assert.notEqual(edited, answers);
  assert.deepEqual(edited?.q1.remediationDetails, { severity: 'High' });
  assert.equal(edited?.q2, answers.q2);

  assert.equal(
    editRemediationDetail({
      answers,
      questionId: 'q1',
      key: 'rootCause',
      value: 'Changed',
      canEdit: false,
      fields: [{ key: 'rootCause', label: 'Root cause', type: 'text' }],
    }),
    null,
    'read-only viewers cannot create an auto-save action'
  );
});

test('action: an unknown Question or unconfigured field writes nothing', () => {
  const answers = { q1: { value: 'No' } };
  const fields =
    /** @type {import('../src/sharepoint-client.js').RemediationField[]} */ ([
      { key: 'rootCause', label: 'Root cause', type: 'text' },
    ]);

  assert.equal(
    editRemediationDetail({
      answers,
      questionId: 'missing',
      key: 'rootCause',
      value: 'x',
      canEdit: true,
      fields,
    }),
    null
  );
  assert.equal(
    editRemediationDetail({
      answers,
      questionId: 'q1',
      key: 'unconfigured',
      value: 'x',
      canEdit: true,
      fields,
    }),
    null
  );
});
