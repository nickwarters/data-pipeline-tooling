```python
"""Case-selection example: choose one Case to check per adviser from sales.

A worked, multi-source selection example. It reads two feeds — **all sales** and
**all case reviews** — refines each through ``raw -> silver`` with its schema
enforced, then assembles a **gold ``selection_pool``**: at most one Case per
adviser, chosen from the adviser's recent sales and gated by the adviser's
case-review history.

The selection criteria are genuinely cross-row and stateful (highest-risk sale
per adviser, rolling-year quotas, cooldowns between cases), so they live as
named, pure-Python rules in :mod:`pipelines.case_selection.rules` and one
orchestrating :func:`~pipelines.case_selection.selection.select_cases` function —
the framework supplies the IO, the schema enforcement, and the gold write.

Run it from the repo root::

    python -m cli run pipelines/case_selection /tmp/selection-demo
    python -m pipelines.case_selection.pipeline /tmp/selection-demo

See [`docs/example-case-selection.md`](../../docs/example-case-selection.md).
"""

```
