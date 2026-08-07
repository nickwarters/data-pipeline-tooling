"""Gold for the ``sharepoint_cases`` feed: the current Case.

Silver is an append-only history of *observations* -- one row per (list item,
version) the poll ever saw, with overlapping windows re-presenting rows that did
not change. Gold is the other shape: **one row per Case as it stands now**. It is
rebuilt whole with ``Refresh()`` on every poll, so a re-drive converges rather
than accumulating.

One table, and its declared grain:

================  =====================================================
``case_current``  one row per ``case_id`` -- the latest observation
================  =====================================================

It carries a live grain gate; see :func:`case_current_builder`. The grain is
declared both in that builder's docstring and in the data dictionary.

**One instant decides everything.** ``as_of`` is the candidate SharePoint window
end -- the value the run is about to commit as its watermark -- and never
``utcnow()``: a re-drive of the same window must produce byte-identical gold.
The table carries it as ``as_of_utc``.
"""

from __future__ import annotations

import datetime as dt
import re

import pandas as pd

from framework.core import Dataset, Reader, UniqueValidator, Writer
from framework.io import Refresh
from framework.run import Pipeline, RunLog
from framework.transform import DeriveKey, Stamp
from tools.medallion import Medallion

from .schema import FEED_NAME, LIST_NAME

# The silver table gold reduces, and the current-state table it reduces to.
# ``GOLD_TABLES`` -- every gold table, in publication order -- sits at the foot
# of this module, beside the publication it describes.
SILVER_TABLE = "case_version"
CURRENT_TABLE = "case_current"

CASE_ID_COLUMN = "case_id"
AS_OF_COLUMN = "as_of_utc"

# ``"3"``, ``W/"3"``, ``"4,1"`` and ``"3.0"`` are all shapes this list's version
# column really holds; the separator is whichever of the two the source used.
_VERSION_SEPARATOR = re.compile(r"[.,]")

# The version an observation with no parseable one sorts at. Deliberately ``-1``
# and not NA: pandas sorts NA *last*, which would let a version-less observation
# beat a properly versioned one at the same ``Modified``.
_NO_VERSION = -1


# --- the current-state rule -------------------------------------------------


def _version_parts(value: object) -> tuple[int, int]:
    """One ``source_version`` as the ``(major, minor)`` pair it sorts on.

    The column holds whichever of three shapes the observation carried: a
    SharePoint ETag (``'"3"'``, ``'W/"3"'``, ``'"4,1"'`` -- quotes included, as
    stored), a dotted UI version (``'3.0'``, ``'512.0'``), or -- when the row
    answered with no version at all -- the sha256 digest the Reader falls back
    to. Only the first two order; the digest is not a version and cannot pretend
    to be one, so it sorts at ``(-1, -1)``.

    Comparing these as *text* is the thing to avoid: ``"10"`` sorts before
    ``"9"`` lexically, so a same-``Modified`` tie would resolve backwards.
    """
    if not isinstance(value, str):
        return (_NO_VERSION, _NO_VERSION)
    text = value.strip()
    if text.startswith("W/"):
        text = text[2:]
    parts = _VERSION_SEPARATOR.split(text.strip('"'))
    try:
        major = int(parts[0])
    except ValueError:
        return (_NO_VERSION, _NO_VERSION)
    try:
        minor = int(parts[1]) if len(parts) > 1 else 0
    except ValueError:
        minor = 0
    return (major, minor)


def latest_case_version(dataset: Dataset) -> Dataset:
    """Reduce an accumulated observation history to the latest row per Case.

    The sort key, in order: ``case_id``, the ``Modified`` instant, the parsed
    version's major then minor part, and finally ``source_observation_id``. One
    stable sort, then ``drop_duplicates(keep="last")``.

    Why each tier exists. ``Modified`` is the source's own idea of when the item
    last changed, so it leads. It is not a tie-break on its own -- two versions
    of one item can share a ``Modified`` to the second, and the append-only
    silver keyed on ``source_observation_id`` keeps both -- so the parsed
    version decides that tie. ``source_observation_id`` is the last resort, and
    it is deterministic rather than meaningful: a sha256 of the list name, the
    item id and the version.

    **Be honest about the last tier.** Every observation whose version could not
    be parsed -- the digest fallback -- shares the same ``(-1, -1)`` bucket. Two
    of *those* at the same ``Modified`` are therefore separated entirely by
    ``source_observation_id``: the same input always picks the same winner, but
    which one it picks carries no meaning. That is a property of a source row
    that arrived without a version, not something this reduction can repair.

    Takes ``case_id`` as already derived (``DeriveKey`` runs above it), so this
    stays a pure reduction over columns rather than knowing how a Case is keyed.

    ``source_modified_at`` is parsed **without** ``errors="coerce"``, so an
    unparseable stamp raises here rather than becoming ``NaT``. Silver declares
    the column non-null and typed, so there is no honest way for one to arrive;
    coercing would sort the bad row *last* and hand it the Case, which is the
    same NA trap ``_NO_VERSION`` exists to avoid.
    """
    frame = dataset.to_pandas()
    parts = [_version_parts(value) for value in frame["source_version"]]
    ordered = frame.assign(
        _modified_at_utc=pd.to_datetime(
            frame["source_modified_at"], utc=True, format="ISO8601"
        ),
        _version_major=pd.Series(
            [major for major, _ in parts], index=frame.index, dtype="int64"
        ),
        _version_minor=pd.Series(
            [minor for _, minor in parts], index=frame.index, dtype="int64"
        ),
    ).sort_values(
        [
            CASE_ID_COLUMN,
            "_modified_at_utc",
            "_version_major",
            "_version_minor",
            "source_observation_id",
        ],
        kind="stable",
    )
    current = ordered.drop_duplicates(CASE_ID_COLUMN, keep="last").drop(
        columns=["_modified_at_utc", "_version_major", "_version_minor"]
    )
    return Dataset.from_pandas(current.reset_index(drop=True))


# --- the builders -----------------------------------------------------------


def case_current_builder(
    reader: Reader,
    writer: Writer,
    *,
    as_of: dt.datetime,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the current-state hop. **Grain: one row per ``case_id``.**

    Reads the whole silver history, derives the deterministic ``case_id`` from
    the list item id, reduces to the latest observation of each Case, stamps the
    run's ``as_of_utc``, and refreshes the table.

    ``UniqueValidator(CASE_ID_COLUMN)`` sits after the reduction, where it can
    never fire: ``drop_duplicates`` has just guaranteed what it checks. It is
    kept anyway as a **tripwire**: this grain is produced by a *rule* rather
    than by construction, so it is the one thing here a future change to that
    rule could get wrong.

    Every silver column is republished, including the ``answers`` /
    ``conversation`` / ``details`` JSON blobs. They are the Case as it stands and
    a consumer has nowhere else to read them; the cost is that a poll rewrites
    them all, which is the price of ``Refresh()`` and cheap at this list's size.
    """
    p = Pipeline(f"{FEED_NAME}:gold:{CURRENT_TABLE}", run_log=run_log)
    r = p.read(reader, name="read")
    keyed = p.transform(
        DeriveKey(
            into=CASE_ID_COLUMN,
            namespace=LIST_NAME,
            natural_key=["source_item_id"],
        ),
        r,
        name="derive-key",
    )
    latest = p.transform(latest_case_version, keyed, name="latest-version")
    stamped = p.transform(
        Stamp(AS_OF_COLUMN, as_of.isoformat()), latest, name="stamp-as-of"
    )
    validated = p.validate(
        UniqueValidator(CASE_ID_COLUMN), stamped, name="unique-validate"
    )
    p.write(writer, validated, name="write")
    return p


# --- publication ------------------------------------------------------------


# Every gold table, in publication order.
GOLD_TABLES = (CURRENT_TABLE,)


def _publish(pipeline: Pipeline, describe: bool) -> Dataset:
    """Print the hop's plan when asked, run it, and hand back what it produced."""
    if describe:
        print(pipeline.describe())
    return pipeline.run()


def publish_gold(
    med: Medallion,
    *,
    as_of: dt.datetime,
    describe: bool = False,
    run_log: RunLog | None = None,
) -> None:
    """Rebuild the gold tables from the accumulated silver history.

    ``case_current`` is reduced from the whole history, not from the batch a poll
    happened to fetch: a Case whose latest version arrived three polls ago is
    still current. It is refreshed rather than appended to, so a re-drive of the
    same window converges.

    Every hop runs as a bare ``p.run()``, exactly as the raw and silver hops
    above it do, and so inherits the **ambient** run context the runner makes
    active -- which is where a dry run's write-nothing behaviour comes from. No
    context is passed in here because none of these hops would read it.

    The first thing it does is ask whether silver has landed anything at all.
    Only one situation answers no: a **dry run against a fresh base directory**,
    where the silver write was previewed rather than performed, so there is no
    table to read. Previewing no gold steps there is honest -- there is nothing
    to reduce. A real run always creates the table, even for a quiet window, so
    this never fires in production. It is a *probe* and not a caught
    ``OperationalError``, which would also swallow "database is locked".
    """
    if med.silver.columns_of(SILVER_TABLE).columns() is None:
        return

    _publish(
        case_current_builder(
            med.silver.reader(SILVER_TABLE),
            med.gold.writer(CURRENT_TABLE, Refresh()),
            as_of=as_of,
            run_log=run_log,
        ),
        describe,
    )
