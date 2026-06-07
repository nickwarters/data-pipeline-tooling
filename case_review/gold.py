"""Case-review gold helpers built on generic framework reducers."""

from __future__ import annotations

import uuid

from framework.builder import Pipeline
from framework.gold import current_silver_to_gold, detail_current_silver_to_gold
from framework.processors import Unpivot
from framework.run_log import RunLog
from framework.store import Store


def ingest_silver_to_gold(
    store: Store,
    table: str,
    *,
    namespace: uuid.UUID,
    natural_key: list[str],
    by: str = "load_date",
    case_id_column: str = "case_id",
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Reduce accumulated case silver to one current gold row per Case."""
    return current_silver_to_gold(
        store,
        table,
        namespace=namespace,
        natural_key=natural_key,
        by=by,
        entity_id_column=case_id_column,
        name=name,
        run_log=run_log,
    )


def detail_ingest_silver_to_gold(
    store: Store,
    table: str,
    *,
    namespace: uuid.UUID,
    natural_key: list[str],
    unpivot: Unpivot,
    case_id_column: str = "case_id",
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Reduce accumulated detail silver to current gold rows linked by case id."""
    return detail_current_silver_to_gold(
        store,
        table,
        namespace=namespace,
        natural_key=natural_key,
        unpivot=unpivot,
        entity_id_column=case_id_column,
        name=name,
        run_log=run_log,
    )
