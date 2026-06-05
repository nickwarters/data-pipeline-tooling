```python
"""``CasePool`` — the domain population of Cases, behind intention-revealing reads.

The CasePool is the clean domain abstraction the platform exposes *instead of*
raw ``pandas.read_*`` calls (CONTEXT.md): it is the full population of a Case
Type's Cases, read from the **ingested gold** layer (the current-only,
one-row-per-Case reduction — ADR-0006 amendment), and it offers domain-named
retrievals the Selection pipeline calls. The headline retrieval is the *concept*
of fetching **available cases** — the candidate Cases eligible to enter
Selection, defined by business availability criteria (e.g. activity dated within
the last N working days — CONTEXT.md), computed in **Python**, never SQL
(ADR-0002).

It is scoped **per Case Type** (CONTEXT.md): constructed from that type's
:class:`~framework.case_type.CaseType` (for its schema), its
:class:`~framework.store.Store` (to read its gold), and a
:class:`~framework.calendar.WorkingDayCalendar` (the availability arithmetic).
Gold round-trips dates through SQLite as text, so the pool re-coerces the read
frame toward the schema's types via :class:`~framework.schema.SchemaCoercion`
before applying the window — the typed-on-demand edge (ADR-0002). The bulk-tier
:class:`~framework.dataset.Dataset` it returns flows straight into the Selection
pipeline; surfacing fully typed ``Case`` objects is a later slice.
"""

from __future__ import annotations

from datetime import date

from framework.calendar import WorkingDayCalendar
from framework.case_type import CaseType
from framework.dataset import Dataset
from framework.processors import Filter
from framework.schema import SchemaCoercion
from framework.store import Store


class CasePool:
    """One Case Type's population of Cases, read from its ingested silver."""

    def __init__(
        self,
        case_type: CaseType,
        store: Store,
        calendar: WorkingDayCalendar,
    ) -> None:
        self._case_type = case_type
        self._store = store
        self._calendar = calendar

    def fetch_available_cases(
        self,
        as_of: date,
        *,
        activity_column: str,
        within_working_days: int,
    ) -> Dataset:
        """Return the Cases available for Selection as of ``as_of``.

        Available = activity dated within the last ``within_working_days``
        working days on or before ``as_of`` (CONTEXT.md). Reads the Case Type's
        gold (current-only, one-row-per-Case), repairs the round-trip-lossy date
        column toward the schema's types, then narrows to the working-day window
        in Python (ADR-0002).
        """
        dataset = self._store.reader("gold", self._case_type.name).read()
        # Silver round-trips dates as text; repair toward the schema's types so
        # the window comparison is date-vs-date, not text-vs-date (ADR-0002).
        dataset = SchemaCoercion(self._case_type.schema).process(dataset)

        window = set(
            self._calendar.last_n_working_days(within_working_days, as_of)
        )
        return Filter(
            lambda row: row[activity_column].date() in window
        ).process(dataset)

```
