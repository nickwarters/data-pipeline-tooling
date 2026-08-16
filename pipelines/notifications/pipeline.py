"""Tell the two Conversation parties who did not post the last Message.

Reads Sync's **gold** current state -- ``case_current`` and the gold
``conversation_message`` Detail Table -- because the rule needs the last
Message, the Case's people and its status at one grain, already reduced. Both
tables already carry ``case_id`` and are already one row per their own grain, so
nothing here re-derives a key or reduces a second time.

Emits one JSON file per pass into the deliverable outbox: an array of objects
carrying exactly ``recipients`` / ``subject`` / ``body``. The path is unique per
pass, so a `Refresh` can never overwrite a file nobody has drained yet.
"""

from __future__ import annotations

import argparse
import html
import sys
from pathlib import Path
from typing import Callable

import pandas as pd

from framework.core import Dataset, PipelineError, Reader, Writer, format_failure
from framework.io import AppendOnly, DatasetReader, JsonWriter, Refresh
from framework.run import (
    FreshnessRequirement,
    Pipeline,
    RunContext,
    RunLog,
    run_pipeline,
)
from framework.transform import AntiJoinWith
from readers import users
from readers.users import UsersReader
from shared.account_names import to_bare_account
from tools.deliverables import NOTIFICATIONS_DESTINATION, get_deliverable_path
from tools.medallion import medallion
from tools.observability import timestamps
from tools.store import Store, StoreRegistry

PIPELINE_NAME = "notifications"
# Same-day, deliberately: the default max_age_days of 0 is the whole coupling
# between the two schedules. Sync may run as often as it likes and this as often
# as it likes; all that is required is that today's Sync has landed before
# anyone is told anything. Widening this would trade that guarantee for a
# quieter run log.
UPSTREAMS = (FreshnessRequirement("sharepoint_cases"),)

SYNC_SUBJECT = "sharepoint_cases"
CASE_TABLE = "case_current"
MESSAGE_TABLE = "conversation_message"

SUBJECT = "notifications"
LEDGER_TABLE = "notified"
# The ledger row is exactly this and nothing else. A notified_at column would be
# a non-key value the append-only comparison could see move, turning a
# legitimate re-present into a conflict; the Writer's own run-provenance column
# already answers "which run first told them".
LEDGER_KEY = ("case_id", "recipient", "message_at")

# A Case whose review is over needs nobody's attention. Mirrors the Sync feed's
# own terminal statuses.
TERMINAL_STATUSES = ("Completed", "Void")

# The three keys the notification service reads, in the order it reads them.
OUTBOX_COLUMNS = ("recipients", "subject", "body")
SUBJECT_LINE = "you have a new message"
RECIPIENT_SEPARATOR = ";"

# PLACEHOLDER -- two tenant facts fold into one string: the site collection and
# the host page the single-page app is served from. The fragment after them is
# the app's own registered conversation route, so the recipient lands where they
# can reply rather than on a read-only list form.
CASE_LINK_TEMPLATE = (
    "https://sharepoint.invalid/sites/REPLACE-ME/SitePages/REPLACE-ME.aspx"
    "#/conversation/{case_type}/{source_item_id}"
)

_THREAD_COLUMNS = ("case_id", "last_author_login", "message_at")
_CASE_COLUMNS = (
    "case_id",
    "case_type",
    "source_item_id",
    "assigned_reviewer_name",
    "responsible_party_name",
)
_PENDING_COLUMNS = (
    "case_id",
    "case_type",
    "source_item_id",
    "message_at",
    "recipient",
)


def _empty(columns: tuple[str, ...]) -> Dataset:
    return Dataset.from_pandas(
        pd.DataFrame({column: pd.Series(dtype="object") for column in columns})
    )


# --- the steps --------------------------------------------------------------


def last_message_per_case(messages: Dataset) -> Dataset:
    """Reduce the Conversation to each Case's last Message.

    Gold holds one observation's worth of Messages per Case, so ``seq`` totally
    orders the thread and the last Message is one ``idxmax``. ``posted_at`` is
    carried through verbatim: it is the ledger's key, and parsing it would let a
    spelling difference re-notify everybody.
    """
    frame = messages.to_pandas()
    if frame.empty:
        return _empty(_THREAD_COLUMNS)
    last = frame.loc[frame.groupby("case_id")["seq"].idxmax()]
    return Dataset.from_pandas(
        last.rename(
            columns={"author_login": "last_author_login", "posted_at": "message_at"}
        )
        .loc[:, list(_THREAD_COLUMNS)]
        .reset_index(drop=True)
    )


def live_cases(cases: Dataset) -> Dataset:
    """Drop the Cases whose review is over, and keep only the columns needed."""
    frame = cases.to_pandas()
    live = frame[~frame["status"].isin(TERMINAL_STATUSES)]
    return Dataset.from_pandas(live.loc[:, list(_CASE_COLUMNS)].reset_index(drop=True))


def join_threads_to_cases(threads: Dataset, cases: Dataset) -> Dataset:
    """Pair each Case's last Message with that Case's people."""
    merged = threads.to_pandas().merge(cases.to_pandas(), on="case_id", how="inner")
    return Dataset.from_pandas(merged)


def recipients_of(threads: Dataset, users: Dataset) -> Dataset:
    """Resolve the two parties who did not author the last Message.

    The Responsible Party's Manager comes from the *Responsible Party's*
    directory row, never the author's -- the Manager is a party to the thread
    because of who they manage, not because of who spoke. A party who is absent
    or whom the directory cannot resolve is skipped, never substituted.
    """
    user_frame = users.to_pandas()
    email_of = dict(zip(user_frame["login"], user_frame["email"]))
    manager_of = {
        login: (manager_login, manager_email)
        for login, manager_login, manager_email in zip(
            user_frame["login"],
            user_frame["manager_login"],
            user_frame["manager_email"],
        )
    }

    rows: list[dict[str, object]] = []
    for record in threads.to_pandas().to_dict("records"):
        author = to_bare_account(record["last_author_login"])
        reviewer = to_bare_account(record["assigned_reviewer_name"])
        party = to_bare_account(record["responsible_party_name"])
        manager_login, manager_email = manager_of.get(party, ("", ""))
        manager = to_bare_account(manager_login)

        # Keyed by login, so one person holding two roles collapses to one
        # recipient before the author is removed. The Manager's own row wins
        # over the address cached on the Responsible Party's, which is the
        # fallback for a Manager the directory lists only as someone's manager.
        by_login = {
            reviewer: email_of.get(reviewer, ""),
            party: email_of.get(party, ""),
            manager: email_of.get(manager) or manager_email,
        }
        emails = sorted(
            {
                email
                for login, email in by_login.items()
                if login and email and login != author
            }
        )
        rows.extend(
            {
                "case_id": record["case_id"],
                "case_type": record["case_type"],
                "source_item_id": record["source_item_id"],
                "message_at": record["message_at"],
                "recipient": email,
            }
            for email in emails
        )
    if not rows:
        return _empty(_PENDING_COLUMNS)
    return Dataset.from_pandas(pd.DataFrame(rows, columns=list(_PENDING_COLUMNS)))


def render_notifications(pending: Dataset) -> Dataset:
    """Group the surviving recipients into one notification object per Case."""
    frame = pending.to_pandas()
    rows: list[dict[str, str]] = []
    for _, group in frame.groupby("case_id", sort=True):
        first = group.iloc[0]
        link = CASE_LINK_TEMPLATE.format(
            case_type=html.escape(str(first["case_type"]), quote=True),
            source_item_id=html.escape(str(first["source_item_id"]), quote=True),
        )
        rows.append(
            {
                "recipients": RECIPIENT_SEPARATOR.join(sorted(set(group["recipient"]))),
                "subject": SUBJECT_LINE,
                # The notification system renders almost no styling, so this is
                # a paragraph and a link and deliberately nothing else.
                "body": (
                    "<p>There is a new message on a case that needs your "
                    "attention.</p>\n"
                    f'<p><a href="{link}">Open the conversation</a></p>'
                ),
            }
        )
    return Dataset.from_pandas(pd.DataFrame(rows, columns=list(OUTBOX_COLUMNS)))


def ledger_rows(pending: Dataset, *_written: Dataset) -> Dataset:
    """Project the notified recipients down to the ledger's key.

    Takes the outbox write's result as a further input purely to order the two
    writes: nobody is recorded as told until the file telling them has landed.
    A crash between the two costs a duplicate notification, which is the safe
    direction.
    """
    frame = pending.to_pandas().loc[:, list(LEDGER_KEY)].drop_duplicates()
    return Dataset.from_pandas(frame.reset_index(drop=True))


def ledger_reader(store: Store) -> Callable[[], Dataset]:
    """A callable yielding the ledger's keys, tolerating a first run.

    ``SqliteReader`` raises on a table that does not exist yet, so the very
    first pass would abort before it could notify anybody.
    """

    def read() -> Dataset:
        if store.columns_of(LEDGER_TABLE).columns() is None:
            return _empty(LEDGER_KEY)
        frame = store.reader(LEDGER_TABLE).read().to_pandas()
        return Dataset.from_pandas(frame.loc[:, list(LEDGER_KEY)])

    return read


# --- the builders -----------------------------------------------------------


def pending_notifications_builder(
    messages: Reader,
    cases: Reader,
    users: Reader,
    ledger: Callable[[], Dataset],
    *,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the selection half: who is owed a notification they have not had."""
    p = Pipeline(f"{PIPELINE_NAME}:pending", run_log=run_log)
    thread = p.transform(
        last_message_per_case,
        p.read(messages, name="read-messages"),
        name="last-message",
    )
    live = p.transform(
        live_cases, p.read(cases, name="read-cases"), name="drop-terminal"
    )
    joined = p.transform(join_threads_to_cases, thread, live, name="join-case")
    resolved = p.transform(
        recipients_of, joined, p.read(users, name="read-users"), name="recipients"
    )
    p.transform(
        AntiJoinWith(ledger, on=list(LEDGER_KEY), name="already-notified"),
        resolved,
        name="drop-notified",
    )
    return p


def outbox_builder(
    pending: Dataset,
    outbox: Writer,
    ledger: Writer,
    *,
    run_log: RunLog | None = None,
) -> Pipeline:
    """Build the publication half: the file first, then the ledger rows."""
    p = Pipeline(f"{PIPELINE_NAME}:outbox", run_log=run_log)
    source = p.read(DatasetReader(pending), name="read-pending")
    rendered = p.transform(render_notifications, source, name="render")
    written = p.write(outbox, rendered, name="write-outbox")
    p.write(
        ledger,
        p.transform(ledger_rows, source, written, name="ledger-rows"),
        name="write-ledger",
    )
    return p


# --- the run ----------------------------------------------------------------


def outbox_filename(generated_at: str, pipeline_run_id: str) -> str:
    """A per-pass filename that is legal on Windows as well as macOS."""
    stamp = "".join(character for character in generated_at if character.isalnum())
    return f"{stamp}-{pipeline_run_id[:8]}.json"


def users_path() -> Path:
    """The directory extract behind the recipients, as this pipeline sees it.

    Interim, and reaching for the reader's private declaration on purpose:
    naming a path here is exactly what a consumer must stop doing, and #737
    deletes this helper along with the rest of the location arithmetic. It
    survives one ticket only so the tests that stub the directory keep their
    existing seam while the reader moves.
    """
    return users._BUNDLED_FEED


def run(context: RunContext, *, describe: bool = False) -> Dataset:
    """Select who is owed a notification, then publish and record it."""
    base_dir = context.base_dir or Path.cwd() / "data"
    registry = StoreRegistry(base_dir)
    sync = medallion(registry, SYNC_SUBJECT)
    ledger_store = medallion(registry, SUBJECT).gold

    selection = pending_notifications_builder(
        sync.gold.reader(MESSAGE_TABLE),
        sync.gold.reader(CASE_TABLE),
        UsersReader(path=users_path()),
        ledger_reader(ledger_store),
        run_log=context.run_log,
    )
    if describe:
        print(selection.describe())
    pending = selection.run(context)
    if not isinstance(pending, Dataset):
        raise TypeError("notification selection did not return a Dataset")
    # Nobody is owed anything: publishing an empty array would put a file in the
    # outbox for the service to drain and find nothing in.
    if len(pending) == 0:
        return pending

    outbox = JsonWriter(
        get_deliverable_path(
            base_dir,
            NOTIFICATIONS_DESTINATION,
            outbox_filename(timestamps.utc_now_iso(), context.pipeline_run_id),
        ),
        Refresh(),
    )
    publication = outbox_builder(
        pending,
        outbox,
        ledger_store.writer(LEDGER_TABLE, AppendOnly(LEDGER_KEY)),
        run_log=context.run_log,
    )
    if describe:
        print(publication.describe())
    publication.run(context)
    return pending


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.notifications.pipeline",
        description="Emit notifications for the two Conversation parties who "
        "did not post the last Message.",
    )
    parser.add_argument("--base-dir", default=None)
    parser.add_argument("--describe", action="store_true")
    args = parser.parse_args(argv[1:])
    base_dir = Path(args.base_dir) if args.base_dir else Path.cwd() / "data"

    try:
        run_pipeline(
            lambda context: run(context, describe=args.describe),
            PIPELINE_NAME,
            base_dir=base_dir,
            upstreams=UPSTREAMS,
        )
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main(sys.argv))
