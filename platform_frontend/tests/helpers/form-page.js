// @ts-check
/**
 * Drives one Form route — a Form itself, or New form — the way the store route
 * does, against the mock client and the dev personas, so a test reads what a
 * persona sees and writes what they would write. Import it after
 * `installDom()`: the page draws with the stub DOM.
 */

import { makeChrome } from './fixtures.js';
import { createRouteSlice } from '../../src/pages/cora-form.js';
import { MockSharePointClient } from '../../src/services/mock-sharepoint-client.js';
import { resolveCapabilities } from '../../src/services/permissions.js';
import { personas } from '../../dev/fixtures/personas.js';
import { people } from '../../dev/fixtures/people.js';
import { formLists } from '../../dev/fixtures/forms.js';
import { oneToOne } from '../../form-types/one-to-one.js';

/** The dev fixtures are written against this day. */
export const FORM_NOW = () => new Date(2026, 9, 10, 15, 32, 0);

/**
 * A mock client over a fresh copy of the dev Forms and directory.
 *
 * @param {typeof formLists} [lists] Stored Form rows to read instead.
 */
export function formsClient(lists = formLists) {
  return new MockSharePointClient({
    personas: {},
    people,
    formLists: structuredClone(lists),
    now: FORM_NOW,
  });
}

/**
 * Mount a Form route as a persona.
 *
 * @param {string} persona a key of the dev personas
 * @param {{
 *   id?: string,
 *   slug?: string,
 *   client?: any,
 *   formTypes?: any[] | null,
 *   chrome?: any,
 * }} [options] Without an `id`, New form is mounted. `formTypes: null`
 *   mounts an application that configures none.
 */
export function mountFormRoute(
  persona,
  {
    id,
    slug = oneToOne.slug,
    client = formsClient(),
    formTypes = [oneToOne],
    chrome,
  } = {}
) {
  const who = personas[persona];
  const context = /** @type {any} */ ({
    client,
    chrome:
      chrome ??
      makeChrome({
        currentUser: { id: who.userId, displayName: who.displayName },
        permissions: resolveCapabilities(who.groups),
      }),
    formTypes: formTypes ?? undefined,
  });
  const slice = /** @type {any} */ (
    createRouteSlice(id === undefined ? {} : { slug, id }, context, {
      now: FORM_NOW,
    })
  );
  /** @type {any} */
  let state = slice.initialState;
  /** @type {Set<() => void>} */
  const waiting = new Set();
  /** @type {any[]} */
  const actions = [];
  const lifetime = new AbortController();
  let active = true;
  /** @type {(value?: unknown) => void} */
  let reachedAfterLeave = () => {};
  const afterLeave = new Promise((resolve) => (reachedAfterLeave = resolve));
  const tools = {
    dispatch: (/** @type {any} */ action) => {
      if (!active) reachedAfterLeave();
      actions.push(action);
      state = slice.reducer(state, action);
      for (const check of [...waiting]) check();
    },
    isActive: () => {
      if (!active) reachedAfterLeave();
      return active;
    },
    signal: lifetime.signal,
    context,
  };
  const stop = slice.start?.(tools);
  return {
    client,
    actions,
    dispatch: tools.dispatch,
    get state() {
      return state;
    },
    /** The route's own slice of state. */
    get route() {
      return Object.values(state.routes)[0];
    },
    /**
     * Resolves once the route's state satisfies `predicate`, checked after
     * every action the page dispatches.
     *
     * @param {(route: any) => boolean} predicate
     * @returns {Promise<void>}
     */
    until(predicate) {
      return new Promise((resolve) => {
        const check = () => {
          if (!predicate(Object.values(state.routes)[0])) return;
          waiting.delete(check);
          resolve();
        };
        waiting.add(check);
        check();
      });
    },
    /**
     * Resolves once work the page started before it was left comes back to
     * it: when it asks whether it is still mounted, or dispatches regardless.
     *
     * @returns {Promise<void>}
     */
    afterLeave: () => afterLeave,
    render: () => /** @type {HTMLElement} */ (slice.view(state, tools)),
    leave() {
      active = false;
      lifetime.abort();
      if (typeof stop === 'function') stop();
    },
  };
}

/**
 * Mount a Form and wait for its read to settle.
 *
 * @param {string} persona
 * @param {string} id
 * @param {Parameters<typeof mountFormRoute>[1]} [options]
 */
export async function openForm(persona, id, options = {}) {
  const page = mountFormRoute(persona, { ...options, id });
  await page.until((route) => route.load !== 'loading');
  return page;
}
