```python
"""How a SharePoint component names the list it touched.

The ``{namespace, name}`` shape a Reader or Writer reports on ``data_locations``
for the run record — the SharePoint counterpart of
``framework._internal.locations``' ``file_location`` / ``table_location``. It
lives here rather than there because SharePoint is application integration, not
framework IO vocabulary.

One copy, because the redaction is the point: a persisted run record must not be
the one place credentials embedded in a site URL survive, and a second copy of
that rule is a second place to forget it.
"""

from __future__ import annotations

from framework._internal.describe import redact_url


def sharepoint_location(site: str, list_name: str) -> dict[str, str]:
    """One SharePoint list, with any credentials in the site URL stripped."""
    return {"namespace": redact_url(site), "name": list_name}

```
