// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnvironment } from '../src/config/environment.js';

test('resolveEnvironment: "uat" resolves to the UAT environment', () => {
  const env = resolveEnvironment('uat');
  assert.equal(env.name, 'uat');
  assert.equal(env.listPrefix, 'uat_');
  assert.equal(
    env.exportBasePath,
    '/Style%20Library/case-review-uat/case-types'
  );
});

test('resolveEnvironment: "prod" resolves to prod with no list prefix', () => {
  const env = resolveEnvironment('prod');
  assert.equal(env.name, 'prod');
  assert.equal(env.listPrefix, '');
  assert.equal(env.exportBasePath, '/Style%20Library/case-review/case-types');
});

test('resolveEnvironment: undefined (dev loop, no host token) resolves to prod', () => {
  assert.equal(resolveEnvironment(undefined).name, 'prod');
});

test('resolveEnvironment: an unsubstituted {{CORA_ENV}} token resolves to prod', () => {
  assert.equal(resolveEnvironment('{{CORA_ENV}}').name, 'prod');
});

test('resolveEnvironment: defaults to globalThis.CORA_ENV', () => {
  const g = /** @type {Record<string, unknown>} */ (
    /** @type {unknown} */ (globalThis)
  );
  assert.equal(resolveEnvironment().name, 'prod');
  g.CORA_ENV = 'uat';
  try {
    assert.equal(resolveEnvironment().name, 'uat');
  } finally {
    delete g.CORA_ENV;
  }
});
