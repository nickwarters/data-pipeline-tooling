"""Case-review gold helpers composed from generic framework transforms.

These take a caller's **identity contract** (its ``namespace`` and
``natural_key``) and feed it to :class:`~framework.transform.DeriveKey`, which
knows only a namespace, a list of natural-key columns and the column to stamp
the derived digest into — nothing about Cases. Naming that column ``case_id``
is this layer's business, not the framework's. The Case builder and each
Detail-Table builder must be handed the *same* namespace and natural key so a
Case and its Detail rows derive the same deterministic ``case_id`` independently.
Gold builders accept the namespace, natural key and schema explicitly; callers
must source those identity values from the same declaration.
"""

from __future__ import annotations

from framework.core import UniqueValidator
from framework.io import Refresh
from framework.run import Pipeline, RunLog
from framework.transform import DeriveKey, LatestPerKey, Unpivot
from tools.medallion import Medallion

# A Case is identified by its ``case_id`` everywhere downstream, so the column
# DeriveKey stamps, LatestPerKey reduces by and UniqueValidator gates on is fixed
# once here rather than passed in at each call site.
CASE_ID_COLUMN = "case_id"


def ingest_silver_to_gold(
    medallion: Medallion,
    namespace: str,
    natural_key: tuple[str, ...],
    schema: type,
    table: str | None = None,
    *,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Reduce accumulated case silver to one current gold row per Case.

    The silver/gold ``table`` defaults to ``namespace``. ``schema`` travels
    with the caller's declared contract but is not inspected by this reduction.
    """
    table_name = table or namespace
    p = Pipeline(name or table_name, run_log=run_log)
    r = p.read(medallion.silver.reader(table_name), name="read")

    keyed = p.transform(
        DeriveKey(
            into=CASE_ID_COLUMN,
            namespace=namespace,
            natural_key=list(natural_key),
        ),
        r,
        name="derive-key",
    )
    latest = p.transform(
        LatestPerKey(key=CASE_ID_COLUMN, by="load_date"), keyed, name="latest-per-key"
    )
    validated = p.validate(
        UniqueValidator(CASE_ID_COLUMN), latest, name="unique-validate"
    )
    p.write(medallion.gold.writer(table_name, Refresh()), validated, name="write")
    return p


def detail_ingest_silver_to_gold(
    medallion: Medallion,
    namespace: str,
    natural_key: tuple[str, ...],
    schema: type,
    table: str,
    *,
    unpivot: Unpivot,
    name: str | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Reduce accumulated detail silver to current gold rows linked by case id.

    Pass the *same* ``namespace`` and ``natural_key`` as the Case builder so the
    Detail Table's ``case_id`` derives identically. ``table`` is the Detail
    Table's own name (distinct from the Case table); ``schema`` travels with the
    caller's declared contract but is not inspected by this reduction.
    """
    p = Pipeline(name or table, run_log=run_log)
    r = p.read(medallion.silver.reader(table), name="read")

    keyed = p.transform(
        DeriveKey(
            into=CASE_ID_COLUMN,
            namespace=namespace,
            natural_key=list(natural_key),
        ),
        r,
        name="derive-key",
    )
    unpivoted = p.transform(unpivot, keyed, name="unpivot")
    p.write(medallion.gold.writer(table, Refresh()), unpivoted, name="write")
    return p
