# Configurable per-failure Remediation Details

## Status

Superseded by [ADR-0020](./0020-unified-issue-capture-engine.md). The historical
completion-gate and master-detail rationale carries forward there; the flat
storage and declaration shape does not.

> The flat `remediationFields` / `remediationDetails:
Record<string,string>` model is replaced by the unified **Issue Capture** engine
> (grouped, typed `Issue Capture Field`s incl. first-class `person`/`actions`, intra-group
> `showWhen`, `Answer.capture`). The completion-gate and master–detail-drawer ideas below
> carry forward into ADR-0020; the storage and declaration shapes do not.

A **Case Type** can declare extra capture fields recorded against each _failed_ **Answer**, beyond its **Attributed Party** and **Remediation Actions** — e.g. a free-text "root cause" or a "severity" select. Some Case Types need only attribution; others need more. These **Remediation Details** are declared once per Case Type and captured in the **Issues** Section.

## Declaration (per Case Type)

The Case Type module declares one shared field set:

```js
remediationFields: [
  { key: 'rootCause', label: 'Root cause', type: 'text', required: true },
  {
    key: 'severity',
    label: 'Severity',
    type: 'select',
    options: ['Low', 'Med', 'High'],
  },
];
```

The set applies to **every** failed Answer in that Case Type; a Case Type needing only attribution declares none. It is **not** declared per **Question Definition**: Question Definitions are shared cross-Case-Type (see `CONTEXT.md`), so per-question fields would follow the question into every Case Type that uses it — not the intent.

## Storage (inline on the Answer)

Values are stored inline as `Answer.remediationDetails: Record<string,string>` in the Answers JSON blob, mirroring `attributedParty`. They share that lifecycle: **stripped automatically when the Answer is no longer a failure, and frozen once the Case is Completed.** No new column or second source of truth (a separate blob was considered and rejected for the sync burden).

## Required fields extend the completion gate

A field marked `required: true` participates in completeness: a Case cannot be **Completed** until every required Remediation Detail on every failed Answer is filled, alongside the existing "all **Applicable Question**s answered" rule. The Issues drawer flags what is missing, mirroring the unanswered-question jump affordance. **Attribution itself stays optional** and does not gate completion unless that ADR is later amended.

## UI: master–detail drawer

The Issues Section shows a compact, scannable **list** of failed Answers (question text, fail chip, a summary of what's captured). Selecting one opens a focused **side drawer** holding that Answer's full capture surface — attribution, remediation actions, and the configured Remediation Detail fields. One Answer's fields are visible at a time. A box-per-row grid was rejected: with attribution + N actions + configurable fields it becomes an unworkable wall of inputs.

## Consequences

- `CaseTypeConfig` gains optional `remediationFields`; the `Answer` typedef gains optional `remediationDetails`.
- The completeness computation (`allAnswered` → a broader "case complete") must account for required Remediation Details on failed Answers.
- Reuses the existing drawer pattern in the codebase; the Issues row list and the drawer are new UI.
- Field values are plain strings keyed by `key`; `select` values are validated against `options` at capture time.
