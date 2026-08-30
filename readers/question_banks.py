"""The Case Review Platform's published **Question Bank** artifacts, as rows.

The review platform owns the Question Bank outright — its content, and which
bank a Case gets (root ``CONTEXT.md``, *Question Bank ownership*). This side
only ever *reads* it, and reads it as a **published contract**: the export
artifact specified by
``platform_frontend/docs/reporting-data-contract.md``, which exists precisely so
an external reporting process can turn Case data into question-level reports
without executing any Case Type logic.

Two filename forms, and they are the whole of the ``version`` argument:

``{slug}.txt``
    The **current** bank — what an in-progress Case is being reviewed against,
    and what a Case completed today would be stamped with. Also the only file
    carrying the ``labels`` table and the ``history`` list.
``{slug}.{version}.txt``
    An immutable **versioned** snapshot. A completed Case row carries the
    identifier it was reviewed against in ``questionBankVersion``; passing that
    value here gives the as-reviewed wording, ``optionOutcomes`` and
    ``showWhen``, free of drift from later bank edits.

The ``.txt`` extension is a SharePoint constraint, not a format: both files hold
JSON, and both are parsed explicitly rather than by trusting a content type.

Two datasets, because one artifact declares two things
------------------------------------------------------

An artifact carries the Case Type's **questions** *and* the **outcome options**
those questions' answers map onto — a different grain, ~50 rows against ~4, so
they are two Readers rather than one denormalised frame:

``reader(...)``
    A row per question. ``option_outcomes`` maps each answer *wording* to an
    outcome ``id``.
``outcomes_reader(...)``
    A row per outcome option: its ``id``, its ``wording``, and its ``severity``
    — the score that ranks them, which is what makes an Outcome comparable at
    all (the case verdict is the highest-severity applicable mapped outcome).

They join on ``id``, and both carry ``default_outcome_id`` so the failure test —
*an option mapped to anything other than the default fails* — can be applied
from either side.

Two readers, one per grain
---------------------------

``qb_reader`` and ``outcomes_reader`` are the whole surface. Every argument is
optional and every argument **narrows**; the defaults are the widest sensible
read::

    store.qb_reader()                             # every Case Type's head
    store.qb_reader("complaints")                 # that Case Type's head
    store.qb_reader(current=False)                # every published snapshot
    store.qb_reader("complaints", current=False)  # that Case Type's snapshots
    store.qb_reader("complaints", v, current=False)   # that one snapshot

``case_type`` picks one Case Type out of all of them. ``current`` picks which
*kind* of artifact — the mutable heads (``{slug}.txt``) or the immutable
snapshots (``{slug}.{version}.txt``). ``version`` pins one snapshot out of a
Case Type's. Every combination means something, bar two:

``qb_reader(case_type, version)`` — refused
    ``current=True`` names a head and a version names a snapshot beside it.
    This is the contradiction a Case row walks into: ``questionBankVersion`` is
    absent on an in-progress Case and present on a completed one, so a consumer
    passing it straight through would silently read a different *kind* of file
    depending on the row. Refusing puts the branch at the call site.
``qb_reader(None, version, current=False)`` — refused
    A version identifier is minted per Case Type and shared with none, so
    "every bank at version X" is not a set.

``current=False`` **without** a version is deliberately allowed, and it is what
lets two methods do the work of four: there is no such thing as "the" snapshot,
so the natural reading of an unpinned ``current=False`` is *every* snapshot.
It is also the only thing ``current`` says that ``version`` cannot — with the
pairing above refused, a version already implies a snapshot, so "unpinned" is
the parameter's entire job.

**The snapshots sweep is the ``{slug}.{version}.txt`` files and never the
heads.** Those two are not the same set, and the difference is a silent double
count. A current bank declares the version it was last published as, so
``complaints.txt`` and ``complaints.49fee….txt`` are today the *same* bank at
the *same* version under two names; reading both yields two identical,
individually-correct rows per question, and any figure grouped by version is
then twice what it should be. De-duplicating them would be shaping (G5) and
would hide a genuine disagreement if the two ever diverged. So ``current``
splits the directory where the artifacts themselves split it, and a head whose
version has no snapshot beside it is absent from ``current=False``, correctly —
it has not been published as one. Comparing the two reads' ``version`` sets is
how you find that out.

Narrowing by ``case_type`` is *which artifacts to open*, which this store has
always decided — it is not the row-level predicate pushdown left open at the end
of ``docs/shared-readers.md``, and applying it to both kinds of artifact is what
makes the grid complete rather than holed.

A **store** rather than one class per dataset, because a Question Bank is not
one dataset: it is a family, two-dimensional in Case Type and version, and
neither dimension is enumerable from a consumer. That does not weaken G4: the
store is the factory, so a *Reader* is still fully parametrised by the time it
exists and still answers ``read()`` and nothing else. What it must not grow is a
``reader.for_version(...)``.

**Where the artifacts live is this module's business** (G3), and today's answer
is the frontend's own source tree, ``platform_frontend/case-types/banks/``. It
is not a fixture: those are the bytes that deploy, unchanged
([ADR-0041](../platform_frontend/docs/adr/0041-deployed-bytes-are-source-bytes.md)).
The day a pipeline reads them from a synced drop under the base directory, or
over HTTP from the deployed folder, the answer changes here and no call site
moves — which is why the store takes ``base_dir`` even though it has nothing to
resolve with it yet.
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

#: Where the artifacts live today. The frontend's source tree *is* its deployed
#: tree, so this is the published contract and not a copy of one.
_BANKS_DIR = (
    Path(__file__).resolve().parents[1] / "platform_frontend" / "case-types" / "banks"
)

#: Envelope field -> column, on every row of both datasets.
#:
#: A question means nothing without the ``default_outcome_id`` its
#: ``option_outcomes`` are read against, and a figure is only reproducible if
#: the ``version`` it came from travels with it — so the envelope is stamped
#: rather than left for a consumer to carry alongside. ``generatedAt`` is absent
#: from the current bank and present on every versioned one, so its column is a
#: gap for the former.
_ENVELOPE_FIELDS = {
    "slug": "slug",
    "label": "label",
    "version": "version",
    "generatedAt": "generated_at",
    "defaultOutcomeId": "default_outcome_id",
}

#: Question field -> column. A question carries only the keys that apply to it —
#: ``labelIds``, ``showWhen``, ``remediationActions`` and ``category`` are each
#: on a minority of rows — so every one of these is landed as a gap when absent.
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

#: Outcome option field -> column.
#:
#: ``wording`` is what an answer *is* — it is the key side of a question's
#: ``option_outcomes`` map — and ``id`` is what it *counts as*, the value side.
#: ``severity`` is the score that orders them: the review platform resolves a
#: Case's verdict as the highest-severity applicable mapped outcome, so it is
#: the field that makes "worse" mean anything.
_OUTCOME_FIELDS = {
    "id": "id",
    "wording": "wording",
    "severity": "severity",
}

#: One row per question, in the order the artifact declares them.
#:
#: Names are the artifact's own, canonicalised from camelCase and nothing more —
#: so ``id`` and ``text`` are the *question*'s, never a Case's. Renaming for a
#: consumer's convenience is that consumer's business (G5).
QUESTION_COLUMNS = (
    *_ENVELOPE_FIELDS.values(),
    "outcome_options",
    "position",
    *_QUESTION_FIELDS.values(),
)

#: One row per outcome option, in the order the artifact declares them.
#:
#: Deliberately small and deliberately not denormalised into
#: :data:`QUESTION_COLUMNS`: ~4 rows against ~50 is a different grain, and a
#: consumer counting outcomes should not have to de-duplicate questions first.
OUTCOME_COLUMNS = (
    *_ENVELOPE_FIELDS.values(),
    "position",
    *_OUTCOME_FIELDS.values(),
)

#: The question columns holding a nested structure, landed as a JSON string.
#:
#: ``Dataset`` is a tabular carrier and these are objects and arrays, so one of
#: the two has to give. Encoding keeps them whole, keeps them writable to a
#: table unchanged, and keeps the decision here rather than in each consumer;
#: ``json.loads`` on the column is the other half. An absent key stays a **gap**
#: rather than becoming the string ``"null"`` — a question with no ``showWhen``
#: is unconditional, which is not the same statement as one whose rule is null.
#:
#: The outcome options have no nested fields, which is most of why they are
#: worth a Reader of their own: ``severity`` arrives as a number to sort on
#: rather than as a string to parse back out of ``outcome_options``.
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
    """Refuse anything that is not a single, plain filename segment.

    A ``version`` reaches this module off a Case row and a ``case_type`` off a
    Case Type's configuration — both are data, and both are pasted into a path.
    The contract says to treat a version as an opaque label and never to parse
    it, which is exactly the argument for checking it can only ever name a file
    *in this directory*.
    """
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

    ``slug`` is the join key to a Case's ``caseType`` and ``version`` is what a
    completed Case was stamped with; the contract has each echoed inside the
    file it names. If a file and its own envelope disagree, every figure derived
    from it is attributed to the wrong bank — and silently, because both values
    look perfectly well-formed on their own.
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
    """The walk shared by all four Readers: resolve, parse, explode, stack.

    Subclassed rather than composed, and only inside this module: the two
    subclasses differ by *which array of the envelope they are a row per element
    of* and nothing else, so there is one method to override. The
    compose-don't-subclass rule in ``readers/__init__`` is about not subclassing
    the framework's ``Reader`` — which neither of these does; ``Reader`` is a
    structural Protocol and they satisfy it by shape.
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
    """A Case Type's questions — one row per question, in declared order.

    Minted by :class:`QuestionBankStore`, never constructed directly: the path
    is the store's secret, and a consumer holding one has been told the source
    is a file.
    """

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

    The small dataset behind every ranking question: ``severity`` is the score
    the review platform resolves a Case's verdict with (highest applicable
    mapped outcome wins), and ``wording`` is the key side of a question's
    ``option_outcomes`` map, so this joins to
    :class:`QuestionBankReader`'s rows from either end.

    Minted by :class:`QuestionBankStore`, never constructed directly.
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

    ::

        store = QuestionBankStore(context.base_dir)

        store.qb_reader()                             # every current bank
        store.qb_reader("complaints")                 # that bank's head
        store.qb_reader(current=False)                # every published snapshot
        store.qb_reader("complaints", current=False)  # that bank's snapshots
        store.qb_reader("complaints", v, current=False)   # one snapshot

        store.outcomes_reader(...)           # the same five, at the other grain

    ``base_dir`` is taken and **not used**, deliberately and for the same reason
    ``UsersReader`` takes it: resolving a location is this module's job, and
    today's answer happens to be a directory in the repository. The signature is
    already the one a synced drop under the base directory would need.

    ``banks_dir`` is a **test and spike seam**, keyword-only so it cannot be
    passed by accident. Nothing in ``pipelines/`` should use it.
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
        """Questions: one bank's, or every Case Type's current bank stacked.

        ``qb_reader()``
            Every Case Type's current bank.
        ``qb_reader("complaints")``
            That Case Type's current bank — the mutable head.
        ``qb_reader(current=False)``
            Every published snapshot of every Case Type.
        ``qb_reader("complaints", current=False)``
            That Case Type's whole published history.
        ``qb_reader("complaints", version, current=False)``
            The one snapshot a completed Case was reviewed against.

        Stacked over more than one artifact, nothing is added to tell them
        apart and nothing is reconciled between them: ``slug`` and ``version``
        are on every row already, a question ``id`` is unique only within its
        own bank, and two Case Types asking the same thing stay two rows.

        See :meth:`_resolve` for the two combinations that are refused. Nothing
        is opened here: a missing bank surfaces at ``read()``, as a missing file
        does from every other Reader, rather than in a new way of the store's
        own.
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
        """Outcome options: one bank's, or every Case Type's current bank stacked.

        The same five shapes as :meth:`qb_reader`, at the other grain. Stacked
        over every current bank it is the cross-Case-Type view of severity —
        whether two Case Types score the same wording the same way is a
        question this answers and no per-bank Reader can. Stacked over the
        snapshots it is the cross-*time* one: a severity can be re-scored
        between publications, and reading today's would attribute a completed
        Case to a ranking that did not exist when it was reviewed.
        """
        resolve, described = self._resolve(case_type, version, current=current)
        return OutcomeOptionsReader(
            resolve, described_as=f"OutcomeOptionsReader({described})"
        )

    def _resolve(
        self, case_type: str | None, version: str | None, *, current: bool
    ) -> tuple[Callable[[], Iterable[_Artifact]], str]:
        """Settle which artifacts a reader will walk, and how it describes them.

        Every argument **narrows**, and their defaults are the widest sensible
        read. ``case_type`` picks one Case Type out of all of them, ``current``
        picks which *kind* of artifact — the mutable heads or the immutable
        snapshots — and ``version`` pins one snapshot out of a Case Type's.
        Every combination therefore means something, bar two:

        - ``current=True`` with a ``version`` is a contradiction: ``current``
          names a bank's head and a version names a snapshot beside it. It is
          the contradiction a Case row walks into — ``questionBankVersion`` is
          absent on an in-progress Case and present on a completed one, so a
          consumer passing it straight through would silently read a different
          *kind* of file depending on the row. Refusing puts that branch at the
          call site instead.
        - A ``version`` with no ``case_type`` names nothing: a version
          identifier is minted per Case Type and shared with none, so "every
          bank at version X" is not a set.

        ``current=False`` without a version is **not** refused, and that is what
        collapsed this store to two methods. There is no such thing as "the"
        snapshot, so the natural reading of an unpinned ``current=False`` is
        *every* snapshot — which is exactly the sweep that used to need a method
        of its own. It is also the only thing ``current`` says that ``version``
        cannot: with the pairing refused above, a ``version`` already implies a
        snapshot, so unpinned is the parameter's whole job.
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
        """Every ``{slug}.txt`` in the directory, ordered by slug.

        A versioned artifact is ``{slug}.{version}.txt``, so the current banks
        are exactly the files whose stem carries no further dot — the same rule
        the filenames are minted under, read backwards.

        Ordered so two runs over one directory produce rows in the same order;
        directory iteration order is the filesystem's business and differs
        between Windows and macOS.

        **Finding none is refused**, rather than returned as an empty dataset. A
        deployed banks folder always has at least one bank, so zero is a broken
        sync or a wrong root — and a report of nothing, published, looks exactly
        like a report of nothing that is true.
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
        """Every ``{slug}.{version}.txt`` in the directory, ordered by both.

        Narrowed to one Case Type when ``case_type`` is given. That is the same
        selection ``qb_reader("complaints")`` already makes over the heads —
        *which artifacts to open*, which this store has always decided — and not
        the row-level predicate pushdown left open at the end of
        ``docs/shared-readers.md``. Applying it to both kinds is what makes the
        argument grid complete rather than holed.

        The complement of :meth:`_current_artifacts`, split on the same rule
        read the same way: a stem carrying a further dot was minted as
        ``f"{slug}.{version}"``, so it partitions back at the first one. A
        version identifier is opaque and contains no dot in anything the
        platform publishes; if one ever did, the envelope echo check in
        :func:`_load` is what catches the mis-split, not a guess here.

        **The current head is deliberately not in this set**, even though it
        declares a version of its own — it is the same bank as its snapshot
        under a second name, and including both double counts every one of its
        questions under a version that then reports twice its true figure.

        Finding none is refused, as it is for the current sweep: a directory
        holding banks but no published snapshot of any of them is a partial
        sync, and an empty history published as a history is indistinguishable
        from a true one.
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
