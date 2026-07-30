# Reporting data contract

How an **external reporting process** (e.g. Python) turns **Case** data into
question-level reports — "top failed **Question Definitions** across all Cases
modified yesterday," and similar.

This is a _consumer_ guide. The reporting code itself is out of scope; this
document specifies the **format** it reads and the **algorithm** it must apply.
The decisions behind it are
and.

## TL;DR

- You need **two inputs**: the per-Case-Type **export** (`case-types/{slug}.json`
  for current, `case-types/{slug}.{hash}.json` for versioned) and the **Case
  rows** (read from the per-Case-Type SharePoint list).
- A question **failed** when its stored answer value maps (via the question's
  `optionOutcomes`) to an Outcome other than the export's `defaultOutcomeId`.
  The universal `NA` answer never fails. That's it — no JS, no functions.
- For a **case-level verdict** (pass / refer / fail), read the
  `outcomeAtCompletion` column on the Case row. **Do not** try to recompute it.
- For **Completed Cases with a `questionBankVersion`**: use the versioned file
  (`{slug}.{hash}.json`) for the question catalogue and its `optionOutcomes` /
  `defaultOutcomeId` — this gives you the as-reviewed snapshot and avoids drift
  from later bank edits.

## What you do _not_ need

- **The compiled `case-types/{slug}.js` module.** It contains `computeOutcome`, a
  JS function you cannot parse. Ignore it. Read the `.json` sibling instead.
- **The outcome function, in any form.** Per-question failure is data
  (`optionOutcomes` vs `defaultOutcomeId`); case verdicts are a stored snapshot
  (`outcomeAtCompletion`). Reporting never executes Case Type logic.

## Input 1 — the Case Type export

Two variants live in the Style Library beside the `.js` module:

| File                 | Contents                                                                                                      | When to use                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `{slug}.json`        | **Current** export — always the latest bank version. Carries the `labels` table.                              | In-progress Cases; any report that reads only the latest bank.                                                             |
| `{slug}.{hash}.json` | **Versioned** export — immutable snapshot. Carries frozen `labelIds` per question but not the `labels` table. | Completed Cases with a `questionBankVersion` — use this file to get as-reviewed wording, `optionOutcomes`, and `showWhen`. |

Fetch by URL over the same NTLM/Kerberos auth as everything else, e.g.
`/Style Library/case-review/case-types/complaint-review.json` or
`/Style Library/case-review/case-types/complaint-review.sha256%3Aabc123.json`.

### Envelope

```json
{
  "slug": "complaint-review",
  "label": "Complaint Review",
  "generatedAt": "2026-06-05T09:30:00Z",
  "hash": "sha256:1a2b3c4d5e6f…",
  "questions": [
    /* … */
  ],
  "labels": [{ "id": "lbl-coaching", "name": "Coaching", "color": "#2563eb" }]
}
```

`labels` is present only in **`{slug}.json`** (the current file). Versioned files
(`{slug}.{hash}.json`) carry the per-question `labelIds` but not the label
definitions — see **Label resolution** below.

| Field         | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| `slug`        | Join key — matches the `caseType` field on a Case row.            |
| `label`       | Human-readable Case Type name.                                    |
| `generatedAt` | ISO-8601 timestamp the export was compiled.                       |
| `hash`        | Content identity (full SHA-256 of questions+slug).                |
| `questions`   | The Case Type's **Question Bank**, as data (below).               |
| `labels`      | Label definitions — **current file only** (see Label resolution). |

### Per-question fields

```json
{
  "id": "q-rootcause",
  "text": "Was a root cause documented?",
  "category": "Analysis",
  "responseType": "yes-no-na",
  "options": null,
  "optionOutcomes": { "No": "fail" },
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
  "labelIds": ["lbl-coaching"],
  "deprecated": false
}
```

| Field            | Type                                                          | Use in reporting                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | string                                                        | Key into the Case row's `answers` map.                                                                                                                                                                                    |
| `text`           | string                                                        | Display label for the report.                                                                                                                                                                                             |
| `category`       | string \| absent                                              | Group / roll up (e.g. failure rate per section).                                                                                                                                                                          |
| `responseType`   | `yes-no-na` \| `single-choice` \| `multi-choice` \| `outcome` | **Selects the failure test** (scalar equality vs array-includes). `outcome` is single-choice over the Case Type's Outcomes.                                                                                               |
| `options`        | string[] \| absent                                            | Valid choices; useful for labelling, not required for failure.                                                                                                                                                            |
| `optionOutcomes` | object \| null                                                | Maps each response option label to a configured Outcome id. **Drives the case verdict** (highest-scoring applicable mapped Outcome wins) **and per-question failure** (any option mapped to a non-default Outcome fails). |
| `showWhen`       | object \| absent                                              | Applicability rule. Only needed for _denominators_ (see below); not for counting failures.                                                                                                                                |
| `labelIds`       | string[] \| absent                                            | IDs of labels assigned to this question (frozen in versioned files). Resolve to names via `labels` in the current file.                                                                                                   |
| `deprecated`     | boolean                                                       | Question retired from the bank; may still appear on older Cases — label or exclude as your report requires.                                                                                                               |

Maintainers can use this to add informational Question Bank questions. For
example, a required `General` yes/no question with no `optionOutcomes` mapping
still appears in the Review tab and counts toward completion, but a `No` answer
is outcome-neutral and must not create an Issue or Remediation. Reports must
therefore derive failures from the `optionOutcomes` mapping, not from raw
answer values across every question.

Intentionally **absent**: `computeOutcome` (code), `remediationActions` /
`disallowFreeFormRemediation` (authoring templates — the remediation actually _taken_
lives on the Answer, below), and Case-Type config (`eligibleGroups`, `slaHours`,
`attributeFailures`).

### Label resolution

Labels follow a **frozen-structure / current-presentation** split:

- **`labelIds` on each question** are _structure_ — which labels a question
  carried is part of the point-in-time snapshot. They are frozen in versioned
  files (`{slug}.{hash}.json`).
- **Label definitions** (`id → name, color`) are _presentation_ — always read
  from the **current** `{slug}.json`. A label rename or recolor then applies
  consistently across all historical reports without needing to rewrite versioned
  files.

Algorithm:

```python
current = load_json(f"case-types/{slug}.json")
label_map = {l["id"]: l for l in current.get("labels", [])}

# To get label names for a question in a versioned export:
q_labels = [label_map[lid] for lid in q.get("labelIds", []) if lid in label_map]
```

If a `labelId` from a versioned file is not present in the current `labels` table
(e.g. the label was retired), treat it as unknown rather than failing — the
`labelId` is still valid as a grouping key even without a display name.

## Input 2 — the Case row

Read Case rows from the per-Case-Type SharePoint list (one list per Case Type). The
reporting-relevant fields:

| Field                     | Type                         | Notes                                                                                                                  |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`                      | string                       | Case identifier.                                                                                                       |
| `caseType`                | string                       | Slug — join to `{caseType}.json`.                                                                                      |
| `status`                  | `In-progress` \| `Completed` | Most reports filter to `Completed`.                                                                                    |
| `answers`                 | object (JSON blob)           | `{ [questionId]: Answer }`. See shape below.                                                                           |
| `completedAt`             | ISO-8601 \| null             | Use for date-range filters ("modified yesterday").                                                                     |
| `outcomeAtCompletion`     | string \| null               | **Frozen reviewer verdict**. Use this, never recompute.                                                                |
| `hadRemediation`          | boolean                      | Frozen at completion: any Answer carried a Remediation Action.                                                         |
| `effectiveOutcome`        | string \| null               | **Corrected case verdict**. Re-stamped on every Answer Override; equals `outcomeAtCompletion` when no Override exists. |
| `effectiveHadRemediation` | boolean                      | The Effective-Answers counterpart of `hadRemediation`, re-derived alongside `effectiveOutcome`.                        |
| `outcomeOverridden`       | boolean                      | `true` once an Answer Override has been authored — flags/segments corrected Cases.                                     |

> **Which verdict column to read.** Two frozen-vs-corrected columns
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

> **Provisioning (Maintainers).** On top of the architecture decision's two columns, every
> per-Case-Type list now needs three more, added when the Case Type
> list is provisioned:
>
> - `EffectiveOutcome` — Single line of text, **indexed**.
> - `EffectiveHadRemediation` — Yes/No.
> - `OutcomeOverridden` — Yes/No, **indexed**.
>
> The framework filters on `EffectiveOutcome` and `OutcomeOverridden`
> server-side (`http-sharepoint-client.js`, `listCases`), so both must be indexed
> for the bounded report query. Rows completed before the architecture decision landed may have
> these absent/null; treat them as un-corrected (`effectiveOutcome` ⇒ fall back to
> `outcomeAtCompletion`, `outcomeOverridden` ⇒ `false`).

> **Case-verdict snapshot.** the architecture decision is implemented: the completion write
> (`cora-case-review.js`, `_completeCase`) runs the outcome function over the
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
def failure_values(question, default_outcome_id):
 mapping = question.get("optionOutcomes") or {}
 return {
 value
 for value, outcome_id in mapping.items()
 if value != "NA" and outcome_id != default_outcome_id
 }

def is_failure(question, answer, default_outcome_id):
 failing = failure_values(question, default_outcome_id)
 if not failing: # question can never fail
 return False
 if answer is None: # unanswered
 return False
 value = answer["value"]
 if isinstance(value, list): # multi-choice
 return any(v in failing for v in value if v != "NA")
 return value != "NA" and value in failing # scalar
```

> **The branch on `responseType` is implicit in `value`'s type**, but keep
> `responseType` in mind: a `multi-choice` value is always a list (failure =
> _includes_), scalar types are strings (failure = _equals_). Do not equality-test
> a list.

### Worked example — "top failed questions"

```python
for case in cases_modified_yesterday: # filter on completedAt
 version = case.get("questionBankVersion")
 if version: # the architecture decision: use the versioned file
 export = load_json(f"case-types/{slug}.{version}.json")
 else:
 export = load_json(f"case-types/{case['caseType']}.json")
 by_id = {q["id"]: q for q in export["questions"]}
 for qid, answer in case["answers"].items():
 q = by_id.get(qid)
 if q and is_failure(q, answer, export.get("defaultOutcomeId")):
 tally[(case["caseType"], qid, q["text"], q.get("category"))] += 1

# tally, sorted descending, is your "top failed questions" report
```

## Caveats — read these

1. **Use versioned exports for Completed Cases.** When a Case row
   carries a `questionBankVersion`, fetch `{slug}.{hash}.json` for that hash
   instead of `{slug}.json`. This gives you the exact questions, wording, and
   `optionOutcomes` / `defaultOutcomeId` that were in force at review time. Cases completed before
   the architecture decision was deployed have no `questionBankVersion`; fall back to the current
   `{slug}.json` for those (same behaviour as before).

2. **Case verdicts are different — and stable.** The _case-level_ pass/refer/fail
   is **not** re-derived from answers. Read `outcomeAtCompletion` straight off the
   row; it is frozen at completion and immune to later bank edits.
   Never recompute it. The completion path stamps it in the same PATCH as
   `status` + `completedAt`, so it is present on every Case completed after
   the architecture decision landed (older rows may carry a null — treat those as un-snapshotted).

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
