```python
"""Tell the two Conversation parties who did not post the last Message, and the
Responsible Party and their Manager when a Case becomes Reportable with
remediation.

Reads Sync's published current state -- every Case as it currently stands, and
every Conversation Message -- because the rule needs the last Message, the
Case's people and its status at one grain, already reduced. Both arrive keyed by
``case_id`` and already one row per their own grain, so nothing here re-derives
a key or reduces a second time. Neither is this pipeline's to locate: they come
through ``readers.sharepoint_cases``, which is why no layer or table is named
below.

Two triggers, two independent selection passes over the same ``case_current``,
each anti-joined against its own ledger table. Emits one JSON file per pass into
the deliverable outbox: an array of objects carrying exactly ``recipients`` /
``subject`` / ``body``, one object per Case per trigger. The path is unique per
pass, so a `Refresh` can never overwrite a file nobody has drained yet.

Every line below **does its work when it is reached**: put a breakpoint on one,
step over it, and the variable holds the actual rows at that point
([ADR-0027](../../docs/adr/0027-eager-steps-are-the-default-authoring-model.md)).
Where a rule takes two inputs -- pairing a thread with its Case, resolving
recipients against the directory -- it is a plain Python call wrapped in
``step``, which keeps it a timed, named record in the run log without pretending
it is a one-input transform.
"""

from __future__ import annotations

import argparse
import functools
import html
import sys
from pathlib import Path
from typing import Callable

import pandas as pd

from framework.core import Dataset, PipelineError, Writer, format_failure
from framework.io import AppendOnly, JsonWriter, Refresh
from framework.run import (
    FreshnessRequirement,
    RunContext,
    read,
    run_pipeline,
    transform,
    write,
)
from framework.transform import AntiJoinWith
from readers.sharepoint_cases import ConversationMessagesReader, CurrentCasesReader
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

# What this pipeline owns and writes. Where the Cases and the Conversation
# Messages it reads actually live is not declared here at all.
SUBJECT = "notifications"
LEDGER_TABLE = "notified"
# The ledger row is exactly this and nothing else. A notified_at column would be
# a non-key value the append-only comparison could see move, turning a
# legitimate re-present into a conflict; the Writer's own run-provenance column
# already answers "which run first told them".
LEDGER_KEY = ("case_id", "recipient", "message_at")

# The Reportable-with-remediation trigger's own ledger, a second table rather
# than a rekeying of the one above: reportable_at is frozen at the milestone and
# never advances, so a third column here would do no work.
REPORTABLE_LEDGER_TABLE = "notified_reportable"
REPORTABLE_LEDGER_KEY = ("case_id", "recipient")

# A Case whose review is over needs nobody's attention. Mirrors the Sync feed's
# own terminal statuses.
TERMINAL_STATUSES = ("Completed", "Void")

# The three keys the notification service reads, in the order it reads them.
OUTBOX_COLUMNS = ("recipients", "subject", "body")
SUBJECT_LINE = "you have a new message"
REPORTABLE_SUBJECT_LINE = "a case is reportable and needs remediation attention"
RECIPIENT_SEPARATOR = ";"

# PLACEHOLDER -- two tenant facts fold into one string: the site collection and
# the host page the single-page app is served from. Shared by both link
# constants below so the go-live swap stays a single place.
_LINK_BASE = "https://sharepoint.invalid/sites/REPLACE-ME/SitePages/REPLACE-ME.aspx"

# The fragment after the base is the app's own registered conversation route, so
# the recipient lands where they can reply rather than on a read-only list form.
CASE_LINK_TEMPLATE = _LINK_BASE + "#/conversation/{case_type}/{source_item_id}"
# The Reportable trigger has no message to reply to, so it links to the Case
# page itself rather than the conversation deep link above.
REPORTABLE_CASE_LINK_TEMPLATE = _LINK_BASE + "#/case/{case_type}/{source_item_id}"

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

# Reportable selection needs status/reportable_at/had_remediation for the
# predicate, none of which live_cases' projection carries.
_REPORTABLE_CASE_COLUMNS = (
    "case_id",
    "case_type",
    "source_item_id",
    "responsible_party_name",
    "status",
    "reportable_at",
    "had_remediation",
)
_REPORTABLE_PENDING_COLUMNS = ("case_id", "case_type", "source_item_id", "recipient")


def _empty(columns: tuple[str, ...]) -> Dataset:
    return Dataset.from_pandas(
        pd.DataFrame({column: pd.Series(dtype="object") for column in columns})
    )


# --- the steps --------------------------------------------------------------


def last_message_per_case(messages: Dataset) -> Dataset:
    """Reduce the Conversation to each Case's last Message.

    Sync publishes one observation's worth of Messages per Case, so ``seq``
    totally orders the thread and the last Message is one ``idxmax``.
    ``posted_at`` is carried through verbatim: it is the ledger's key, and
    parsing it would let a spelling difference re-notify everybody.
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


def _directory_index(
    users: Dataset,
) -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    """Build the login-to-email and login-to-manager lookups both rules need."""
    frame = users.to_pandas()
    email_of = dict(zip(frame["login"], frame["email"]))
    manager_of = {
        login: (manager_login, manager_email)
        for login, manager_login, manager_email in zip(
            frame["login"], frame["manager_login"], frame["manager_email"]
        )
    }
    return email_of, manager_of


def recipients_of(threads: Dataset, users: Dataset) -> Dataset:
    """Resolve the two parties who did not author the last Message.

    The Responsible Party's Manager comes from the *Responsible Party's*
    directory row, never the author's -- the Manager is a party to the thread
    because of who they manage, not because of who spoke. A party who is absent
    or whom the directory cannot resolve is skipped, never substituted.
    """
    email_of, manager_of = _directory_index(users)

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


def reportable_cases(cases: Dataset) -> Dataset:
    """Select Cases newly Reportable while carrying remediation.

    Terminal Cases are excluded: ``had_remediation`` is only set on the Send
    Actions path, which leaves the Case ``Actions In Progress``, so such a Case
    reaches ``Completed`` only once its remediation is *finished*. Including
    terminal Cases would email people about work already done. The accepted cost
    is a Case that becomes Reportable-with-remediation and reaches
    ``Completed``/``Void`` before the next pass runs: it is never notified at
    all.
    """
    frame = cases.to_pandas()
    # reportable_at is stamped text, never parsed -- NA reduces to "" here, same
    # as a genuinely blank cell, so both mean "not yet Reportable".
    stamped = frame["reportable_at"].fillna("").astype(str).str.strip() != ""
    # had_remediation is gold REAL; a NULL arrives as NaN, and bool(nan) is
    # True, so a naive .astype(bool) would treat every Case as carrying
    # remediation. Comparing to 1 reads a missing flag as "no remediation".
    remediated = frame["had_remediation"] == 1
    live = ~frame["status"].isin(TERMINAL_STATUSES)
    selected = frame[stamped & remediated & live]
    return Dataset.from_pandas(
        selected.loc[:, list(_REPORTABLE_CASE_COLUMNS)].reset_index(drop=True)
    )


def responsible_party_and_manager_of(cases: Dataset, users: Dataset) -> Dataset:
    """Resolve the Responsible Party and their Manager for a Reportable Case.

    Shares the two silent parties' properties: a party who is absent or
    unresolvable is skipped, never substituted; the Manager comes from the
    Responsible Party's own directory row, never ``responsible_party_manager_name``;
    and one person in two roles collapses to one recipient.
    """
    email_of, manager_of = _directory_index(users)

    rows: list[dict[str, object]] = []
    for record in cases.to_pandas().to_dict("records"):
        party = to_bare_account(record["responsible_party_name"])
        manager_login, manager_email = manager_of.get(party, ("", ""))
        manager = to_bare_account(manager_login)

        by_login = {
            party: email_of.get(party, ""),
            manager: email_of.get(manager) or manager_email,
        }
        emails = sorted({email for login, email in by_login.items() if login and email})
        rows.extend(
            {
                "case_id": record["case_id"],
                "case_type": record["case_type"],
                "source_item_id": record["source_item_id"],
                "recipient": email,
            }
            for email in emails
        )
    if not rows:
        return _empty(_REPORTABLE_PENDING_COLUMNS)
    return Dataset.from_pandas(
        pd.DataFrame(rows, columns=list(_REPORTABLE_PENDING_COLUMNS))
    )


def render_notifications(
    pending: Dataset,
    *,
    subject: str,
    link_template: str,
    intro: str,
    link_text: str,
) -> Dataset:
    """Group the surviving recipients into one notification object per Case."""
    frame = pending.to_pandas()
    rows: list[dict[str, str]] = []
    for _, group in frame.groupby("case_id", sort=True):
        first = group.iloc[0]
        link = link_template.format(
            case_type=html.escape(str(first["case_type"]), quote=True),
            source_item_id=html.escape(str(first["source_item_id"]), quote=True),
        )
        rows.append(
            {
                "recipients": RECIPIENT_SEPARATOR.join(sorted(set(group["recipient"]))),
                "subject": subject,
                # The notification system renders almost no styling, so this is
                # a paragraph and a link and deliberately nothing else.
                "body": f'<p>{intro}</p>\n<p><a href="{link}">{link_text}</a></p>',
            }
        )
    return Dataset.from_pandas(pd.DataFrame(rows, columns=list(OUTBOX_COLUMNS)))


def ledger_rows(pending: Dataset, *, ledger_key: tuple[str, ...]) -> Dataset:
    """Project the notified recipients down to a ledger's key."""
    frame = pending.to_pandas().loc[:, list(ledger_key)].drop_duplicates()
    return Dataset.from_pandas(frame.reset_index(drop=True))


def ledger_reader(
    store: Store, table: str, ledger_key: tuple[str, ...]
) -> Callable[[], Dataset]:
    """A callable yielding a ledger's keys, tolerating a first run.

    ``SqliteReader`` raises on a table that does not exist yet, so the very
    first pass would abort before it could notify anybody.
    """

    def read() -> Dataset:
        if store.columns_of(table).columns() is None:
            return _empty(ledger_key)
        frame = store.reader(table).read().to_pandas()
        return Dataset.from_pandas(frame.loc[:, list(ledger_key)])

    return read


# --- the passes -------------------------------------------------------------


def pending_notifications(
    messages: Dataset,
    cases: Dataset,
    users: Dataset,
    ledger: Callable[[], Dataset],
) -> Dataset:
    """Who is owed a new-message notification and has not already had it."""
    thread = transform(last_message_per_case, messages, name="last-message")
    live = transform(live_cases, cases, name="drop-terminal")

    # Two inputs, passed the way the builder passed two input nodes: the first
    # is the flow being narrowed and the one ``rows_in`` counts, the rest are the
    # reference side.
    joined = transform(join_threads_to_cases, thread, live, name="join-case")
    resolved = transform(recipients_of, joined, users, name="recipients")

    return transform(
        AntiJoinWith(ledger, on=list(LEDGER_KEY), name="already-notified"),
        resolved,
        name="drop-notified",
    )


def reportable_notifications(
    cases: Dataset,
    users: Dataset,
    ledger: Callable[[], Dataset],
) -> Dataset:
    """Who is owed a Reportable-with-remediation notification, and has not had it.

    A second, independent selection over the same ``case_current`` -- not a
    branch of :func:`pending_notifications` -- so each trigger anti-joins its own
    ledger with its own key. Its steps are named apart from the other pass's for
    the same reason: one run log, two passes, and an operator reading it back
    should be able to tell which one dropped a row.
    """
    selected = transform(reportable_cases, cases, name="select-reportable")

    resolved = transform(
        responsible_party_and_manager_of,
        selected,
        users,
        name="reportable-recipients",
    )

    return transform(
        AntiJoinWith(ledger, on=list(REPORTABLE_LEDGER_KEY), name="already-notified"),
        resolved,
        name="reportable-drop-notified",
    )


def publish(
    rendered: Dataset,
    outbox: Writer,
    pending: Dataset,
    ledger: Writer,
    pending_reportable: Dataset,
    reportable_ledger: Writer,
) -> None:
    """Write the one outbox file, then each ledger's rows.

    The order of these lines *is* the ordering guarantee: nobody is recorded as
    told until the file telling them has landed. A crash between the two costs a
    duplicate notification, which is the safe direction. Expressing that used to
    take an extra graph edge feeding each ledger step the outbox write's result;
    written out, it is simply which line comes first.
    """
    write(outbox, rendered, name="write-outbox")
    write(
        ledger,
        transform(
            functools.partial(ledger_rows, ledger_key=LEDGER_KEY),
            pending,
            name="ledger-rows",
        ),
        name="write-ledger",
    )
    write(
        reportable_ledger,
        transform(
            functools.partial(ledger_rows, ledger_key=REPORTABLE_LEDGER_KEY),
            pending_reportable,
            name="ledger-rows-reportable",
        ),
        name="write-ledger-reportable",
    )


# --- the run ----------------------------------------------------------------


def outbox_filename(generated_at: str, pipeline_run_id: str) -> str:
    """A per-pass filename that is legal on Windows as well as macOS."""
    stamp = "".join(character for character in generated_at if character.isalnum())
    return f"{stamp}-{pipeline_run_id[:8]}.json"


def run(context: RunContext) -> Dataset:
    """Select who is owed a notification on either trigger, publish, record.

    Returns the union of both triggers' surviving recipients, reduced to
    ``case_id`` / ``recipient`` -- callers use it only for its length, to know
    how many notifications were owed this pass.
    """
    base_dir = context.base_dir or Path.cwd() / "data"
    # The ledger is this pipeline's own subject, so it resolves that itself.
    # Everything it reads belongs to someone else and arrives through a reader
    # that knows where it lives.
    ledger_store = medallion(StoreRegistry(base_dir), SUBJECT).gold

    # Both triggers select from the same published current state and the same
    # directory, so each is read once here and handed to both passes rather than
    # re-read per pass.
    cases = read(CurrentCasesReader(base_dir=base_dir), name="read-cases")
    users = read(UsersReader(base_dir=base_dir), name="read-users")
    messages = read(ConversationMessagesReader(base_dir=base_dir), name="read-messages")

    pending = pending_notifications(
        messages,
        cases,
        users,
        ledger_reader(ledger_store, LEDGER_TABLE, LEDGER_KEY),
    )
    pending_reportable = reportable_notifications(
        cases,
        users,
        ledger_reader(ledger_store, REPORTABLE_LEDGER_TABLE, REPORTABLE_LEDGER_KEY),
    )

    # Nobody is owed anything on either trigger: publishing an empty array
    # would put a file in the outbox for the service to drain and find nothing
    # in. One trigger owing nobody anything while the other does must still
    # publish, so this checks both together rather than either alone.
    if len(pending) == 0 and len(pending_reportable) == 0:
        return _empty(("case_id", "recipient"))

    rendered = Dataset.from_pandas(
        pd.concat(
            [
                render_notifications(
                    pending,
                    subject=SUBJECT_LINE,
                    link_template=CASE_LINK_TEMPLATE,
                    intro="There is a new message on a case that needs your attention.",
                    link_text="Open the conversation",
                ).to_pandas(),
                render_notifications(
                    pending_reportable,
                    subject=REPORTABLE_SUBJECT_LINE,
                    link_template=REPORTABLE_CASE_LINK_TEMPLATE,
                    intro=(
                        "A case has become reportable and is carrying remediation "
                        "that needs your attention."
                    ),
                    link_text="Open the case",
                ).to_pandas(),
            ],
            ignore_index=True,
        )
    )

    outbox = JsonWriter(
        get_deliverable_path(
            base_dir,
            NOTIFICATIONS_DESTINATION,
            outbox_filename(timestamps.utc_now_iso(), context.pipeline_run_id),
        ),
        Refresh(),
    )
    publish(
        rendered,
        outbox,
        pending,
        ledger_store.writer(LEDGER_TABLE, AppendOnly(LEDGER_KEY)),
        pending_reportable,
        ledger_store.writer(REPORTABLE_LEDGER_TABLE, AppendOnly(REPORTABLE_LEDGER_KEY)),
    )
    return Dataset.from_pandas(
        pd.concat(
            [
                pending.to_pandas().loc[:, ["case_id", "recipient"]],
                pending_reportable.to_pandas().loc[:, ["case_id", "recipient"]],
            ],
            ignore_index=True,
        )
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.notifications.pipeline",
        description="Emit notifications for the two Conversation parties who "
        "did not post the last Message, and for a Case newly Reportable "
        "with remediation.",
    )
    parser.add_argument("--base-dir", default=None)
    args = parser.parse_args(argv[1:])
    base_dir = Path(args.base_dir) if args.base_dir else Path.cwd() / "data"

    # The *same* run_pipeline the operator CLI uses, so a run started here and
    # one started with `cli run` record under one identity. To see what a pass
    # would do without doing it, use `cli run pipelines/notifications --dry-run`:
    # every step still runs, and only the commits are held back.
    try:
        run_pipeline(
            run,
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

```
