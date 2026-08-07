// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_GLOBAL_NAMES } from './helpers/browser-globals.js';

const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** @param {string} dir @returns {string[]} */
function javascriptFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return javascriptFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

/** @param {string} source */
function mutatesBrowserGlobal(source) {
  return BROWSER_GLOBAL_NAMES.some((name) => {
    const reference = `globalThis).${name}`;
    const directReference = `globalThis.${name}`;
    return source.split('\n').some((line) => {
      if (!line.includes(reference) && !line.includes(directReference)) {
        return false;
      }
      return (
        /\bdelete\b/.test(line) ||
        new RegExp(`\\.${name}(?:\\.[\\w$]+)?\\s*=(?!=|>)`).test(line)
      );
    });
  });
}

test('browser-global writes opt into automatic per-test restoration', () => {
  const uncovered = javascriptFiles(TESTS_DIR)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => mutatesBrowserGlobal(source))
    .filter(
      ({ source }) =>
        !source.includes('installDom()') &&
        !source.includes('isolateBrowserGlobals()')
    )
    .map(({ path }) => relative(TESTS_DIR, path))
    .sort();

  assert.deepEqual(
    uncovered,
    [],
    'use installDom() or isolateBrowserGlobals() before replacing browser globals'
  );
});
