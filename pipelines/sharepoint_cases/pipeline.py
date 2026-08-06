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
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence
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


class EncodeMultiValueColumns:
    """Render a multi-value cell as JSON text.

    A list cell cannot be bound by ``sqlite3``, so raw stores the multi-value
    field as the compact JSON its own values spell out. ASCII-escaped and
    separator-fixed so the same cell encodes to the same bytes on every machine
    -- raw is compared whole by the append-only load, and a re-encoding that
    drifted would read as a changed row.
    """

    def __init__(self, columns: Sequence[str]) -> None:
        self._columns = tuple(columns)

    def __call__(self, dataset: Dataset) -> Dataset:
        frame = dataset.to_pandas()
        for column in self._columns:
            frame[column] = [_as_json_text(value) for value in frame[column]]
        return Dataset.from_pandas(frame)


def _as_json_text(value: object) -> str:
    if isinstance(value, (list, tuple)):
        return json.dumps(list(value), ensure_ascii=True, separators=(",", ":"))
    return "[]" if value is None or bool(pd.isna(value)) else str(value)


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
        self._encode = EncodeMultiValueColumns(multi_value_columns)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return getattr(self._inner, "data_locations", [])

    def describe(self) -> str:
        return self._inner.describe()

    def read(self) -> Dataset:
        frame = self._inner.read().to_pandas()
        # A quiet window comes back as the declared projection only: the columns
        # the *client* adds by expanding a lookup were never asked for by name,
        # so they cannot be there to select. A populated read missing one is a
        # broken promise and says so, rather than manufacturing the very column
        # the raw hop's gate is about to check.
        if frame.empty:
            return self._encode(
                Dataset.from_pandas(frame.reindex(columns=self._columns))
            )
        missing = [c for c in self._columns if c not in frame.columns]
        if missing:
            raise SharePointFeedError(
                f"SharePoint list {LIST_NAME!r} returned items without "
                f"{', '.join(missing)}: the observation raw stores needs every "
                "projected and expanded column."
            )
        return self._encode(Dataset.from_pandas(frame.loc[:, self._columns]))


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


class LocalJsonListClient:
    """A ``SharePointListClient`` replaying the bundled fixture pages offline.

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
    """
    return source_to_raw(
        reader,
        writer,
        expected_columns=list(RAW_FEED_COLUMNS),
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
    client: SharePointListClient | None = None,
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

    silver_rows = 0
    party_rows = 0
    # Both hops below normalise the batch just fetched, never the whole raw
    # history. A quiet window leaves nothing to normalise -- and an empty batch
    # carries none of the dtypes the schema gates check, since only rows give a
    # column its type -- so the two hops are skipped rather than asked to
    # validate a shape that is not there yet.
    if len(batch) > 0:
        silver_p = silver_builder(
            reader=DatasetReader(SelectColumns(SILVER_SOURCE_COLUMNS)(batch)),
            writer=med.silver.writer(
                "case_version", AppendOnly("source_observation_id")
            ),
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
                # Keyed on the position as well as the observation: the same
                # person may legitimately appear twice in one cell, and keying
                # on the person would read that as a contradiction.
                AppendOnly(("source_observation_id", "party_position")),
            ),
            run_log=context.run_log,
        )
        if describe:
            print(party_p.describe())
        party_rows = len(party_p.run())

    # The watermark is deliberately not committed here. Advancing it vouches for
    # the rows having been published, and publication is the gold step's to do.

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


def _server_time(client: SharePointListClient | None) -> dt.datetime:
    """SharePoint's own clock, never this box's.

    The window bounds a predicate the *list* evaluates, so a skewed local clock
    would silently widen or narrow it. There is no local fallback for that
    reason.
    """
    server_time = getattr(client, "server_time", None)
    if server_time is None:
        raise NotImplementedError(
            "No SharePoint client was supplied: pass client=<the organisational "
            "client> (anything with fetch_items(...) and a server_time() "
            "returning the list server's clock), or --sample to replay the "
            "bundled fixture pages offline."
        )
    return server_time()


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
