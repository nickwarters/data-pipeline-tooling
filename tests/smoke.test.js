// TODO(simplify-ui): Keep this test focused on the simple public seams as
// the UI migrates. Where this behavior is consumed by screens, add coverage
// through function components, h() output, reactive() updates, or thin route
// shells rather than class lifecycle setup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('node test runner is wired up', () => {
  assert.equal(1 + 1, 2);
});

test('dev/index.html local stylesheet hrefs resolve to existing files', () => {
  const html = readFileSync(resolve(ROOT, 'dev/index.html'), 'utf8');
  const localHrefs = [
    ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g),
  ]
    .map((m) => m[1])
    .filter((href) => !href.startsWith('http'));

  assert.ok(
    localHrefs.length > 0,
    'expected at least one local stylesheet link'
  );

  for (const href of localHrefs) {
    const abs = resolve(ROOT, 'dev', href);
    assert.ok(
      existsSync(abs),
      `stylesheet not found: ${href} (resolved to ${abs})`
    );
  }
});
