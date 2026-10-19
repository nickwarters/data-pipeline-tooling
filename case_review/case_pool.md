```python
"""``CasePool`` — the case-review population behind domain-named reads.

The CasePool is the application/domain abstraction exposed to case-review
pipelines instead of raw ``pandas.read_*`` calls. It reads a Case Type's current
gold table through the type's **gold** namespace ``Store``, repairs
storage-round-tripped values toward its declared schema, and returns framework
``Dataset`` objects for downstream pipelines.
"""

from __future__ import annotations

from datetime import date

from framework.core import Dataset
from framework.transform import Filter, SchemaCoercion
from tools.calendar import WorkingDayCalendar
from tools.store import Store


class CasePool:
    """One Case Type's population of Cases, read from its ingested gold."""

    def __init__(
        self,
        table: str,
        schema: type,
        gold: Store,
        calendar: WorkingDayCalendar,
    ) -> None:
        self._table = table
        self._schema = schema
        self._gold = gold
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
        expressed in Python and performed after reading through the gold
        namespace ``Store``.
        """
        dataset = self._gold.reader(self._table).read()
        dataset = SchemaCoercion(self._schema)(dataset)

        window = set(self._calendar.last_n_working_days(within_working_days, as_of))
        return Filter(lambda row: row[activity_column].date() in window)(dataset)

```
