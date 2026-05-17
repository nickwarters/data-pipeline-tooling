# Component Authoring

## Quick reference

```js
// src/components/cr-my-widget.js
import { CRElement } from './cr-element.js';

export class CRMyWidget extends CRElement {
  constructor() {
    super();
    this.label = '';          // public property — set by parent before connectedCallback
  }

  connectedCallback() {
    const span = document.createElement('span');
    span.textContent = this.label;
    this.replaceChildren(span);   // light DOM, NOT shadow DOM
  }
}

customElements.define('cr-my-widget', CRMyWidget);
```

Then import the module in `src/setup/register-components.js` so the custom element is defined before any route mounts it.

---

## Conventions

### Naming

Every custom element uses the `cr-` prefix: `<cr-question>`, `<cr-notes>`, `<cr-toast>`. This isolates the framework's CSS from SharePoint's own stylesheet. The class name matches the tag in PascalCase: `cr-my-widget` → `CRMyWidget`.

### File location

Put the component under `src/components/`. One file per element. The file name matches the tag name: `cr-my-widget.js`.

### Light DOM, not Shadow DOM

Components render into their own element directly (`this.replaceChildren(…)`), not into a shadow root. This is intentional (ADR-0003): light DOM lets browser-native form controls participate in `<form>` submission and keeps CSS simple. The `cr-` CSS prefix is the isolation mechanism instead of encapsulation.

### No `innerHTML` for user data

Build the DOM imperatively with `document.createElement` and set `textContent`. Never assign user-supplied data to `innerHTML` — it opens an XSS vector and clobbers input state.

### Public properties

Pass data in by setting properties on the element before it is connected:

```js
const el = document.createElement('cr-my-widget');
el.label = 'Hello';           // set property …
container.replaceChildren(el); // … then connect
```

`connectedCallback` reads `this.label` at mount time. If the value can change later, use a signal (see [Signals](signals.md)).

---

## Lifecycle

| Callback | When it fires | What to do |
|---|---|---|
| `constructor` | Element created | Declare properties with defaults only. Don't touch the DOM. |
| `connectedCallback` | Element inserted into the document | Build DOM, subscribe to signals. |
| `disconnectedCallback` | Element removed from the document | `CRElement` calls `dispose()` on every subscription automatically. Override only if you have additional teardown. |

`CRElement.subscribe(sig, cb)` wraps `effect()` and registers the dispose function so that all reactive subscriptions are cleaned up in `disconnectedCallback` without manual tracking.

---

## Worked example: `<cr-greeting>`

```js
// src/components/cr-greeting.js
// @ts-check
import { CRElement } from './cr-element.js';

export class CRGreeting extends CRElement {
  constructor() {
    super();
    /** @type {{ get: () => string }} */
    this.nameSignal = { get: () => '' };  // replaced by parent at mount time
  }

  connectedCallback() {
    const p = document.createElement('p');

    // subscribe keeps the DOM in sync with the signal.
    // It fires immediately and again whenever nameSignal changes.
    this.subscribe(this.nameSignal, name => {
      p.textContent = `Hello, ${name}!`;
    });

    this.replaceChildren(p);
  }
}

customElements.define('cr-greeting', CRGreeting);
```

Usage in a route handler:

```js
import { signal } from '../lib/signal.js';

const name = signal('World');

const el = document.createElement('cr-greeting');
el.nameSignal = name;
container.replaceChildren(el);

// Later — the DOM updates automatically:
name.set('Alice');
```

Don't forget to add `import './cr-greeting.js'` in `src/setup/register-components.js`.
