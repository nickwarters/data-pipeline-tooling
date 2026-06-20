# 15. Data-only Case Type export for external reporting

Date: 2026-06-05

## Status

Accepted

## Context

External reporting — run in **Python**, outside the SharePoint-hosted app — needs
to read **Case** data and turn it into question-level reports, e.g. "take every
Case modified yesterday, extract the question responses, and show the top failed
**Question Definitions** across all Cases."

To decide whether a question _failed_, a report needs that question's
`failureCriteria` (and `text` / `category` to be readable). The natural instinct
is to feed Python "the **Question Bank**" — but the only machine-readable form of
a Case Type's bank today is the compiled `case-types/{slug}.js` module produced by
the question bank editor (`question-bank-compile.js`). That module is the wrong
input for Python for two reasons:

1. **It contains a function.** Per [ADR-0006], applicability is data (`showWhen`)
   but **outcome is code** — the module exports `computeOutcome(answers)`. Python
   cannot parse or execute JS, so the module is not consumable as data.
2. **It is UI-shaped, not report-shaped.** It is an ES module meant to be
   `import()`ed by the browser, not a payload meant to be fetched and parsed by a
   data pipeline.

Two framings were rejected:

- **Port `computeOutcome` to Python.** This forks business logic across two
  languages and rots on the first divergence. It is also unnecessary: per-question
  failure is pure data (`failureCriteria`), and _case-level_ verdicts are already
  persisted as the frozen `outcomeAtCompletion` snapshot on the Case row
  ([ADR-0012]) precisely so reporting never re-runs the outcome function. Python
  never needs the function.
- **Point Python at the live Question Definitions SharePoint list** ([ADR-0004]).
  That list holds the _shared_ half of a question (text, response type, options),
  but per [ADR-0006] `showWhen` — and, as compiled, the per-Case-Type
  `failureCriteria` wiring — is **per-Case-Type**, assembled by the compile step.
  The live list alone cannot tell Python "for `complaint-review`, `q-rootcause`
  fails on `No`." Only the compile step has the full per-Case-Type catalogue as
  data.

## Decision

The question bank compile step emits, alongside the `case-types/{slug}.js` module,
a **function-free JSON sibling** `case-types/{slug}.json` — a data-only projection
of that Case Type's **Question Bank**, intended as the contract for external
(Python) reporting.

- **One file per Case Type**, co-located with the module (mirrors [ADR-0004]'s
  one-module-per-type model). Published through the _same_ review/PR flow as the
  `.js` — two outputs from one compile, never generated at runtime from the
  deployed module (which would reintroduce the function-parsing problem).
- **Envelope:** `{ slug, label, generatedAt, hash, questions: [...] }`. `hash`
  mirrors the `sha256` the compile drawer already shows for the `.js`, giving
  reports a traceable artifact identity.
- **Per question:** `id`, `text`, `category`, `responseType`, `options`,
  `showWhen`, `failureCriteria`, `deprecated`. Explicitly **excluded**:
  `computeOutcome` (code; not Python's path), `remediationActions` /
  `allowFreeFormRemediation` (authoring/UI templates — per-Case remediation
  _taken_ lives on the Answer), and Case-Type operational config
  (`eligibleGroups`, `slaHours`, `attributeFailures`). `showWhen` is carried even
  though the headline report does not need it: it is pure data, and it is the
  difference between counting failures and computing applicability-aware rates —
  including it now future-proofs the contract against a breaking format bump.
- **Failure is derived, not stored, by the report.** Reports replicate
  `isFailure()` (`failure-evaluator.js`): for scalar values
  (`yes-no-na` / `single-choice`) failure is `value === failureCriteria`; for
  `multi-choice` it is array-_includes_. Reports branch on `responseType`.
- **Latest-export semantics for v1.** Python always reads the current
  `{slug}.json`. Because the **Question Bank** is live-edited, failure derivation
  uses _current_ `failureCriteria` against historical Answers, so historical
  per-question reports can shift if the bank is re-curated. This is accepted for
  v1 and documented as a caveat (see `docs/reporting-data-contract.md`). For
  point-in-time-stable _case verdicts_, reports use the frozen
  `outcomeAtCompletion` snapshot ([ADR-0012]) rather than re-deriving.

> **Dependency note.** [ADR-0012] is Accepted but **not yet implemented**: the
> completion write (`cr-case-review.js`, `_completeCase`) currently stamps only
> `status` + `completedAt`, not `outcomeAtCompletion` / `hadRemediation`. The
> per-question failure reporting this ADR enables works today; _case-level_ verdict
> reporting is blocked until ADR-0012 lands. This export deliberately carries no
> verdict of its own — recomputing it in Python is out of scope (above).

The "how to process it" guide lives in
[`docs/reporting-data-contract.md`](../reporting-data-contract.md).

## Consequences

**Positive**

- Python gets a stable, function-free contract without parsing JS or forking
  business logic.
- No new SharePoint list and no sync job: the JSON ships in the Style Library
  beside the module, through the existing deploy flow ([ADR-0004], and consistent
  with [ADR-0012]'s "no new list" preference). Python fetches it by URL over the
  existing NTLM/Kerberos boundary ([ADR-0010]).
- The `hash` / `generatedAt` fields exist from day one, so the deferred
  snapshot-stability story below can be built later without a format break.

**Negative**

- Two artifacts now ship per Case Type; the compile/publish flow must keep them in
  lockstep, and a hand-published JSON can drift from its `.js` if the flow is
  bypassed.
- Latest-export semantics mean long-range retrospective per-question reports are
  not point-in-time stable. If that is ever required, the path is a per-question
  failure snapshot at completion (mirroring [ADR-0012]) plus stamping the export
  `hash` onto the completed Case row — deliberately out of scope here.
- A mild duplication of intent with [ADR-0006]: applicability/failure data now
  exists in both the `.js` module and the `.json` export. Resolved by treating the
  `.json` as a generated projection, never hand-edited.

[ADR-0004]: ./0004-case-type-config-as-js-modules.md
[ADR-0006]: ./0006-applicability-graph-and-outcome-function.md
[ADR-0010]: ./0010-auth-and-permissions.md
[ADR-0012]: ./0012-outcome-snapshot-at-completion-for-reporting.md
