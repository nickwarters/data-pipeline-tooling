#!/usr/bin/env python3
"""Sync the deployable runtime tree to SharePoint (issue #253).

Uploads the framework's runtime source files to a SharePoint document library
under ``Style Library/CODE/CORA`` (see issue #253 and the README hosting model:
the Style Library is minimally cached and serves fresh files most consistently).

The deploy is a **sync**, not a blind copy:

- **add** local files missing from the target,
- **update** files whose content has changed,
- **delete** target files with no local counterpart.

Only the sync *policy* lives here. Every actual REST call — folder creation,
listing, upload, delete — goes through the :class:`SharePointDeployClient`
protocol, which is implemented separately (auth handshake, ``X-RequestDigest``,
``_api/web/GetFolderByServerRelativeUrl(...)`` etc.). This keeps the diff logic
pure and unit-testable, and lets the transport/auth choice (NTLM, Kerberos,
app-only) be swapped without touching the plan.

Standard library only — no ``requests``, no third-party packages.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable, Optional, Protocol, runtime_checkable


SCRIPT_ROOT = Path(__file__).resolve().parents[1]

# The document library and folder the runtime lives under. Everything the deploy
# touches is scoped beneath this path — the sync never reaches outside it.
DEFAULT_LIBRARY = "Style Library"
DEFAULT_TARGET_FOLDER = "CODE/CORA"

# The deployable runtime tree. There is no build step, so source JS is deployed
# JS (ADR-0001/0005). These roots deliberately exclude dev/, tests/, docs/,
# node_modules/, and config/dotfiles — they simply live outside the roots.
DEFAULT_INCLUDE_ROOTS = ("src", "case-types")

# Only ship browser-loadable assets. A stray tool artefact under an include root
# (e.g. a generated .map or an editor backup) is not deployed.
DEFAULT_INCLUDE_SUFFIXES = (".js", ".css", ".html", ".aspx")


# --------------------------------------------------------------------------- #
# Client protocol — implemented separately.
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class RemoteFile:
    """A file already present under the target folder.

    ``path`` is POSIX, relative to the target folder (e.g. ``lib/signal.js``).

    ``sha256`` is the hex digest of the remote content when the client can
    supply it cheaply (for example from a deployed manifest or a stored
    property). Leave it ``None`` and the engine falls back to
    :meth:`SharePointDeployClient.download_file` to compare content.
    """

    path: str
    sha256: Optional[str] = None


@runtime_checkable
class SharePointDeployClient(Protocol):
    """The transport the deploy engine drives.

    An implementation owns the SharePoint site URL, the auth handshake, the
    request digest, and the REST surface. All paths are POSIX and **relative to
    the target folder** (``Style Library/CODE/CORA``); the implementation joins
    them onto the library's server-relative URL. Implementations must never
    resolve a path outside the target folder.
    """

    def ensure_folder(self, folder: str) -> None:
        """Ensure ``folder`` (and any missing parents) exists under the target.

        Called with ``""`` for the target folder root, then for each nested
        directory before its files are uploaded. Idempotent: a no-op when the
        folder already exists.
        """
        ...

    def list_files(self) -> Iterable[RemoteFile]:
        """Recursively list every file currently under the target folder.

        Returns one :class:`RemoteFile` per file, with target-relative POSIX
        paths. Return an empty iterable when the target folder is absent or
        empty.
        """
        ...

    def download_file(self, path: str) -> bytes:
        """Return the raw bytes of the target-relative file at ``path``.

        Only called for files whose :attr:`RemoteFile.sha256` was ``None``, to
        decide add-vs-update by content.
        """
        ...

    def upload_file(self, path: str, content: bytes) -> None:
        """Create or overwrite the target-relative file at ``path``.

        The engine guarantees the parent folder was passed to
        :meth:`ensure_folder` first.
        """
        ...

    def delete_file(self, path: str) -> None:
        """Remove the target-relative file at ``path``."""
        ...


# --------------------------------------------------------------------------- #
# Pure diff/plan logic — no I/O, unit-testable.
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class LocalFile:
    """A deployable local file, keyed by its target-relative POSIX path."""

    path: str
    content: bytes

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


@dataclass
class DeployPlan:
    """The add/update/delete work computed from a local/remote comparison."""

    adds: list[str] = field(default_factory=list)
    updates: list[str] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)

    @property
    def is_noop(self) -> bool:
        return not (self.adds or self.updates or self.deletes)

    def summary(self) -> str:
        return (
            f"{len(self.adds)} to add, "
            f"{len(self.updates)} to update, "
            f"{len(self.deletes)} to delete"
        )


def collect_local_files(
    root: Path,
    include_roots: Iterable[str] = DEFAULT_INCLUDE_ROOTS,
    include_suffixes: Iterable[str] = DEFAULT_INCLUDE_SUFFIXES,
) -> dict[str, LocalFile]:
    """Gather the deployable tree, keyed by target-relative POSIX path.

    Files are read from ``root/<include_root>/**`` and keyed *including* the
    include-root prefix, so ``src/lib/signal.js`` deploys to
    ``<target>/src/lib/signal.js`` and the layout is preserved.
    """
    suffixes = tuple(include_suffixes)
    files: dict[str, LocalFile] = {}
    for include_root in include_roots:
        base = root / include_root
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix not in suffixes:
                continue
            rel = PurePosixPath(path.relative_to(root).as_posix())
            files[str(rel)] = LocalFile(str(rel), path.read_bytes())
    return files


def compute_plan(
    local: dict[str, LocalFile],
    remote: dict[str, RemoteFile],
    download: Callable[[str], bytes],
) -> DeployPlan:
    """Compare local vs remote by content hash and return a :class:`DeployPlan`.

    ``download`` is called only for remote files whose ``sha256`` is unknown, to
    resolve add-vs-update by content. Ordering is deterministic (sorted paths).
    """
    plan = DeployPlan()

    for rel in sorted(local):
        local_file = local[rel]
        remote_file = remote.get(rel)
        if remote_file is None:
            plan.adds.append(rel)
            continue
        remote_hash = remote_file.sha256
        if remote_hash is None:
            remote_hash = hashlib.sha256(download(rel)).hexdigest()
        if remote_hash != local_file.sha256:
            plan.updates.append(rel)

    for rel in sorted(remote):
        if rel not in local:
            plan.deletes.append(rel)

    return plan


# --------------------------------------------------------------------------- #
# Execution — drives the client from a computed plan.
# --------------------------------------------------------------------------- #


def parent_folders(path: str) -> list[str]:
    """Return the ancestor folders of ``path``, root-first (excluding ``path``).

    ``src/lib/signal.js`` -> ``["src", "src/lib"]``. Used to ensure every
    directory exists before a file is uploaded into it.
    """
    parts = PurePosixPath(path).parts[:-1]
    return ["/".join(parts[: i + 1]) for i in range(len(parts))]


def execute_plan(
    plan: DeployPlan,
    local: dict[str, LocalFile],
    client: SharePointDeployClient,
    log=print,
) -> None:
    """Apply ``plan`` through ``client``. Assumes ``plan`` is non-empty.

    Folders are created before their uploads; a failure propagates (fail loudly
    on partial upload) rather than being swallowed.
    """
    client.ensure_folder("")
    ensured: set[str] = {""}

    for rel in plan.adds + plan.updates:
        for folder in parent_folders(rel):
            if folder not in ensured:
                client.ensure_folder(folder)
                ensured.add(folder)
        client.upload_file(rel, local[rel].content)
        log(f"  uploaded {rel}")

    for rel in plan.deletes:
        client.delete_file(rel)
        log(f"  deleted  {rel}")


def print_plan(plan: DeployPlan, log=print) -> None:
    for rel in plan.adds:
        log(f"  add     {rel}")
    for rel in plan.updates:
        log(f"  update  {rel}")
    for rel in plan.deletes:
        log(f"  delete  {rel}")
    log(plan.summary())


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class DeployOptions:
    root: Path
    site_url: str
    library: str
    target_folder: str
    dry_run: bool


def parse_args(argv: list[str]) -> DeployOptions:
    parser = argparse.ArgumentParser(
        description=(
            "Sync the deployable runtime tree (src/, case-types/) to "
            "SharePoint under Style Library/CODE/CORA."
        )
    )
    parser.add_argument(
        "--site-url",
        required=True,
        help="Target SharePoint site URL, e.g. https://sp.example.com/sites/cora.",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=SCRIPT_ROOT,
        help="Repository root. Defaults to the current checkout.",
    )
    parser.add_argument(
        "--library",
        default=DEFAULT_LIBRARY,
        help=f'Document library. Defaults to "{DEFAULT_LIBRARY}".',
    )
    parser.add_argument(
        "--target-folder",
        default=DEFAULT_TARGET_FOLDER,
        help=f'Folder within the library. Defaults to "{DEFAULT_TARGET_FOLDER}".',
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the add/update/delete plan without touching SharePoint.",
    )
    args = parser.parse_args(argv)
    return DeployOptions(
        root=args.root.resolve(),
        site_url=args.site_url,
        library=args.library,
        target_folder=args.target_folder,
        dry_run=args.dry_run,
    )


def build_client(opts: DeployOptions) -> SharePointDeployClient:
    """Construct the concrete client for ``opts``.

    Implemented separately (issue #253): wire up the SharePoint SE auth
    handshake (browser NTLM/Kerberos per ADR-0010) and REST transport here, then
    delete this guard.
    """
    raise NotImplementedError(
        "SharePointDeployClient is not implemented yet. Implement it (auth + REST "
        "against Style Library/CODE/CORA) and construct it here, or run with "
        "--dry-run to preview the plan."
    )


def run(opts: DeployOptions, client_factory=build_client, log=print) -> int:
    target = f"{opts.library}/{opts.target_folder}"
    log(f"Deploy target: {opts.site_url} -> {target}")

    local = collect_local_files(opts.root)
    if not local:
        log("No deployable files found. Nothing to do.")
        return 1
    log(f"Local deployable files: {len(local)}")

    if opts.dry_run:
        # A dry run still needs to read the remote side to produce a real plan.
        # When the client can't be built (not implemented / no creds), fall back
        # to an empty remote so the plan shows a full first-deploy.
        try:
            client = client_factory(opts)
            remote = {rf.path: rf for rf in client.list_files()}
            download = client.download_file
        except NotImplementedError as error:
            log(f"(dry-run) no client available: {error}")
            log("(dry-run) assuming an empty target — showing a full first deploy.")
            remote = {}
            download = lambda path: b""  # noqa: E731 - only reached if remote non-empty
        plan = compute_plan(local, remote, download)
        log("Planned changes (dry run, nothing written):")
        print_plan(plan, log=log)
        return 0

    client = client_factory(opts)
    remote = {rf.path: rf for rf in client.list_files()}
    plan = compute_plan(local, remote, client.download_file)
    print_plan(plan, log=log)
    if plan.is_noop:
        log("Already in sync. Nothing to do.")
        return 0
    log("Applying changes...")
    execute_plan(plan, local, client, log=log)
    log("Done.")
    return 0


def main(argv: list[str]) -> int:
    try:
        return run(parse_args(argv))
    except Exception as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
