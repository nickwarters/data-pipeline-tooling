# 54. The application configuration is the composition root

Date: 2026-09-06

## Status

Proposed.

Amends [ADR-0053](./0053-section-plugin-architecture.md), which made a Section
declare itself but left the framework naming every Section, so every Section is
by definition a framework Section.

Amends [ADR-0042](./0042-static-page-imports.md) in its _reasoning_ only: pages
remain statically imported and `#/question-bank` keeps its thunk for the three
reasons that ADR gives. What changes is the file that holds the imports.

Upholds [ADR-0041](./0041-deployed-bytes-are-source-bytes.md): everything here
is a static `import`, and no step produces code.

## Context

Two epics have converged on the same problem from opposite ends.

[ADR-0053](./0053-section-plugin-architecture.md) gave each Case Review Section
a self-describing module, then had to name all ten of them in
`src/sections/registry.js`. There is no way for the application to add a Section
without editing a framework file, which makes "plugin" a word the architecture
has not earned. The attempts to work around it each failed for their own reason:
registering from a Case Type module puts the Section in _every_ Case Type's
registry and only loads it for users eligible for that Case Type; registering
from `case-types/manifest.js` breaks that manifest's tested guarantee that
importing it evaluates no Case Type module; and a second, application-owned
registry forces `CaseTypeConfig.sections` to widen from the `Section` union to
`Record<string, SectionConfig>`, moving a compile-time key check to a runtime
one.

The Page & Feature epic proposes the same shape for pages and hits the same wall
from the other side. A feature descriptor naming a page module is a file outside
`src/pages/` reaching into it, which `tests/component-layering-contract.test.js`
forbids. That epic's answer was a dynamic `import()` per feature — which reverses
ADR-0042 and reintroduces the ten deferrals #575 removed.

Both are symptoms of one thing: **the library names what the application is made
of.** Every workaround — widening the layering guard, a second registry,
per-Case-Type registration, thunks — is an attempt to let the application add
something without changing who does the naming.

## Decision

**One application configuration module names everything this application is made
of, and the library names nothing.**

```js
// src/app-config.js — the composition root
import { DetailsPlugin } from './sections/details/details-plugin.js';
import { QuestionsPlugin } from './sections/questions/questions-plugin.js';
// …

export const APP_CONFIG = /** @type {const} */ ({
  sectionPlugins: [DetailsPlugin, QuestionsPlugin /* … */],
});

/**
 * The Section id union, projected from what this application composes —
 * built-in and application-added alike, with no distinction between them.
 *
 * @typedef {(typeof APP_CONFIG)['sectionPlugins'][number]['id']} Section
 */
```

```js
// src/sections/registry.js — the engine. Imports no plugin and no config.
const registry = new Map();
let configured = false;

export function configureSections(plugins) {
  registry.clear();
  for (const plugin of plugins) registry.set(plugin.id, plugin);
  configured = true;
}
```

Boot calls `configureSections(APP_CONFIG.sectionPlugins)` before the router
mounts anything, the same way it calls `registerRoutes()` today.

## Consequences

### The Section id union covers everything

Verified on a prototype before this was proposed:

```
app/main.js(10,14): error TS2322:
  Type '"nope"' is not assignable to type '"details" | "secondReview"'
runtime — ids: details,secondReview
```

`secondReview` is an application Section the library never names, and it is in
the type union. So `CaseTypeConfig.sections` stays
`Partial<Record<Section, SectionConfig>>` and a mistyped key remains a `tsc`
error. That is the property the second-registry alternative could not provide.

### The import cycle disappears by construction

Today the graph runs `services/section-access.js → sections/registry.js →
plugins → page views → services`. That knot is why the built-in manifest had to
become a function — a module-scope array read a binding still in its temporal
dead zone — and why the lifecycle predicates had to move to
`evaluators/case-lifecycle.js`. With the engine importing nothing, the graph is
one direction:

```
app-config.js → plugins → views → services → sections/registry.js  (imports nothing)
```

### The layering contract is satisfied rather than widened

`tests/component-layering-contract.test.js` privileges
`setup/register-routes.js` as the one file that may name a page module. The
privilege moves to `src/app-config.js` and stays a privilege of exactly one
file, rather than being widened to a directory — which is where both epics were
otherwise heading.

### Boot order becomes load-bearing, and must fail loudly

The registry currently self-heals: its lazy initialiser falls back to the
built-ins. With no built-ins there is nothing to fall back to, so a read before
configuration must **throw**. A silent empty registry is the exact failure this
codebase has been burned by — `sectionIds().every(s => access[s] === 'hidden')`
in `lib/case-loader.js` is vacuously true over an empty list, which denies access
to every Case and renders a blank application with no error.

### Case Types stay behind thunks, and that asymmetry is deliberate

`sectionPlugins` and `pagePlugins` are static imports. Case Types cannot be:
`tests/case-type-manifest.test.js` asserts that the manifest may statically
import only its loader and the outcome validator, because the boot-critical
_synchronous_ permissions config composes each Case Type's three SharePoint
group names from its `displayName` without evaluating its module. Flattening
that into static imports would pull every Case Type config into boot. The config
holds Case Types as entries carrying thunks, exactly as `case-types/manifest.js`
does today.

### There is no "core" tier

A built-in Section is one the config happens to list; an application Section is
one it also lists. Omitting a built-in disables it. A separate
`enabledCoreSections` key would restate what `sectionPlugins` already says,
which is the duplication ADR-0053 set out to remove.

### What this costs

- `Section` becomes a type the library imports _from_ the application config.
  Type-only, so no runtime edge, and correct for a single-application
  repository — the composition root is where "what this application is" belongs.
  Were the framework ever extracted, `Section` becomes a generic parameter
  instead.
- One more file on the boot path, and one more thing that must run in the right
  order.
- The manifest does not disappear. ADR-0041 bans a build step, so nothing can
  discover modules at runtime and a module must be named somewhere to be loaded.
  What changes is _whose_ file that is: the application's, not the library's.
