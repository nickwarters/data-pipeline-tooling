// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '../src/lib/signal.js';

// Provide a minimal HTMLElement stub before reactive-element.js is evaluated.
/** @type {any} */ (globalThis).HTMLElement = class {
  constructor() {
    /** @type {any[]} */
    this.children = [];
  }

  disconnectedCallback() {}

  /**
   * @param {...any} children
   */
  replaceChildren(...children) {
    this.children = children;
  }
};

const { ReactiveElement } = await import('../src/components/reactive-element.js');

test('ReactiveElement: disconnectedCallback releases render signal subscriptions', () => {
  const value = signal('initial');

  class TestElement extends ReactiveElement {
    constructor() {
      super();
      this.renderCount = 0;
    }

    render() {
      this.renderCount++;
      value.get();
      return undefined;
    }
  }

  const el = new TestElement();
  el.connectedCallback();
  assert.equal(el.renderCount, 1);

  value.set('while-connected');
  assert.equal(el.renderCount, 2);

  el.disconnectedCallback();
  value.set('after-disconnect');
  assert.equal(el.renderCount, 2);
});
