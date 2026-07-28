// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';

installDom();

const { EmptyState, LoadingState } = await import('../src/lib/empty-state.js');

test('EmptyState: defaults to a <p> carrying the shared cora-empty hook', () => {
  const el = EmptyState('No messages yet.');
  assert.equal(el.tagName, 'P');
  assert.equal(el.className, 'cora-empty');
  assert.equal(el.textContent, 'No messages yet.');
});

test('EmptyState: appends the component class after the shared hook', () => {
  const el = EmptyState('No failures.', {
    className: 'cora-remediation-empty',
  });
  assert.equal(el.className, 'cora-empty cora-remediation-empty');
  assert.equal(el.textContent, 'No failures.');
});

test('EmptyState: tag option lets non-paragraph sites reuse the helper', () => {
  const span = EmptyState('No labels assigned', {
    tag: 'span',
    className: 'label-empty',
  });
  assert.equal(span.tagName, 'SPAN');
  assert.equal(span.className, 'cora-empty label-empty');

  const div = EmptyState('// no remediations', {
    tag: 'div',
    className: 'rem-empty',
  });
  assert.equal(div.tagName, 'DIV');
  assert.equal(div.className, 'cora-empty rem-empty');
});

test('EmptyState: omitting className leaves no trailing whitespace', () => {
  const el = EmptyState('Nothing here');
  assert.equal(el.className, 'cora-empty');
});

test('LoadingState: one spelling of the in-flight placeholder, with the shared hook', () => {
  const el = LoadingState('Loading roadmap');
  assert.equal(el.tagName, 'P');
  assert.equal(el.className, 'cora-loading');
  // One ellipsis character across every site: call sites pass the subject,
  // never their own trailing dots.
  assert.equal(el.textContent, 'Loading roadmap…');
});

test('LoadingState: bare call renders the generic wording', () => {
  assert.equal(LoadingState().textContent, 'Loading…');
});

test('LoadingState: accepts a component class after the shared hook', () => {
  const el = LoadingState('Loading Question Banks', {
    className: 'cora-bank-loading',
  });
  assert.equal(el.className, 'cora-loading cora-bank-loading');
});
