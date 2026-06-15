"""The raw->silver builder.

Raw is landed schema-light, then silver is where the declared schema contract is
enforced. :class:`~framework.transform.coercion.SchemaCoercion` casts
round-trip-lossy types before :class:`~framework.validate.schema.SchemaValidator`
checks the output that is about to be written. Nothing runs until ``.run()``, and
a coercion or schema breach aborts before silver is written.

The caller supplies the load strategy; the Writer owns its location and load
behaviour.
"""

from __future__ import annotations

from framework.core import RAW, SILVER
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun, Refresh
from framework.run.builder import Pipeline
from framework.run.run_log import RunLog
from framework.transform.coercion import SchemaCoercion
from framework.transform.processors import Filter
from framework.validate.schema import SchemaValidator


def raw_to_silver(
    store: Store,
    table: str,
    schema: type,
    *,
    strategy: Refresh | AccumulateByRun | None = None,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the raw->silver pipeline for one subject's ``table``.

    Reads ``store``'s raw ``table``, enforces ``schema`` as a post-validator,
    and writes the silver ``table``. ``strategy`` controls the load behaviour:
    ``Refresh()`` (default) truncates and reloads each run; ``AccumulateByRun``
    stamps ``run_id`` / ``load_date`` and keeps prior logical runs. ``name``
    labels the run for observability; ``run_log`` is the optional run-log sink.
    """
    effective_strategy = strategy if strategy is not None else Refresh()
    pipeline = Pipeline(name or table, store.reader(RAW, table), run_log)
    if isinstance(effective_strategy, AccumulateByRun):
        # Raw has accumulated rows from multiple runs; narrow to this run's rows
        # before schema coercion so previous snapshots don't bleed into the
        # current silver write under a different run_id stamp.
        run_id = effective_strategy.run_id
        pipeline = pipeline.with_processor(
            Filter(lambda row, _rid=run_id: row["run_id"] == _rid)
        )
    return (
        pipeline.with_processor(SchemaCoercion(schema))
        .with_post_validator(SchemaValidator(schema))
        .write_to(store.writer(SILVER, table, effective_strategy))
    )
