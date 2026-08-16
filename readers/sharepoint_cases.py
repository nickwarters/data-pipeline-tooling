"""Shared Readers over the ``sharepoint_cases`` subject's published gold.

The Sync Feed owns these datasets and is the only thing that writes them. This
module is the one place that knows *where* they are, so a consumer of the Case
Review Platform's current state names neither a layer nor a table and asserts
nothing about the producer's storage shape.

Both readers are pass-throughs: they hand back the rows as landed, with no
projection, no coercion and no column contract. A consumer that needs specific
columns keeps its own ``ColumnValidator`` — the reader must not grow into the
union of every consumer's needs.

Nor does either declare how fresh the data has to be. Two pipelines can read the
same Cases and legitimately want different tolerances -- notifications must not
tell anyone anything on yesterday's picture, while a monthly report would rather
publish slightly stale than not at all -- and a reader has no basis to choose
between them. Each consuming pipeline declares its own ``UPSTREAMS``.
"""

from __future__ import annotations

import os

from framework.core import Dataset, Reader
from tools.medallion import medallion
from tools.store import StoreRegistry

# Private, and that is the entire point of the module: the subject, the layer
# and the table are what a consumer must not know.
_SUBJECT = "sharepoint_cases"
_CASE_CURRENT_TABLE = "case_current"
_CONVERSATION_MESSAGE_TABLE = "conversation_message"


def _gold_reader(base_dir: str | os.PathLike[str], table: str) -> Reader:
    """Mint a Reader over one of the subject's published gold tables.

    The single declaration of location for everything in this module. Today
    that resolves through the subject's medallion; the day it does not, this is
    the function that changes and no call site moves.
    """
    return medallion(StoreRegistry(base_dir), _SUBJECT).gold.reader(table)


class CurrentCasesReader:
    """Every Case as it currently stands — one row per ``case_id``.

    The Sync Feed's published current state: each Case reduced to its latest
    observation, so a consumer reads the Case's people, its status and its
    dates at one grain without reducing anything itself.

    Wraps the Reader the store mints rather than subclassing one: ``Reader`` is
    a structural Protocol, so composition costs three delegated members and
    leaves the SQLite mechanics where they already are.
    """

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _gold_reader(base_dir, _CASE_CURRENT_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()


class ConversationMessagesReader:
    """Every Conversation Message across every Case — grain ``case_id`` x ``seq``.

    The Sync Feed's published Detail Table, already reduced to the winning
    observation's messages, so the thread a consumer reads is the thread as it
    currently stands.
    """

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _gold_reader(base_dir, _CONVERSATION_MESSAGE_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()
