// @ts-check

/**
 * Mount-lifetime read-binding contract.
 *
 * `createStoreRoute` owns an `AbortController` per mount and exposes it as
 * `tools.signal`. A route that reads Cases binds it to its client once in
 * `start()` via `withAbortSignal`, so navigating away cancels the reads the
 * abandoned page still has in flight.
 *
 * That binding reached the Case-source fan-out pages first, and the four pages
 * left behind sat unbound for long enough to become a second working example. This is the ratchet that stops the next page joining them: a page
 * that reads through `context.client` must bind the lifetime, and a new one
 * cannot be added unbound without failing here.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);
const PAGES = new URL('src/pages/', ROOT);

/**
 * Pages that read through the client but cannot carry the signal today, with
 * the reason. This is an exemption list, not a debt ledger: an entry is a
 * statement that the read has nowhere to put a signal, not that binding it is
 * outstanding work.
 *
 * `withAbortSignal` only binds the reads that take a `(subject, opts)` shape —
 * `getCase`, `listCases`, `countCases`. `listRoadmapItems()` takes no options
 * bag at all, so wrapping the Roadmap's client would read as covered while
 * cancelling nothing. Giving it one means changing the `SharePointClient`
 * interface for a single small read of a static list, and `CaseReadOptions` is
 * the wrong shape to hang on a non-Case read. Revisit if that read grows
 * options for another reason.
 */
const UNBINDABLE = new Map([
  ['src/pages/roadmap.js', 'listRoadmapItems() takes no options bag'],
]);

/** @param {URL} dir @returns {string[]} repo-relative paths of every .js file */
function jsFilesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...jsFilesUnder(child));
    else if (entry.name.endsWith('.js'))
      out.push(child.pathname.slice(ROOT.pathname.length));
  }
  return out;
}

/**
 * Source with whole-line comments stripped, so prose about `context.client`
 * does not count as a read.
 * @param {string} rel @returns {string}
 */
function readCode(rel) {
  return readFileSync(new URL(rel, ROOT), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n');
}

test('every route slice that reads through the client binds the mount lifetime', () => {
  /** @type {string[]} */
  const unbound = [];
  for (const rel of jsFilesUnder(PAGES)) {
    const code = readCode(rel);
    // Only route slices reach `tools.signal` — a pure view has no `start()`.
    if (!/export function createRouteSlice/.test(code)) continue;
    if (!/context\.client/.test(code)) continue;
    if (UNBINDABLE.has(rel)) continue;
    if (!/withAbortSignal\(/.test(code)) unbound.push(rel);
  }

  assert.deepEqual(
    unbound,
    [],
    `these route slices read through context.client without binding tools.signal:\n  ${unbound.join('\n  ')}\n` +
      'Bind it once in start() with withAbortSignal(client, tools.signal), and handle the rejection with ignoreAbortError.'
  );
});

test('the unbindable-read exemptions still describe real pages', () => {
  for (const [rel, reason] of UNBINDABLE) {
    const code = readCode(rel);
    assert.ok(
      /export function createRouteSlice/.test(code),
      `${rel} is exempted but is no longer a route slice — drop the entry (${reason})`
    );
    assert.ok(
      !/withAbortSignal\(/.test(code),
      `${rel} now binds the lifetime — drop its exemption (${reason})`
    );
  }
});
