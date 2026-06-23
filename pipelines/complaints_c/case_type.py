"""The ``complaints_c`` Case Type: its schema bundled with its identity contract.

A :class:`~case_review.case_type.CaseType` bundles the feed's declared ``schema``
with its **identity contract**: the ``natural_key`` column(s) that identify a
Case, from which the Case Type derives its own ``namespace`` and deterministic
``case_id``. Declaring it here once means the raw -> silver spine and any gold
step you add read identity off the same object, so a Case and its Detail rows
derive the same ``case_id`` without a cross-pipeline join.

Set ``natural_key`` to your feed's stable identifying column(s); add ``Variation``
entries (e.g. the review platform's Question Bank) if the Case Type has them.
"""

from __future__ import annotations

from case_review.case_type import CaseType

from .schema import ComplaintsCRow

CASE_TYPE = CaseType(
    name="complaints_c",
    schema=ComplaintsCRow,
    natural_key=("record_id",),
)
