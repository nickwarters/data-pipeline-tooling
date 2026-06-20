# Signals

## Quick reference

```js
import { signal, computed, effect } from '../lib/signal.js';

const count = signal(0); // writable reactive value
count.get(); // → 0
count.set(1); // notifies all subscribers

const doubled = computed(() => count.get() * 2); // derived, lazy, cached
doubled.get(); // → 2

const dispose = effect(() => {
  // runs now + on every dependency change
  console.log(doubled.get());
});
dispose(); // stop reacting
```

---

## Why signals?

The framework has no virtual DOM and no framework-managed render cycle. Signals give us fine-grained reactivity: when a value changes, only the effects that read it are re-run. There are no re-renders of entire component trees.

The implementation (`src/lib/signal.js`) is ~50 lines. There are no external dependencies. Understanding the three primitives is all you need.

---

## `signal(initialValue)`

Returns `{ get, set }`. Reading `.get()` inside an active `effect` or `computed` automatically registers the signal as a dependency. Calling `.set(newValue)` notifies every registered subscriber synchronously.

```js
const status = signal('idle');
status.get(); // 'idle'
status.set('loading');
status.get(); // 'loading'
```

---

## `computed(fn)`

Returns `{ get }` (read-only). Evaluates `fn()` lazily — only on first `.get()` or after a dependency changes. Caches the result until a dependency signals a change.

```js
const firstName = signal('Alice');
const lastName = signal('Smith');
const fullName = computed(() => `${firstName.get()} ${lastName.get()}`);

fullName.get(); // 'Alice Smith'  — fn() runs once
fullName.get(); // 'Alice Smith'  — cached, fn() does NOT run again
firstName.set('Bob');
fullName.get(); // 'Bob Smith'    — cache invalidated, fn() runs again
```

Use `computed` when you derive a value from other signals and want:

- automatic caching (no stale results, no manual memoization)
- automatic dependency tracking (no dependency arrays to maintain)

---

## `effect(fn)`

Runs `fn()` immediately, tracking which signals it reads. Re-runs `fn()` whenever any of those signals change. Returns a `dispose` function that permanently stops the effect.

```js
const label = signal('off');

const dispose = effect(() => {
  document.title = label.get(); // sets title now and on every change
});

label.set('on'); // fn() runs again → document.title = 'on'
dispose(); // stop; future label.set() calls are ignored
```

`CRElement.subscribe(sig, cb)` is a thin wrapper around `effect` that auto-disposes when the element disconnects from the DOM. Use `subscribe` inside components instead of calling `effect` directly.

---

## Worked example: a counter component

```js
// src/components/cr-counter.js
// @ts-check
import { CRElement } from './cr-element.js';
import { signal } from '../lib/signal.js';

export class CRCounter extends CRElement {
  connectedCallback() {
    const count = signal(0); // local state

    const label = document.createElement('span');
    const btn = document.createElement('button');
    btn.textContent = '+1';

    // Keep the label in sync — fires immediately, then on every change.
    this.subscribe(count, (n) => {
      label.textContent = String(n);
    });

    btn.addEventListener('click', () => count.set(count.get() + 1));

    this.replaceChildren(label, btn);
  }
}

customElements.define('cr-counter', CRCounter);
```

The signal is created inside `connectedCallback` so each instance has its own independent count. If the count should be shared across components, create the signal outside and pass it in as a property (see [Sharing signals](sharing-signals.md)).
