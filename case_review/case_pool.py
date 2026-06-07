"""``CasePool`` — the case-review population behind domain-named reads.

The CasePool is the application/domain abstraction exposed to case-review
pipelines instead of raw ``pandas.read_*`` calls. It is scoped per Case Type,
reads the type's current gold table through the generic framework ``Store``,
repairs storage-round-tripped values toward the Case Type schema, and returns
framework ``Dataset`` objects for downstream pipelines.
"""

from __future__ import annotations

from datetime import date

from case_review.case_type import CaseType
from framework.calendar import WorkingDayCalendar
from framework.dataset import Dataset
from framework.processors import Filter
from framework.schema import SchemaCoercion
from framework.store import Store


class CasePool:
    """One Case Type's population of Cases, read from its ingested gold."""

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
        """Return Cases available for Selection as of ``as_of``.

        Available = activity dated within the last ``within_working_days``
        working days on or before ``as_of``. The narrowing is application logic
        expressed in Python and performed after reading through the framework
        ``Store``.
        """
        dataset = self._store.reader("gold", self._case_type.name).read()
        dataset = SchemaCoercion(self._case_type.schema).process(dataset)

        window = set(
            self._calendar.last_n_working_days(within_working_days, as_of)
        )
        return Filter(
            lambda row: row[activity_column].date() in window
        ).process(dataset)

