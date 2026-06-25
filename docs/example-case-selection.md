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
python -m cli run pipelines/case_selection /tmp/selection-demo
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
| Max 10 checks per rolling 12 months (counted by **calendar month**) | `at_check_capacity` (`rolling_months` / `in_rolling_window`) |
| Only one case in progress at a time | `has_case_in_progress` |
| 28-day cooldown after a `fail` outcome | `blocked_by_failed_review` |
| ≥ 21 days from the last completed case to the next selection | `too_soon_since_last_case` |
| 2 of the 10 rolling-year checks must be case type C | `assign_case_type` |

Two interpretations worth calling out, both encoded and documented in `rules.py`:

- **Type-C quota (the spec's "2 of the 10 per rolling 12 months be case type
  C").** The case type normally follows the risk score. But when an adviser's
  remaining slots in the rolling year are no more than their outstanding type-C
  shortfall, `assign_case_type` **raises this selection to C** so the quota stays
  reachable — otherwise the score alone could never meet it. In the bundled
  sample, `adv006` has 8 checks (none type C) and a low-risk sale, so its case is
  forced to C.
- **Rolling 12 months "by month not by date".** The window is the 12 `(year,
  month)` buckets ending with the run month, so a check counts by the month it
  was selected, not an exact 365-day span.

## The bundled sample

[`sample_data/`](../pipelines/case_selection/sample_data/) is shaped so the run
(as of `2026-06-25`) exercises every rule. Eight advisers have a recent sale;
four are selected and four are excluded — one per exclusion gate:

| Adviser | Outcome | Why |
|---|---|---|
| `adv007` | selected, type C | risk 260 -> C by score |
| `adv008` | selected, type B | past `fail`, but the 28-day cooldown has cleared |
| `adv001` | selected, type B | two equal-risk sales — picks the category-A one |
| `adv006` | selected, type **C** | low-risk sale **forced to C** to meet the quota |
| `adv002` | excluded | a case is already in progress |
| `adv003` | excluded | at the 10-check rolling-year capacity |
| `adv004` | excluded | within the 28-day failed-review cooldown |
| `adv005` | excluded | within 21 days of the last completed case |

## Testing

[`tests/pipelines/test_case_selection.py`](../tests/pipelines/test_case_selection.py)
mirrors the layering: a focused unit test per rule, `select_cases` over synthetic
rows, the `selection_builder` driven in memory with `given_rows` +
`RecordingWriter` (no SQLite/filesystem), and the full `run` over the bundled
CSVs asserting the pool and the trace. Customise it the same way you would any
feed — see [`adding-a-feed.md`](adding-a-feed.md).
