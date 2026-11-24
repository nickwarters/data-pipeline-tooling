// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIST,
  PERSONAS,
  MockSharePointClient,
} from './helpers/mock-sharepoint-client.js';
import { makeCaseRow } from './helpers/fixtures.js';

// Capability: recording a manager also writes the current manager that decides
// access, and nothing else the platform saves ever touches it.

const OPTS = { listName: LIST };

/** @param {Partial<import('../src/sharepoint-client.js').CaseRow>} [row] */
function clientWith(row = {}) {
  return new MockSharePointClient({
    lists: {
      [LIST]: [makeCaseRow({ id: 'case-m', etag: 'etag-m', ...row })],
    },
    personas: PERSONAS,
    people: [
      {
        loginName: 'jsmith',
        displayName: 'John Smith',
        manager: 'i:0#.w|CONTOSO\\Boss',
      },
    ],
  });
}

test('recording the Reviewer Manager writes the same person as the current Reviewer Manager', async () => {
  const client = clientWith({
    assignedReviewerManager: 'previous-manager',
    currentReviewerManager: 'previous-manager',
  });

  const result = await client.patchCase(
    'case-m',
    { assignedReviewer: 'bea', assignedReviewerManager: 'mo' },
    'etag-m',
    OPTS
  );

  assert.equal(result.data?.assignedReviewerManager, 'mo');
  assert.equal(result.data?.currentReviewerManager, 'mo');
});

test('clearing the Reviewer Manager clears the current Reviewer Manager', async () => {
  const client = clientWith({
    assignedReviewerManager: 'mo',
    currentReviewerManager: 'mo',
  });

  const result = await client.patchCase(
    'case-m',
    { assignedReviewer: '', assignedReviewerManager: null },
    'etag-m',
    OPTS
  );

  assert.equal(result.data?.currentReviewerManager, null);
});

test('saving a Responsible Party writes their manager as the current Responsible Party Manager', async () => {
  const client = clientWith();

  const result = await client.patchCase(
    'case-m',
    { responsibleParty: 'jsmith' },
    'etag-m',
    OPTS
  );

  assert.equal(result.data?.responsiblePartyManager, 'boss');
  assert.equal(result.data?.currentResponsiblePartyManager, 'boss');
});

test('a save that records no manager leaves a current manager updated outside the platform as it is', async () => {
  const client = clientWith({
    assignedReviewerManager: 'mo',
    currentReviewerManager: 'updated-elsewhere',
    responsiblePartyManager: 'boss',
    currentResponsiblePartyManager: 'also-updated-elsewhere',
  });

  const result = await client.patchCase(
    'case-m',
    { notes: 'progress', status: 'Actions In Progress' },
    'etag-m',
    OPTS
  );

  assert.equal(result.data?.currentReviewerManager, 'updated-elsewhere');
  assert.equal(
    result.data?.currentResponsiblePartyManager,
    'also-updated-elsewhere'
  );
});

test('a save that names a current manager itself keeps that person', async () => {
  const client = clientWith();

  const result = await client.patchCase(
    'case-m',
    {
      assignedReviewerManager: 'mo',
      currentReviewerManager: 'someone-else',
      responsiblePartyManager: 'boss',
      currentResponsiblePartyManager: 'another',
    },
    'etag-m',
    OPTS
  );

  assert.equal(result.data?.assignedReviewerManager, 'mo');
  assert.equal(result.data?.currentReviewerManager, 'someone-else');
  assert.equal(result.data?.responsiblePartyManager, 'boss');
  assert.equal(result.data?.currentResponsiblePartyManager, 'another');
});
