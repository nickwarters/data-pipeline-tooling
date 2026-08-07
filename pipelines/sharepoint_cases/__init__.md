```python
"""Ingest feed for one Case Type's SharePoint list, source -> raw -> silver.

Polls the list by its ``Modified`` window and lands each observation twice: raw
in SharePoint's own column names, silver snake_cased, typed and validated. Both
are append-only histories of immutable source versions.
"""

```
