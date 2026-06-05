```python
"""Remote-IO seams for the SAS and SharePoint feeds.

Neither source can run on the framework host (SAS doesn't run on macOS; the
SharePoint tenant/auth is deferred), so the remote behaviour — shelling to
``ssh``/``scp``, calling the SharePoint API — is kept behind small interfaces
that are **stubbed for now** and swappable for a library later (ADR-0004,
ADR-0005). The Readers in :mod:`framework.readers` own the local read path and
talk only to these seams, so the whole feed is testable against local fixtures
with no network, SAS box, or tenant.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol, runtime_checkable

import pandas as pd

from framework.dataset import Dataset


@runtime_checkable
class RemoteRunner(Protocol):
    """The SAS box's shell/transfer seam: run a script remotely, copy outputs back.

    The cross-platform escape hatch (AC4): ``ssh``/``scp`` today, a library such
    as ``paramiko`` later, swapped without touching :class:`SasReader`. Both
    methods are side-effecting and return nothing; the Reader reads whatever the
    runner lands in ``dest`` via the ordinary file read path.
    """

    def run_script(self, script: str) -> None:
        """Execute ``script`` on the remote SAS host."""
        ...

    def fetch(self, copy_glob: str, dest: Path) -> None:
        """Copy the remote files matching ``copy_glob`` into local ``dest``."""
        ...


class StubbedRemoteRunner:
    """No-op :class:`RemoteRunner` — the default until SSH/scp is implemented.

    Runs nothing and copies nothing; it assumes the output files are already
    landed in ``dest`` (a fixture in tests, a previously-copied directory in
    practice). This is the stub that ADR-0004 defers: the real ssh/scp body
    drops in behind the same interface later.
    """

    def run_script(self, script: str) -> None:  # pragma: no cover - no-op stub
        return None

    def fetch(self, copy_glob: str, dest: Path) -> None:  # pragma: no cover - no-op stub
        return None


@runtime_checkable
class SharePointFetcher(Protocol):
    """The SharePoint download seam: fetch one list's rows as a Dataset.

    Engine-confined like a Reader's internals — the concrete client (the
    SharePoint/Graph API today's stub defers) lives behind this interface and
    behind the Dataset seam, swappable for a real client later (ADR-0005).
    """

    def fetch(self, site: str, list_name: str, auth: object) -> Dataset:
        """Fetch ``list_name`` from ``site`` (authenticated with ``auth``)."""
        ...


class StubbedSharePointFetcher:
    """The deferred SharePoint client: fetching raises until it is implemented.

    SharePoint auth and the tenant are out of scope for this slice (ADR-0004),
    so the default fetcher refuses to pretend it reached the network. Supply a
    :class:`LocalCsvFetcher` (or a real client later) to exercise the read path.
    """

    def fetch(self, site: str, list_name: str, auth: object) -> Dataset:
        raise NotImplementedError(
            "SharePoint fetch is not implemented yet (auth/tenant deferred — "
            "ADR-0004). Pass a fetcher, e.g. LocalCsvFetcher(path), to read "
            "from a local fixture."
        )


class LocalCsvFetcher:
    """An offline :class:`SharePointFetcher` backed by a local CSV fixture.

    Stands in for the SharePoint client so the feed is testable with no tenant:
    it ignores ``site``/``list_name``/``auth`` and reads the fixture file. The
    same shape a real client will take once SharePoint auth lands.
    """

    def __init__(self, path: str | os.PathLike[str]) -> None:
        # Path keeps separators OS-agnostic across Windows and macOS.
        self._path = Path(path)

    def fetch(self, site: str, list_name: str, auth: object) -> Dataset:
        return Dataset.from_pandas(pd.read_csv(self._path))

```
