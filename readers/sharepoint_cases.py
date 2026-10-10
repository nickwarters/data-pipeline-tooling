"""Shared Readers for the ``sharepoint_cases`` published datasets.

They pass through rows without validation or freshness policy, narrowed to the
``columns`` a consumer names. The one exception is ``current_cases_with_brand``,
a deliberate, temporary stand-in that attaches a ``brand`` no source carries yet.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Sequence

import pandas as pd

from framework.core import Dataset, Reader, ValidationError
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
_CASE_ID_COLUMN = "case_id"
_BRAND_COLUMN = "brand"

# The values the stand-in brand takes.
STAND_IN_BRANDS = ("brand 1", "brand 2", "brand 3")


def _gold_reader(
    base_dir: str | os.PathLike[str], table: str, columns: Sequence[str] | None
) -> Reader:
    """Mint a Reader over a published gold table in this subject."""
    return medallion(StoreRegistry(base_dir), _SUBJECT).gold.reader(
        table, columns=columns
    )


def _silver_reader(
    base_dir: str | os.PathLike[str], table: str, columns: Sequence[str] | None
) -> Reader:
    """Mint a Reader over one of the subject's silver tables -- the history."""
    return medallion(StoreRegistry(base_dir), _SUBJECT).silver.reader(
        table, columns=columns
    )


class CurrentCasesReader:
    """Published current-state Cases, one row per ``case_id``."""

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        columns: Sequence[str] | None = None,
    ) -> None:
        self._reader = _gold_reader(base_dir, _CASE_CURRENT_TABLE, columns)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()


def stand_in_brand(case_id: str) -> str:
    """The stand-in brand of the Case ``case_id``: one of ``STAND_IN_BRANDS``.

    Picked by a hash of the Case id rather than at random, so a Case keeps its
    brand from read to read and from run to run, on every machine.
    """
    digest = hashlib.sha256(str(case_id).encode("utf-8")).hexdigest()
    return STAND_IN_BRANDS[int(digest, 16) % len(STAND_IN_BRANDS)]


def current_cases_with_brand(
    base_dir: str | os.PathLike[str],
    *,
    columns: Sequence[str] | None = None,
) -> Reader:
    """The current Cases, each with a stand-in ``brand`` attached.

    **A stand-in, and a deliberate breach of G5** (a Shared Reader does no
    shaping, ``docs/shared-readers.md``): no source reachable from Sync carries
    Brand yet, so this attaches one of ``STAND_IN_BRANDS`` to each Case, picked
    by ``stand_in_brand`` from its ``case_id``, so that what reads it can group
    by brand now. It replaces any ``brand`` the table carries. The day a real
    source carries Brand, this goes and its consumers read ``CurrentCasesReader``
    again.

    ``columns`` narrows the read as it does on ``CurrentCasesReader``, and may
    name ``brand``: the rest is fetched (with ``case_id``, which the brand is
    derived from, whether named or not) and the result comes back in the order
    named.
    """
    return _CurrentCasesWithBrandReader(base_dir, columns=columns)


class _CurrentCasesWithBrandReader:
    """``CurrentCasesReader`` plus a stand-in ``brand``; see
    ``current_cases_with_brand``."""

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        columns: Sequence[str] | None,
    ) -> None:
        self._columns = None if columns is None else list(columns)
        fetched = None
        if columns is not None:
            # Names match as the read matches them, ignoring ASCII case.
            fetched = [c for c in columns if c.lower() != _BRAND_COLUMN]
            if not any(c.lower() == _CASE_ID_COLUMN for c in fetched):
                fetched.append(_CASE_ID_COLUMN)
        self._reader = CurrentCasesReader(base_dir, columns=fetched)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        frame = self._reader.read().to_pandas()
        case_id = next((c for c in frame.columns if c.lower() == _CASE_ID_COLUMN), None)
        if case_id is None:
            raise ValidationError(
                f"{_CASE_CURRENT_TABLE} is missing required column(s): "
                f"{_CASE_ID_COLUMN} (the stand-in brand is derived from it)"
            )
        brand = next(
            (c for c in self._columns or () if c.lower() == _BRAND_COLUMN),
            _BRAND_COLUMN,
        )
        frame = frame.drop(
            columns=[c for c in frame.columns if c.lower() == _BRAND_COLUMN]
        )
        frame[brand] = [
            None if pd.isna(value) else stand_in_brand(value)
            for value in frame[case_id]
        ]
        if self._columns is not None:
            frame = frame[self._columns]
        return Dataset.from_pandas(frame)

    def describe(self) -> str:
        return (
            "the current Cases with a stand-in brand, picked from each case_id: "
            + self._reader.describe()
        )


class ConversationMessagesReader:
    """Published conversation messages, one row per ``case_id`` × ``seq``."""

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        columns: Sequence[str] | None = None,
    ) -> None:
        self._reader = _gold_reader(base_dir, _CONVERSATION_MESSAGE_TABLE, columns)

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

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        columns: Sequence[str] | None = None,
    ) -> None:
        self._reader = _gold_reader(base_dir, _ANSWER_TABLE, columns)

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

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        columns: Sequence[str] | None = None,
    ) -> None:
        self._reader = _gold_reader(base_dir, _ANSWER_ACTION_TABLE, columns)

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

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        columns: Sequence[str] | None = None,
    ) -> None:
        self._reader = _gold_reader(base_dir, _APPEAL_TABLE, columns)

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

    def __init__(
        self,
        base_dir: str | os.PathLike[str],
        *,
        columns: Sequence[str] | None = None,
    ) -> None:
        self._reader = _silver_reader(base_dir, _CASE_HISTORY_TABLE, columns)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()
