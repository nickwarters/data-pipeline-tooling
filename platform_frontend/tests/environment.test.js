// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_NAMES,
  PROD_ENVIRONMENT_NAME,
  listPrefixFor,
  resolveEnvironment,
} from '../src/config/environment.js';

test('ENVIRONMENT_NAMES: prod is first and every name is a clean identifier', () => {
  assert.equal(ENVIRONMENT_NAMES[0], PROD_ENVIRONMENT_NAME);
  assert.equal(new Set(ENVIRONMENT_NAMES).size, ENVIRONMENT_NAMES.length);
  for (const name of ENVIRONMENT_NAMES) {
    // The name becomes a list prefix, a folder suffix and a host page name,
    // so it must be safe in all three.
    assert.match(name, /^[a-z][a-z0-9]*$/);
  }
});

test('resolveEnvironment: "uat" resolves to the UAT environment', () => {
  const env = resolveEnvironment('uat');
  assert.equal(env.name, 'uat');
  assert.equal(env.listPrefix, 'uat_');
});

test('resolveEnvironment: "training" resolves to the training environment', () => {
  const env = resolveEnvironment('training');
  assert.equal(env.name, 'training');
  assert.equal(env.listPrefix, 'training_');
});

test('resolveEnvironment: "prod" resolves to prod with no list prefix', () => {
  const env = resolveEnvironment('prod');
  assert.equal(env.name, 'prod');
  assert.equal(env.listPrefix, '');
});

test('resolveEnvironment: every declared environment resolves to itself', () => {
  for (const name of ENVIRONMENT_NAMES) {
    const env = resolveEnvironment(name);
    assert.equal(env.name, name);
    assert.equal(env.listPrefix, listPrefixFor(name));
    assert.equal(env.listPrefix, name === 'prod' ? '' : `${name}_`);
  }
});

test('resolveEnvironment: declares the list prefix and nothing else', () => {
  // Question Bank artifacts used to need a second environment declaration — a
  // Style Library base path per environment — and now resolve relative to the
  // module that reads them, so each deploy reads the artifacts it was deployed
  // with. Pinning the shape keeps that from being quietly reintroduced.
  assert.deepEqual(Object.keys(resolveEnvironment('uat')).sort(), [
    'listPrefix',
    'name',
  ]);
});

test('resolveEnvironment: undefined (dev loop, no host token) resolves to prod', () => {
  assert.equal(resolveEnvironment(undefined).name, 'prod');
});

test('resolveEnvironment: an unsubstituted {{CORA_ENV}} token resolves to prod', () => {
  assert.equal(resolveEnvironment('{{CORA_ENV}}').name, 'prod');
});

test('resolveEnvironment: an unknown name resolves to prod, never to a guessed prefix', () => {
  assert.deepEqual(resolveEnvironment('staging'), {
    name: 'prod',
    listPrefix: '',
  });
  assert.deepEqual(resolveEnvironment('UAT'), { name: 'prod', listPrefix: '' });
  assert.deepEqual(resolveEnvironment(42), { name: 'prod', listPrefix: '' });
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
