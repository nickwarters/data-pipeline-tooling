// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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
