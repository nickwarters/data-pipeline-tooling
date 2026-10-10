// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducePeopleSearches } from '../src/pages/forms/people-search-state.js';

// Capability: each people picker on a Forms page keeps its own search, offers
// matches only for what is in its box, and forgets them when it is cleared.

const SAM = { loginName: 'sam', displayName: 'Sam Patel' };

/** @param {string} query */
function answered(query) {
  return { query, people: [SAM], status: /** @type {const} */ ('success') };
}

test('typing on keeps the earlier matches offered until the directory answers', () => {
  const next = reducePeopleSearches(
    { Employee: answered('sa') },
    { type: 'forms/person-query', key: 'Employee', query: 'sam' }
  );
  assert.deepEqual(next?.Employee, {
    query: 'sam',
    people: [SAM],
    status: 'idle',
  });
});

test('emptying the box offers no one, whatever was matched before', () => {
  const next = reducePeopleSearches(
    { Employee: answered('sa') },
    { type: 'forms/person-query', key: 'Employee', query: '  ' }
  );
  assert.deepEqual(next?.Employee.people, []);
});

test('a picker searched for the first time offers no one until the directory answers', () => {
  const next = reducePeopleSearches(
    {},
    { type: 'forms/person-query', key: 'Employee', query: 'sam' }
  );
  assert.deepEqual(next?.Employee.people, []);
});

test('the directory’s answer for what is in the box is offered', () => {
  const next = reducePeopleSearches(
    { Employee: { query: 'sam', people: [], status: 'loading' } },
    { type: 'forms/person-results', key: 'Employee', search: answered('sam') }
  );
  assert.deepEqual(next?.Employee, answered('sam'));
});

test('matches for a query typed past, or for a picker since cleared, are not offered', () => {
  const searches = { Employee: answered('sam') };
  for (const [key, query] of [
    ['Employee', 'sa'],
    ['FirstLineManager', 'sam'],
  ]) {
    assert.equal(
      reducePeopleSearches(searches, {
        type: 'forms/person-results',
        key,
        search: answered(query),
      }),
      searches,
      key
    );
  }
});

test('clearing one picker leaves the others searching', () => {
  const next = reducePeopleSearches(
    { Employee: answered('sam'), FirstLineManager: answered('ana') },
    { type: 'forms/person-cleared', key: 'Employee' }
  );
  assert.deepEqual(Object.keys(next ?? {}), ['FirstLineManager']);
});

test('an action that is not about a people picker is left to the page', () => {
  assert.equal(reducePeopleSearches({}, { type: 'form/loaded' }), null);
});
