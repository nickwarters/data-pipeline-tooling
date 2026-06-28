// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterMount,
  captureFocus,
  defineView,
  on,
  restoreFocus,
} from '../src/lib/view.js';

test('view API: exports the future framework primitives', () => {
  assert.equal(typeof defineView, 'function');
  assert.equal(typeof on, 'function');
  assert.equal(typeof afterMount, 'function');
  assert.equal(typeof captureFocus, 'function');
  assert.equal(typeof restoreFocus, 'function');
});

test.todo('defineView: defines a custom element for the supplied tag name');

test.todo('defineView: applies default props to new host instances');

test.todo('defineView: renders returned nodes into the host element');

test.todo('defineView: re-renders when signals read by render change');

test.todo('defineView: disposes render effects when the host disconnects');

test.todo('on: removes registered listeners when the owning view disconnects');

test.todo('afterMount: runs once on connect and disposes returned cleanup');

test.todo('captureFocus/restoreFocus: preserves data-focus-key and selection');
