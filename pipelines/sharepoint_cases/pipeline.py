"""Ingest pipeline for the ``sharepoint_cases`` feed: source -> raw -> silver.

The feed polls one SharePoint Case list by its ``Modified`` window and lands what
it observes three times over:

- ``raw_builder``    lands the observation faithfully, in SharePoint's own
  column names, keyed on the observation id so a re-read is a no-op.
- ``silver_builder`` renames, coerces, quarantines and validates one row per
  observed Case version (``CaseVersion``).
- ``party_builder``  fans the list's one multi-value person column out to the
  ``case_party_version`` bridge, at one row per observation × party.

It deliberately **stops at silver**, and it deliberately does **not** commit the
polling watermark: the checkpoint vouches for rows having been published, and
gold publication is not this feed's to do.

Address it by its location on disk -- the framework imports
``pipelines.sharepoint_cases.pipeline`` and runs its ``run(context)`` callable::

    python -m cli run pipelines/sharepoint_cases --base-dir BASE_DIR

or run the module directly against the bundled fixture pages::

    python -m pipelines.sharepoint_cases.pipeline --base-dir BASE_DIR --sample

Both run from the repo root so the import-only ``framework`` package resolves on
``sys.path``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Protocol, Sequence, get_type_hints
from uuid import UUID

import pandas as pd

from framework.core import (
    Dataset,
    PipelineError,
    Reader,
    SchemaValidator,
    Writer,
    format_failure,
)
from framework.io import AppendOnly, DatasetReader
from framework.run import Pipeline, RunContext, RunLog
from framework.transform import SchemaCoercion, SelectColumns
from tools.environments import known_environments, resolve_base_dir
from tools.integrations.sharepoint_checkpoint import (
    SharePointCheckpointStore,
    SharePointSource,
)
from tools.integrations.sharepoint_rest import (
    ModifiedWindow,
    SharePointFeedError,
    SharePointListClient,
    SharePointModifiedReader,
)
from tools.medallion import medallion
from tools.recipes import raw_to_silver, source_to_raw
from tools.store import StoreRegistry

from .schema import CasePartyVersion, CaseVersion

FEED_NAME = "sharepoint_cases"

# Pipelines this feed depends on being fresh before it runs. A source feed has
# none.
UPSTREAMS = ()

# The list this feed polls. The title is what the Reader asks for and may be
# renamed; the GUID is what the watermark is keyed on and never changes.
SITE = "https://contoso.sharepoint.com/sites/case-review"
LIST_NAME = "Cases"
LIST_ID = UUID("1b6f2a3c-0000-4a1f-9c7e-5f2d8a4b1e01")

# What is asked of the list. The projection is stable on purpose: the Reader's
# fallback version digest covers the projected values, so widening this
# re-identifies every item once.
SOURCE_COLUMNS = (
    "CaseRef",
    "Status",
    "OpenedOn",
    "TargetCloseOn",
    "RiskScore",
    "OwnerId",
    "PartiesId",
)
EXPAND_FIELDS = ("Owner", "Parties")

# What raw stores: the source's own names, plus the observation metadata the
# Reader stamps. ``Id`` / ``Modified`` / ``odata.etag`` are dropped -- the
# stamped ``source_item_id`` / ``source_modified_at`` / ``source_version`` say
# the same thing in the vocabulary every hop below reads.
RAW_FEED_COLUMNS = (
    "CaseRef",
    "Status",
    "OpenedOn",
    "TargetCloseOn",
    "RiskScore",
    "OwnerId",
    "Owner/Title",
    "PartiesId",
    "Parties/Title",
    "source_list_name",
    "source_item_id",
    "source_modified_at",
    "source_version",
    "source_observation_id",
)

# The list's one multi-value person column, as its two halves: the lookup ids
# and their display titles, paired by position.
PARTY_ID_COLUMN = "PartiesId"
PARTY_TITLE_COLUMN = "Parties/Title"
MULTI_VALUE_COLUMNS = (PARTY_ID_COLUMN, PARTY_TITLE_COLUMN)

# Source columns whose names differ from the schema's fields, mapped to the
# canonical field names. raw keeps the source names faithfully; silver renames.
RENAME = {
    "CaseRef": "case_ref",
    "Status": "status",
    "OpenedOn": "opened_on",
    "TargetCloseOn": "target_close_on",
    "RiskScore": "risk_score",
    "OwnerId": "owner_user_id",
    "Owner/Title": "owner_display_name",
}

# What the silver hop reads, in source names. The multi-value columns are at the
# wrong grain for a Case row, so they are dropped before the hop rather than
# renamed into a schema that has nowhere to put them.
SILVER_SOURCE_COLUMNS = (
    *RENAME,
    "source_observation_id",
    "source_list_name",
    "source_item_id",
    "source_modified_at",
    "source_version",
)


def _integer_columns_in_source_names() -> tuple[str, ...]:
    """The silver schema's ``int`` fields, named as the source names them.

    Derived rather than listed: the cast this feeds has to stay in step with
    ``CaseVersion`` *through* ``RENAME``, and a hand-kept parallel list is a
    second place to forget. ``get_type_hints`` without ``include_extras``
    resolves ``Annotated[int, ...]`` down to the ``int`` being asked about.
    """
    to_source = {canonical: source for source, canonical in RENAME.items()}
    hints = get_type_hints(CaseVersion)
    return tuple(
        to_source.get(field.name, field.name)
        for field in fields(CaseVersion)
        if hints[field.name] is int
    )


# The silver schema's integer columns, in source names: a zero-row batch has no
# rows to type them and ``SchemaCoercion`` does not reach ``int``.
SILVER_INTEGER_COLUMNS = _integer_columns_in_source_names()

# How far back each window reaches over the last one, and how far behind
# SharePoint's clock its upper bound is held.
OVERLAP = dt.timedelta(minutes=5)
SAFETY_LAG = dt.timedelta(seconds=30)

SAMPLE_PAGES = (
    Path(__file__).parent / "sample_data" / "cases_page_1.json",
    Path(__file__).parent / "sample_data" / "cases_page_2.json",
)


@dataclass(frozen=True)
class SharePointIngestResult:
    """What one poll fetched, and where it left the list.

    The counts are rows of the *fetched batch* that reached each write. An
    append-only target no-ops a repeat, so polling the same window twice reports
    the same counts against an unchanged table.
    """

    window: ModifiedWindow
    ingestion_batch_id: str
    raw_rows: int
    silver_rows: int
    party_rows: int


def batch_id_for(source: SharePointSource, watermark: dt.datetime | None) -> str:
    """Identify the source window this poll resumes from.

    Not the run id: a run that failed part-way re-polls the same window, and the
    batch it fetches the second time is the same batch. Keying on where the poll
    resumed from makes a re-drive mint the same id, which is what the checkpoint
    store's opaque, caller-owned ``ingestion_batch_id`` is for. The list GUID
    alone identifies the source, so no site or credential travels with it.
    """
    return f"{source.list_id}:{watermark.isoformat() if watermark else 'first-load'}"


def _encode_multi_value(frame: pd.DataFrame, columns: Sequence[str]) -> pd.DataFrame:
    """Render each multi-value cell as compact JSON text.

    A list cell cannot be bound by ``sqlite3``, so raw stores the multi-value
    field as the compact JSON its own values spell out. ASCII-escaped and
    separator-fixed so the same cell encodes to the same bytes on every machine
    -- raw is compared whole by the append-only load, and a re-encoding that
    drifted would read as a changed row.

    This is also the **one** place the source's several spellings of a
    multi-value cell become one, so the bridge that decodes it can assume what it
    actually relies on: a JSON array of single values, which is enforced here
    element by element rather than discovered three steps later.
    """
    encoded = frame.copy()
    if not columns:
        return encoded
    item_ids = list(encoded["source_item_id"])
    for column in columns:
        encoded[column] = [
            _as_json_text(value, column, item_id)
            for value, item_id in zip(encoded[column], item_ids)
        ]
    return encoded


def _as_json_text(value: object, column: str, item_id: object) -> str:
    try:
        return json.dumps(
            _multi_value_list(value, column, item_id),
            ensure_ascii=True,
            separators=(",", ":"),
            # NaN is not JSON. Python would happily emit the bare token ``NaN``,
            # which no strict parser downstream accepts -- so a cell carrying one
            # fails here rather than landing unreadable text in raw.
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise SharePointFeedError(
            f"SharePoint list {LIST_NAME!r}, item {item_id}: column {column!r} "
            f"holds a value that cannot be stored as JSON ({exc})."
        ) from None


def _multi_value_list(value: object, column: str, item_id: object) -> list:
    """One multi-value cell as the single list shape this feed stores.

    A REST client hands a multi-value lookup back in more than one spelling: as
    a plain list, as OData's verbose ``{"results": [...]}`` envelope, or -- when
    the cell holds exactly one value -- flattened to the bare value. All three
    say the same thing, so all three normalise here rather than each reader
    downstream having to know the difference.
    """
    if isinstance(value, dict):
        value = value.get("results", value)
    if isinstance(value, (list, tuple)):
        return [_multi_value_element(v, column, item_id) for v in value]
    if value is None or _is_missing(value):
        return []
    return [_multi_value_element(value, column, item_id)]


def _multi_value_element(value: object, column: str, item_id: object) -> object:
    """One value out of a multi-value cell, as something JSON can hold.

    The bridge reads these back as an id and a display name, one per party, so an
    element has to be a *single value*. OData's verbose mode -- the same mode that
    wraps a cell in a results envelope -- can also hand each element back as a
    person **object**; that is a shape this feed has not been shown, and it is
    refused here rather than stored as JSON the bridge then dies on.
    """
    if not pd.api.types.is_scalar(value):
        raise SharePointFeedError(
            f"SharePoint list {LIST_NAME!r}, item {item_id}: column {column!r} "
            f"holds a {type(value).__name__} where a single value was expected. "
            "This feed reads a multi-value cell as a list of ids or of titles, "
            "not of objects."
        )
    # ``.item()`` unwraps a numpy scalar to the Python one ``json`` can encode.
    # A typed column yields these whether the cell was flattened or a list.
    return value.item() if hasattr(value, "item") else value


def _is_missing(value: object) -> bool:
    """Whether pandas calls this value null; one it cannot judge is not null."""
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


class StorableObservations:
    """Narrow one SharePoint read to the observation raw stores.

    A Reader decorator: it forwards what the wrapped Reader reports touching and
    renders its plan line, so wrapping costs the plan nothing. ``observed_at`` is
    dropped here rather than stored -- an append-only target compares every
    non-key column, so a per-read stamp would make each overlapping re-read of an
    unchanged item look like a contradiction.
    """

    def __init__(
        self,
        inner: Reader,
        columns: Sequence[str],
        multi_value_columns: Sequence[str] = (),
    ) -> None:
        self._inner = inner
        self._columns = list(columns)
        self._multi_value_columns = tuple(multi_value_columns)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._inner.data_locations

    def describe(self) -> str:
        return self._inner.describe()

    def read(self) -> Dataset:
        frame = self._inner.read().to_pandas()
        if frame.empty:
            # A quiet window comes back as the *declared* projection: the columns
            # the client adds by expanding a lookup were never asked for by name,
            # so they cannot be there. Reindexing declares the shape raw stores
            # rather than leaving the hop below to fail on an absence that means
            # "nothing changed". The cast goes with it: reindex fills a column it
            # had to invent with NaN and so types it float, and raw's columns are
            # text.
            frame = frame.reindex(columns=self._columns).astype("object")
        else:
            missing = [c for c in self._columns if c not in frame.columns]
            if missing:
                raise SharePointFeedError(
                    f"SharePoint list {LIST_NAME!r} returned items without "
                    f"{', '.join(missing)}: the observation raw stores needs "
                    "every projected and expanded column."
                )
            frame = frame.loc[:, self._columns]
        return Dataset.from_pandas(
            _encode_multi_value(frame, self._multi_value_columns)
        )


class ExplodeParties:
    """Fan one observation's multi-value person cell out to one row per party.

    The two halves of the field pair **positionally** -- SharePoint returns the
    lookup ids and their titles as parallel lists -- so lengths that disagree are
    a broken pairing rather than a row to guess at.
    """

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        observation_ids: list[str] = []
        item_ids: list[str] = []
        modified: list[str] = []
        user_ids: list[int] = []
        display_names: list[object] = []
        positions: list[int] = []
        for _, row in frame.iterrows():
            party_ids = json.loads(row[PARTY_ID_COLUMN])
            titles = json.loads(row[PARTY_TITLE_COLUMN])
            if len(party_ids) != len(titles):
                raise SharePointFeedError(
                    f"SharePoint list {LIST_NAME!r}, item "
                    f"{row['source_item_id']}: {PARTY_ID_COLUMN} holds "
                    f"{len(party_ids)} value(s) but {PARTY_TITLE_COLUMN} holds "
                    f"{len(titles)}; a multi-value person field pairs its ids "
                    "and titles by position."
                )
            for position, (party_id, title) in enumerate(zip(party_ids, titles)):
                observation_ids.append(row["source_observation_id"])
                item_ids.append(row["source_item_id"])
                modified.append(row["source_modified_at"])
                user_ids.append(party_id)
                display_names.append(title)
                positions.append(position)
        # Built column by column with declared dtypes: a list with no parties at
        # all still has to present the integer columns the bridge's schema gate
        # checks, and an empty object column is not an integer one.
        return Dataset.from_pandas(
            pd.DataFrame(
                {
                    "source_observation_id": pd.Series(observation_ids, dtype="object"),
                    "source_item_id": pd.Series(item_ids, dtype="object"),
                    "source_modified_at": pd.Series(modified, dtype="object"),
                    "party_user_id": pd.Series(user_ids, dtype="int64"),
                    "party_display_name": pd.Series(display_names, dtype="object"),
                    "party_position": pd.Series(positions, dtype="int64"),
                }
            )
        )


class CaseListClient(SharePointListClient, Protocol):
    """What this feed needs of the organisational SharePoint client.

    ``SharePointListClient`` declares the fetch alone, because there the window
    is the caller's to supply. This feed *computes* the window, so it needs the
    list server's own clock as well: the bounds are a predicate the list
    evaluates, and a skewed local clock would silently widen or narrow them.

    Stated here rather than upstream because it is this feed's requirement, not
    the Reader's — and stated as an extension, so the fetch is declared once.
    """

    def server_time(self) -> dt.datetime: ...


class LocalJsonListClient:
    """A ``CaseListClient`` replaying the bundled fixture pages offline.

    The organisational client owns paging, so the pages are concatenated before
    they are returned. ``filters`` are ignored, which makes every read of this
    client a first load of the whole fixture list.
    """

    def __init__(self, pages: Sequence[Path] = SAMPLE_PAGES) -> None:
        self._pages = tuple(pages)

    def fetch_items(
        self,
        list_name: str,
        expand_fields: Sequence[str],
        select_fields: Sequence[str],
        filters: Sequence[str],
    ) -> pd.DataFrame:
        items: list[dict] = []
        for page in self._pages:
            items.extend(json.loads(page.read_text(encoding="utf-8")))
        return pd.DataFrame(items)

    def server_time(self) -> dt.datetime:
        return dt.datetime.now(dt.timezone.utc)


def raw_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the raw hop: faithful landing zone.

    The standard raw hop, composed from the shared recipe. To diverge, inline
    the recipe's body here and edit it: a recipe is composition, not
    inheritance, so there is nothing to fight.

    Composed **without** the recipe's ``expected_columns`` gate, unlike a file
    feed. This source is read through ``StorableObservations``, which projects
    the response onto exactly the columns raw stores and names any it could not
    find; a presence check downstream of that projection is satisfied by
    construction and could never fire. One gate, and it is the live one.
    """
    return source_to_raw(
        reader,
        writer,
        name=f"{FEED_NAME}:raw",
        run_log=run_log,
    )


def silver_builder(
    reader: Reader,
    writer: Writer,
    reject_writer: Writer | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the silver hop: schema coercion and enforcement + quarantine.

    The standard silver hop, composed from the shared recipe; inline it here to
    diverge.
    """
    return raw_to_silver(
        reader,
        writer,
        schema=CaseVersion,
        rename=RENAME,
        reject_writer=reject_writer,
        name=f"{FEED_NAME}:silver",
        run_log=run_log,
    )


def party_builder(
    reader: Reader,
    writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the bridge hop: one row per observation × party.

    Hand-composed rather than a recipe: this hop changes the grain, which is the
    one thing the standard raw/silver hops do not do. It is a pure function of
    the raw observation -- the bridge is keyed on the observation and holds no
    reference into ``case_version``, so a Case row quarantined for an unrelated
    value rule does not take its parties with it.
    """
    p = Pipeline(f"{FEED_NAME}:parties", run_log=run_log)
    node = p.read(reader, name="read")
    node = p.transform(ExplodeParties(), node, name="explode")
    node = p.transform(SchemaCoercion(CasePartyVersion), node, name="coerce")
    node = p.validate(SchemaValidator(CasePartyVersion), node, name="post-validate")
    p.write(writer, node, name="write")
    return p


def run(
    context: RunContext,
    *,
    describe: bool = False,
    client: CaseListClient | None = None,
) -> SharePointIngestResult | None:
    """Poll the list once and refine what it returned source -> raw -> silver.

    Returns ``None`` when there is nothing safe to poll yet -- a run repeated
    sooner than the safety lag, which is ordinary operation rather than a
    failure.
    """
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    source = SharePointSource(SITE, LIST_ID)
    checkpoints = SharePointCheckpointStore(context.base_dir)

    watermark = checkpoints.committed_watermark(source)
    window = checkpoints.window(
        source,
        server_now=_server_time(client),
        overlap=OVERLAP,
        safety_lag=SAFETY_LAG,
    )
    if window is None:
        return None
    batch_id = batch_id_for(source, watermark)

    raw_p = raw_builder(
        reader=StorableObservations(
            SharePointModifiedReader(
                SITE,
                LIST_NAME,
                SOURCE_COLUMNS,
                window,
                expand_fields=EXPAND_FIELDS,
                client=client,
            ),
            RAW_FEED_COLUMNS,
            MULTI_VALUE_COLUMNS,
        ),
        writer=med.raw.writer("case_observation", AppendOnly("source_observation_id")),
        run_log=context.run_log,
    )
    if describe:
        print(raw_p.describe())
    batch = raw_p.run()

    # Both hops below normalise the batch just fetched, never the whole raw
    # history. The projection they read is applied here rather than as a step,
    # so it shows up in neither plan nor run log -- the recipe owns the hop's
    # shape, and reshaping its input is the caller's side of that bargain.
    silver_p = silver_builder(
        reader=DatasetReader(_silver_source(batch)),
        writer=med.silver.writer("case_version", AppendOnly("source_observation_id")),
        reject_writer=med.silver.quarantine_writer("case_version"),
        run_log=context.run_log,
    )
    if describe:
        print(silver_p.describe())
    silver_rows = len(silver_p.run())

    party_p = party_builder(
        reader=DatasetReader(batch),
        writer=med.silver.writer(
            "case_party_version",
            # Keyed on the position as well as the observation: the same person
            # may legitimately appear twice in one cell, and keying on the
            # person would read that as a contradiction.
            AppendOnly(("source_observation_id", "party_position")),
        ),
        run_log=context.run_log,
    )
    if describe:
        print(party_p.describe())
    party_rows = len(party_p.run())

    # --- gold is yours to assemble ------------------------------------------
    # How these accumulated versions become gold is still open: a Case Type may
    # want the version that was current at a point in time copied forward, or
    # the current row joined live to its parties and to other feeds. The two
    # answers differ in what a later correction does to yesterday's report, so
    # the choice is per-Case-Type and the seam is left commented.
    # ------------------------------------------------------------------------
    return SharePointIngestResult(
        window=window,
        ingestion_batch_id=batch_id,
        raw_rows=len(batch),
        silver_rows=silver_rows,
        party_rows=party_rows,
    )


def _silver_source(batch: Dataset) -> Dataset:
    """The batch narrowed to what a Case row is made of, typed even when empty.

    The multi-value columns are at the wrong grain for a Case row, so they are
    dropped rather than renamed into a schema with nowhere to put them.

    The cast is for the quiet window. ``SchemaCoercion`` repairs only the types a
    storage round-trip loses -- dates and booleans -- and leaves ``int`` alone,
    so a zero-row batch reaches the silver gate with its integer columns still
    object-typed and no row to give them a type. Casting them here is what lets a
    quiet poll run the same three hops, and emit the same run-log steps, as a
    busy one. Only when empty: casting a populated batch would hide a genuine
    dtype breach the gate exists to catch.
    """
    frame = SelectColumns(SILVER_SOURCE_COLUMNS)(batch).to_pandas()
    if frame.empty:
        frame = frame.astype(dict.fromkeys(SILVER_INTEGER_COLUMNS, "int64"))
    return Dataset.from_pandas(frame)


def _server_time(client: CaseListClient | None) -> dt.datetime:
    """SharePoint's own clock, never this box's.

    The window bounds a predicate the *list* evaluates, so a skewed local clock
    would silently widen or narrow it. There is no local fallback for that
    reason.
    """
    if client is None:
        raise NotImplementedError(
            "No SharePoint client was supplied: pass client=<the organisational "
            "client> (fetch_items(...) plus a server_time() returning the list "
            "server's clock), or --sample to replay the bundled fixture pages "
            "offline."
        )
    return client.server_time()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.sharepoint_cases.pipeline",
        description="Poll the SharePoint Cases list source -> raw -> silver.",
    )
    parser.add_argument(
        "--base-dir",
        dest="base_dir",
        default=None,
        help="medallion root directory; omit to resolve it from --env",
    )
    parser.add_argument(
        "--env",
        help="named environment to resolve base_dir from when no --base-dir is "
        f"given ({', '.join(known_environments())}); defaults to $PIPELINE_ENV or dev",
    )
    parser.add_argument(
        "--describe",
        action="store_true",
        help="print each pipeline's plan before running it",
    )
    parser.add_argument(
        "--sample",
        action="store_true",
        help="replay the bundled fixture pages instead of reaching a tenant",
    )
    args = parser.parse_args(argv[1:])
    # An explicit path wins; otherwise resolve base_dir from the named environment.
    try:
        base_dir = Path(args.base_dir) if args.base_dir else resolve_base_dir(args.env)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    from framework.run import PipelineRunner

    def handler(ctx: RunContext) -> SharePointIngestResult | None:
        return run(
            ctx,
            describe=args.describe,
            client=LocalJsonListClient() if args.sample else None,
        )

    runner = PipelineRunner()
    runner.register(
        subject="",
        pipeline=FEED_NAME,
        handler=handler,
        freshness=UPSTREAMS,
    )

    try:
        result = runner.run("", FEED_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    if result is None:
        print("Nothing safe to poll yet; the window has not advanced.")
        return 0
    print(
        f"Polled {LIST_NAME} up to {result.window.end.isoformat()} as batch "
        f"{result.ingestion_batch_id}: {result.raw_rows} observation(s) -> "
        f"{result.silver_rows} case version(s) + {result.party_rows} party row(s) "
        f"under {base_dir / FEED_NAME}. The watermark was not committed."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
