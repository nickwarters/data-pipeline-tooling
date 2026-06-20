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

from framework._internal.describe import redact_url, render
from framework.core.dataset import Dataset
from framework.io.readers import GlobCsvReader
from framework.io.strategy import AccumulateByRun, Refresh
from framework.io.writers import _stamp_accumulate_frame


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


class SasReader:
    """Read a SAS feed by running it remotely and reading the landed output."""

    def __init__(
        self,
        script: str,
        copy_glob: str,
        dest: str | os.PathLike[str],
        *,
        runner: RemoteRunner | None = None,
    ) -> None:
        self._script = script
        self._copy_glob = copy_glob
        self._dest = Path(dest)
        self._runner = runner or StubbedRemoteRunner()

    def read(self) -> Dataset:
        self._runner.run_script(self._script)
        self._runner.fetch(self._copy_glob, self._dest)
        return GlobCsvReader(self._dest, self._copy_glob).read()

    def describe(self) -> str:
        return render(
            self,
            script=self._script,
            copy_glob=self._copy_glob,
            dest=str(self._dest),
        )


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

    def read(self) -> Dataset:
        return self._fetcher.fetch(self._site, self._list_name, self._auth)

    def describe(self) -> str:
        # Render the site with any embedded credentials stripped and omit the
        # auth config entirely — the plan never surfaces secrets.
        return render(self, site=redact_url(self._site), list_name=self._list_name)


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

    def write(self, dataset: Dataset) -> None:
        if isinstance(self._strategy, AccumulateByRun):
            dataset = Dataset.from_pandas(
                _stamp_accumulate_frame(dataset.to_pandas(), self._strategy)
            )
        self._pusher.push(
            self._site,
            self._list_name,
            self._auth,
            dataset,
            self._strategy,
        )

    def describe(self) -> str:
        # Strip any credentials embedded in the site URL and omit auth config
        # entirely — the plan never surfaces secrets.
        return render(self, site=redact_url(self._site), list_name=self._list_name)
