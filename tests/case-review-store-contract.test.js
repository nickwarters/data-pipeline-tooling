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
      /\b(?:ShellElement|defineView|reactive)\b|\bsignal\s*\(|from ['\"][^'\"]*signal\.js['\"]/
    );
  }
});
