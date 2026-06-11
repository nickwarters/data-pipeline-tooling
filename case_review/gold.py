"""Case-review gold helpers built on generic framework reducers.

These read a Case Type's **identity contract** (its ``namespace`` and
``natural_key``) straight off the :class:`~case_review.case_type.CaseType` and
hand it to the generic framework reducers, which know only ``entity_id`` /
``namespace`` / ``natural_key`` and nothing about Cases. The Case builder and
each Detail-Table builder take the *same* Case Type, so a Case and its Detail
rows derive the same deterministic ``case_id`` independently — the parent/child
link is structural (ADR-0009), not two call sites that must be kept in step.
"""

from __future__ import annotations

from case_review.case_type import CaseType
from framework.builder import Pipeline
from framework.gold import current_silver_to_gold, detail_current_silver_to_gold
from framework.processors import Unpivot
from framework.run_log import RunLog
from framework.store import Store

# The domain's entity-id column name — a Case is identified by its ``case_id``
# everywhere downstream (ADR-0009). The generic reducer calls this its
# ``entity_id_column``; the case-review layer fixes it to ``case_id``.
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
    return current_silver_to_gold(
        store,
        table or case_type.name,
        namespace=case_type.namespace,
        natural_key=list(case_type.natural_key),
        entity_id_column=CASE_ID_COLUMN,
        name=name,
        run_log=run_log,
    )


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
    ``case_id`` derives identically (ADR-0009). ``table`` is the Detail Table's
    own name (distinct from the Case table).
    """
    return detail_current_silver_to_gold(
        store,
        table,
        namespace=case_type.namespace,
        natural_key=list(case_type.natural_key),
        unpivot=unpivot,
        entity_id_column=CASE_ID_COLUMN,
        name=name,
        run_log=run_log,
    )
