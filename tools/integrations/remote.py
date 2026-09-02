"""Remote IO seams for SAS and SharePoint feeds.

Remote behaviour stays behind small interfaces so local Readers and Writers are
testable with fixtures and can later swap in platform-specific clients without
changing pipeline code.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol, runtime_checkable

import pandas as pd

from framework._internal.describe import render
from framework.core.dataset import Dataset
from framework.io.strategy import AccumulateByRun, Refresh
from tools.integrations.locations import sharepoint_location


@runtime_checkable
class RemoteRunner(Protocol):
    """The SAS shell/transfer seam: run a script remotely, copy outputs back."""

    def run_script(self, script: str) -> None:
        """Execute ``script`` on the remote SAS host."""
        ...

    def fetch(self, copy_glob: str, dest: Path) -> None:
        """Copy the remote files matching ``copy_glob`` into local ``dest``."""
        ...


class StubbedRemoteRunner:
    """No-op :class:`RemoteRunner` for already-landed output files."""

    def run_script(self, script: str) -> None:  # pragma: no cover - no-op stub
        return None

    def fetch(
        self, copy_glob: str, dest: Path
    ) -> None:  # pragma: no cover - no-op stub
        return None


@runtime_checkable
class SharePointFetcher(Protocol):
    """The SharePoint download seam: fetch one list's rows as a Dataset."""

    def fetch(self, site: str, list_name: str, auth: object) -> Dataset:
        """Fetch ``list_name`` from ``site`` (authenticated with ``auth``)."""
        ...


@runtime_checkable
class SharePointPusher(Protocol):
    """The SharePoint upload seam: push a Dataset to one list."""

    def push(
        self,
        site: str,
        list_name: str,
        auth: object,
        dataset: Dataset,
        strategy: object,
    ) -> None:
        """Push ``dataset`` to ``list_name`` at ``site`` using ``strategy``."""
        ...


class StubbedSharePointFetcher:
    """The default SharePoint fetcher: raises until a real client is supplied."""

    def fetch(self, site: str, list_name: str, auth: object) -> Dataset:
        raise NotImplementedError(
            "SharePoint fetch is not implemented yet (on-prem SE connection "
            "deferred). Pass a fetcher, e.g. LocalCsvFetcher(path), "
            "to read from a local fixture."
        )


class StubbedSharePointPusher:
    """The deferred SharePoint write client: pushing raises until implemented."""

    def push(
        self,
        site: str,
        list_name: str,
        auth: object,
        dataset: Dataset,
        strategy: object,
    ) -> None:
        raise NotImplementedError(
            "SharePoint push is not implemented yet (on-prem SE connection "
            "deferred). Pass a pusher test double, or a real client "
            "later, to write to a SharePoint list."
        )


class LocalCsvFetcher:
    """An offline :class:`SharePointFetcher` backed by a local CSV fixture."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self._path = Path(path)

    def fetch(self, site: str, list_name: str, auth: object) -> Dataset:
        return Dataset.from_pandas(pd.read_csv(self._path))


class SharePointReader:
    """Read a SharePoint list into a Dataset through a swappable fetcher."""

    def __init__(
        self,
        site: str,
        list_name: str,
        auth: object = None,
        *,
        fetcher: SharePointFetcher | None = None,
    ) -> None:
        self._site = site
        self._list_name = list_name
        self._auth = auth
        self._fetcher = fetcher or StubbedSharePointFetcher()
        self.data_locations: list[dict[str, str]] = []

    def read(self) -> Dataset:
        self.data_locations = [sharepoint_location(self._site, self._list_name)]
        return self._fetcher.fetch(self._site, self._list_name, self._auth)

    def describe(self) -> str:
        # The auth config is omitted from the plan.
        return render(self, site=self._site, list_name=self._list_name)


class SharePointWriter:
    """Emit a Dataset to a SharePoint list through a swappable pusher."""

    def __init__(
        self,
        site: str,
        list_name: str,
        auth: object = None,
        strategy: Refresh | AccumulateByRun = Refresh(),
        *,
        pusher: SharePointPusher | None = None,
    ) -> None:
        self._site = site
        self._list_name = list_name
        self._auth = auth
        self._strategy = strategy
        self._pusher = pusher or StubbedSharePointPusher()
        self.data_locations: list[dict[str, str]] = []

    def write(self, dataset: Dataset) -> None:
        self.data_locations = [sharepoint_location(self._site, self._list_name)]
        if isinstance(self._strategy, AccumulateByRun):
            dataset = Dataset.from_pandas(self._strategy.stamp(dataset.to_pandas()))
        self._pusher.push(
            self._site,
            self._list_name,
            self._auth,
            dataset,
            self._strategy,
        )

    def describe(self) -> str:
        # The auth config is omitted from the plan.
        return render(self, site=self._site, list_name=self._list_name)
