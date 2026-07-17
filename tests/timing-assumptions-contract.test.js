// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const THIS_FILE = basename(fileURLToPath(import.meta.url));

function javascriptTests() {
  /** @param {string} directory @returns {{ name: string, source: string }[]} */
  const collect = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return collect(path);
      if (!entry.name.endsWith('.js') || entry.name === THIS_FILE) return [];
      return [
        {
          name: path.slice(TESTS_DIR.length + 1),
          source: readFileSync(path, 'utf8'),
        },
      ];
    });

  return collect(TESTS_DIR);
}

test('tests do not wait for real timers to guess when async work finished', () => {
  const offenders = javascriptTests()
    .filter(({ source }) =>
      /await\s+new Promise\([\s\S]{0,160}?setTimeout\s*\(/.test(source)
    )
    .map(({ name }) => name);

  assert.deepEqual(
    offenders,
    [],
    'await an operation/waitFor observable state, or advance Node mock timers explicitly'
  );
});

test('tests do not poll wall-clock deadlines for eventual completion', () => {
  const offenders = javascriptTests()
    .filter(({ source }) => /while\s*\([^)]*Date\.now\(\)[^)]*\)/.test(source))
    .map(({ name }) => name);

  assert.deepEqual(
    offenders,
    [],
    'expose and await the promise that represents the operation instead'
  );
});

test('tests do not yield to setImmediate to guess when async work finished', () => {
  const offenders = javascriptTests()
    .filter(({ source }) =>
      /await\s+new Promise\([\s\S]{0,160}?setImmediate\s*\(/.test(source)
    )
    .map(({ name }) => name);

  assert.deepEqual(
    offenders,
    [],
    'await an operation promise or waitFor observable state instead of yielding a turn'
  );
});
