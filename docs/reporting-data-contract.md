# Reporting data contract

How an **external reporting process** (e.g. Python) turns **Case** data into
question-level reports — "top failed **Question Definitions** across all Cases
modified yesterday," and similar.

This is a _consumer_ guide. The reporting code itself is out of scope; this
document specifies the **format** it reads and the **algorithm** it must apply.
The decision behind it is [ADR-0015](./adr/0015-data-only-case-type-export-for-reporting.md).

## TL;DR

- You need **two inputs**: the per-Case-Type **export** (`case-types/{slug}.json`)
  and the **Case rows** (read from the per-Case-Type SharePoint list).
- A question **failed** when its stored answer value matches the question's
  `failureCriteria`. That's it — no JS, no functions.
- For a **case-level verdict** (pass / refer / fail), read the
  `outcomeAtCompletion` column on the Case row. **Do not** try to recompute it.

## What you do _not_ need

- **The compiled `case-types/{slug}.js` module.** It contains `computeOutcome`, a
  JS function you cannot parse. Ignore it. Read the `.json` sibling instead.
- **The outcome function, in any form.** Per-question failure is data
  (`failureCriteria`); case verdicts are a stored snapshot (`outcomeAtCompletion`).
  Reporting never executes Case Type logic.

## Input 1 — the Case Type export (`case-types/{slug}.json`)

One file per **Case Type**, published in the Style Library beside the module, e.g.
`/Style Library/case-review/case-types/complaint-review.json`. Fetch it by URL over
the same NTLM/Kerberos auth as everything else.

### Envelope

```json
{
  "slug": "complaint-review",
  "label": "Complaint Review",
  "generatedAt": "2026-06-05T09:30:00Z",
  "hash": "sha256:1a2b3c4d5e6f",
  "questions": [
    /* … */
  ]
}
```

| Field         | Meaning                                                         |
| ------------- | --------------------------------------------------------------- |
| `slug`        | Join key — matches the `caseType` field on a Case row.          |
| `label`       | Human-readable Case Type name.                                  |
| `generatedAt` | ISO-8601 timestamp the export was compiled.                     |
| `hash`        | Identity of this export (same digest the compile drawer shows). |
| `questions`   | The Case Type's **Question Bank**, as data (below).             |

### Per-question fields

```json
{
  "id": "q-rootcause",
  "text": "Was a root cause documented?",
  "category": "Analysis",
  "responseType": "yes-no-na",
  "options": null,
  "showWhen": {
    "$and": [
      { "q-acknowledged": { "equals": "Yes" } },
      {
        "$or": [
          { "q-severity": { "equals": "High" } },
          { "q-severity": { "equals": "Regulatory" } }
        ]
      }
    ]
  },
  "failureCriteria": "No",
  "deprecated": false
}
```

| Field             | Type                                             | Use in reporting                                                                                            |
| ----------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `id`              | string                                           | Key into the Case row's `answers` map.                                                                      |
| `text`            | string                                           | Display label for the report.                                                                               |
| `category`        | string \| absent                                 | Group / roll up (e.g. failure rate per section).                                                            |
| `responseType`    | `yes-no-na` \| `single-choice` \| `multi-choice` | **Selects the failure test** (scalar equality vs array-includes).                                           |
| `options`         | string[] \| absent                               | Valid choices; useful for labelling, not required for failure.                                              |
| `showWhen`        | object \| absent                                 | Applicability rule. Only needed for _denominators_ (see below); not for counting failures.                  |
| `failureCriteria` | string \| absent                                 | The value that marks a failure. **Absent ⇒ the question cannot fail.**                                      |
| `deprecated`      | boolean                                          | Question retired from the bank; may still appear on older Cases — label or exclude as your report requires. |

Intentionally **absent**: `computeOutcome` (code), `remediationActions` /
`allowFreeFormRemediation` (authoring templates — the remediation actually _taken_
lives on the Answer, below), and Case-Type config (`eligibleGroups`, `slaHours`,
`attributeFailures`).

## Input 2 — the Case row

Read Case rows from the per-Case-Type SharePoint list (one list per Case Type). The
reporting-relevant fields:

| Field                     | Type                         | Notes                                                                                                                             |
| ------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | string                       | Case identifier.                                                                                                                  |
| `caseType`                | string                       | Slug — join to `{caseType}.json`.                                                                                                 |
| `status`                  | `In-progress` \| `Completed` | Most reports filter to `Completed`.                                                                                               |
| `answers`                 | object (JSON blob)           | `{ [questionId]: Answer }`. See shape below.                                                                                      |
| `completedAt`             | ISO-8601 \| null             | Use for date-range filters ("modified yesterday").                                                                                |
| `outcomeAtCompletion`     | string \| null               | **Frozen reviewer verdict** (ADR-0012). Use this, never recompute.                                                                |
| `hadRemediation`          | boolean                      | Frozen at completion: any Answer carried a Remediation Action.                                                                    |
| `effectiveOutcome`        | string \| null               | **Corrected case verdict** (ADR-0019). Re-stamped on every Answer Override; equals `outcomeAtCompletion` when no Override exists. |
| `effectiveHadRemediation` | boolean                      | The Effective-Answers counterpart of `hadRemediation`, re-derived alongside `effectiveOutcome`.                                   |
| `outcomeOverridden`       | boolean                      | `true` once an Answer Override has been authored — flags/segments corrected Cases.                                                |

> **Which verdict column to read (ADR-0019).** Two frozen-vs-corrected columns
> serve two report audiences from the same row, and one column cannot serve both
> honestly:
>
> - **Reviewer-quality** reports (was the _reviewer_ right?) read
>   `outcomeAtCompletion` — the reviewer's original record. A wrongly-passed Case
>   is the very error QA exists to surface; "fixing" it retroactively erases the
>   evidence.
> - **Responsible-Party / true-result** reports (how did the _agent_ actually do?)
>   read `effectiveOutcome` — the corrected result after any Answer Override.
> - `outcomeOverridden` lets either report flag or filter the corrected subset.
>
> All three are **indexed**, so an `$filter` on `effectiveOutcome` /
> `outcomeOverridden` stays server-side and bounded — no full-row fetch, no
> client-side re-derivation. Never recompute either verdict.

> **Provisioning (Maintainers).** On top of ADR-0012's two columns, every
> per-Case-Type list now needs three more (ADR-0019), added when the Case Type
> list is provisioned:
>
> - `EffectiveOutcome` — Single line of text, **indexed**.
> - `EffectiveHadRemediation` — Yes/No.
> - `OutcomeOverridden` — Yes/No, **indexed**.
>
> The framework filters on `EffectiveOutcome` and `OutcomeOverridden`
> server-side (`http-sharepoint-client.js`, `listCases`), so both must be indexed
> for the bounded report query. Rows completed before ADR-0019 landed may have
> these absent/null; treat them as un-corrected (`effectiveOutcome` ⇒ fall back to
> `outcomeAtCompletion`, `outcomeOverridden` ⇒ `false`).

> **Case-verdict snapshot.** ADR-0012 is implemented: the completion write
> (`cr-case-review.js`, `_completeCase`) runs the outcome function over the
> answers at completion time and stamps `outcomeAtCompletion` + `hadRemediation`
> in the same ETag-guarded PATCH as `status` / `completedAt`. The snapshot is
> frozen — later edits to the Question Bank, the outcome function, or the answers
> do not change a Completed Case's stamped values. Read these columns straight off
> the row; **never recompute the verdict** (see "What you do _not_ need"). Rows
> completed _before_ this landed may still have the columns absent/null; treat
> those as un-snapshotted rather than recomputing.

### The `Answer` shape

Each entry in `answers`, keyed by question `id`:

```json
{
  "value": "No",
  "justification": "No RCA was recorded in the case file.",
  "remediationActions": [
    { "id": "q-rootcause-ra-0", "text": "Open RCA ticket.", "completed": false }
  ],
  "attributedParty": { "loginName": "jsmith", "displayName": "J. Smith" }
}
```

- **`value` is the only field needed to derive failure.** It is a **string** for
  `yes-no-na` and `single-choice`, and a **`string[]`** for `multi-choice`. An
  empty string or empty array means **unanswered**.
- `justification`, `remediationActions`, `attributedParty` are optional and not
  needed for failure counting (use them for richer reports if you want — e.g.
  "failures with no justification," or remediation-completion rates).

## The join + failure algorithm

For each Case → look up its export by `caseType` → for each question in the
export, find the Answer by `id` → apply the failure test. This replicates
`isFailure()` in `src/evaluators/failure-evaluator.js` exactly:

```python
def is_failure(question, answer):
    fc = question.get("failureCriteria")
    if fc is None:            # question can never fail
        return False
    if answer is None:        # unanswered
        return False
    value = answer["value"]
    if isinstance(value, list):           # multi-choice
        return fc in value                # array-includes
    return value == fc                    # scalar equality
```

> **The branch on `responseType` is implicit in `value`'s type**, but keep
> `responseType` in mind: a `multi-choice` value is always a list (failure =
> _includes_), scalar types are strings (failure = _equals_). Do not equality-test
> a list.

### Worked example — "top failed questions"

```
for case in cases_modified_yesterday:           # filter on completedAt
    export = load_export(case["caseType"])       # case-types/{slug}.json
    by_id  = {q["id"]: q for q in export["questions"]}
    for qid, answer in case["answers"].items():
        q = by_id.get(qid)
        if q and is_failure(q, answer):
            tally[(case["caseType"], qid, q["text"], q.get("category"))] += 1

# tally, sorted descending, is your "top failed questions" report
```

## Caveats — read these

1. **Latest-export semantics (v1).** You always read the _current_
   `{slug}.json`. The **Question Bank** is live-edited, so if `failureCriteria`
   changes after a Case completes, your per-question failure counts for that
   _historical_ Case will be derived against **today's** criteria, not the
   criteria in force when it was reviewed. For recent/operational reports
   ("yesterday") this is virtually always fine. For long-range retrospective
   trend reports, be aware the baseline can shift under you. (If true point-in-time
   stability is ever needed, ADR-0015 notes the path: a per-question failure
   snapshot at completion — not built yet.)

2. **Case verdicts are different — and stable.** The _case-level_ pass/refer/fail
   is **not** re-derived from answers. Read `outcomeAtCompletion` straight off the
   row; it is frozen at completion (ADR-0012) and immune to later bank edits.
   Never recompute it. The completion path stamps it in the same PATCH as
   `status` + `completedAt`, so it is present on every Case completed after
   ADR-0012 landed (older rows may carry a null — treat those as un-snapshotted).

3. **Applicability (`showWhen`).** Counting _failures_ needs no `showWhen` — a
   failed answer was, by definition, shown and answered. You only need `showWhen`
   for **denominators** ("of the Cases where `q-rootcause` was applicable, what %
   failed?"). To compute applicability, evaluate `showWhen` against the Case's
   answers, mirroring `src/evaluators/applicability-evaluator.js`
   (`equals` / `in` / `answered`, combined with `$and` / `$or`).

4. **Deprecated questions.** A date-range report will hit Cases answered against
   questions later marked `deprecated: true`. They still carry real answers; decide
   per report whether to label, segregate, or exclude them.

5. **Unanswered ≠ failed.** Empty string / empty array is unanswered, and
   `is_failure` returns `False` for it. If you want to report unanswered-but-
   applicable questions, that's a separate measure (and needs `showWhen`).

## Provenance

Record the export `hash` (and `generatedAt`) you read alongside each report run.
It makes a number reproducible ("derived from `complaint-review.json`
`sha256:1a2b3c4d5e6f`") and is the hook that a future point-in-time mode would use.
