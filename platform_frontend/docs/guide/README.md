# Maintainer developer guide

Start with the one-page authoring path, then open the reference for the boundary
you are changing.

## Topics

| Guide                                                         | What it covers                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Add a store-driven page](add-a-page.md)                      | One-page path: state → `h()`/`svg()`, actions, effects, route entry, tests   |
| [Store, actions, and effects](store-actions-and-effects.md)   | Permanent contracts and ownership boundaries                                 |
| [Router integration](router.md)                               | Route independence, page resolution, registration, and cleanup               |
| [SaveQueue](save-queue.md)                                    | Debounced, ETag-guarded persistence                                          |
| [SharePointClient](sharepoint-client.md)                      | Interface contract, new methods, and mock substitution (`?mock=1`)           |
| [Case Type onboarding (code)](case-type-onboarding-code.md)   | Manual path from nothing to a running mock Case Type                         |
| [Provisioning runbook](provisioning-runbook.md)               | SharePoint lists, per-Case-Type groups, and holiday-list maintenance         |
| [Provisioning an environment](provisioning-an-environment.md) | Standing up another isolated deployment (`training`, …) beside prod and UAT  |
| [Feature switches](feature-switches.md)                       | Hard-coded on/off constants, and how a feature is enabled by deleting one    |
| [Testing](testing.md)                                         | Public seams, semantic DOM tests, and repository gates                       |
| [In-memory flow runner](in-memory-flow-runner.md)             | Browser-free end-to-end domain and persistence journeys                      |
| [Charts](charts.md)                                           | Grouped SVG charts plus the My Stats grain-matched Case Type breakdown table |

## Explainers

Self-contained, interactive HTML pages — no server or build, open straight from
the repository in a browser.

| Explainer                                                    | What it shows                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [The Render Loop](../render-loop-explainer.html)             | Runtime mechanics: dispatch → reducer → view → `render()` commit, and how the keyed reconciler patches the DOM |
| [State → view → action](../component-anatomy-explainer.html) | The shape of a page: the four exports, the route-table entry, the pre-ship checklist                           |
| [Applicability Graph](../show-when-explainer.html)           | `showWhen`, `evaluate()`, and cycle detection over a Case Type's Question catalogue                            |
| [SaveQueue](../save-queue-explainer.html)                    | Debounce, ETag concurrency, and retry/conflict handling for autosave                                           |

## Prerequisites

- Read [CONTEXT.md](../../CONTEXT.md) for domain language (`Case`, `Case Type`,
  `Question Definition`, `Answer`, `Outcome`, …).
- Read [CLAUDE.md](../../CLAUDE.md) for the shipped architecture and hard rules.
- Check [docs/adr/](../adr/) for the current decision governing the seam. Do not
  deviate from an accepted ADR without surfacing the deviation.
