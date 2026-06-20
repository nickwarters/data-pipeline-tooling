# Applicability as data, outcome as code

Within each **Case Type** module, **question applicability** is expressed as a declarative `showWhen` graph (data), while the **outcome computation** is an exported JS function (code). Both live in the same module so a Case Type's behaviour is understood from one file.

`showWhen` is per-Case-Type rather than per-Question-Definition because Question Definitions are shared (ADR-0004); the same question can wire into different follow-ups across Case Types. The schema starts minimal — `{questionId: {in: [...] | equals: ... | answered: true}}` plus `$and` / `$or` — and grows by extension only when a real case demands it. Resist evolving it into a Turing-complete DSL.

The framework rejects Case Types whose `showWhen` graph contains cycles at load time (loud error, refuse to mount). Questions without `showWhen` are always applicable.

The outcome function is typed via an `OutcomeFn` JSDoc typedef and receives `(answers, caseDetails)`. It returns a verdict + summary. Shared helpers live under `/case-types/shared/` to keep individual Case Type modules focused.

The deliberate split: applicability is part of the catalogue's _structure_ (the framework walks it to render), so it must stay inspectable; outcome is _business logic_ that varies wildly per Case Type, doesn't need framework introspection, and benefits from full JS expressiveness.
