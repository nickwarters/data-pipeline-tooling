```python
"""How a SharePoint component names the list it touched.

The ``{namespace, name}`` shape a Reader or Writer reports on ``data_locations``
for the run record — the SharePoint counterpart of
``framework._internal.locations``' ``file_location`` / ``table_location``. It
lives here rather than there because SharePoint is application integration, not
framework IO vocabulary.

One copy, so the shape has one definition rather than one per component.
"""

from __future__ import annotations


def sharepoint_location(site: str, list_name: str) -> dict[str, str]:
    return {"namespace": site, "name": list_name}

```
