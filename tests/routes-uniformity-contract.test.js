// @ts-check

/**
 * Route modules stay one shape (#520, #548).
 *
 * #520 collapsed nine pass-through route shells onto `registerStoreRoute`.
 * `#/team-cases` could not follow, because it hand-rolled a `mount`/`unmount`
 * literal to dig the query string out of `location.hash` — something the router
 * had already parsed in order to match the route at all. #548 gave the router
 * `params.queryString` and that last literal went away.
 *
 * Nothing enforced the result, which is the gap this closes. The cost of a
 * second shape is not the shape: it is that `src/routes/` becomes a directory
 * with two patterns to copy, and the next route wanting a query string copies
 * the wrong one — the exact regression #520 and #548 exist to prevent. A
 * hand-rolled handler also re-opens the mount-lifetime questions
 * `createStoreRoute` answers centrally (#437's failure containment, #517's
 * AbortController and `isActive()` guard), each of which is easy to get subtly
 * wrong and invisible when you do.
 *
 * If a route genuinely needs behaviour `registerStoreRoute` cannot express, the
 * fix is to teach `registerStoreRoute` — as #548 taught the router — not to
 * add a second pattern here. Deleting this test is the wrong way to make it
 * pass.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROUTES = new URL('../src/routes/', import.meta.url);

const routeFiles = readdirSync(ROUTES)
  .filter((name) => name.endsWith('.js'))
  .sort();

test('every route module registers through registerStoreRoute (#520, #548)', () => {
  assert.ok(routeFiles.length > 0, 'there are route modules to check');

  for (const name of routeFiles) {
    const source = readFileSync(new URL(name, ROUTES), 'utf8');

    assert.match(
      source,
      /registerStoreRoute\(/,
      `src/routes/${name} does not call registerStoreRoute — see this file's header before adding a second route shape`
    );

    // `router.register` is the primitive `registerStoreRoute` wraps. A route
    // module calling it directly is hand-rolling the handler.
    assert.doesNotMatch(
      source,
      /router\.register\(/,
      `src/routes/${name} calls router.register directly; registerStoreRoute owns the handler shape`
    );

    // The `mount`/`unmount` object literal #520 removed and #548 finished off.
    // Matches a method shorthand or a property assignment, which is how a
    // handler literal is spelled.
    assert.doesNotMatch(
      source,
      /\b(?:mount|unmount)\s*[(:]/,
      `src/routes/${name} declares a mount/unmount handler literal; the store route owns the mount lifetime (#437, #517)`
    );
  }
});
