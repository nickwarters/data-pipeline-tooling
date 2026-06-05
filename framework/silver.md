```python
"""The raw->silver builder — enforce a Case Type's schema at the silver boundary.

This factory encodes the ADR-0008 convention in one place: **raw** is landed
schema-light, then **silver** is where the declared :mod:`~framework.schema`
contract is enforced. It wires the subject's raw Reader and silver Writer into a
deferred :class:`~framework.builder.Pipeline`: a ``SchemaCoercion`` processor
casts the schema's round-trip-lossy types (dates, booleans) ahead of the
``SchemaValidator``, which is attached as a **post**-validator so the schema is
checked on the coerced output that is about to be written. Nothing runs until
``.run()`` — and a coercion or schema breach aborts the run atomically *before*
silver is written (fail-fast, ADR-0007).

It makes no write or load decisions of its own (ADR-0003): the caller supplies
an explicit :class:`~framework.strategy.Refresh` (current-state snapshot, the
default) or :class:`~framework.strategy.AccumulateByRun` (history-upstream
Ingest profile) strategy; the Writer owns its location and load strategy.
"""

from __future__ import annotations

from framework.builder import Pipeline
from framework.processors import Filter
from framework.run_log import RunLog
from framework.schema import SchemaCoercion, SchemaValidator
from framework.store import Store
from framework.strategy import AccumulateByRun, Refresh


def raw_to_silver(
    store: Store,
    table: str,
    schema: type,
    *,
    strategy: Refresh | AccumulateByRun | None = None,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the deferred raw->silver pipeline for one subject's ``table``.

    Reads ``store``'s raw ``table``, enforces ``schema`` as a post-validator,
    and writes the silver ``table``. ``strategy`` controls the load behaviour:
    ``Refresh()`` (default) truncates and reloads each run; ``AccumulateByRun``
    accumulates history and stamps ``run_id`` / ``load_date`` — used for the
    Ingest history-upstream profile (ADR-0006 amendment). ``name`` labels the
    run for observability (defaults to ``table``); ``run_log`` is the optional
    run-log sink. Returns the composed :class:`~framework.builder.Pipeline`;
    call ``.run()`` to execute.
    """
    effective_strategy = strategy if strategy is not None else Refresh()
    pipeline = Pipeline(name or table, store.reader("raw", table), run_log)
    if isinstance(effective_strategy, AccumulateByRun):
        # Raw has accumulated rows from multiple runs; narrow to this run's rows
        # before schema coercion so previous snapshots don't bleed into the
        # current silver write under a different run_id stamp.
        run_id = effective_strategy.run_id
        pipeline = pipeline.with_processor(
            Filter(lambda row, _rid=run_id: row["run_id"] == _rid)
        )
    return (
        pipeline
        .with_processor(SchemaCoercion(schema))
        .with_post_validator(SchemaValidator(schema))
        .write_to(store.writer("silver", table, effective_strategy))
    )

```
