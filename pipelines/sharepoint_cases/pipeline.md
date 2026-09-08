```python
"""Ingest pipeline for the ``sharepoint_cases`` feed: source -> raw -> silver -> gold.

Every Case list in ``CASE_LISTS`` is polled by its own ``Modified`` window and
refined source -> raw -> silver, all into the same two tables; gold is then
published once, over every list's accumulated history.

- ``to_raw``    lands the observation faithfully, in SharePoint's own
  column names, keyed on the observation id so a re-read is a no-op.
- ``to_silver`` snake_cases those names, settles ``case_type`` to the
  polled list's declared one, then ``enforce``s ``CaseVersion`` -- coerce,
  quarantine value-rule breaches, validate, in that order.
- The seven ``to_silver_*`` Detail Table steps (``answer``,
  ``answer_capture``, ``answer_action``, ``general_answer``,
  ``conversation_message``, ``appeal``, ``case_detail``) each explode one
  blob -- or one level further into one -- of that same silver batch into
  one row per child structure; see each builder's own docstring.
- ``gold.publish_gold`` rebuilds the current Case, the Detail Tables and six
  aggregates from the whole silver history, each with ``Refresh()`` -- four
  reduced from ``case_current``, and two from a Detail Table.

**Every watermark is committed last**, after gold has been written, because
advancing one is what vouches for its window having been *published*. A run that
fails anywhere above leaves them alone and the next run re-polls and converges.
Under a dry run nothing is committed: a step's writes are previewed by the
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

# Repeated per-list and per-detail steps prefix names so the run log identifies
# their source.

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Mapping, Protocol, Sequence

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
from framework.run import (
    RunContext,
    enforce,
    quarantine,
    read,
    run_pipeline,
    transform,
    validate,
    write,
)
from framework.transform import (
    DropColumns,
    ExplodeJsonList,
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
    PERSON_VALUE_KIND,
    TEXT_VALUE_KIND,
    UNSUPPORTED_CAPTURE_VALUE_KIND,
    AnswerActionRow,
    AnswerCaptureRow,
    AnswerRow,
    AppealRow,
    CaseDetailRow,
    CaseList,
    CaseVersion,
    ConversationMessageRow,
    GeneralAnswerRow,
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
# ``Name`` sub-field already selected -- which is the *claims* spelling, so the
# consumer normalises both sides before matching. Matching on display names would be the
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
# ``source_version`` say the same thing in the vocabulary every step below reads.
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
    "VoidReasonNote",
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

    ``detail_rows`` is keyed by table name rather than one field per table:
    every Detail Table this feed grows next only adds an entry here, not a new
    field every reader of ``ListPoll`` has to learn about.
    """

    case_list: CaseList
    window: ModifiedWindow
    ingestion_batch_id: str
    raw_rows: int
    silver_rows: int
    detail_rows: Mapping[str, int]


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
        # the step below fail on an absence that means "nothing changed"; the
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


def to_raw(reader: Reader, writer: Writer, case_list: CaseList) -> Dataset:
    """One list's source -> raw: flatten the people, keep the stored columns.

    No column gate, unlike a file feed: ``storable_observation`` projects the
    response onto exactly the columns raw stores and names any it could not
    find, so a presence check below it could never fire.

    Every step name is prefixed with the list being polled, so a run log that
    holds one of these per list still says which list each ``read`` was.
    """
    at = f"raw:{case_list.case_type}"
    data = read(reader, name=f"{at}:read")
    data = transform(
        partial(storable_observation, list_name=case_list.list_name),
        data,
        name=f"{at}:observation",
    )
    return write(writer, data, name=f"{at}:write")


def to_silver(
    reader: Reader,
    writer: Writer,
    case_list: CaseList,
    reject_writer: Writer | None = None,
) -> Dataset:
    """One list's raw -> silver: rename, settle the Case Type, enforce the schema.

    The list's own ``CaseType`` cell is nullable and hand-editable, and gold
    keys a Case on it, so silver replaces it with the Case Type declared for the
    list being polled. Raw keeps the cell as the list holds it.

    ``enforce`` is the coerce -> quarantine -> validate sequence in the order
    that makes it correct; given no ``reject_writer`` it is coerce -> validate.
    """
    at = f"silver:{case_list.case_type}"
    data = read(reader, name=f"{at}:read")
    data = transform(Rename(RENAME), data, name=f"{at}:rename")
    data = transform(
        Stamp("case_type", case_list.case_type), data, name=f"{at}:case-type"
    )
    data = enforce(CaseVersion, data, reject_writer=reject_writer, name=at)
    return write(writer, data, name=f"{at}:write")


# A canonical, groupable rendering of a multi-select answer -- not display
# copy. An option label plausibly contains a comma, so that would be a poor
# separator; value_json stays the lossless representation for anything that
# needs the exact value back.
VALUE_TEXT_SEPARATOR = "|"


def derive_value_text(dataset: Dataset) -> Dataset:
    """Add ``value_text``, the canonical rendering of ``value_json``.

    A cell is treated as a multi-select only when it is JSON-list-shaped
    text; its elements are stringified and joined on
    ``VALUE_TEXT_SEPARATOR``. Everything else is ``str(cell)`` -- not passed
    through, since a JSON ``true``/``3`` would otherwise land here as
    Python's ``True``/``3``. Null in, null out.
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


def encode_detail_value(dataset: Dataset) -> Dataset:
    """Add ``value_text``, a faithful text rendering of the exploded ``details``
    value: a JSON string lands as itself, everything else as its JSON
    encoding -- see the data dictionary's Part B/D.

    ``str`` passthrough also stops the dict/list arm (already JSON-encoded by
    ``ExplodeJsonMap``) from being double-encoded.
    """
    frame = dataset.to_pandas()
    values = []
    for cell in frame["value_text"]:
        if pd.isna(cell):
            values.append(None)
        elif isinstance(cell, str):
            values.append(cell)
        else:
            values.append(json.dumps(cell))
    text = pd.Series(values, index=frame.index, dtype="object")
    frame = frame.assign(value_text=text)
    return Dataset.from_pandas(frame)


def discriminate_capture_value(dataset: Dataset) -> Dataset:
    """Add ``value_kind`` / ``value_text`` / ``person_login`` / ``person_display``,
    discriminating one Issue Capture field's ``raw_value`` into ``text``,
    ``person`` or ``unsupported`` -- see the data dictionary for the arms.

    Must be **total**: ``value_kind`` is never null. A value rule masks on
    ``notna()``, so a null ``value_kind`` would slip past quarantine and then
    abort the whole run at ``SchemaValidator``'s ``NonNull`` check.
    """
    frame = dataset.to_pandas()
    kinds, texts, logins, displays = [], [], [], []
    for cell in frame["raw_value"]:
        kind = UNSUPPORTED_CAPTURE_VALUE_KIND
        text = login = display = None
        if pd.isna(cell):
            pass
        elif isinstance(cell, str):
            try:
                decoded = json.loads(cell)
                parses = True
            except ValueError:
                decoded = None
                parses = False
            if parses and isinstance(decoded, dict):
                login_value = decoded.get("loginName")
                display_value = decoded.get("displayName")
                if login_value and display_value:
                    kind = PERSON_VALUE_KIND
                    login, display = login_value, display_value
                # else: a half-filled person -- stays unsupported.
            elif parses and isinstance(decoded, list):
                pass  # the legacy Action[] arm -- stays unsupported.
            else:
                kind = TEXT_VALUE_KIND
                text = cell
        # else: a non-text scalar (a raw JSON number or boolean) -- stays
        # unsupported; this feed's capture values are never one.
        kinds.append(kind)
        texts.append(text)
        logins.append(login)
        displays.append(display)
    frame = frame.assign(
        value_kind=pd.Series(kinds, index=frame.index, dtype="object"),
        value_text=pd.Series(texts, index=frame.index, dtype="object"),
        person_login=pd.Series(logins, index=frame.index, dtype="object"),
        person_display=pd.Series(displays, index=frame.index, dtype="object"),
    )
    return Dataset.from_pandas(frame)


def to_silver_answer(
    reader: Reader, writer: Writer, case_list: CaseList, reject_writer: Writer
) -> Dataset:
    """One list's answer table: explode ``answers`` into one row per question.

    Reads the settled **silver** batch, not raw: raw's ``CaseType`` cell is
    nullable and hand-editable, so an answer row built over it could mint a
    different ``case_id`` than the parent Case's, and the gold semi-join
    would then silently land zero rows. A malformed ``answers`` blob is a
    feed defect and **raises** (``JsonShapeError``); a well-formed but
    out-of-vocabulary value **quarantines**, exactly as ``to_silver``
    treats a bad ``status``.
    """
    at = f"silver:{case_list.case_type}:answer"
    data = read(reader, name=f"{at}:read")
    data = transform(
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
        data,
        name=f"{at}:explode",
    )
    data = transform(derive_value_text, data, name=f"{at}:value-text")
    data = enforce(AnswerRow, data, reject_writer=reject_writer, name=at)
    return write(writer, data, name=f"{at}:write")


def to_silver_answer_capture(
    reader: Reader, writer: Writer, case_list: CaseList, reject_writer: Writer
) -> Dataset:
    """One list's answer-capture table: explode ``answers`` and then each
    answer's flat ``capture`` map, one row per Issue Capture Field.

    Two chained ``ExplodeJsonMap`` passes reach the second level -- see the
    data dictionary for the mechanism. Reads silver, not raw, as
    ``to_silver_answer``.

    The one that writes coerce/quarantine/validate out rather than calling
    ``enforce``: a column has to be dropped *between* the quarantine and the
    validate, so the three cannot be collapsed.
    """
    at = f"silver:{case_list.case_type}:answer_capture"
    data = read(reader, name=f"{at}:read")
    data = transform(
        ExplodeJsonMap(
            column="answers",
            key_into="question_id",
            id_vars=list(DETAIL_ID_VARS),
            exclude_key_prefix="general:",
            fields={"capture": "capture_json"},
        ),
        data,
        name=f"{at}:explode-answers",
    )
    data = transform(
        ExplodeJsonMap(
            column="capture_json",
            key_into="field_key",
            id_vars=[*DETAIL_ID_VARS, "question_id"],
            value_into="raw_value",
        ),
        data,
        name=f"{at}:explode-capture",
    )
    data = transform(discriminate_capture_value, data, name=f"{at}:discriminate")
    data = transform(SchemaCoercion(AnswerCaptureRow), data, name=f"{at}:coerce")
    data = quarantine(
        SchemaValueRulePartitioner(AnswerCaptureRow),
        reject_writer,
        data,
        name=f"{at}:quarantine",
    )
    # Dropped after quarantine, not before, so the reject table still keeps
    # the offending raw_value for diagnosis.
    data = transform(DropColumns(["raw_value"]), data, name=f"{at}:drop-raw-value")
    validate(SchemaValidator(AnswerCaptureRow), data, name=f"{at}:schema_validator")
    return write(writer, data, name=f"{at}:write")


def to_silver_answer_action(
    reader: Reader, writer: Writer, case_list: CaseList, reject_writer: Writer
) -> Dataset:
    """One list's answer-action table: explode ``answers`` and then each
    answer's ``remediationActions`` list, one row per ticked action.

    ``{id, text}`` is the real frontend contract for one action -- a third
    ``completed`` field some docs describe is stale there, not here.
    """
    at = f"silver:{case_list.case_type}:answer_action"
    data = read(reader, name=f"{at}:read")
    data = transform(
        ExplodeJsonMap(
            column="answers",
            key_into="question_id",
            id_vars=list(DETAIL_ID_VARS),
            exclude_key_prefix="general:",
            fields={"remediationActions": "actions_json"},
        ),
        data,
        name=f"{at}:explode-answers",
    )
    data = transform(
        ExplodeJsonList(
            column="actions_json",
            ordinal_into="action_seq",
            id_vars=[*DETAIL_ID_VARS, "question_id"],
            fields={"id": "action_id", "text": "action_text"},
        ),
        data,
        name=f"{at}:explode-actions",
    )
    data = enforce(AnswerActionRow, data, reject_writer=reject_writer, name=at)
    return write(writer, data, name=f"{at}:write")


def to_silver_general_answer(
    reader: Reader, writer: Writer, case_list: CaseList, reject_writer: Writer
) -> Dataset:
    """One list's general-answer table: explode ``answers`` into one row per
    General Question catalogue key.

    Reads silver, not raw, as ``to_silver_answer``. No value rule on
    ``GeneralAnswerRow`` can fire today, but the quarantine step stays wired
    anyway: ``SchemaValueRulePartitioner`` is schema-derived and ``quarantine``
    writes only when rejects exist, so a future rule needs no rewiring and this
    one costs nothing on disk.
    """
    at = f"silver:{case_list.case_type}:general_answer"
    data = read(reader, name=f"{at}:read")
    data = transform(
        ExplodeJsonMap(
            column="answers",
            key_into="general_key",
            id_vars=list(DETAIL_ID_VARS),
            include_key_prefix="general:",
            strip_key_prefix=True,
            fields={"value": "value_json"},
        ),
        data,
        name=f"{at}:explode",
    )
    data = transform(derive_value_text, data, name=f"{at}:value-text")
    data = enforce(GeneralAnswerRow, data, reject_writer=reject_writer, name=at)
    return write(writer, data, name=f"{at}:write")


def to_silver_conversation_message(
    reader: Reader, writer: Writer, case_list: CaseList, reject_writer: Writer
) -> Dataset:
    """One list's conversation-message table: explode ``conversation`` into
    one row per message.

    ``conversation`` is a JSON list, so one ``ExplodeJsonList`` reaches every
    field -- no second level to chain. Reads silver, not raw, as
    ``to_silver_answer``; quarantine stays wired anyway, as
    ``to_silver_general_answer``.
    """
    at = f"silver:{case_list.case_type}:conversation_message"
    data = read(reader, name=f"{at}:read")
    data = transform(
        ExplodeJsonList(
            column="conversation",
            ordinal_into="seq",
            id_vars=list(DETAIL_ID_VARS),
            fields={
                "author.loginName": "author_login",
                "author.displayName": "author_display_name",
                "timestamp": "posted_at",
                "body": "body",
            },
        ),
        data,
        name=f"{at}:explode",
    )
    data = enforce(ConversationMessageRow, data, reject_writer=reject_writer, name=at)
    return write(writer, data, name=f"{at}:write")


def to_silver_appeal(
    reader: Reader, writer: Writer, case_list: CaseList, reject_writer: Writer
) -> Dataset:
    """One list's appeal table: explode ``appeals`` into one row per Appeal,
    with its 1:1 ``resolution`` lifted onto the same row via dotted paths,
    exactly as ``to_silver_answer`` lifts ``remediationStatus``'s.

    Reads silver, not raw, as ``to_silver_answer``. A malformed blob
    **raises**; an out-of-vocabulary ``state`` **quarantines**.
    """
    at = f"silver:{case_list.case_type}:appeal"
    data = read(reader, name=f"{at}:read")
    data = transform(
        ExplodeJsonList(
            column="appeals",
            ordinal_into="appeal_seq",
            id_vars=list(DETAIL_ID_VARS),
            fields={
                "id": "appeal_id",
                "appellant": "appellant",
                "at": "raised_at",
                "rationale": "rationale",
                "state": "state",
                "citedAnswerKeys": "cited_question_ids_json",
                "resolution.verdict": "resolution_verdict",
                "resolution.rationale": "resolution_rationale",
                "resolution.resolver": "resolution_resolver",
                "resolution.at": "resolution_at",
            },
        ),
        data,
        name=f"{at}:explode",
    )
    data = enforce(AppealRow, data, reject_writer=reject_writer, name=at)
    return write(writer, data, name=f"{at}:write")


def to_silver_case_detail(
    reader: Reader, writer: Writer, case_list: CaseList, reject_writer: Writer
) -> Dataset:
    """One list's case-detail table: explode ``details`` into one row per
    Case Details field.

    Reads silver, not raw, as ``to_silver_answer``. A malformed blob
    **raises**; an off-contract value is encoded to text rather than
    quarantined -- see the data dictionary. Quarantine stays wired anyway, as
    ``to_silver_general_answer``.
    """
    at = f"silver:{case_list.case_type}:case_detail"
    data = read(reader, name=f"{at}:read")
    data = transform(
        ExplodeJsonMap(
            column="details",
            key_into="field_key",
            id_vars=list(DETAIL_ID_VARS),
            value_into="value_text",
        ),
        data,
        name=f"{at}:explode",
    )
    data = transform(encode_detail_value, data, name=f"{at}:encode-value")
    data = enforce(CaseDetailRow, data, reject_writer=reject_writer, name=at)
    return write(writer, data, name=f"{at}:write")


# Every Detail Table this feed publishes, in the order run() drives them: the
# table name, the function that produces it (every one sharing
# to_silver_answer's (reader, writer, case_list, reject_writer) shape), and the
# composite AppendOnly key its grain needs -- one observation
# yields many rows of each, so a single-column key would raise on the second.
# Named generically rather than "answer" -- conversation_message and appeal
# explode a different blob entirely, not answers.
_DETAIL_TABLES = (
    ("answer", to_silver_answer, ("source_observation_id", "question_id")),
    (
        "answer_capture",
        to_silver_answer_capture,
        ("source_observation_id", "question_id", "field_key"),
    ),
    (
        "answer_action",
        to_silver_answer_action,
        ("source_observation_id", "question_id", "action_id"),
    ),
    (
        "general_answer",
        to_silver_general_answer,
        ("source_observation_id", "general_key"),
    ),
    (
        "conversation_message",
        to_silver_conversation_message,
        ("source_observation_id", "seq"),
    ),
    ("appeal", to_silver_appeal, ("source_observation_id", "appeal_id")),
    (
        "case_detail",
        to_silver_case_detail,
        ("source_observation_id", "field_key"),
    ),
)


def run(
    context: RunContext,
    *,
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

        batch = to_raw(
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
        )

        # Silver normalises the batch just fetched, never the whole raw history --
        # which is simply the dataset ``to_raw`` just handed back.
        versions = to_silver(
            DatasetReader(batch),
            med.silver.writer("case_version", AppendOnly("source_observation_id")),
            case_list,
            med.silver.quarantine_writer("case_version"),
        )

        # Detail builders consume the settled silver batch, not raw.
        detail_rows: dict[str, int] = {}
        for table, to_silver_detail, key_columns in _DETAIL_TABLES:
            detail_rows[table] = len(
                to_silver_detail(
                    DatasetReader(versions),
                    med.silver.writer(table, AppendOnly(key_columns)),
                    case_list,
                    med.silver.quarantine_writer(table),
                )
            )
        polls.append(
            ListPoll(
                case_list,
                window,
                batch_id,
                len(batch),
                len(versions),
                detail_rows,
            )
        )

    if not polls:
        return []

    # Gold is rebuilt from the whole accumulated history of every list, not from
    # the batches: a Case whose latest version arrived three polls ago is still
    # current. Every window shares an end -- ``window()`` derives it as
    # ``server_now - safety_lag``, independently of the source -- so any poll's
    # end is the instant this run publishes as of.
    publish_gold(med, as_of=polls[0].window.end)

    # Visibly last, and only on a real run. Advancing a watermark is what vouches
    # for its window having been *published*, so nothing above may be allowed to
    # fail silently: every step either committed or raised before this line.
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

    def handler(ctx: RunContext) -> list[ListPoll]:
        return run(ctx, client=LocalJsonListClient() if args.sample else None)

    # Use run_pipeline so direct and CLI runs share identity; dry-run holds back
    # commits and watermarks.
    try:
        polls = run_pipeline(handler, FEED_NAME, base_dir, upstreams=UPSTREAMS)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    if not polls:
        print("Nothing safe to poll yet; no window has advanced.")
        return 0
    for poll in polls:
        # Derived from detail_rows rather than one field per table, so a new
        # Detail Table this feed grows shows up here with no edit to main().
        detail_summary = ", ".join(
            f"{count} {table} row(s)" for table, count in poll.detail_rows.items()
        )
        print(
            f"Polled {poll.case_list.list_name} up to "
            f"{poll.window.end.isoformat()} as batch {poll.ingestion_batch_id}: "
            f"{poll.raw_rows} observation(s) -> {poll.silver_rows} case version(s), "
            f"{detail_summary}."
        )
    print(
        f"{sum(poll.silver_rows for poll in polls)} case version(s) from "
        f"{len(polls)} list(s) under {base_dir / FEED_NAME}, gold rebuilt; "
        "every watermark advanced."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))

```
