```python
"""The Case Review Platform's published **Question Bank** artifacts, as rows.

The review platform owns the Question Bank outright (root ``CONTEXT.md``); this
side only reads it, as the export artifact
``platform_frontend/docs/reporting-data-contract.md`` specifies. Both filename
forms hold JSON (``.txt`` is a SharePoint constraint), and one artifact
declares two grains — a Case Type's **questions** (~50) and the **outcome
options** they map onto (~4) — hence two Readers, joining on ``id``.

``{slug}.txt`` is a bank's **mutable head**; ``{slug}.{version}.txt`` an
**immutable snapshot**, which is what a completed Case's ``questionBankVersion``
names. Never read together: a head declares the version it was last published
as, so the same bank sits under both names and reading both double counts it.

Design, guardrails and the argument grid: ``docs/shared-readers.md``.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import pandas as pd

from framework.core import Dataset, ValidationError

__all__ = [
    "OUTCOME_COLUMNS",
    "QUESTION_COLUMNS",
    "QUESTION_JSON_COLUMNS",
    "OutcomeOptionsReader",
    "QuestionBankReader",
    "QuestionBankStore",
]

#: Where the artifacts live today: the frontend's source tree, which is also its
#: deployed tree, so these are the published bytes and not a copy of them.
_BANKS_DIR = (
    Path(__file__).resolve().parents[1] / "platform_frontend" / "case-types" / "banks"
)

#: Envelope field -> column, stamped on every row of both datasets.
#: ``generatedAt`` is absent from a head and present on every snapshot.
_ENVELOPE_FIELDS = {
    "slug": "slug",
    "label": "label",
    "version": "version",
    "generatedAt": "generated_at",
    "defaultOutcomeId": "default_outcome_id",
}

#: Question field -> column. A question carries only the keys that apply to it,
#: so any of these is a gap when absent.
_QUESTION_FIELDS = {
    "id": "id",
    "text": "text",
    "questionGroup": "question_group",
    "category": "category",
    "responseType": "response_type",
    "deprecated": "deprecated",
    "options": "options",
    "optionOutcomes": "option_outcomes",
    "showWhen": "show_when",
    "labelIds": "label_ids",
    "remediationActions": "remediation_actions",
}

#: Outcome option field -> column. ``wording`` is the key side of a question's
#: ``option_outcomes`` map, ``id`` the value side, ``severity`` the score.
_OUTCOME_FIELDS = {
    "id": "id",
    "wording": "wording",
    "severity": "severity",
}

#: One row per question. Names are the artifact's own, canonicalised from
#: camelCase — ``id`` and ``text`` are the *question*'s, never a Case's.
QUESTION_COLUMNS = (
    *_ENVELOPE_FIELDS.values(),
    "outcome_options",
    "position",
    *_QUESTION_FIELDS.values(),
)

#: One row per outcome option, in declared order.
OUTCOME_COLUMNS = (
    *_ENVELOPE_FIELDS.values(),
    "position",
    *_OUTCOME_FIELDS.values(),
)

#: Nested question columns, landed as JSON text so they survive whole and
#: survive a write to a table. An absent key stays a gap rather than becoming
#: the string ``"null"``; ``json.loads`` on the column is the other half.
QUESTION_JSON_COLUMNS = (
    "outcome_options",
    "options",
    "option_outcomes",
    "show_when",
    "label_ids",
    "remediation_actions",
)


@dataclass(frozen=True)
class _Artifact:
    """One bank file, and the name it is filed under."""

    path: Path
    case_type: str
    version: str | None


def _segment(kind: str, value: str) -> str:
    """Refuse anything but a plain filename segment (a version is Case data)."""
    text = str(value).strip()
    if not text or text in {".", ".."} or set(text) & set("/\\"):
        raise ValidationError(
            f"{kind} {value!r} is not a usable filename segment; "
            f"it must name one Question Bank artifact and no path around it"
        )
    return text


def _encode(column: str, value: object) -> object:
    """JSON-encode a nested column's value, leaving a gap a gap."""
    if column in QUESTION_JSON_COLUMNS and value is not None:
        return json.dumps(value)
    return value


def _load(artifact: _Artifact) -> dict:
    """Parse one artifact, refusing one that does not answer to its own name.

    They are join keys: a file disagreeing with its own envelope attributes
    every derived figure to the wrong bank, silently.
    """
    payload = json.loads(artifact.path.read_text(encoding="utf-8"))
    declared_slug = payload.get("slug")
    if declared_slug != artifact.case_type:
        raise ValidationError(
            f"{artifact.path} declares slug {declared_slug!r}, "
            f"not the {artifact.case_type!r} it is filed under"
        )
    declared_version = payload.get("version")
    if artifact.version is not None and declared_version != artifact.version:
        raise ValidationError(
            f"{artifact.path} declares version {declared_version!r}, "
            f"not the {artifact.version!r} it is filed under"
        )
    return payload


class _BankReader:
    """The walk both Readers share: resolve, parse, explode, stack.

    They differ only by which envelope array they are a row per element of.
    """

    #: The envelope array this Reader is a row per element of.
    _ARRAY_FIELD: str = ""
    _COLUMNS: tuple[str, ...] = ()

    def __init__(
        self,
        resolve: Callable[[], Iterable[_Artifact]],
        *,
        described_as: str,
    ) -> None:
        self._resolve = resolve
        self._described_as = described_as
        self.data_locations: list[dict[str, str]] = []

    def read(self) -> Dataset:
        rows: list[dict] = []
        locations: list[dict[str, str]] = []
        for artifact in self._resolve():
            payload = _load(artifact)
            locations.append({"namespace": "file", "name": str(artifact.path)})
            items = payload.get(self._ARRAY_FIELD)
            if not isinstance(items, list):
                raise ValidationError(
                    f"{artifact.path} declares no {self._ARRAY_FIELD!r} array; "
                    f"it is not a Question Bank export"
                )
            envelope = {
                column: payload.get(field) for field, column in _ENVELOPE_FIELDS.items()
            }
            rows.extend(
                self._row(payload, envelope, position, item)
                for position, item in enumerate(items)
            )
        # Set only once the whole walk succeeded, so a run log never claims a
        # partial read touched everything it had opened before it failed.
        self.data_locations = locations
        return Dataset.from_pandas(
            pd.DataFrame(rows, columns=list(self._COLUMNS)).reset_index(drop=True)
        )

    def _row(
        self, payload: dict, envelope: dict, position: int, item: dict
    ) -> dict:  # pragma: no cover - overridden
        raise NotImplementedError

    def describe(self) -> str:
        return self._described_as


class QuestionBankReader(_BankReader):
    """A Case Type's questions — one row per question, in declared order."""

    _ARRAY_FIELD = "questions"
    _COLUMNS = QUESTION_COLUMNS

    def _row(self, payload: dict, envelope: dict, position: int, item: dict) -> dict:
        return (
            envelope
            | {
                "outcome_options": _encode(
                    "outcome_options", payload.get("outcomeOptions")
                ),
                "position": position,
            }
            | {
                column: _encode(column, item.get(field))
                for field, column in _QUESTION_FIELDS.items()
            }
        )


class OutcomeOptionsReader(_BankReader):
    """A Case Type's outcome options — one row per option, with its severity.

    ``severity`` is the score a Case's verdict resolves by (highest applicable
    mapped outcome wins).
    """

    _ARRAY_FIELD = "outcomeOptions"
    _COLUMNS = OUTCOME_COLUMNS

    def _row(self, payload: dict, envelope: dict, position: int, item: dict) -> dict:
        return (
            envelope
            | {"position": position}
            | {column: item.get(field) for field, column in _OUTCOME_FIELDS.items()}
        )


class QuestionBankStore:
    """Mints Readers over the published Question Banks — one bank, or all of them.

    ``base_dir`` is taken and **not used**, as ``UsersReader`` takes it:
    resolving a location is this module's job, and the signature is already the
    one a synced drop under the base directory would need. ``banks_dir`` is a
    test and spike seam, keyword-only; ``pipelines/`` should not use it.
    """

    def __init__(
        self,
        base_dir: str | os.PathLike[str] | None = None,
        *,
        banks_dir: str | os.PathLike[str] | None = None,
    ) -> None:
        self._banks_dir = Path(banks_dir) if banks_dir is not None else _BANKS_DIR

    def qb_reader(
        self,
        case_type: str | None = None,
        version: str | None = None,
        *,
        current: bool = True,
    ) -> QuestionBankReader:
        """Questions, at any scope. Every argument is optional and narrows::

            qb_reader()                             # every Case Type's head
            qb_reader("complaints")                 # that Case Type's head
            qb_reader(current=False)                # every published snapshot
            qb_reader("complaints", current=False)  # that Case Type's history
            qb_reader("complaints", v, current=False)   # that one snapshot

        A version with ``current`` left true is refused (a version names a
        snapshot, ``current`` the head — the contradiction a Case row walks
        into), as is a version with no ``case_type`` (a version is minted per
        Case Type). Nothing is opened until ``read()``.
        """
        resolve, described = self._resolve(case_type, version, current=current)
        return QuestionBankReader(
            resolve, described_as=f"QuestionBankReader({described})"
        )

    def outcomes_reader(
        self,
        case_type: str | None = None,
        version: str | None = None,
        *,
        current: bool = True,
    ) -> OutcomeOptionsReader:
        """Outcome options — the same five shapes as :meth:`qb_reader`."""
        resolve, described = self._resolve(case_type, version, current=current)
        return OutcomeOptionsReader(
            resolve, described_as=f"OutcomeOptionsReader({described})"
        )

    def _resolve(
        self, case_type: str | None, version: str | None, *, current: bool
    ) -> tuple[Callable[[], Iterable[_Artifact]], str]:
        """Settle which artifacts a reader walks, and how it describes them.

        An unpinned ``current=False`` is deliberately allowed — every snapshot —
        and is the only thing ``current`` says that ``version`` cannot.
        """
        if current and version is not None:
            raise ValidationError(
                f"current=True reads a bank's head and version {version!r} names a "
                f"snapshot beside it; pass current=False to read that snapshot, or "
                f"drop the version to read the head"
            )
        if version is not None and case_type is None:
            raise ValidationError(
                f"version {version!r} names a snapshot of one Case Type's bank, so it "
                f"needs a case_type; a version identifier is minted per Case Type and "
                f"shared with none"
            )

        if current:
            if case_type is None:
                return self._current_artifacts, "banks='every current'"
            artifact = self._artifact(case_type, None)
            return (
                lambda: (artifact,),
                f"case_type={artifact.case_type!r}, version=None",
            )

        if version is not None:
            artifact = self._artifact(case_type, version)
            return (
                lambda: (artifact,),
                f"case_type={artifact.case_type!r}, version={version!r}",
            )
        if case_type is None:
            return self._versioned_artifacts, "banks='every published version'"
        slug = _segment("case type", case_type)
        return (
            lambda: self._versioned_artifacts(slug),
            f"case_type={slug!r}, banks='every published version'",
        )

    def _artifact(self, case_type: str, version: str | None) -> _Artifact:
        slug = _segment("case type", case_type)
        stem = slug if version is None else f"{slug}.{_segment('version', version)}"
        return _Artifact(self._banks_dir / f"{stem}.txt", slug, version)

    def _current_artifacts(self) -> tuple[_Artifact, ...]:
        """Every ``{slug}.txt``, ordered by slug so two runs agree.

        Finding none is refused rather than read as an empty dataset.
        """
        artifacts = tuple(
            _Artifact(path, path.stem, None)
            for path in sorted(self._banks_dir.glob("*.txt"))
            if "." not in path.stem
        )
        if not artifacts:
            raise ValidationError(
                f"no current Question Bank artifacts under {self._banks_dir}; "
                f"expected at least one '<slug>.txt'"
            )
        return artifacts

    def _versioned_artifacts(
        self, case_type: str | None = None
    ) -> tuple[_Artifact, ...]:
        """Every ``{slug}.{version}.txt``, optionally for one Case Type.

        Split from :meth:`_current_artifacts` on the rule the filenames were
        minted under, read backwards. **The head is deliberately not in this
        set**: it is the same bank as its own snapshot under a second name, and
        including both double counts every question under that version.
        """
        artifacts = []
        for path in sorted(self._banks_dir.glob("*.txt")):
            slug, dot, version = path.stem.partition(".")
            if dot and case_type in (None, slug):
                artifacts.append(_Artifact(path, slug, version))
        if not artifacts:
            of_one = f" for case type {case_type!r}" if case_type else ""
            raise ValidationError(
                f"no published Question Bank versions{of_one} under "
                f"{self._banks_dir}; expected at least one '<slug>.<version>.txt'"
            )
        return tuple(artifacts)

    def describe(self) -> str:
        return f"QuestionBankStore(banks_dir={str(self._banks_dir)!r})"

```
