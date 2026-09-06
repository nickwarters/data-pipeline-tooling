// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

/**
 * The lazy-load property, observed rather than inferred.
 *
 * This file imports the composition root and **nothing else** before it, with a
 * module load hook recording every module the import actually pulls in — so the
 * question "does importing the config evaluate a Case Type?" is answered by
 * watching, not by reading the source for static imports. The source scan in
 * `case-type-manifest.test.js` is the other half: it stops a static import
 * being added, this catches one arriving any other way.
 *
 * Its own file because the test runner gives each one its own process. In any
 * other file a Case Type module would already be loaded by something else and
 * there would be nothing to see.
 */

/** @type {string[]} */
const loaded = [];
registerHooks({
  load(url, context, nextLoad) {
    loaded.push(url);
    return nextLoad(url, context);
  },
});

const { APP_CONFIG } = await import('../src/app-config.js');

test('importing the composition root evaluates no Case Type module', () => {
  const slugs = APP_CONFIG.caseTypes.map((entry) => entry.slug);
  assert.ok(slugs.length > 0, 'expected at least one composed Case Type');
  assert.ok(loaded.length > 0, 'the load hook saw the import happen');

  const evaluated = slugs.filter((slug) =>
    loaded.some((url) => url.endsWith(`/case-types/${slug}.js`))
  );
  assert.deepEqual(
    evaluated,
    [],
    'the boot-critical synchronous permissions config reads slug and displayName off these entries, so evaluating a Case Type module here would pull every one of them into boot'
  );
});

test('the composed Case Types are frozen entries carrying un-invoked thunks', () => {
  for (const entry of APP_CONFIG.caseTypes) {
    assert.equal(typeof entry.importer, 'function', `${entry.slug} importer`);
    assert.ok(!(entry.importer instanceof Promise), `${entry.slug} importer`);
    if (entry.bank) assert.equal(typeof entry.bank, 'function');
    assert.ok(Object.isFrozen(entry), `${entry.slug} entry is frozen`);
  }
  assert.ok(Object.isFrozen(APP_CONFIG.caseTypes), 'the declaration is frozen');
});
