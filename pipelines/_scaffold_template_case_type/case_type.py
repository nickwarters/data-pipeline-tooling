"""The ``myfeed`` Case Type: its schema bundled with its identity contract.

A :class:`~case_review.case_type.CaseType` bundles the feed's declared ``schema``
with its **identity contract** (ADR-0009): the ``natural_key`` column(s) that
identify a Case, from which the Case Type derives its own ``namespace`` and the
deterministic ``case_id = uuid5(namespace, natural_key)``. Declaring it here —
once — is exactly what the generic feed scaffold deliberately does *not* do; both
the raw -> silver spine in ``pipeline.py`` and any gold step you add read identity
off this one object, so a Case and its Detail rows derive the same ``case_id``
with no cross-pipeline join.

Set ``natural_key`` to your feed's stable identifying column(s); add ``Variation``
entries (e.g. the review platform's Question Bank) if the Case Type has them.
"""

from __future__ import annotations

from case_review.case_type import CaseType

from .schema import MyfeedRow

CASE_TYPE = CaseType(
    name="myfeed",
    schema=MyfeedRow,
    natural_key=("record_id",),
)
