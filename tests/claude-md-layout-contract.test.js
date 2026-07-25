// @ts-check

import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../', import.meta.url);

/**
 * `CLAUDE.md`'s **Directory layout** block is the map every contributor and
 * every agent reads before touching anything non-trivial, so a module missing
 * from it is effectively undiscoverable. This checks only that each production
 * module's *basename* is mentioned somewhere in that block — strict enough to
 * catch a whole new page or route, loose enough not to police the annotations
 * or the indentation.
 *
 * Scoped to `src/` and `case-types/`: those are the deployed source. Fixtures
 * and scripts are listed in the block as directories, not file by file.
 *
 * @param {string} directory
 * @returns {string[]}
 */
function productionFiles(directory) {
  return readdirSync(new URL(directory, ROOT), {
    withFileTypes: true,
  }).flatMap((entry) => {
    if (entry.isDirectory())
      return productionFiles(`${directory}${entry.name}/`);
    return entry.isFile() && entry.name.endsWith('.js')
      ? [`${directory}${entry.name}`]
      : [];
  });
}

test('CLAUDE.md layout mentions every production module', () => {
  const md = readFileSync(new URL('CLAUDE.md', ROOT), 'utf8');
  const layout = md.split('## Directory layout')[1] ?? '';
  assert.notEqual(layout, '', 'CLAUDE.md has no "## Directory layout" section');

  const missing = [
    ...productionFiles('src/'),
    ...productionFiles('case-types/'),
  ]
    .filter((file) => !layout.includes(file.split('/').pop() ?? ''))
    .sort();

  assert.deepEqual(
    missing,
    [],
    'These modules are absent from the Directory layout block in CLAUDE.md. Add a line for each so it stays the reliable map of the tree.'
  );
});
