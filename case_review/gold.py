"""Case-review gold helpers built on generic framework reducers.

These read a Case Type's **identity contract** (its ``namespace`` and
``natural_key``) straight off the :class:`~case_review.case_type.CaseType` and
hand it to the generic framework reducers, which know only ``entity_id`` /
``namespace`` / ``natural_key`` and nothing about Cases. The Case builder and
each Detail-Table builder take the *same* Case Type, so a Case and its Detail
rows derive the same deterministic ``case_id`` independently — the parent/child
link is structural, not two call sites that must be kept in step.
"""

from __future__ import annotations

from case_review.case_type import CaseType
from framework.core import GOLD, SILVER, UniqueValidator
from framework.io import Store
from framework.io.strategy import Refresh
from framework.run import Pipeline, RunLog
from framework.transform import DeriveKey, LatestPerKey, Unpivot

# A Case is identified by its ``case_id`` everywhere downstream. The generic
# reducer calls this its ``entity_id_column``; the case-review layer fixes it.
CASE_ID_COLUMN = "case_id"


def ingest_silver_to_gold(
    store: Store,
    case_type: CaseType,
    table: str | None = None,
    *,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Reduce accumulated case silver to one current gold row per Case.

    Identity (``namespace`` / ``natural_key``) comes from ``case_type``; the
    silver/gold ``table`` defaults to the Case Type's ``name``.
    """
    table_name = table or case_type.name
    p = Pipeline(name or table_name, run_log=run_log)
    r = p.read(store.reader(SILVER, table_name), name="read")
    
    keyed = p.transform(
        DeriveKey(into=CASE_ID_COLUMN, namespace=case_type.namespace, natural_key=list(case_type.natural_key)),
        r,
        name="derive-key"
    )
    latest = p.transform(LatestPerKey(key=CASE_ID_COLUMN, by="load_date"), keyed, name="latest-per-key")
    validated = p.validate(UniqueValidator(CASE_ID_COLUMN), latest, name="unique-validate")
    p.write(store.writer(GOLD, table_name, Refresh()), validated, name="write")
    return p


def detail_ingest_silver_to_gold(
    store: Store,
    case_type: CaseType,
    table: str,
    *,
    unpivot: Unpivot,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Reduce accumulated detail silver to current gold rows linked by case id.

    Takes the *same* ``case_type`` as its Case table, so the Detail Table's
    ``case_id`` derives identically. ``table`` is the Detail Table's own name
    (distinct from the Case table).
    """
    p = Pipeline(name or table, run_log=run_log)
    r = p.read(store.reader(SILVER, table), name="read")
    
    keyed = p.transform(
        DeriveKey(into=CASE_ID_COLUMN, namespace=case_type.namespace, natural_key=list(case_type.natural_key)),
        r,
        name="derive-key"
    )
    unpivoted = p.transform(unpivot, keyed, name="unpivot")
    p.write(store.writer(GOLD, table, Refresh()), unpivoted, name="write")
    return p
