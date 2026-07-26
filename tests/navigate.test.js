// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

isolateBrowserGlobals();

/**
 * @param {{ pathname?: string, search?: string }} [parts]
 */
function stubLocation(parts = {}) {
  /** @type {string[]} */
  const replaced = [];
  const stub = {
    hash: '#/before',
    pathname: parts.pathname ?? '/SitePages/app.aspx',
    search: parts.search ?? '',
    /** @param {string} url */
    replace(url) {
      replaced.push(url);
    },
  };
  /** @type {any} */ (globalThis).location = stub;
  return { stub, replaced };
}

const { navigateTo, redirectTo } = await import('../src/lib/navigate.js');

test('navigateTo pushes a history entry by assigning the hash', () => {
  const { stub } = stubLocation();
  navigateTo('#/case/complaints/c1');
  assert.equal(stub.hash, '#/case/complaints/c1');
});

test('redirectTo replaces the current entry, preserving path and query', () => {
  const { stub, replaced } = stubLocation({
    pathname: '/SitePages/uat.app.aspx',
    search: '?mock=1',
  });
  redirectTo('#/');
  assert.deepEqual(replaced, ['/SitePages/uat.app.aspx?mock=1#/']);
  assert.equal(stub.hash, '#/before', 'does not also assign the hash');
});
