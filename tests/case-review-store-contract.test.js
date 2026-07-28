// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

/**
 * Every `.js` file under `src/`, as `[relative path, source]` pairs.
 * @param {URL} directory
 * @param {string} [prefix]
 * @returns {Array<[string, string]>}
 */
function sourceFiles(directory, prefix = '') {
  /** @type {Array<[string, string]>} */
  const found = [];
  for (const entry of readdirSync(directory).sort()) {
    const url = new URL(entry, directory);
    if (statSync(url).isDirectory()) {
      found.push(
        ...sourceFiles(new URL(`${entry}/`, directory), `${prefix}${entry}/`)
      );
    } else if (entry.endsWith('.js')) {
      found.push([`${prefix}${entry}`, readFileSync(url, 'utf8')]);
    }
  }
  return found;
}

test('case review tree contains only store actions and pure views', () => {
  const directory = new URL('../src/pages/cora-case-review/', import.meta.url);
  const files = readdirSync(directory).sort();
  assert.deepEqual(
    files.filter((file) =>
      /(controller|registry|interim-adapter|types)\.js$/.test(file)
    ),
    []
  );

  for (const file of files) {
    const source = readFileSync(new URL(file, directory), 'utf8');
    assert.doesNotMatch(
      source,
      /\b(?:ShellElement|defineView|reactive)\b|\bsignal\s*\(|from ['"][^'"]*signal\.js['"]/
    );
  }
});

test('the Case Review page has exactly one Answer owner', () => {
  const page = readFileSync(
    new URL('../src/pages/cora-case-review.js', import.meta.url),
    'utf8'
  );

  // Answers live in the store. A view callback that reached past it into the
  // loader would create the second owner this page was refactored to remove.
  assert.doesNotMatch(page, /answersSignal/);
  assert.doesNotMatch(page, /caseLoader\.handle/);

  // And exactly one writer: `editAnswers` is the only caller of the Answer
  // save effect, which is in turn the only place Answers are dispatched and
  // enqueued.
  assert.equal(
    (page.match(/answersEdited\(/g) ?? []).length,
    1,
    'only editAnswers may call the Answer save effect'
  );
});

/**
 * The two modules allowed to hold a Case Row on an object: the loader, which
 * hands it to the store in `toStoreSnapshot()`, and `CaseMachine`, which
 * captures it at construction. Adding a third means a new copy that can drift
 * from `snapshot.caseRow` — argue for it in review, do not just extend this.
 */
const CASE_ROW_HOLDERS = new Set(['lib/case-loader.js', 'lib/case-machine.js']);

test('the Case Review page has exactly one Case Row owner', () => {
  // The store owns the Case Row. The loader keeps a copy only long enough to
  // hand it over, so no other module may assign one: a second writer is the
  // hand-rolled sync that was removed for Answers, one level up.
  //
  // Deliberately matches *any* `.caseRow =` rather than the `caseLoader|loader`
  // spellings the original regression used, so a writer through a differently
  // named binding still trips it. Limitation worth knowing: this is text
  // matching, so it cannot see `Object.assign(target, { caseRow })`, a
  // destructured alias, or a computed `target['caseRow'] =`. It holds the
  // shape the codebase actually writes today, not a proof.
  const assignsCaseRow = /\.caseRow\s*=[^=]/;
  for (const [path, source] of sourceFiles(
    new URL('../src/', import.meta.url)
  )) {
    if (CASE_ROW_HOLDERS.has(path)) continue;
    assert.ok(
      !assignsCaseRow.test(source),
      `${path} assigns a Case Row onto an object; the store is the owner`
    );
  }
});
