"""Entry point for the Forwarder's delivery loop.

Each tick works through the tasks declared in the config file. A
``create_sharepoint_items`` task creates SharePoint list items from the queued
files matching its pattern, ``update_sharepoint_items`` amends existing ones,
and ``copy_file_to_sharepoint`` puts the files themselves into a destination
folder. Whichever it is, the file is set aside afterwards. Both clients are
Windows-only and live outside this repository, so the defaults raise and tests
pass doubles.
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePath
from typing import Any, Protocol, runtime_checkable

from forwarder.config import (
    COPY_FILE_TO_SHAREPOINT,
    CREATE_SHAREPOINT_ITEMS,
    UPDATE_SHAREPOINT_ITEMS,
    Config,
    CopyMethod,
    Task,
)
from shared.constants import PROCESSED_DIR_NAME, QUEUE_DIR_NAME

DEFAULT_TICK_MINUTES = 5

MINIMUM_TICK_MINUTES = 1

SECONDS_PER_MINUTE = 60

# How long a file must have been still before it is taken to be finished.
DEFAULT_QUIET_SECONDS = 120

SITE_URL = "https://example.sharepoint.com/sites/case-review"

BASE_DIR = Path(__file__).parent

QUEUE_DIR = BASE_DIR / QUEUE_DIR_NAME

PROCESSED_DIR = BASE_DIR / PROCESSED_DIR_NAME

CONFIG_FILE = BASE_DIR / "config.yaml"

# Marks a file holding the items a previous tick could not deliver, stamped with
# when it was written. UTC, so the names sort chronologically and no hour ever
# repeats itself at the end of summer time.
RETRY_MARKER = ".retry_"

RETRY_TIMESTAMP_FORMAT = "%Y%m%d%H%M%S"

# The actions a tick knows how to perform. A task naming anything else is
# skipped, and its files stay in the queue.
DELIVERABLE_ACTIONS = (
    CREATE_SHAREPOINT_ITEMS,
    UPDATE_SHAREPOINT_ITEMS,
    COPY_FILE_TO_SHAREPOINT,
)

# The SharePoint client lives outside this repository. Its result type is named
# here so the seam's signature matches the real one; nothing reads its shape.
HttpResult = Any

logger = logging.getLogger(__name__)


@runtime_checkable
class ListItemClient(Protocol):
    """The SharePoint list-write seam: create or update items in one list."""

    def create_list_item(
        self,
        list_name: str,
        fields: dict[str, Any],
        raise_on_error: bool = True,
    ) -> HttpResult:
        """Create an item carrying ``fields`` in ``list_name``."""
        ...

    def update_list_item(
        self,
        list_name: str,
        item_id: int,
        fields: dict[str, Any],
        raise_on_error: bool = True,
    ) -> HttpResult:
        """Update item ``item_id`` in ``list_name``, setting only ``fields``."""
        ...


class StubbedListItemClient:
    """The default list client: raises until a real SharePoint client is supplied."""

    def create_list_item(
        self,
        list_name: str,
        fields: dict[str, Any],
        raise_on_error: bool = True,
    ) -> HttpResult:
        raise self._not_wired_up()

    def update_list_item(
        self,
        list_name: str,
        item_id: int,
        fields: dict[str, Any],
        raise_on_error: bool = True,
    ) -> HttpResult:
        raise self._not_wired_up()

    @staticmethod
    def _not_wired_up() -> NotImplementedError:
        return NotImplementedError(
            "The SharePoint list client is not wired up yet. Pass a list client "
            "to run(), e.g. a test double, to exercise the loop."
        )


def build_list_item_client(site_url: str) -> ListItemClient:
    """Build the list client the loop writes through, for the site at ``site_url``."""
    return StubbedListItemClient()


@runtime_checkable
class FileHandlerClient(Protocol):
    """The SharePoint file seam: put one queued file into a destination folder."""

    def copy_or_move_items_to_sharepoint(
        self,
        src_dir: str,
        file_name: str,
        destination_dir: str,
        method: CopyMethod,
    ) -> HttpResult:
        """Copy or move ``file_name`` from ``src_dir`` into ``destination_dir``."""
        ...


class StubbedFileHandlerClient:
    """The default file client: raises until a real SharePoint client is supplied."""

    def copy_or_move_items_to_sharepoint(
        self,
        src_dir: str,
        file_name: str,
        destination_dir: str,
        method: CopyMethod,
    ) -> HttpResult:
        raise NotImplementedError(
            "The SharePoint file client is not wired up yet. Pass a file handler "
            "to run(), e.g. a test double, to exercise the loop."
        )


def build_file_handler_client(site_url: str) -> FileHandlerClient:
    """Build the file client the loop copies through, for the site at ``site_url``."""
    return StubbedFileHandlerClient()


def read_items(items_file: Path) -> list[dict[str, Any]]:
    """Read the pending items. Each carries ``fields``; the task names the list."""
    return json.loads(items_file.read_text(encoding="utf-8"))


def create_items(
    list_client: ListItemClient, items_file: Path, list_name: str
) -> list[dict[str, Any]]:
    """Create every item declared in ``items_file`` in ``list_name``.

    One item's failure does not abandon the rest of the file. The entries that
    failed are returned exactly as they were read, so a caller can write them
    back out for another attempt.
    """
    failed: list[dict[str, Any]] = []
    for item in read_items(items_file):
        try:
            list_client.create_list_item(list_name, item["fields"])
        except Exception:
            logger.exception(
                "could not create an item in %s from %s", list_name, items_file.name
            )
            failed.append(item)
    return failed


def update_items(
    list_client: ListItemClient, items_file: Path, list_name: str
) -> list[dict[str, Any]]:
    """Update every item declared in ``items_file``, setting only its ``fields``.

    An update item names the ``item_id`` it amends and carries only the fields
    that change — the rest of the item is left as it is in SharePoint. As with
    creation, the entries that failed are returned rather than raised.
    """
    failed: list[dict[str, Any]] = []
    for item in read_items(items_file):
        try:
            list_client.update_list_item(list_name, item["item_id"], item["fields"])
        except Exception:
            logger.exception(
                "could not update item %s in %s from %s",
                item.get("item_id"),
                list_name,
                items_file.name,
            )
            failed.append(item)
    return failed


def original_stem(stem: str) -> str:
    """``stem`` with any retry marker of a previous tick removed.

    Only a marker followed by digits is stripped, so a file genuinely named
    ``notes.retry_draft.json`` keeps its name.
    """
    marker = stem.rfind(RETRY_MARKER)
    if marker == -1:
        return stem
    return stem[:marker] if stem[marker + len(RETRY_MARKER) :].isdigit() else stem


def retry_name(queued_file: Path, stamped_at: datetime | None = None) -> str:
    """The name the residue of ``queued_file`` takes, stamped with the time.

    The stamp keeps each residue distinct, so the one it replaces can be
    archived rather than overwritten — the trail of what was attempted when
    stays readable in the processed directory. The previous tick's marker is
    replaced rather than appended to, so the name never grows.
    """
    stamped_at = stamped_at or datetime.now(timezone.utc)
    stamp = stamped_at.strftime(RETRY_TIMESTAMP_FORMAT)
    return f"{original_stem(queued_file.stem)}{RETRY_MARKER}{stamp}{queued_file.suffix}"


def write_retry_file(
    queued_file: Path,
    failed: list[dict[str, Any]],
    stamped_at: datetime | None = None,
) -> Path:
    """Write the entries that failed back into the queue for the next tick.

    Written to a temporary name and moved into place, so a crash part-way
    through cannot leave a truncated file that would then fail to parse on
    every tick from now on.
    """
    destination = queued_file.with_name(retry_name(queued_file, stamped_at))
    scratch = queued_file.with_name(f"{destination.name}.partial")
    scratch.write_text(json.dumps(failed, indent=2), encoding="utf-8")
    scratch.replace(destination)
    return destination


def cleanup_file(queued_file: Path, processed_dir: Path = PROCESSED_DIR) -> Path:
    """Move a delivered ``queued_file`` into the processed directory."""
    processed_dir.mkdir(parents=True, exist_ok=True)
    destination = processed_dir / queued_file.name
    queued_file.replace(destination)
    return destination


def is_ready(queued_file: Path, quiet_seconds: float, now: float) -> bool:
    """Whether ``queued_file`` has been still long enough to be taken as finished.

    A producer still writing keeps pushing its file's mtime forward, so the age
    of the last write is the signal. This is a heuristic, not a guarantee — a
    writer that stalls for longer than the quiet period beats it — which is why
    the content is parsed before anything is sent rather than trusted here.

    ``now`` is wall-clock, because mtime is. On a network share whose clock
    differs from this host's, that difference lands directly in this sum.
    """
    try:
        modified_at = queued_file.stat().st_mtime
    except OSError:
        # Vanished or unreadable between listing and now: not ours to take.
        return False
    return now - modified_at >= quiet_seconds


def retry_pattern(file_pattern: str) -> str:
    """The glob matching the residues a task with ``file_pattern`` produces."""
    pattern = PurePath(file_pattern)
    return f"{original_stem(pattern.stem)}{RETRY_MARKER}*{pattern.suffix}"


def task_patterns(task: Task) -> tuple[str, ...]:
    """The globs ``task``'s files are found by.

    With per-item retry on, the residues the task itself produces are looked
    for as well as its declared pattern. Without this an exact pattern — one
    naming a file rather than a shape, ``create-complaints-2026-08.json`` — would
    never match its own stamped residue, and those items would quietly stop
    being retried.
    """
    if not task.enable_per_item_retry_next_run:
        return (task.file_pattern,)
    return (task.file_pattern, retry_pattern(task.file_pattern))


def discover_files(
    queue_dir: Path = QUEUE_DIR, patterns: str | Sequence[str] = "*"
) -> list[Path]:
    """List the queued files matching any of ``patterns``, by name.

    Sorted so a tick's order is the same on every platform, and files only, so
    a directory sitting in the queue is never mistaken for work. A file matched
    by more than one pattern is returned once.
    """
    if isinstance(patterns, str):
        patterns = (patterns,)
    if not queue_dir.is_dir():
        return []
    found = {
        path
        for pattern in patterns
        for path in queue_dir.glob(pattern)
        if path.is_file()
    }
    return sorted(found)


def copy_file(
    file_handler: FileHandlerClient,
    queued_file: Path,
    destination_dir: str,
    method: CopyMethod,
) -> None:
    """Put ``queued_file`` into ``destination_dir`` on SharePoint."""
    file_handler.copy_or_move_items_to_sharepoint(
        str(queued_file.parent), queued_file.name, destination_dir, method
    )


def deliver(
    task: Task,
    queued_file: Path,
    list_client: ListItemClient,
    file_handler: FileHandlerClient,
) -> list[dict[str, Any]]:
    """Perform ``task``'s action against one queued file.

    Returns the entries that failed. A copy has no per-item notion of failure —
    it either happened or it raised — so it reports none.
    """
    if task.action == CREATE_SHAREPOINT_ITEMS:
        return create_items(list_client, queued_file, task.list_name)
    if task.action == UPDATE_SHAREPOINT_ITEMS:
        return update_items(list_client, queued_file, task.list_name)
    if task.action == COPY_FILE_TO_SHAREPOINT:
        copy_file(file_handler, queued_file, task.destination_dir, task.method)
    return []


def deliver_one(
    task: Task,
    queued_file: Path,
    list_client: ListItemClient,
    file_handler: FileHandlerClient,
    processed_dir: Path,
) -> bool:
    """Deliver one queued file and set it aside. Says whether that succeeded.

    A failure leaves the file where it is, which *is* the retry: the next tick
    finds it still queued and tries again (ADR-0001). Nothing here re-raises —
    one bad file must not stop the files behind it, let alone the service.
    """
    try:
        failed = deliver(task, queued_file, list_client, file_handler)
    except Exception:
        logger.exception(
            "%s failed for %s; leaving it queued to retry",
            task.action,
            queued_file.name,
        )
        return False
    if failed and not task.enable_per_item_retry_next_run:
        # Whole-file retry: every item is sent again next tick, including the
        # ones that already landed. Per-item retry is what avoids that.
        logger.error(
            "%s: %d of %s's items failed; leaving the whole file queued to retry",
            task.action,
            len(failed),
            queued_file.name,
        )
        return False
    if failed:
        try:
            # Before the archive, never after: a crash between the two should
            # cost a duplicate, not the failed items themselves.
            residue = write_retry_file(queued_file, failed)
        except OSError:
            logger.exception(
                "%s: could not write %s's %d failed items back to the queue; "
                "leaving the whole file to retry",
                task.action,
                queued_file.name,
                len(failed),
            )
            return False
        logger.warning(
            "%s: %d of %s's items failed and were written to %s for the next tick",
            task.action,
            len(failed),
            queued_file.name,
            residue.name,
        )
        if residue == queued_file:
            # Only reachable if the stamp matched this file's own to the second
            # — two ticks in the same second, which back-to-back passes after an
            # overrun make possible. The residue was rewritten in place, so
            # archiving now would delete the very items we mean to retry.
            return False
    try:
        cleanup_file(queued_file, processed_dir)
    except OSError:
        # Delivered but not archived: the next tick will deliver it again.
        logger.exception(
            "%s delivered %s but could not set it aside; it will be sent again",
            task.action,
            queued_file.name,
        )
        return False
    # Archived, but only wholly delivered if nothing was written back.
    return not failed


@dataclass(frozen=True)
class TickSummary:
    """What one tick did, and what it left behind.

    ``failed`` counts files not *wholly* delivered — including one whose
    failures were written back for another attempt. ``oldest_pending_seconds``
    is the health signal: a queue that is not draining shows up as an age that
    keeps climbing.
    """

    delivered: int = 0
    failed: int = 0
    not_ready: int = 0
    pending: int = 0
    oldest_pending_seconds: float | None = None
    stopped_early: bool = False

    def describe(self) -> str:
        parts = [
            f"{self.delivered} delivered",
            f"{self.failed} failed",
            f"{self.not_ready} not ready",
            f"{self.pending} pending",
        ]
        if self.oldest_pending_seconds is not None:
            parts.append(f"oldest {self.oldest_pending_seconds / 60:.0f}m")
        if self.stopped_early:
            parts.append("stopped early")
        return ", ".join(parts)


def queue_backlog(queue_dir: Path, now: float) -> tuple[int, float | None]:
    """How many files are still queued, and the age of the oldest.

    ``now`` must be read when the backlog is measured, not when the tick began:
    residues written during the tick are newer than its start, which would
    otherwise report a negative age.
    """
    try:
        pending = discover_files(queue_dir, "*")
    except OSError:
        logger.exception("could not measure the queue at %s", queue_dir)
        return 0, None
    ages = []
    for path in pending:
        try:
            ages.append(max(0.0, now - path.stat().st_mtime))
        except OSError:
            continue
    return len(pending), max(ages) if ages else None


def run(
    list_client: ListItemClient,
    file_handler: FileHandlerClient,
    config: Config,
    queue_dir: Path = QUEUE_DIR,
    processed_dir: Path = PROCESSED_DIR,
    quiet_seconds: float = DEFAULT_QUIET_SECONDS,
    should_stop: Callable[[], bool] | None = None,
) -> TickSummary:
    """Perform one tick: work each declared task, setting delivered files aside.

    Each task, and each file within it, is isolated: a failure is logged and the
    tick carries on with the rest of the work. ``should_stop`` is consulted
    between files, so a shutdown never interrupts one part-way through.
    """
    stop = should_stop or (lambda: False)
    now = time.time()
    delivered = failed = not_ready = 0
    stopped_early = False
    for task in config.tasks:
        if task.action not in DELIVERABLE_ACTIONS:
            continue
        if stop():
            stopped_early = True
            break
        try:
            queued_files = discover_files(queue_dir, task_patterns(task))
        except OSError:
            logger.exception(
                "could not read the queue for %s (%s); skipping it this tick",
                task.action,
                task.file_pattern,
            )
            continue
        for queued_file in queued_files:
            if stop():
                stopped_early = True
                break
            if not is_ready(queued_file, quiet_seconds, now):
                not_ready += 1
                continue
            if deliver_one(task, queued_file, list_client, file_handler, processed_dir):
                delivered += 1
            else:
                failed += 1
    pending, oldest = queue_backlog(queue_dir, time.time())
    summary = TickSummary(
        delivered=delivered,
        failed=failed,
        not_ready=not_ready,
        pending=pending,
        oldest_pending_seconds=oldest,
        stopped_early=stopped_early,
    )
    logger.info("tick: %s", summary.describe())
    return summary


def next_deadline(previous: float, tick_seconds: float, now: float) -> float:
    """The monotonic instant the next tick is due.

    Deadlines are measured from when a tick *started*, not from when it
    finished, so the period stays the declared interval rather than becoming
    interval-plus-work. A tick that overruns its interval re-bases the deadline
    on ``now`` instead of carrying the debt forward: the next pass runs
    immediately — which is what a backlog wants — but a tick that took several
    intervals does not then fire a burst of catch-up passes.
    """
    due = previous + tick_seconds
    return due if due > now else now


def tick_minutes(value: str) -> int:
    """Parse a tick interval in minutes, refusing anything below the minimum."""
    minutes = int(value)
    if minutes < MINIMUM_TICK_MINUTES:
        raise argparse.ArgumentTypeError(
            f"must be at least {MINIMUM_TICK_MINUTES}, got {minutes}"
        )
    return minutes


def quiet_seconds(value: str) -> int:
    """Parse the quiet period in seconds. Zero means take a file immediately."""
    seconds = int(value)
    if seconds < 0:
        raise argparse.ArgumentTypeError(f"cannot be negative, got {seconds}")
    return seconds


def request_shutdown_on_signals() -> threading.Event:
    """Ask the loop to stop at the next safe point when a stop signal arrives.

    An :class:`~threading.Event` rather than a plain flag because setting it
    also wakes the sleep between ticks — ``time.sleep`` would otherwise be
    resumed after the handler and hold the process for the rest of the interval.
    """
    stopping = threading.Event()

    def handle(signum: int, frame: object) -> None:
        logger.info(
            "%s received; finishing the file in hand then stopping",
            signal.Signals(signum).name,
        )
        stopping.set()

    for stop_signal in (signal.SIGINT, signal.SIGTERM):
        signal.signal(stop_signal, handle)
    return stopping


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Read the Forwarder's command line."""
    parser = argparse.ArgumentParser(description="Run the Forwarder delivery loop.")
    parser.add_argument(
        "--tick-minutes",
        type=tick_minutes,
        default=DEFAULT_TICK_MINUTES,
        help=(
            "Minutes to wait between delivery passes "
            f"(default: %(default)s, minimum: {MINIMUM_TICK_MINUTES})."
        ),
    )
    parser.add_argument(
        "--quiet-seconds",
        type=quiet_seconds,
        default=DEFAULT_QUIET_SECONDS,
        help=(
            "How long a file must have been unmodified before it is taken to be "
            "finished (default: %(default)s; 0 takes files immediately)."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    """Run the Forwarder."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    args = parse_args(argv)
    tick_seconds = args.tick_minutes * SECONDS_PER_MINUTE
    config = Config.from_file(CONFIG_FILE)
    list_client = build_list_item_client(SITE_URL)
    file_handler = build_file_handler_client(SITE_URL)
    stopping = request_shutdown_on_signals()
    # Monotonic, not wall clock: the cadence must survive a clock adjustment.
    deadline = time.monotonic()
    while not stopping.is_set():
        # run() already isolates each task and file. This is the backstop for
        # anything it could not foresee: the loop outlives a failed tick.
        try:
            run(
                list_client,
                file_handler,
                config,
                quiet_seconds=args.quiet_seconds,
                should_stop=stopping.is_set,
            )
        except Exception:
            logger.exception("the tick failed; waiting for the next one")
        now = time.monotonic()
        deadline = next_deadline(deadline, tick_seconds, now)
        # Event.wait, not time.sleep: a signal arriving mid-wait must end it
        # rather than be resumed for the rest of the interval.
        stopping.wait(max(0.0, deadline - now))
    logger.info("stopped")


if __name__ == "__main__":
    main()
