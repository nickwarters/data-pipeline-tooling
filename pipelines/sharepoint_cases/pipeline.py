"""Ingest pipeline for the ``sharepoint_cases`` feed: source -> raw -> silver.

The feed polls one Case Type's SharePoint list by its ``Modified`` window and
lands what it observes twice:

- ``raw_builder``    lands the observation faithfully, in SharePoint's own
  column names, keyed on the observation id so a re-read is a no-op.
- ``silver_builder`` snake_cases those names, coerces the types, quarantines
  value-rule breaches and validates ``CaseVersion``.

There is no third hop and very little in the second: this feed's job is to get
the list's rows into the database as immutable versions, not to interpret them.

It deliberately **stops at silver**, and it deliberately does **not** commit the
polling watermark: the checkpoint vouches for rows having been published, and
gold publication is not this feed's to do.

Run the module directly, from the repo root so the import-only ``framework``
package resolves on ``sys.path``::

    python -m pipelines.sharepoint_cases.pipeline --base-dir BASE_DIR --sample

Unlike a file-sourced feed, this one cannot be addressed by its location on disk:
reaching a tenant needs a client passed in, and the path-addressed route calls
``run(context)`` with nothing else to give it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence
from uuid import UUID

import pandas as pd

from framework.core import Dataset, PipelineError, Reader, Writer, format_failure
from framework.io import AppendOnly, DatasetReader
from framework.run import Pipeline, RunContext, RunLog
from framework.transform import SelectColumns
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

from .schema import CaseVersion

FEED_NAME = "sharepoint_cases"

# Pipelines this feed depends on being fresh before it runs. A source feed has
# none.
UPSTREAMS = ()

# PLACEHOLDER -- both must be filled in from the tenant before this feed can
# reach a real list. The review application derives its site from the page it is
# served from and addresses lists by title, so neither value exists anywhere to
# copy: the site is whichever site collection holds the Case lists, and the GUID
# comes from the list's own settings page. The watermark is keyed on the GUID, so
# a wrong one silently forks the feed's place rather than failing.
SITE = "https://sharepoint.invalid/sites/REPLACE-ME"
LIST_ID = UUID(int=0)

# One list per Case Type, named ``Cases-{slug}``; there is no combined list and
# no default. Only Complaints is live, so this feed names it directly rather
# than growing a per-Case-Type indirection for a second type that may never come.
# A UAT tenant prefixes the same list ``uat_``.
LIST_NAME = "Cases-Complaints"

# The five Person columns, expanded so each answers with the claims login rather
# than the numeric id it otherwise returns, and the sub-field of each the read
# asks for. Only the Responsible Party's display name is selected: it is the one
# of the five a view names a person by, and the rest are matched, never shown.
PERSON_SUBFIELDS = {
    "AssignedReviewer": ("Name",),
    "ResponsibleParty": ("Name", "Title"),
    "AssignedReviewerManager": ("Name",),
    "ResponsiblePartyManager": ("Name",),
    "VoidedBy": ("Name",),
}
EXPAND_FIELDS = tuple(PERSON_SUBFIELDS)

# What is asked of the list. The ``*`` is load-bearing: naming a person's
# sub-field turns the read into a projection, and without it every other column
# silently stops coming back. The slash form is OData ``$select`` syntax -- it
# says which sub-field to bring back, not what the response is shaped like.
SOURCE_COLUMNS = (
    "*",
    *(
        f"{person}/{subfield}"
        for person, subfields in PERSON_SUBFIELDS.items()
        for subfield in subfields
    ),
)

# What raw stores: every documented column of the list, in the source's own
# names, plus the observation metadata the Reader stamps. ``Modified`` and
# ``odata.etag`` are dropped -- the stamped ``source_modified_at`` /
# ``source_version`` say the same thing in the vocabulary every hop below reads.
RAW_FEED_COLUMNS = (
    "Id",
    "Title",
    "CaseType",
    "Status",
    "AssignedReviewer/Name",
    "AssignedAt",
    "ResponsibleParty/Name",
    "ResponsibleParty/Title",
    "AssignedReviewerManager/Name",
    "ResponsiblePartyManager/Name",
    "DueDate",
    "CompletedAt",
    "ReportableAt",
    "RemediationDueDate",
    "RelatedDate",
    "Created",
    "HasOpenAppeal",
    "AppealRaisedAt",
    "AwaitingResponsibleParty",
    "AwaitingSince",
    "ReviewRequired",
    "OnHold",
    "PlacedOnHoldAt",
    "VoidedAt",
    "VoidReason",
    "VoidedBy/Name",
    "Outcome",
    "OutcomeAtCompletion",
    "HadRemediation",
    "EffectiveOutcome",
    "EffectiveHadRemediation",
    "OutcomeOverridden",
    "QuestionBankVersion",
    "CaseJustification",
    "Notes",
    "Answers",
    "Conversation",
    "Appeals",
    "AmendedOutcome",
    "Details",
    "source_list_name",
    "source_item_id",
    "source_modified_at",
    "source_version",
    "source_observation_id",
)

# How far back each window reaches over the last one, and how far behind
# SharePoint's clock its upper bound is held.
OVERLAP = dt.timedelta(minutes=5)
SAFETY_LAG = dt.timedelta(seconds=30)

SAMPLE_PAGES = (
    Path(__file__).parent / "sample_data" / "cases_page_1.json",
    Path(__file__).parent / "sample_data" / "cases_page_2.json",
)

_WORDS = re.compile(r"[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+")


def snake_case(name: str) -> str:
    """One SharePoint column name as its canonical silver name.

    Mechanical rather than curated: ``DueDate`` -> ``due_date``,
    ``AssignedReviewerId`` -> ``assigned_reviewer_id``, and an expanded
    sub-field's ``/`` reads as another word boundary
    (``ResponsibleParty/Title`` -> ``responsible_party_title``). A map of
    forty hand-written pairs would be forty chances to drift from the list.
    Already-snake_case names pass through unchanged, so the stamped provenance
    columns need no special case.
    """
    return "_".join(word.lower() for word in _WORDS.findall(name.replace("/", "_")))


# Source name -> canonical name, for every column raw stores.
RENAME = {column: snake_case(column) for column in RAW_FEED_COLUMNS}


# A zero-row batch has no rows to type these and ``SchemaCoercion`` repairs only
# what a storage round-trip loses -- dates and booleans -- so it does not reach
# ``int``. In source names, because the cast lands before the rename.
SILVER_INTEGER_COLUMNS = ("Id",)


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


def batch_id_for(source: SharePointSource, watermark: dt.datetime | None) -> str:
    """Identify the source window this poll resumes from.

    Not the run id: a run that failed part-way re-polls the same window, and the
    batch it fetches the second time is the same batch. Keying on where the poll
    resumed from makes a re-drive mint the same id, which is what the checkpoint
    store's opaque, caller-owned ``ingestion_batch_id`` is for. The list GUID
    alone identifies the source, so no site or credential travels with it.
    """
    return f"{source.list_id}:{watermark.isoformat() if watermark else 'first-load'}"


def _flatten_people(frame: pd.DataFrame) -> pd.DataFrame:
    """Spread each expanded person across the columns the rest of the feed reads.

    SharePoint answers an expanded lookup as a **nested object on the property**
    -- ``{"AssignedReviewer": {"Name": ...}}`` -- and a role nobody holds as a
    plain ``null`` there, not as an object of null members. The slash form the
    read asks with is ``$select`` syntax for *which sub-field to bring back*, and
    says nothing about the response's shape.

    A tabular carrier has nowhere to put a nested cell, so the nesting is undone
    here, at the edge that already owns the read's shape. The feed owns this
    rather than the client because it is the feed that decided to store a person
    as columns; a client would otherwise have to know that, undocumented.

    A quiet window has no person column to flatten -- the Reader declares the
    projection's own names, which are already the flat ones -- so this is a no-op
    there and the reindex below handles the rest.

    Consumes ``frame``: the caller's copy is spent, not preserved.
    """
    if not any(person in frame.columns for person in PERSON_SUBFIELDS):
        return frame
    flattened = frame
    item_ids = list(flattened["source_item_id"])
    for person, subfields in PERSON_SUBFIELDS.items():
        if person not in flattened.columns:
            continue
        people = list(flattened.pop(person))
        for subfield in subfields:
            flattened[f"{person}/{subfield}"] = [
                _person_subfield(value, person, subfield, item_id)
                for value, item_id in zip(people, item_ids)
            ]
    return flattened


def _person_subfield(
    value: object, person: str, subfield: str, item_id: object
) -> object:
    """One sub-field of one expanded person, or ``None`` where nobody holds it."""
    if isinstance(value, dict):
        # An unexpanded lookup still answers with an object, so accepting any
        # object would read a broken $expand as an empty role rather than as the
        # failure it is. Identity is the tell: an expanded person always carries
        # ``Name``, whereas a display name is genuinely optional.
        if "Name" not in value:
            raise SharePointFeedError(
                f"SharePoint list {LIST_NAME!r}, item {item_id}: column {person!r} "
                "holds an object with no 'Name', so it was not expanded. Check the "
                "read still expands it."
            )
        return value.get(subfield)
    if value is None or value is pd.NA or (isinstance(value, float) and pd.isna(value)):
        return None
    raise SharePointFeedError(
        f"SharePoint list {LIST_NAME!r}, item {item_id}: column {person!r} holds "
        f"a {type(value).__name__} where an expanded person object or null was "
        "expected. A Person column is read expanded, so it answers with its "
        "sub-fields or with nothing."
    )


class StorableObservations:
    """Narrow one SharePoint read to the observation raw stores.

    A Reader decorator: it forwards what the wrapped Reader reports touching and
    renders its plan line, so wrapping costs the plan nothing. ``observed_at`` is
    dropped here rather than stored -- an append-only target compares every
    non-key column, so a per-read stamp would make each overlapping re-read of an
    unchanged item look like a contradiction.
    """

    def __init__(self, inner: Reader, columns: Sequence[str]) -> None:
        self._inner = inner
        self._columns = list(columns)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._inner.data_locations

    def describe(self) -> str:
        return self._inner.describe()

    def read(self) -> Dataset:
        frame = _flatten_people(self._inner.read().to_pandas())
        if frame.empty:
            # A quiet window comes back as the *declared* projection, and this
            # list is read with ``$select=*`` -- so almost every column arrives
            # because the client expanded the star, and none of them can be
            # there when there are no rows. Reindexing declares the shape raw
            # stores rather than leaving the hop below to fail on an absence that
            # means "nothing changed". The cast goes with it: reindex fills a
            # column it had to invent with NaN and so types it float, and raw's
            # columns are text.
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
        return Dataset.from_pandas(frame)


class CaseListClient(SharePointListClient, Protocol):
    """What this feed needs of the organisational SharePoint client.

    ``SharePointListClient`` declares the fetch alone, because there the window
    is the caller's to supply. This feed *computes* the window, so it needs the
    list server's own clock as well: the bounds are a predicate the list
    evaluates, and a skewed local clock would silently widen or narrow them.

    Stated here rather than upstream because it is this feed's requirement, not
    the Reader's -- and stated as an extension, so the fetch is declared once.

    A client returns the items **as SharePoint returned them**, and owes the feed
    no reshaping: an expanded person arrives as the nested
    ``{"AssignedReviewer": {"Name": ...}}`` object the API answers with, or null
    where nobody holds the role. Flattening that onto columns is the feed's own
    doing (:func:`_flatten_people`), because it is the feed that decided to store
    a person as columns.
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
    """Build the silver hop: rename, coerce, quarantine, validate.

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
        ),
        writer=med.raw.writer("case_observation", AppendOnly("source_observation_id")),
        run_log=context.run_log,
    )
    if describe:
        print(raw_p.describe())
    batch = raw_p.run()

    # Silver normalises the batch just fetched, never the whole raw history. The
    # projection it reads is applied here rather than as a step, so it shows up
    # in neither plan nor run log -- the recipe owns the hop's shape, and
    # reshaping its input is the caller's side of that bargain.
    silver_p = silver_builder(
        reader=DatasetReader(_silver_source(batch)),
        writer=med.silver.writer("case_version", AppendOnly("source_observation_id")),
        reject_writer=med.silver.quarantine_writer("case_version"),
        run_log=context.run_log,
    )
    if describe:
        print(silver_p.describe())
    silver_rows = len(silver_p.run())

    # --- gold is yours to assemble ------------------------------------------
    # How these accumulated versions become gold is still open: a Case Type may
    # want the version that was current at a point in time copied forward, or
    # the current row joined live to other feeds. The two answers differ in what
    # a later correction does to yesterday's report, so the choice is
    # per-Case-Type and the seam is left commented.
    # ------------------------------------------------------------------------
    return SharePointIngestResult(
        window=window,
        ingestion_batch_id=batch_id,
        raw_rows=len(batch),
        silver_rows=silver_rows,
    )


def _silver_source(batch: Dataset) -> Dataset:
    """The batch narrowed to the columns silver declares, typed even when empty.

    The cast is for the quiet window. ``SchemaCoercion`` repairs only the types a
    storage round-trip loses -- dates and booleans -- and leaves ``int`` alone,
    so a zero-row batch reaches the silver gate with its integer columns still
    object-typed and no row to give them a type. Casting them here is what lets a
    quiet poll run the same hops, and emit the same run-log steps, as a busy one.
    Only when empty: casting a populated batch would hide a genuine dtype breach
    the gate exists to catch.
    """
    frame = SelectColumns(tuple(RENAME))(batch).to_pandas()
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
        description=f"Poll the {LIST_NAME} list source -> raw -> silver.",
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
    except NotImplementedError as exc:
        # Running with no client at all is an operator forgetting one, not a
        # bug: the message says what to pass, so it is worth more than a stack.
        print(str(exc), file=sys.stderr)
        return 1

    if result is None:
        print("Nothing safe to poll yet; the window has not advanced.")
        return 0
    print(
        f"Polled {LIST_NAME} up to {result.window.end.isoformat()} as batch "
        f"{result.ingestion_batch_id}: {result.raw_rows} observation(s) -> "
        f"{result.silver_rows} case version(s) under {base_dir / FEED_NAME}. "
        "The watermark was not committed."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
