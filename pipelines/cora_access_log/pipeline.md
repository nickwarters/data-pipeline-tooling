```python
"""Ingest pipeline for the ``cora_access_log`` feed: source -> raw -> silver.

The list is append-only, so polling its ``Modified`` window picks up each new
entry once; the watermark is committed last, and only on a real run::

    python -m cli run pipelines/cora_access_log --base-dir BASE_DIR
    python -m pipelines.cora_access_log.pipeline --base-dir BASE_DIR --sample
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence
from uuid import UUID

import pandas as pd

from framework.core import (
    Dataset,
    ErrorCategory,
    PipelineError,
    Reader,
    Writer,
    format_failure,
)
from framework.io import AppendOnly, DatasetReader
from framework.run import RunContext, enforce, read, run_pipeline, transform, write
from framework.transform import Rename
from tools.environments import known_environments, resolve_base_dir
from tools.integrations.sharepoint_rest import (
    SharePointFeedError,
    SharePointListClient,
    SharePointModifiedReader,
    SharePointSource,
)
from tools.medallion import medallion
from tools.source_checkpoint import (
    InstantWindow,
    SourceCheckpointStore,
    instant_window,
)
from tools.store import StoreRegistry

from .schema import FEED_NAME, LIST_ID, LIST_NAME, SITE, AccessLogEntry

# A source feed depends on nothing upstream.
UPSTREAMS = ()

# Author is a Person column, expanded so it answers with a login and a name.
EXPAND_FIELDS = ("Author",)
SOURCE_COLUMNS = ("*", "Author/Name", "Author/Title")

# What raw stores, in the source's own names, plus the metadata the Reader stamps.
RAW_FEED_COLUMNS = (
    "Id",
    "Title",
    "TargetName",
    "AccessAction",
    "AccessRole",
    "CaseType",
    "Reason",
    "Changes",
    "Outcome",
    "RelatesTo",
    "Created",
    "Author/Name",
    "Author/Title",
    "source_list_name",
    "source_item_id",
    "source_modified_at",
    "source_version",
    "source_observation_id",
)

# Source name -> silver name; Title is the login of the person whose access changed.
RENAME = {
    "Id": "id",
    "Title": "target_login",
    "TargetName": "target_name",
    "AccessAction": "access_action",
    "AccessRole": "access_role",
    "CaseType": "case_type",
    "Reason": "reason",
    "Changes": "changes",
    "Outcome": "outcome",
    "RelatesTo": "relates_to",
    "Created": "created",
    "Author/Name": "author_name",
    "Author/Title": "author_title",
}

# How far each window reaches back over the last, and how far behind the server it ends.
OVERLAP = dt.timedelta(minutes=5)
SAFETY_LAG = dt.timedelta(seconds=30)

SAMPLE_PAGES = (Path(__file__).parent / "sample_data" / "access_log_page_1.json",)


@dataclass(frozen=True)
class AccessLogPoll:
    """What one poll of the Access Log fetched, and where it left the list."""

    window: InstantWindow
    ingestion_batch_id: str
    raw_rows: int
    silver_rows: int


class AccessLogClient(SharePointListClient, Protocol):
    """The fetch, plus the list server's own clock that bounds each window."""

    def server_time(self) -> dt.datetime: ...


class LocalJsonListClient:
    """A ``AccessLogClient`` replaying the bundled fixture page offline."""

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


def storable_observation(dataset: Dataset) -> Dataset:
    """Flatten the expanded author and narrow the read to the columns raw stores."""
    frame = dataset.to_pandas()
    if frame.empty:
        # A quiet window carries no columns to flatten, so declare raw's shape instead.
        return Dataset.from_pandas(
            frame.reindex(columns=list(RAW_FEED_COLUMNS)).astype("object")
        )
    if "Author" in frame.columns:
        authors = list(frame.pop("Author"))
        for subfield in ("Name", "Title"):
            frame[f"Author/{subfield}"] = [
                _author_subfield(a, subfield) for a in authors
            ]
    missing = [c for c in RAW_FEED_COLUMNS if c not in frame.columns]
    if missing:
        raise SharePointFeedError(
            f"SharePoint list {LIST_NAME!r} returned items without "
            f"{', '.join(missing)}: raw stores every projected and expanded column."
        )
    return Dataset.from_pandas(frame.loc[:, list(RAW_FEED_COLUMNS)])


def _author_subfield(value: object, subfield: str) -> object:
    """One sub-field of the expanded author, or ``None`` where the list has none."""
    return value.get(subfield) if isinstance(value, dict) else None


def blank_as_null(dataset: Dataset) -> Dataset:
    """Read the empty ``case_type`` and ``relates_to`` the platform writes as null."""
    frame = dataset.to_pandas()
    for column in ("case_type", "relates_to"):
        frame[column] = frame[column].map(
            lambda value: None if value is None or value == "" else value
        )
    return Dataset.from_pandas(frame)


def to_raw(reader: Reader, writer: Writer) -> Dataset:
    """Source -> raw: land each entry faithfully, in the list's own column names."""
    data = read(reader, name="raw:read")
    data = transform(storable_observation, data, name="raw:observation")
    return write(writer, data, name="raw:write")


def to_silver(
    reader: Reader, writer: Writer, reject_writer: Writer | None = None
) -> Dataset:
    """Raw -> silver: rename, null the blanks, enforce the schema."""
    data = read(reader, name="silver:read")
    data = transform(Rename(RENAME), data, name="silver:rename")
    data = transform(blank_as_null, data, name="silver:blanks")
    data = enforce(AccessLogEntry, data, reject_writer=reject_writer, name="silver")
    return write(writer, data, name="silver:write")


def run(
    context: RunContext,
    *,
    client: AccessLogClient | None = None,
    site: str = SITE,
    list_id: UUID = LIST_ID,
    list_name: str = LIST_NAME,
) -> AccessLogPoll | None:
    """Poll the Access Log source -> raw -> silver, then commit the watermark."""
    client = _resolve_client(client)
    med = medallion(StoreRegistry(context.base_dir), FEED_NAME)
    checkpoints = SourceCheckpointStore(context.base_dir)
    source = SharePointSource(site, list_id)
    committed = checkpoints.watermark(source.key)
    window = instant_window(
        committed,
        source_now=client.server_time(),
        overlap=OVERLAP,
        safety_lag=SAFETY_LAG,
    )
    if window is None:
        return None
    # Names the window resumed from, so re-driving a failed one mints the same id.
    batch_id = f"{list_id}:{committed.isoformat() if committed else 'first-load'}"

    batch = to_raw(
        SharePointModifiedReader(
            site,
            list_name,
            SOURCE_COLUMNS,
            window,
            expand_fields=EXPAND_FIELDS,
            client=client,
        ),
        med.raw.writer("access_log_entry", AppendOnly("source_observation_id")),
    )
    entries = to_silver(
        DatasetReader(batch),
        med.silver.writer("access_log_entry", AppendOnly("source_observation_id")),
        med.silver.quarantine_writer("access_log_entry"),
    )

    if not context.dry_run:
        checkpoints.commit(
            source.key,
            window.end,
            batch_id=batch_id,
            pipeline_run_id=context.pipeline_run_id,
        )
    return AccessLogPoll(window, batch_id, len(batch), len(entries))


class NoClientError(PipelineError):
    """The run reached the list with no client to reach it through."""

    category = ErrorCategory.CONFIG


def _resolve_client(client: AccessLogClient | None) -> AccessLogClient:
    """The client to poll with; there is no organisational one yet, so none refuses."""
    if client is None:
        raise NoClientError(
            "No SharePoint client was supplied, and there is no organisational "
            "one to fall back on yet. Wire one into _resolve_client, pass client= "
            "when calling run(), or run the module with --sample to replay the "
            "bundled fixture page offline."
        )
    return client


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.cora_access_log.pipeline",
        description="Poll the CORA Access Log source -> raw -> silver.",
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
        help="replay the bundled fixture page instead of reaching a tenant",
    )
    args = parser.parse_args(argv[1:])
    try:
        base_dir = Path(args.base_dir) if args.base_dir else resolve_base_dir(args.env)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    def handler(ctx: RunContext) -> AccessLogPoll | None:
        return run(ctx, client=LocalJsonListClient() if args.sample else None)

    try:
        poll = run_pipeline(handler, FEED_NAME, base_dir, upstreams=UPSTREAMS)
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1

    if poll is None:
        print("Nothing safe to poll yet; the watermark has not advanced.")
        return 0
    print(
        f"Polled {LIST_NAME} up to {poll.window.end.isoformat()} as batch "
        f"{poll.ingestion_batch_id}: {poll.raw_rows} entry observation(s) -> "
        f"{poll.silver_rows} access log entr(ies) under {base_dir / FEED_NAME}."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))

```
