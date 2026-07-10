// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Must be imported before src/lib/view.js: it installs globalThis.HTMLElement
// (among other DOM stubs) as a side effect, and view.js resolves its
// HTMLElement base class once at module-eval time. See _view-stub.js for why
// this ordering matters.
import { StubEl } from './_view-stub.js';
import { h } from '../src/lib/html.js';
import { signal } from '../src/lib/signal.js';
import {
  afterMount,
  captureFocus,
  createLifecycle,
  defineView,
  normalizeRenderResult,
  on,
  reactive,
  replaceHostChildren,
  restoreFocus,
  ShellElement,
} from '../src/lib/view.js';

test('view API: exports the future framework primitives', () => {
  assert.equal(typeof defineView, 'function');
  assert.equal(typeof reactive, 'function');
  assert.equal(typeof createLifecycle, 'function');
  assert.equal(typeof on, 'function');
  assert.equal(typeof afterMount, 'function');
  assert.equal(typeof captureFocus, 'function');
  assert.equal(typeof restoreFocus, 'function');
});

test('reactive: renders a plain function component into a host node', () => {
  const host = /** @type {StubEl} */ (
    /** @type {unknown} */ (reactive(() => h('p', {}, 'Hello')))
  );

  assert.equal(host.tagName, 'DIV');
  assert.equal(host._children.length, 1);
  assert.equal(host._children[0].tagName, 'P');
  assert.equal(host._children[0].textContent, 'Hello');
});

test('reactive: re-renders when signals read by render change', () => {
  const label = signal('one');
  const host = /** @type {StubEl} */ (
    /** @type {unknown} */ (reactive(() => h('p', {}, label.get())))
  );

  assert.equal(host._children[0].textContent, 'one');
  label.set('two');
  assert.equal(host._children[0].textContent, 'two');
});

test('reactive: supports node arrays and undefined render output', () => {
  const visible = signal(true);
  const host = /** @type {StubEl} */ (
    /** @type {unknown} */ (
      reactive(() =>
        visible.get() ? [h('span', {}, 'A'), h('span', {}, 'B')] : undefined
      )
    )
  );

  assert.deepEqual(
    host._children.map((child) => child.textContent),
    ['A', 'B']
  );
  visible.set(false);
  assert.equal(host._children.length, 0);
});

test('reactive: disposes render effects when the host disconnects', () => {
  const label = signal('one');
  let renders = 0;
  const host = /** @type {StubEl & { disconnectedCallback: () => void }} */ (
    /** @type {unknown} */ (
      reactive(() => {
        renders++;
        return h('p', {}, label.get());
      })
    )
  );

  assert.equal(renders, 1);
  label.set('two');
  assert.equal(renders, 2);

  host.disconnectedCallback();
  label.set('three');

  assert.equal(renders, 2);
  assert.equal(host._children.length, 0);
});

test('reactive: supports local signal state inside function components', () => {
  function Counter() {
    const count = signal(0);
    return reactive(() =>
      h(
        'button',
        { onClick: () => count.set(count.get() + 1) },
        String(count.get())
      )
    );
  }

  const host = /** @type {StubEl} */ (/** @type {unknown} */ (Counter()));
  const button = host._children[0];
  assert.equal(button.textContent, '0');

  button.dispatchEvent(new Event('click'));
  assert.equal(host._children[0].textContent, '1');
});

test('reactive: lifecycle helpers clean up listeners on re-render and disconnect', () => {
  const label = signal('one');
  let calls = 0;
  let cleanups = 0;
  const target = new EventTarget();
  const host = /** @type {StubEl & { disconnectedCallback: () => void }} */ (
    /** @type {unknown} */ (
      reactive(() => {
        label.get();
        on(target, 'ping', () => calls++);
        afterMount(() => () => cleanups++);
        return h('p', {}, label.get());
      })
    )
  );

  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);

  label.set('two');
  assert.equal(cleanups, 1);
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 2);

  host.disconnectedCallback();
  assert.equal(cleanups, 2);
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 2);
});

test('defineView: remains available for custom-element shell boundaries', () => {
  defineView('cora-test-shell', {
    props: { label: 'Default' },
    render({ props }) {
      return h('p', {}, props.label);
    },
  });

  const el =
    /** @type {StubEl & { label: string, connectedCallback: () => void }} */ (
      /** @type {unknown} */ (document.createElement('cora-test-shell'))
    );
  el.label = 'Route shell';
  el.connectedCallback();

  assert.equal(el._children[0].textContent, 'Route shell');
});

test('on: removes registered listeners when the owning lifecycle disconnects', () => {
  const lifecycle = createLifecycle();
  const target = new EventTarget();
  let calls = 0;
  const listener = () => calls++;

  lifecycle.run(() => on(target, 'ping', listener));

  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);

  lifecycle.disconnect();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);
});

test('on: resolves lazy listener targets inside the owning lifecycle', () => {
  const lifecycle = createLifecycle();
  const target = new EventTarget();
  let calls = 0;

  lifecycle.run(() =>
    on(
      () => target,
      'ping',
      () => calls++
    )
  );
  target.dispatchEvent(new Event('ping'));

  assert.equal(calls, 1);
});

test('on: throws when called without an owning lifecycle', () => {
  assert.throws(
    () => on(new EventTarget(), 'ping', () => {}),
    /on\(\) must be called while a view is mounting/
  );
});

test('afterMount: runs registered hooks on mount and disposes returned cleanup', () => {
  const lifecycle = createLifecycle();
  let mounts = 0;
  let cleanups = 0;

  lifecycle.run(() =>
    afterMount(() => {
      mounts++;
      return () => cleanups++;
    })
  );

  assert.equal(mounts, 0);
  lifecycle.mount();
  lifecycle.mount();
  assert.equal(mounts, 1);
  assert.equal(cleanups, 0);

  lifecycle.disconnect();
  assert.equal(cleanups, 1);
});

test('afterMount: runs hooks inside the owning lifecycle', () => {
  const lifecycle = createLifecycle();
  const target = new EventTarget();
  let calls = 0;

  lifecycle.run(() =>
    afterMount(() => {
      on(target, 'ping', () => calls++);
    })
  );

  lifecycle.mount();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);

  lifecycle.disconnect();
  target.dispatchEvent(new Event('ping'));
  assert.equal(calls, 1);
});

test('afterMount: throws when called without an owning lifecycle', () => {
  assert.throws(
    () => afterMount(() => {}),
    /afterMount\(\) must be called while a view is mounting/
  );
});

test('captureFocus/restoreFocus: preserves data-focus-key and selection', () => {
  const root = new StubEl('div');
  const before = new StubEl('input');
  before.setAttribute('data-focus-key', 'answer:1');
  before.selectionStart = 2;
  before.selectionEnd = 5;
  root.replaceChildren(before);
  before.focus();

  const snapshot = captureFocus(/** @type {any} */ (root));
  const after = new StubEl('input');
  after.setAttribute('data-focus-key', 'answer:1');
  root.replaceChildren(after);

  restoreFocus(/** @type {any} */ (root), snapshot);

  assert.equal(document.activeElement, after);
  assert.equal(after.selectionStart, 2);
  assert.equal(after.selectionEnd, 5);
  assert.deepEqual(
    /** @type {any} */ (after)._focusOptions,
    { preventScroll: true },
    'restoreFocus must not let the browser scroll the refocused element into view'
  );
});

test('normalizeRenderResult: wraps a single node in an array', () => {
  const node = new StubEl('p');
  assert.deepEqual(normalizeRenderResult(/** @type {any} */ (node)), [node]);
});

test('normalizeRenderResult: passes arrays through unchanged', () => {
  const a = new StubEl('span');
  const b = new StubEl('span');
  assert.deepEqual(normalizeRenderResult(/** @type {any} */ ([a, b])), [a, b]);
});

test('normalizeRenderResult: returns an empty array for undefined', () => {
  assert.deepEqual(normalizeRenderResult(undefined), []);
});

test('replaceHostChildren: replaces the host children with the normalized result', () => {
  const host = new StubEl('div');
  host.replaceChildren(new StubEl('old'));
  const next = new StubEl('p');

  replaceHostChildren(/** @type {any} */ (host), /** @type {any} */ (next));

  assert.equal(host._children.length, 1);
  assert.equal(host._children[0], next);
});

test('replaceHostChildren: clears the host when the render result is undefined', () => {
  const host = new StubEl('div');
  host.replaceChildren(new StubEl('old'));

  replaceHostChildren(/** @type {any} */ (host), undefined);

  assert.equal(host._children.length, 0);
});

class ShellTestEl extends ShellElement {
  /** @type {(props: any) => any} */
  static renderer = () => undefined;
  render() {
    return ShellTestEl.renderer(this);
  }
}
customElements.define('cora-shell-test', /** @type {any} */ (ShellTestEl));

test('ShellElement.emit: dispatches a bubbling CustomEvent carrying the detail payload', () => {
  ShellTestEl.renderer = () => undefined;
  const el = /** @type {ShellTestEl} */ (
    /** @type {unknown} */ (document.createElement('cora-shell-test'))
  );
  el.connectedCallback();

  let received = /** @type {CustomEvent | null} */ (null);
  el.addEventListener('cora-ping', (event) => {
    received = /** @type {CustomEvent} */ (event);
  });

  el.emit('cora-ping', { value: 42 });

  assert.ok(received);
  assert.equal(/** @type {CustomEvent} */ (received).bubbles, true);
  assert.deepEqual(/** @type {CustomEvent} */ (received).detail, {
    value: 42,
  });
});

test('ShellElement.update: assigns props and re-renders exactly once', () => {
  let renders = 0;
  ShellTestEl.renderer = (self) => {
    renders++;
    return h('p', {}, String(self.label ?? ''));
  };
  const el = /** @type {ShellTestEl & { label?: string }} */ (
    /** @type {unknown} */ (document.createElement('cora-shell-test'))
  );
  el.connectedCallback();
  assert.equal(renders, 1);

  el.update({ label: 'updated' });

  assert.equal(el.label, 'updated');
  assert.equal(renders, 2);
  assert.equal(/** @type {any} */ (el)._children[0].textContent, 'updated');
});

test('ShellElement.update: preserves focus and selection across the re-render', () => {
  ShellTestEl.renderer = (self) =>
    h('input', {
      'data-focus-key': 'answer',
      value: String(self.label ?? ''),
    });
  const el = /** @type {ShellTestEl & { label?: string }} */ (
    /** @type {unknown} */ (document.createElement('cora-shell-test'))
  );
  el.connectedCallback();
  const input = /** @type {any} */ (el)._children[0];
  input.selectionStart = 1;
  input.selectionEnd = 2;
  input.focus();

  el.update({ label: 'two' });

  const nextInput = /** @type {any} */ (el)._children[0];
  assert.notEqual(nextInput, input);
  assert.equal(document.activeElement, nextInput);
  assert.equal(nextInput.selectionStart, 1);
  assert.equal(nextInput.selectionEnd, 2);
});

test('ShellElement.update: assigns props but is a render no-op before connectedCallback', () => {
  let renders = 0;
  ShellTestEl.renderer = () => {
    renders++;
    return undefined;
  };
  const el =
    /** @type {ShellTestEl & { label?: string } & { _shellRenderNow: unknown }} */ (
      /** @type {unknown} */ (document.createElement('cora-shell-test'))
    );

  assert.equal(/** @type {any} */ (el)._shellRenderNow, null);

  el.update({ label: 'pre-connect' });

  assert.equal(el.label, 'pre-connect');
  assert.equal(renders, 0);
});

test('reactive: preserves focus and selection across signal-driven re-render', () => {
  const label = signal('one');
  const host = /** @type {StubEl} */ (
    /** @type {unknown} */ (
      reactive(() =>
        h('input', { 'data-focus-key': 'answer', value: label.get() })
      )
    )
  );
  const input = host._children[0];
  input.selectionStart = 1;
  input.selectionEnd = 2;
  input.focus();

  label.set('two');

  const nextInput = host._children[0];
  assert.notEqual(nextInput, input);
  assert.equal(document.activeElement, nextInput);
  assert.equal(nextInput.selectionStart, 1);
  assert.equal(nextInput.selectionEnd, 2);
  assert.equal(nextInput.value, 'two');
});
