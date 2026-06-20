# Maintainer Developer Guide

Reference for building new `<cr-*>` components and wiring them into the Case Review framework.

## Topics

| Guide                                         | What it covers                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| [Component authoring](component-authoring.md) | `<cr-*>` conventions, `CRElement` base class, light DOM, lifecycle     |
| [Signals](signals.md)                         | `signal()`, `computed()`, `effect()` primitives with worked examples   |
| [Sharing signals](sharing-signals.md)         | Passing signals across components; concrete multi-component example    |
| [Router integration](router.md)               | Registering a new route, `mount`/`unmount` lifecycle                   |
| [SaveQueue](save-queue.md)                    | Why components never call `fetch()` directly; how to enqueue a save    |
| [SharePointClient](sharepoint-client.md)      | Interface contract, adding a new method, mock substitution (`?mock=1`) |
| [Testing](testing.md)                         | `node --test`, DOM stubs, what constitutes a good test                 |

## Prerequisites

- Read [CONTEXT.md](../../CONTEXT.md) for domain language (`Case`, `Case Type`, `Question Definition`, `Answer`, `Outcome`, …).
- Read [docs/PLAN.md](../PLAN.md) to understand the current execution roadmap.
- Skim [docs/adr/](../adr/) — every non-trivial architectural decision is documented there. Don't deviate from an ADR without surfacing the deviation.
