# Component Authoring

Write new UI as plain functions that return `h()` nodes. Reach for `signal()`
for local state and `reactive()` when a host needs to re-render from signals.

Do not add lifecycle-backed base classes for feature components. Keep browser
custom elements at route or integration boundaries only.

## Quick Reference

```js
import { h } from '../lib/html.js';
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';

export function Counter({ initial = 0 } = {}) {
  const count = signal(initial);

  return reactive(() =>
    h(
      'div',
      { class: 'cr-counter' },
      h('span', {}, count.get()),
      h(
        'button',
        { type: 'button', onclick: () => count.set(count.get() + 1) },
        '+1'
      )
    )
  );
}
```

Use it from a route or another component:

```js
container.replaceChildren(Counter({ initial: 2 }));
```

## Conventions

Prefer component names that describe the domain surface, for example
`QuestionList`, `Notes`, or `SummaryPanel`.

Pass data as explicit props:

```js
QuestionList({
  questions,
  answers,
  onAnswer: ({ questionId, value }) => saveAnswer(questionId, value),
});
```

Do not pass the whole app context into a component. It hides dependencies and
makes the function harder to test.

## Rendering

Use `h()` for DOM creation and text content. Do not use `innerHTML` for ordinary
UI. Reviewed raw HTML must go through `unsafeHTML()`.

Return a single node or an array of nodes. Keep side effects at the edge:

```js
export function StatusBanner({ status }) {
  if (status === 'saved') return null;
  return h('p', { role: 'status' }, status);
}
```

## State

Use a local `signal()` when the component owns transient UI state. Use props
when state belongs to the caller.

```js
export function Disclosure({ title, children }) {
  const open = signal(false);

  return reactive(() =>
    h(
      'section',
      {},
      h(
        'button',
        { type: 'button', onclick: () => open.set(!open.get()) },
        title
      ),
      open.get() ? h('div', {}, children) : null
    )
  );
}
```

## Effects And Cleanup

Most components should not need lifecycle hooks. If a component needs a global
listener or imperative mount work, use the lifecycle helpers from `view.js`
inside `reactive()`:

```js
import { afterMount, on, reactive } from '../lib/view.js';

export function KeyboardHelp() {
  return reactive(() => {
    on(document, 'keydown', (event) => {
      if (event.key === '?') console.log('open help');
    });

    afterMount(() => {
      console.log('mounted');
    });

    return h('button', { type: 'button' }, 'Help');
  });
}
```

## Shells

Use `defineView()` only where the browser boundary is genuinely useful, such as
route shells or SharePoint integration. Existing shell elements should delegate
their UI to plain functions and lifecycle helpers.

Do not add new components to a global registry. Routes import the shell modules
they still create, and ordinary UI is composed by calling functions.
