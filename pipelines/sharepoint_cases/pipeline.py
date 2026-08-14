"""Ingest pipeline for the ``sharepoint_cases`` feed: source -> raw -> silver -> gold.

Every Case list in ``CASE_LISTS`` is polled by its own ``Modified`` window and
refined source -> raw -> silver, all into the same two tables; gold is then
published once, over every list's accumulated history.

- ``raw_builder``    lands the observation faithfully, in SharePoint's own
  column names, keyed on the observation id so a re-read is a no-op.
- ``silver_builder`` snake_cases those names, settles ``case_type`` to the
  polled list's declared one, coerces the types, quarantines value-rule
  breaches and validates ``CaseVersion``.
- ``silver_answer_builder`` explodes that same batch's ``answers`` JSON map
  into one row per observation x Question Definition, quarantining a bad value
  the same way while a malformed blob raises.
- ``gold.publish_gold`` rebuilds the current Case, the Detail Tables and three
  aggregates from the whole silver history, each with ``Refresh()``.

**Every watermark is committed last**, after gold has been written, because
advancing one is what vouches for its window having been *published*. A run that
fails anywhere above leaves them alone and the next run re-polls and converges.
Under a dry run nothing is committed: a hop's writes are previewed by the
ambient run context the runner makes active, and the checkpoint -- not a
pipeline step, so with no ambient skip to inherit -- is guarded explicitly.

Reaching the lists needs a client. ``run`` takes one so a test can hand it a
fake and ``--sample`` can hand it the bundled fixture pages; an unattended run
has none passed to it and asks ``_resolve_client`` for the organisation's, which
does not exist yet::

    python -m cli run pipelines/sharepoint_cases --base-dir BASE_DIR
    python -m pipelines.sharepoint_cases.pipeline --base-dir BASE_DIR --sample

Both run from the repo root so the import-only ``framework`` package resolves on
``sys.path``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Protocol, Sequence

import pandas as pd

from framework.core import (
    Dataset,
    ErrorCategory,
    PipelineError,
    Reader,
    SchemaValidator,
    Writer,
    format_failure,
)
from framework.io import AppendOnly, DatasetReader
from framework.run import Pipeline, RunContext, RunLog
from framework.transform import (
    ExplodeJsonMap,
    Rename,
    SchemaCoercion,
    SchemaValueRulePartitioner,
    Stamp,
)
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
from tools.store import StoreRegistry

from .gold import publish_gold
from .schema import (
    CASE_LISTS,
    DETAIL_ID_VARS,
    FEED_NAME,
    AnswerRow,
    CaseList,
    CaseVersion,
)

# Pipelines this feed depends on being fresh before it runs. A source feed has
# none.
UPSTREAMS = ()

# The five Person columns, expanded so each answers with the claims login rather
# than the numeric id it otherwise returns, and the sub-field of each the read
# asks for. Only the Responsible Party's display name is selected: it is the one
# of the five a view names a person by, and the rest are matched, never shown.
#
# Notification tested that premise and it held. Deciding who to notify means
# matching the author of a Conversation Message against these columns, which
# looks like it needs every display name landed -- but the fix belongs at the
# source, not here: a Message carries ``author.loginName`` (see the Message
# shape in ``platform_frontend``), so the match is login-to-login against the
# ``Name`` sub-field already selected. Matching on display names would be the
# wrong repair anyway -- they are neither unique nor stable, and the pair most
# likely to collide is a Responsible Party and their own Manager.
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

# The bundled fixture pages ``--sample`` replays, per list.
SAMPLE_PAGES = {
    "Cases-Complaints": (
        Path(__file__).parent / "sample_data" / "cases_page_1.json",
        Path(__file__).parent / "sample_data" / "cases_page_2.json",
    ),
}

_WORDS = re.compile(r"[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+")


def snake_case(name: str) -> str:
    """One SharePoint column name as its canonical silver name.

    Mechanical rather than curated -- ``ResponsibleParty/Title`` ->
    ``responsible_party_title`` -- because forty hand-written pairs would be
    forty chances to drift from the list. An already-snake_case name passes
    through unchanged, so the stamped provenance columns need no special case.
    """
    return "_".join(word.lower() for word in _WORDS.findall(name.replace("/", "_")))


# Source name -> canonical name, for every column raw stores.
RENAME = {column: snake_case(column) for column in RAW_FEED_COLUMNS}


@dataclass(frozen=True)
class ListPoll:
    """What one list's poll fetched, and where it left that list.

    The counts are rows of the *fetched batch* that reached each write. An
    append-only target no-ops a repeat, so polling the same window twice reports
    the same counts against an unchanged table.
    """

    case_list: CaseList
    window: ModifiedWindow
    ingestion_batch_id: str
    raw_rows: int
    silver_rows: int
    answer_rows: int


def _flatten_people(frame: pd.DataFrame, list_name: str) -> pd.DataFrame:
    """Spread each expanded person across the columns the rest of the feed reads.

    SharePoint answers an expanded lookup as a nested object on the property
    (``{"AssignedReviewer": {"Name": ...}}``) and a role nobody holds as a plain
    ``null`` there. A tabular carrier has nowhere to put a nested cell, so the
    nesting is undone here.

    A quiet window has no person column to flatten, so this is a no-op there.
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
                _person_subfield(value, person, subfield, item_id, list_name)
                for value, item_id in zip(people, item_ids)
            ]
    return flattened


def _person_subfield(
    value: object, person: str, subfield: str, item_id: object, list_name: str
) -> object:
    """One sub-field of one expanded person, or ``None`` where nobody holds it."""
    if isinstance(value, dict):
        # An expanded person always carries a claims login, so an object with no
        # ``Name`` was never expanded; reading it as an empty role would turn a
        # broken read into five roles nobody holds. A display name, by contrast,
        # is genuinely optional.
        if "Name" not in value:
            raise SharePointFeedError(
                f"SharePoint list {list_name!r}, item {item_id}: column {person!r} "
                "holds an object with no 'Name', so it was not expanded. Check the "
                "read still expands it."
            )
        return value.get(subfield)
    if value is None or value is pd.NA or (isinstance(value, float) and pd.isna(value)):
        return None
    raise SharePointFeedError(
        f"SharePoint list {list_name!r}, item {item_id}: column {person!r} holds "
        f"a {type(value).__name__} where an expanded person object or null was "
        "expected. A Person column is read expanded, so it answers with its "
        "sub-fields or with nothing."
    )


def storable_observation(dataset: Dataset, *, list_name: str) -> Dataset:
    """Narrow one SharePoint read to the observation raw stores.

    ``observed_at`` is dropped rather than stored: an append-only target
    compares every non-key column, so a per-read stamp would make each
    overlapping re-read of an unchanged item look like a contradiction.
    """
    frame = _flatten_people(dataset.to_pandas(), list_name)
    if frame.empty:
        # A quiet window brings back no columns at all, because this list is
        # read with ``$select=*``. Declare the shape raw stores rather than let
        # the hop below fail on an absence that means "nothing changed"; the
        # cast goes with it, since reindex types an invented column float.
        frame = frame.reindex(columns=list(RAW_FEED_COLUMNS)).astype("object")
    else:
        missing = [c for c in RAW_FEED_COLUMNS if c not in frame.columns]
        if missing:
            raise SharePointFeedError(
                f"SharePoint list {list_name!r} returned items without "
                f"{', '.join(missing)}: the observation raw stores needs "
                "every projected and expanded column."
            )
        frame = frame.loc[:, list(RAW_FEED_COLUMNS)]
    return Dataset.from_pandas(frame)


class CaseListClient(SharePointListClient, Protocol):
    """The fetch, plus the list server's own clock.

    This feed computes its own windows, and the list evaluates them, so a
    skewed local clock would silently widen or narrow them.
    """

    def server_time(self) -> dt.datetime: ...


class LocalJsonListClient:
    """A ``CaseListClient`` replaying the bundled fixture pages offline.

    The organisational client owns paging, so a list's pages are concatenated
    before they are returned. ``filters`` are ignored, so every read is a first
    load of the whole fixture list.
    """

    def __init__(self, pages: dict[str, Sequence[Path]] = SAMPLE_PAGES) -> None:
        self._pages = dict(pages)

    def fetch_items(
        self,
        list_name: str,
        expand_fields: Sequence[str],
        select_fields: Sequence[str],
        filters: Sequence[str],
    ) -> pd.DataFrame:
        if list_name not in self._pages:
            raise SharePointFeedError(
                f"No bundled sample pages for SharePoint list {list_name!r}. "
                f"Sample data exists for {', '.join(sorted(self._pages))}."
            )
        items: list[dict] = []
        for page in self._pages[list_name]:
            items.extend(json.loads(page.read_text(encoding="utf-8")))
        return pd.DataFrame(items)

    def server_time(self) -> dt.datetime:
        return dt.datetime.now(dt.timezone.utc)


def raw_builder(
    reader: Reader,
    writer: Writer,
    case_list: CaseList,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build one list's raw hop: flatten the people, keep the stored columns.

    No column gate, unlike a file feed: ``storable_observation`` projects the
    response onto exactly the columns raw stores and names any it could not
    find, so a presence check below it could never fire.
    """
    p = Pipeline(f"{FEED_NAME}:raw:{case_list.case_type}", run_log=run_log)
    node = p.read(reader, name="read")
    node = p.transform(
        partial(storable_observation, list_name=case_list.list_name),
        node,
        name="observation",
    )
    p.write(writer, node, name="write")
    return p


def silver_builder(
    reader: Reader,
    writer: Writer,
    case_list: CaseList,
    reject_writer: Writer | None = None,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build one list's silver hop: rename, settle the Case Type, coerce, validate.

    The list's own ``CaseType`` cell is nullable and hand-editable, and gold
    keys a Case on it, so silver replaces it with the Case Type declared for the
    list being polled. Raw keeps the cell as the list holds it.
    """
    p = Pipeline(f"{FEED_NAME}:silver:{case_list.case_type}", run_log=run_log)
    node = p.read(reader, name="read")
    node = p.transform(Rename(RENAME), node, name="rename")
    node = p.transform(Stamp("case_type", case_list.case_type), node, name="case-type")
    node = p.transform(SchemaCoercion(CaseVersion), node, name="coerce")
    if reject_writer is not None:
        node = p.quarantine(
            SchemaValueRulePartitioner(CaseVersion),
            reject_writer,
            node,
            name="quarantine",
        )
    node = p.validate(SchemaValidator(CaseVersion), node, name="post-validate")
    p.write(writer, node, name="write")
    return p


# A canonical, groupable rendering of a multi-select answer -- not display
# copy. An option label plausibly contains a comma, so that would be a poor
# separator; value_json stays the lossless representation for anything that
# needs the exact value back.
VALUE_TEXT_SEPARATOR = "|"


def derive_value_text(dataset: Dataset) -> Dataset:
    """Add ``value_text``, the canonical rendering of ``value_json``.

    ``_as_column_value`` (inside ``ExplodeJsonMap``) lands a scalar cell as
    itself and anything else -- a list, an object -- as JSON text, so this
    re-detects which happened rather than trusting the cell's own type: a cell
    is treated as a multi-select only when it is text starting with ``[`` that
    parses as a JSON list, and its elements are then stringified and joined on
    ``VALUE_TEXT_SEPARATOR``. Everything else is the cell **stringified**
    (``str(cell)``), not passed through -- a JSON ``true``/``3`` lands in
    ``value_json`` as a Python ``bool``/``int``, and passing it through would
    put ``True`` in the one column meant to be canonical text, which SQLite
    would then store as ``1``. Null in, null out.

    The column is created even on a zero-row frame, or ``SchemaCoercion`` has
    no column left to type on the empty-frame path.
    """
    frame = dataset.to_pandas()
    values = []
    for cell in frame["value_json"]:
        if pd.isna(cell):
            values.append(None)
            continue
        if isinstance(cell, str) and cell.startswith("["):
            try:
                decoded = json.loads(cell)
            except ValueError:
                decoded = None
            if isinstance(decoded, list):
                values.append(
                    VALUE_TEXT_SEPARATOR.join(str(element) for element in decoded)
                )
                continue
        values.append(str(cell))
    text = pd.Series(values, index=frame.index, dtype="object")
    frame = frame.assign(value_text=text)
    return Dataset.from_pandas(frame)


def silver_answer_builder(
    reader: Reader,
    writer: Writer,
    case_list: CaseList,
    reject_writer: Writer,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build one list's silver answer hop: explode ``answers`` into one row per
    question.

    Reads the **silver** batch this poll just settled, not raw: silver has
    already stamped the Case Type the run has decided on, and only silver's
    ``case_type`` mints the ``case_id`` gold's Detail Tables can semi-join
    against (see ``run``'s docstring for why raw would silently produce zero
    rows). It also means silver has already renamed the column to ``answers``,
    and a Case quarantined out of ``case_version`` contributes no answer rows
    at all -- which is right, since a quarantined Case can never win an
    observation.

    ``case_list`` names the hop and nothing else: it runs inside the per-list
    poll loop, alongside every other hop there, and the Case Type itself
    arrives already settled on the row.

    A malformed ``answers`` blob is a feed defect and **raises**
    (``JsonShapeError``); a well-formed but out-of-vocabulary value --
    e.g. an unrecognised ``remediation_status`` -- is an ordinary bad row and
    **quarantines**, exactly as ``silver_builder`` treats a bad ``status``.
    """
    p = Pipeline(f"{FEED_NAME}:silver:{case_list.case_type}:answer", run_log=run_log)
    node = p.read(reader, name="read")
    node = p.transform(
        ExplodeJsonMap(
            column="answers",
            key_into="question_id",
            id_vars=list(DETAIL_ID_VARS),
            exclude_key_prefix="general:",
            fields={
                "value": "value_json",
                "justification": "justification",
                "remediationRequired": "remediation_required",
                "freeFormRemediation": "free_form_remediation",
                "remediationStatus.status": "remediation_status",
                "remediationStatus.details": "remediation_status_details",
            },
        ),
        node,
        name="explode",
    )
    node = p.transform(derive_value_text, node, name="value-text")
    node = p.transform(SchemaCoercion(AnswerRow), node, name="coerce")
    node = p.quarantine(
        SchemaValueRulePartitioner(AnswerRow),
        reject_writer,
        node,
        name="quarantine",
    )
    node = p.validate(SchemaValidator(AnswerRow), node, name="post-validate")
    p.write(writer, node, name="write")
    return p


def run(
    context: RunContext,
    *,
    describe: bool = False,
    client: CaseListClient | None = None,
    case_lists: Sequence[CaseList] = CASE_LISTS,
) -> list[ListPoll]:
    """Poll every list, refine source -> raw -> silver -> gold, then commit.

    Returns one :class:`ListPoll` per list polled. A list polled again sooner
    than the safety lag has nothing safe to read and is skipped; when every list
    is skipped the result is empty and nothing is written.
    """
    client = _resolve_client(client)
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    checkpoints = SharePointCheckpointStore(context.base_dir)
    # The list evaluates the window's predicate, so the list's clock bounds it; a
    # skewed local one would silently widen or narrow every window. Read once, so
    # every list's window ends at the same instant.
    server_now = client.server_time()

    polls = []
    for case_list in case_lists:
        source = SharePointSource(case_list.site, case_list.list_id)
        watermark = checkpoints.committed_watermark(source)
        window = checkpoints.window(
            source, server_now=server_now, overlap=OVERLAP, safety_lag=SAFETY_LAG
        )
        if window is None:
            continue
        # Identifies the source window resumed from, not the run: a re-drive of
        # a failed window fetches the same batch and mints the same id.
        batch_id = (
            f"{case_list.list_id}:"
            f"{watermark.isoformat() if watermark else 'first-load'}"
        )

        raw_p = raw_builder(
            SharePointModifiedReader(
                case_list.site,
                case_list.list_name,
                SOURCE_COLUMNS,
                window,
                expand_fields=EXPAND_FIELDS,
                client=client,
            ),
            med.raw.writer("case_observation", AppendOnly("source_observation_id")),
            case_list,
            run_log=context.run_log,
        )
        if describe:
            print(raw_p.describe())
        batch = raw_p.run()

        # Silver normalises the batch just fetched, never the whole raw history.
        silver_p = silver_builder(
            DatasetReader(batch),
            med.silver.writer("case_version", AppendOnly("source_observation_id")),
            case_list,
            med.silver.quarantine_writer("case_version"),
            run_log=context.run_log,
        )
        if describe:
            print(silver_p.describe())
        versions = silver_p.run()

        # The answer hop reads this settled silver batch, not raw's own
        # CaseType cell -- see silver_answer_builder's docstring. One
        # observation yields many answer rows, so the append-only key is
        # composite: a single-column key would raise on the second question of
        # every Case.
        answer_p = silver_answer_builder(
            DatasetReader(versions),
            med.silver.writer(
                "answer", AppendOnly(("source_observation_id", "question_id"))
            ),
            case_list,
            med.silver.quarantine_writer("answer"),
            run_log=context.run_log,
        )
        if describe:
            print(answer_p.describe())
        answers = answer_p.run()
        polls.append(
            ListPoll(
                case_list,
                window,
                batch_id,
                len(batch),
                len(versions),
                len(answers),
            )
        )

    if not polls:
        return []

    # Gold is rebuilt from the whole accumulated history of every list, not from
    # the batches: a Case whose latest version arrived three polls ago is still
    # current. Every window shares an end -- ``window()`` derives it as
    # ``server_now - safety_lag``, independently of the source -- so any poll's
    # end is the instant this run publishes as of.
    publish_gold(
        med, as_of=polls[0].window.end, describe=describe, run_log=context.run_log
    )

    # Visibly last, and only on a real run. Advancing a watermark is what vouches
    # for its window having been *published*, so nothing above may be allowed to
    # fail silently: every hop either committed or raised before this line.
    if not context.dry_run:
        for poll in polls:
            checkpoints.commit(
                SharePointSource(poll.case_list.site, poll.case_list.list_id),
                window_end=poll.window.end,
                ingestion_batch_id=poll.ingestion_batch_id,
                pipeline_run_id=context.pipeline_run_id,
            )

    return polls


class NoClientError(PipelineError):
    """The run reached the list with no client to reach it through."""

    category = ErrorCategory.CONFIG


def _resolve_client(client: CaseListClient | None) -> CaseListClient:
    """The client to poll with; the one place to wire the organisational one in.

    There is none yet, so a run with nothing passed in refuses rather than
    pretend to have reached a tenant.
    """
    if client is None:
        raise NoClientError(
            "No SharePoint client was supplied, and there is no organisational "
            "one to fall back on yet. Wire one into _resolve_client (fetch_items"
            "(...) plus a server_time() returning the list server's clock), pass "
            "client= when calling run(), or run the module with --sample to "
            "replay the bundled fixture pages offline."
        )
    return client


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.sharepoint_cases.pipeline",
        description="Poll every Case list source -> raw -> silver -> gold.",
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

    def handler(ctx: RunContext) -> list[ListPoll]:
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
        polls = runner.run("", FEED_NAME, base_dir=base_dir)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    if not polls:
        print("Nothing safe to poll yet; no window has advanced.")
        return 0
    for poll in polls:
        print(
            f"Polled {poll.case_list.list_name} up to "
            f"{poll.window.end.isoformat()} as batch {poll.ingestion_batch_id}: "
            f"{poll.raw_rows} observation(s) -> {poll.silver_rows} case version(s), "
            f"{poll.answer_rows} answer row(s)."
        )
    print(
        f"{sum(poll.silver_rows for poll in polls)} case version(s) from "
        f"{len(polls)} list(s) under {base_dir / FEED_NAME}, gold rebuilt; "
        "every watermark advanced."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
