# Example: selecting cases to check from sales + review history

A worked, end-to-end **selection** example under
[`../pipelines/case_selection/`](../pipelines/case_selection/). It reads two
feeds — **all sales** and **all case reviews** — and assembles a gold
`selection_pool`: at most one Case to check per adviser. It is intentionally
richer than the [capstone `selection` demo](selection.md): the selection policy
is a real, multi-rule one, so it shows how to keep genuinely cross-row, stateful
selection logic testable while the framework still owns the IO, schema
enforcement, and gold write.

```sh
python -m cli run pipelines/case_selection --base-dir /tmp/selection-demo
python -m pipelines.case_selection.pipeline /tmp/selection-demo   # or directly
```

## What it does

Two source feeds are landed `raw -> silver` with their schemas enforced
(`SchemaCoercion` + `SchemaValidator`), then a selection step assembles gold:

```
sales.csv ───────▶ raw ─▶ silver ─┐
                                   ├─▶ select_cases ─▶ gold selection_pool
case_reviews.csv ─▶ raw ─▶ silver ─┘                 (+ sibling selection_trace)
```

For each adviser with a sale in the last 15 days, the adviser's review history
either **excludes** them (with a recorded reason) or their **highest-risk recent
sale** is chosen, assigned a case type, and written to the pool. A sibling
`selection_trace` records the verdict and reason for every considered adviser —
the same *route-aside-with-a-reason* explainability the
[capstone `.explain(...)`](selection.md#explainability) gives, here emitted by the
selection step itself because the policy is one monolithic, stateful decision
rather than a chain of independent `Filter` gates.

## The criteria, and where each lives

Every rule is a small, pure, named function in
[`rules.py`](../pipelines/case_selection/rules.py), unit-tested with a row `dict`
and a date — no Pipeline, no pandas. They are composed by
[`select_cases`](../pipelines/case_selection/selection.py); only
[`pipeline.py`](../pipelines/case_selection/pipeline.py) touches IO.

| Criterion | Rule |
|---|---|
| Sales from the last 15 days | `is_recent_sale` |
| One sale per adviser, highest risk score, category A over B on a tie | `best_sale` |
| Risk `< 150 -> A`, `< 250 -> B`, `>= 250 -> C` | `case_type_for_score` |
| Check target of 10 over 12 **active** months, pro-rata below that | `at_check_capacity` (`active_months` / `check_target`) |
| Only one case in progress at a time | `has_case_in_progress` |
| 28-day cooldown after a `fail` outcome | `blocked_by_failed_review` |
| ≥ 21 days from the last completed case to the next selection | `too_soon_since_last_case` |
| 2 of the rolling-year checks must be case type C | `assign_case_type` |

### Rule priority

When more than one gate could exclude an adviser, the **first** one wins, so the
trace records a single clear reason. `exclusion_reason` applies them in the agreed
priority order: a **case in progress** first, then the **check capacity**, then
the **21-day gap** between cases, then the longer **28-day cooldown** a failed
review adds on top. The 21-day gap is checked before the 28-day cooldown so an
adviser still inside the general gap is reported as such rather than as a
failed-review case — in the sample, `adv004` clears the 21-day gap but not the
28-day cooldown, so the order is what makes its reason legible.

### Interpretations worth calling out

All encoded and documented in `rules.py`:

- **Pro-rata check target (the spec's "10 over 12 active months").** An *active
  month* is a rolling-window calendar month in which the adviser made at least one
  sale. The target of 10 applies to a full 12 active months; an adviser active in
  fewer months has it scaled pro-rata (`round(10 × active / 12)`), so a
  less-active adviser isn't held to a full-year target. In the sample, `adv003`
  has 5 checks but only 6 active months, so its pro-rata target is 5 — at capacity
  — even though a flat 10 would not exclude it.
- **Type-C quota (the spec's "2 of the … per rolling 12 months be case type C").**
  The case type normally follows the risk score. But when an adviser's remaining
  slots — against their pro-rata check target — are no more than their outstanding
  type-C shortfall, `assign_case_type` **raises this selection to C** so the quota
  stays reachable. In the sample, `adv006` has 2 of its 4 (pro-rata) checks done,
  none type C, so both remaining slots must be C — its low-risk sale is forced to C.
- **Rolling 12 months "by month not by date".** The window is the 12 `(year,
  month)` buckets ending with the run month, so checks and active months count by
  calendar month, not an exact 365-day span.

## The bundled sample

[`sample_data/`](../pipelines/case_selection/sample_data/) is shaped so the run
(as of `2026-06-25`) exercises every rule. Eight advisers have a recent sale; four
are selected (covering all four case-type outcomes) and four are excluded — one
per exclusion gate:

| Adviser | Outcome | Why |
|---|---|---|
| `adv008` | selected, type C | risk 260 -> C by score |
| `adv001` | selected, type B | two equal-risk sales — picks the category-A one |
| `adv006` | selected, type **C** | low-risk sale **forced to C** to meet the type-C quota |
| `adv007` | selected, type A | risk 100 -> A by score |
| `adv002` | excluded | a case is already in progress |
| `adv003` | excluded | at the **pro-rata** check capacity (5 of 5 for 6 active months) |
| `adv004` | excluded | clears the 21-day gap, but inside the 28-day failed-review cooldown |
| `adv005` | excluded | within 21 days of the last completed case |

## Testing

[`tests/pipelines/test_case_selection.py`](../tests/pipelines/test_case_selection.py)
mirrors the layering: a focused unit test per rule, `select_cases` over synthetic
rows, the `selection_builder` driven in memory with `given_rows` +
`RecordingWriter` (no SQLite/filesystem), and the full `run` over the bundled
CSVs asserting the pool and the trace. Customise it the same way you would any
feed — see [`adding-a-feed.md`](adding-a-feed.md).
