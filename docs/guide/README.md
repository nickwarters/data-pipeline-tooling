# Maintainer Developer Guide

Reference for building new function components and wiring them into Case Review.

## Topics

| Guide                                           | What it covers                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| [Component authoring](component-authoring.md)   | Plain function components, `h()`, `reactive()`, and legacy shell limits |
| [Signals](signals.md)                           | `signal()`, `computed()`, `effect()` primitives with worked examples    |
| [Sharing signals](sharing-signals.md)           | Passing signals across components; concrete multi-component example     |
| [Router integration](router.md)                 | Registering a route that composes page functions or explicit shells     |
| [SaveQueue](save-queue.md)                      | Why components never call `fetch()` directly; how to enqueue a save     |
| [SharePointClient](sharepoint-client.md)        | Interface contract, adding a new method, mock substitution (`?mock=1`)  |
| [Provisioning runbook](provisioning-runbook.md) | SharePoint columns, per-Case-Type groups, and the holiday-list burden   |
| [Testing](testing.md)                           | `node --test`, DOM stubs, what constitutes a good test                  |

## Prerequisites

- Read [CONTEXT.md](../../CONTEXT.md) for domain language (`Case`, `Case Type`, `Question Definition`, `Answer`, `Outcome`, …).
- Read [docs/PLAN.md](../PLAN.md) to understand the current execution roadmap.
- Skim [docs/adr/](../adr/) — every non-trivial architectural decision is documented there. Don't deviate from an ADR without surfacing the deviation.
