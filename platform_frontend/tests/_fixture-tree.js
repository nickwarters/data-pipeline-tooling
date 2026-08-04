// @ts-check

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Build a throwaway source tree and return its root URL.
 *
 * The tree always carries a `package.json` with `"type": "module"`, as the repo
 * does: `node --check` reads a `.js` file as a module only when the nearest
 * package.json says so, and without it a broken module would be parsed as a
 * script and quietly pass.
 *
 * @param {Record<string, string>} files repo-relative path -> contents
 * @returns {URL}
 */
export function fixtureTree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cora-fixture-tree-'));
  const tree = { 'package.json': '{ "type": "module" }\n', ...files };
  for (const [rel, contents] of Object.entries(tree)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }
  return pathToFileURL(dir + '/');
}
