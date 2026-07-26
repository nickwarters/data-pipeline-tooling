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

test('CASE-7 case review tree contains only store actions and pure views', () => {
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

test('the Case Review page has exactly one Answer owner (#510)', () => {
  const page = readFileSync(
    new URL('../src/pages/cora-case-review.js', import.meta.url),
    'utf8'
  );

  // Answers live in the store. A view callback that reached past it into the
  // loader would create the second owner this page was refactored to remove.
  assert.doesNotMatch(page, /answersSignal/);
  assert.doesNotMatch(page, /viewModel\.handle/);

  // And exactly one writer: `editAnswers` is the only caller of the Answer
  // save effect, which is in turn the only place Answers are dispatched and
  // enqueued.
  assert.equal(
    (page.match(/answersEdited\(/g) ?? []).length,
    1,
    'only editAnswers may call the Answer save effect'
  );
});

test('the Case Review page has exactly one Case Row owner (#530)', () => {
  // The store owns the Case Row. `CaseReviewViewModel` keeps a copy only long
  // enough to hand it over in `toStoreSnapshot()`, so nothing outside the
  // loader's own `load()` may assign it: a second writer there is the
  // hand-rolled sync #510 removed for Answers, one level up.
  const assignsLoaderCaseRow = /\b(?:viewModel|vm|loader)\.caseRow\s*=[^=]/;
  for (const [path, source] of sourceFiles(
    new URL('../src/', import.meta.url)
  )) {
    if (path === 'lib/case-review-view-model.js') continue;
    assert.ok(
      !assignsLoaderCaseRow.test(source),
      `${path} assigns the loader's Case Row; the store is the owner (#530)`
    );
  }
});
