```python
"""Shared Readers for the ``sharepoint_cases`` published datasets.

They pass through rows without validation or freshness policy.
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
_ANSWER_TABLE = "answer"
_ANSWER_ACTION_TABLE = "answer_action"
_APPEAL_TABLE = "appeal"
_CASE_HISTORY_TABLE = "case_version"


def _gold_reader(base_dir: str | os.PathLike[str], table: str) -> Reader:
    """Mint a Reader over a published gold table in this subject."""
    return medallion(StoreRegistry(base_dir), _SUBJECT).gold.reader(table)


def _silver_reader(base_dir: str | os.PathLike[str], table: str) -> Reader:
    """Mint a Reader over one of the subject's silver tables -- the history."""
    return medallion(StoreRegistry(base_dir), _SUBJECT).silver.reader(table)


class CurrentCasesReader:
    """Published current-state Cases, one row per ``case_id``."""

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
    """Published conversation messages, one row per ``case_id`` × ``seq``."""

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _gold_reader(base_dir, _CONVERSATION_MESSAGE_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()


class AnswersReader:
    """Every Answer across every Case — grain ``case_id`` x ``question_id``.

    The Sync Feed's published ``answer`` Detail Table: the winning
    observation's Answers per Case, each carrying its remediation decision and
    status.
    """

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _gold_reader(base_dir, _ANSWER_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()


class AnswerActionsReader:
    """Every remediation Action across every Case — grain ``case_id`` x
    ``question_id`` x ``action_id``.

    The Sync Feed's published ``answer_action`` Detail Table, reduced to the
    winning observation's Actions per Case.
    """

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _gold_reader(base_dir, _ANSWER_ACTION_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()


class AppealsReader:
    """Every Appeal across every Case — grain ``case_id`` x ``appeal_id``.

    The Sync Feed's published ``appeal`` Detail Table, reduced to the winning
    observation's Appeals per Case, each carrying when it was raised, its state
    and -- once resolved -- its verdict and when.
    """

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _gold_reader(base_dir, _APPEAL_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()


class CaseObservationHistoryReader:
    """Every observation of every Case, as landed by every poll — grain one
    row per observation (``case_type`` x ``source_item_id`` x
    ``source_observation_id``).

    The accumulated history the Sync Feed keeps beneath its current state: one
    row each time a poll saw a Case, faithful to the source columns, with the
    blobs still as landed text. Where ``CurrentCasesReader`` answers "what is
    each Case now", this answers "what did each Case look like each time we
    saw it" -- the only source for anything that measures a *change*.

    It is a history of what the polls saw, not of what happened: a state a Case
    passed through between two polls was never observed and is not here.
    """

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _silver_reader(base_dir, _CASE_HISTORY_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()

```
