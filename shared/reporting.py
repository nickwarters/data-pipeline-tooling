"""The literals a reporting Aggregate fills a missing dimension with.

An Aggregate table's grain must have no hole in it: a NULL group key is a hole
a reader may silently drop, losing rows from a total. So a dimension that is
absent on a row is filled with one of these literals *before* the group-by,
and the literal lands as a key in its own right.

They are declared once, here, because more than one subject reports over the
same vocabulary -- the ``sharepoint_cases`` Sync aggregates, the
``reviewer_activity`` and ``cora_platform_metric`` Reporting subjects -- and a
reader joining across them must see one spelling. ``shared`` holds them rather
than any one pipeline so no pipeline imports another's module for a constant.
"""

# No source reachable from any feed carries brand yet. Every Case-counting
# aggregate still carries the column, filled with this literal, so the grain's
# shape does not change the day a brand source lands; only the fill does.
UNKNOWN_BRAND = "(unknown)"

# A Person dimension with nobody in it (an unassigned Case, a void with no
# recorded actor).
UNASSIGNED = "(unassigned)"

# A stamp column with no instant in it, where a day column is derived from it.
UNSTAMPED = "(unstamped)"

# The remediation tri-state's real third state (see the Sync ``AnswerRow``),
# not a fill for missing data.
UNDECIDED = "(undecided)"

# An outcome or verdict not yet reached.
UNRESOLVED = "(unresolved)"

# A categorical the source left blank (a state, a void reason).
UNSTATED = "(unstated)"

__all__ = [
    "UNASSIGNED",
    "UNDECIDED",
    "UNKNOWN_BRAND",
    "UNRESOLVED",
    "UNSTAMPED",
    "UNSTATED",
]
