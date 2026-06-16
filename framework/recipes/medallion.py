"""Medallion pipeline recipes built from the generic framework primitives."""

from __future__ import annotations

import uuid

from framework.core import GOLD, RAW, SILVER
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun, Refresh
from framework.run.builder import Pipeline
from framework.run.run_log import RunLog
from framework.transform.coercion import SchemaCoercion
from framework.transform.processors import DeriveKey, Filter, LatestPerKey, Unpivot
from framework.validate.schema import SchemaValidator
from framework.validate.validators import UniqueValidator


def raw_to_silver(
    store: Store,
    table: str,
    schema: type,
    *,
    strategy: Refresh | AccumulateByRun | None = None,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Compose the raw->silver pipeline for one subject's ``table``."""
    effective_strategy = strategy if strategy is not None else Refresh()
    pipeline = Pipeline(name or table, store.reader(RAW, table), run_log)
    if isinstance(effective_strategy, AccumulateByRun):
        run_id = effective_strategy.run_id
        pipeline = pipeline.with_processor(
            Filter(lambda row, _rid=run_id: row["run_id"] == _rid)
        )
    return (
        pipeline.with_processor(SchemaCoercion(schema))
        .with_post_validator(SchemaValidator(schema))
        .write_to(store.writer(SILVER, table, effective_strategy))
    )


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
    """Compose the deferred silver->gold accumulating pipeline."""
    pipeline = Pipeline(name or table, store.reader(SILVER, table), run_log)
    if schema is not None:
        pipeline.with_post_validator(SchemaValidator(schema))
    return pipeline.write_to(
        store.writer(GOLD, table, AccumulateByRun(run_id, load_date))
    )


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
    """Compose a history-upstream/current-gold reduction for one subject table."""
    return (
        Pipeline(name or table, store.reader(SILVER, table), run_log)
        .with_processor(
            DeriveKey(
                into=entity_id_column, namespace=namespace, natural_key=natural_key
            )
        )
        .with_processor(LatestPerKey(key=entity_id_column, by=by))
        .with_post_validator(UniqueValidator(entity_id_column))
        .write_to(store.writer(GOLD, table, Refresh()))
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
    """Compose a current-gold reduction for a detail table."""
    return (
        Pipeline(name or table, store.reader(SILVER, table), run_log)
        .with_processor(
            DeriveKey(
                into=entity_id_column, namespace=namespace, natural_key=natural_key
            )
        )
        .with_processor(unpivot)
        .write_to(store.writer(GOLD, table, Refresh()))
    )
