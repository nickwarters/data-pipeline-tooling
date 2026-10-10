// @ts-check
/**
 * Drives the Forms page's route slice the way the store route does, against
 * the mock client and the dev personas, so a test reads what a persona sees.
 * Import it after `installDom()`: the page draws with the stub DOM.
 */

import { makeChrome } from './fixtures.js';
import { queryAllByTag } from './semantic-dom.js';
import { createRouteSlice } from '../../src/pages/cora-forms.js';
import { MockSharePointClient } from '../../src/services/mock-sharepoint-client.js';
import { resolveCapabilities } from '../../src/services/permissions.js';
import { personas } from '../../dev/fixtures/personas.js';
import { formLists } from '../../dev/fixtures/forms.js';
import { oneToOne } from '../../form-types/one-to-one.js';

/** The dev fixtures are written against this day. */
export const NOW = () => new Date(2026, 9, 10, 12, 0, 0);

/**
 * Mount the page as a persona and wait for its first read to settle.
 *
 * @param {string} persona a key of the dev personas
 * @param {{ client?: any, formTypes?: any[], tab?: 'outstanding' | 'archive' }} [options]
 */
export async function mountFormsPage(
  persona,
  { client, formTypes = [oneToOne], tab = 'outstanding' } = {}
) {
  const who = personas[persona];
  const context = /** @type {any} */ ({
    client: client ?? new MockSharePointClient({ personas: {}, formLists }),
    chrome: makeChrome({
      currentUser: { id: who.userId, displayName: who.displayName },
      permissions: resolveCapabilities(who.groups),
    }),
    formTypes,
  });
  const slice = createRouteSlice(
    { queryString: tab === 'archive' ? '?tab=archive' : '' },
    context,
    { now: NOW }
  );
  let state = slice.initialState;
  /** @type {Set<() => void>} */
  const waiting = new Set();
  /** @type {any[]} */
  const actions = [];
  const tools = {
    dispatch: (/** @type {any} */ action) => {
      actions.push(action);
      state = slice.reducer(state, action);
      for (const check of [...waiting]) check();
    },
    isActive: () => true,
    signal: new AbortController().signal,
    context,
  };
  /**
   * Resolves once the page's state satisfies `predicate`, checked after every
   * action the page dispatches.
   *
   * @param {(route: any) => boolean} predicate
   * @returns {Promise<void>}
   */
  const until = (predicate) =>
    new Promise((resolve) => {
      const check = () => {
        if (!predicate(state.routes.forms)) return;
        waiting.delete(check);
        resolve();
      };
      waiting.add(check);
      check();
    });
  slice.start?.(tools);
  const read = tab === 'archive' ? 'archive' : 'mine';
  await until((route) => ['loaded', 'failed'].includes(route[read].status));
  return {
    actions,
    until,
    get state() {
      return state;
    },
    render: () => /** @type {HTMLElement} */ (slice.view(state, tools)),
  };
}

/**
 * Each body row of the page's table as the text of its cells.
 *
 * @param {HTMLElement} view
 * @returns {string[][]}
 */
export function bodyRows(view) {
  const body = queryAllByTag(view, 'tbody')[0];
  if (!body) return [];
  return queryAllByTag(body, 'tr').map((row) =>
    queryAllByTag(row, 'td').map((cell) => cell.textContent)
  );
}
