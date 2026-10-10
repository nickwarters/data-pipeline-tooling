// @ts-check
/**
 * The search state of every people picker on a Forms page, keyed by the field
 * it fills. The form page and New form both hold several pickers at once, so
 * they share this one reducer rather than each spelling out the same guard.
 */

/** @typedef {import('../../lib/people-search.js').PeopleSearchState} PeopleSearchState */

/**
 * @typedef {Record<string, PeopleSearchState>} PeopleSearches
 */

/**
 * The next search state for a `forms/person-query`, `forms/person-results` or
 * `forms/person-cleared` action, or `null` for any other action.
 *
 * @param {PeopleSearches} searches
 * @param {any} action
 * @returns {PeopleSearches | null}
 */
export function reducePeopleSearches(searches, action) {
  if (action.type === 'forms/person-query') {
    const held = searches[action.key];
    return {
      ...searches,
      [action.key]: {
        query: action.query,
        // Earlier matches stay offered until the next search starts, so the
        // list does not flicker under the person typing.
        people: action.query.trim() && held ? held.people : [],
        status: 'idle',
      },
    };
  }
  if (action.type === 'forms/person-results') {
    // An answer for a query the person has typed past would offer matches
    // for a name no longer in the box.
    if (searches[action.key]?.query !== action.search.query) return searches;
    return { ...searches, [action.key]: action.search };
  }
  if (action.type === 'forms/person-cleared') {
    const { [action.key]: _cleared, ...rest } = searches;
    return rest;
  }
  return null;
}
