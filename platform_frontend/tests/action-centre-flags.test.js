// @ts-check
/**
 * The one place the Action Centre's state flags are paired with their clocks.
 *
 * The rule the suite is really guarding is that neither pair can be produced
 * half-way, and that neither clock is a fresh reading of the wall clock: both
 * come out of what is being written, so replaying the identical field bag —
 * which the SaveQueue does on an ETag conflict — persists the identical value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  awaitingFrontlineAfterPost,
  awaitingFrontlineCleared,
  openAppealFields,
} from '../src/services/action-centre-flags.js';

/** @param {string} at */
function message(at) {
  return { author: 'Someone', timestamp: at, body: 'text' };
}

/** @param {string} at @param {'raised'|'resolved'} state */
function appeal(at, state) {
  return { id: `appeal-${at}`, appellant: 'rp', at, rationale: 'why', state };
}

test('a Reviewer’s post starts the Awaiting clock at the message’s own timestamp', () => {
  assert.deepEqual(
    awaitingFrontlineAfterPost(
      ['assignedReviewer'],
      message('2026-07-02T10:30:00.000Z')
    ),
    {
      awaitingResponsibleParty: true,
      awaitingSince: '2026-07-02T10:30:00.000Z',
    }
  );
});

test('the frontline’s reply clears the flag and its clock together', () => {
  assert.deepEqual(
    awaitingFrontlineAfterPost(
      ['responsiblePartyManager'],
      message('2026-07-03T08:00:00.000Z')
    ),
    { awaitingResponsibleParty: false, awaitingSince: null }
  );
});

test('a poster on neither side of the exchange changes neither half of the pair', () => {
  assert.deepEqual(
    awaitingFrontlineAfterPost(
      ['controls'],
      message('2026-07-04T08:00:00.000Z')
    ),
    {}
  );
  assert.deepEqual(
    awaitingFrontlineAfterPost([], message('2026-07-04T08:00:00.000Z')),
    {}
  );
});

test('a Case that waits on nobody carries the cleared pair, not a cleared flag', () => {
  assert.deepEqual(awaitingFrontlineCleared(), {
    awaitingResponsibleParty: false,
    awaitingSince: null,
  });
});

test('an open Appeal raises the flag and dates it from the Appeal itself', () => {
  assert.deepEqual(
    openAppealFields([
      appeal('2026-06-01T00:00:00.000Z', 'resolved'),
      appeal('2026-06-20T12:00:00.000Z', 'raised'),
    ]),
    { hasOpenAppeal: true, appealRaisedAt: '2026-06-20T12:00:00.000Z' }
  );
});

test('resolving the last open Appeal clears the flag and its clock', () => {
  assert.deepEqual(
    openAppealFields([appeal('2026-06-20T12:00:00.000Z', 'resolved')]),
    { hasOpenAppeal: false, appealRaisedAt: null }
  );
});

test('an empty Appeals list is still an answer: no open Appeal', () => {
  assert.deepEqual(openAppealFields([]), {
    hasOpenAppeal: false,
    appealRaisedAt: null,
  });
});

test('the Appeals list handed in is never mutated', () => {
  const appeals = [appeal('2026-06-20T12:00:00.000Z', 'raised')];
  const before = JSON.stringify(appeals);
  openAppealFields(appeals);
  assert.equal(JSON.stringify(appeals), before);
});
