// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { APP_TITLE, formatPageTitle, setPageTitle } =
  await import('../src/lib/page-title.js');

test('page title: parts are joined most-specific first, then the app name', () => {
  assert.equal(
    formatPageTitle('CMP-1234', 'Complaints'),
    'CMP-1234 · Complaints — CORA'
  );
  assert.equal(formatPageTitle('Dashboard'), 'Dashboard — CORA');
});

test('page title: blank and missing parts are dropped, and none at all is the app name', () => {
  assert.equal(
    formatPageTitle(' ', null, 'Search', undefined),
    'Search — CORA'
  );
  assert.equal(formatPageTitle(), APP_TITLE);
  assert.equal(formatPageTitle('', null), APP_TITLE);
});

test('page title: setPageTitle writes the tab title', () => {
  setPageTitle('My Stats');
  assert.equal(document.title, 'My Stats — CORA');
});
