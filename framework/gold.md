```python
"""The silver->gold builder — accumulate a subject's refined data into gold.

Where :func:`~framework.silver.raw_to_silver` enforces the schema at the silver
boundary, this factory carries validated silver forward into the **accumulating**
gold layer (the SelectionPool / Review Outcomes — CONTEXT.md). It wires the
subject's silver Reader into a deferred :class:`~framework.builder.Pipeline`
whose terminus is the gold :class:`~framework.writers.AccumulateByRunWriter`: each
row is stamped with this load's ``run_id`` / ``load_date`` and a re-driven run is
idempotent via delete-by-run then insert (ADR-0006).

``run_id`` / ``load_date`` are **caller-supplied** — gold's ``run_id`` is a
stable, logical idempotency key (e.g. a business date), deliberately distinct
from the run-log's per-execution uuid, because re-driving a day must match and
replace its own prior rows. It makes no write or load decisions of its own (ADR-0003): it passes an explicit
:class:`~framework.strategy.AccumulateByRun` strategy to :func:`Store.writer`,
which maps ``layer → location``; the Writer owns its location and accumulate strategy.

An optional ``schema`` enforces a Case Type's contract at the gold boundary on
the same footing as silver (ADR-0008): when supplied it attaches a
``SchemaValidator`` as a **post**-validator, so the schema is checked on the
data about to be written and a breach aborts the run atomically *before* gold is
touched — no delete-by-run, no insert (fail-fast, ADR-0007). Silver is already
schema-validated upstream, so this is a belt-and-braces guard for
selection-built gold rows rather than ingest mirrors. Omitted, the builder keeps
its pure accumulate pass-through.
"""

from __future__ import annotations

import uuid

from framework.builder import Pipeline
from framework.processors import DeriveKey, LatestPerKey, Unpivot
from framework.run_log import RunLog
from framework.schema import SchemaValidator
from framework.store import Store
from framework.strategy import AccumulateByRun, Refresh
from framework.validators import UniqueValidator


def silver_to_gold(
    store: Store,
    table: str,
    *,
    run_id: str,
    load_date: str,
    schema: type | None = None,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the deferred silver->gold pipeline for one subject's ``table``.

    Reads ``store``'s silver ``table`` and accumulates it into gold, stamping
    each row with ``run_id`` / ``load_date``; re-driving the same ``run_id``
    replaces only that run's rows (ADR-0006). When ``schema`` is supplied it is
    enforced as a post-validator before the gold write, so a breach aborts the
    run atomically without accumulating (ADR-0008); omitted, the accumulate pass
    is unchanged. ``name`` labels the run for observability (defaults to
    ``table``); ``run_log`` is the optional run-log sink. Returns the composed
    :class:`~framework.builder.Pipeline`; call ``.run()`` to execute.
    """
    pipeline = Pipeline(name or table, store.reader("silver", table), run_log)
    if schema is not None:
        pipeline.with_post_validator(SchemaValidator(schema))
    return pipeline.write_to(store.writer("gold", table, AccumulateByRun(run_id, load_date)))


def current_silver_to_gold(
    store: Store,
    table: str,
    *,
    namespace: uuid.UUID,
    natural_key: list[str],
    by: str = "load_date",
    entity_id_column: str,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose a history-upstream/current-gold reduction for one subject table.

    Reads the subject's accumulated silver (full change-over-time history),
    derives a deterministic entity id from ``natural_key`` under ``namespace``,
    collapses history to the latest row per entity via ``LatestPerKey`` (ordered
    by ``by``, defaults to ``load_date``), enforces the one-row-per-entity grain
    at the gold boundary via ``UniqueValidator``, and writes current-only gold
    via ``Refresh`` (truncate + reload). Returns the composed
    :class:`~framework.builder.Pipeline`; call ``.run()`` to execute.
    """
    return (
        Pipeline(name or table, store.reader("silver", table), run_log)
        .with_processor(DeriveKey(into=entity_id_column, namespace=namespace, natural_key=natural_key))
        .with_processor(LatestPerKey(key=entity_id_column, by=by))
        .with_post_validator(UniqueValidator(entity_id_column))
        .write_to(store.writer("gold", table, Refresh()))
    )


def detail_current_silver_to_gold(
    store: Store,
    table: str,
    *,
    namespace: uuid.UUID,
    natural_key: list[str],
    unpivot: Unpivot,
    entity_id_column: str,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose a current-gold reduction for a detail table.

    Reads the subject's accumulated silver (the projected, normalised product
    rows), derives a deterministic entity id from ``natural_key`` under
    ``namespace``, then applies ``unpivot`` to reshape the wide feed into one row
    per detail line (e.g. product 1..N → one row each). Empty detail slots are
    dropped by the Unpivot processor. Writes current-only gold via ``Refresh``
    (truncate + reload) so gold always reflects the latest full set of Detail
    rows. Returns the composed Pipeline; call ``.run()`` to execute.

    Unlike ``current_silver_to_gold`` there is no ``LatestPerKey`` step: the
    detail grain is many rows per entity, not one, so deduplication is not
    appropriate here.
    """
    return (
        Pipeline(name or table, store.reader("silver", table), run_log)
        .with_processor(DeriveKey(into=entity_id_column, namespace=namespace, natural_key=natural_key))
        .with_processor(unpivot)
        .write_to(store.writer("gold", table, Refresh()))
    )

```
