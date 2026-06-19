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
    p = Pipeline(name or table, run_log=run_log)
    r = p.read(store.reader(RAW, table), name="read")
    
    current = r
    if isinstance(effective_strategy, AccumulateByRun):
        run_id = effective_strategy.run_id
        current = p.transform(
            Filter(lambda row, _rid=run_id: row["run_id"] == _rid),
            current,
            name="filter-by-run-id"
        )
        
    coerced = p.transform(SchemaCoercion(schema), current, name="coerce")
    validated = p.validate(SchemaValidator(schema), coerced, name="post-validate")
    p.write(store.writer(SILVER, table, effective_strategy), validated, name="write")
    return p


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
    p = Pipeline(name or table, run_log=run_log)
    r = p.read(store.reader(SILVER, table), name="read")
    
    current = r
    if schema is not None:
        current = p.validate(SchemaValidator(schema), current, name="post-validate")
        
    p.write(store.writer(GOLD, table, AccumulateByRun(run_id, load_date)), current, name="write")
    return p


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
    p = Pipeline(name or table, run_log=run_log)
    r = p.read(store.reader(SILVER, table), name="read")
    
    keyed = p.transform(
        DeriveKey(into=entity_id_column, namespace=namespace, natural_key=natural_key),
        r,
        name="derive-key"
    )
    latest = p.transform(LatestPerKey(key=entity_id_column, by=by), keyed, name="latest-per-key")
    validated = p.validate(UniqueValidator(entity_id_column), latest, name="unique-validate")
    p.write(store.writer(GOLD, table, Refresh()), validated, name="write")
    return p


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
    p = Pipeline(name or table, run_log=run_log)
    r = p.read(store.reader(SILVER, table), name="read")
    
    keyed = p.transform(
        DeriveKey(into=entity_id_column, namespace=namespace, natural_key=natural_key),
        r,
        name="derive-key"
    )
    unpivoted = p.transform(unpivot, keyed, name="unpivot")
    p.write(store.writer(GOLD, table, Refresh()), unpivoted, name="write")
    return p
