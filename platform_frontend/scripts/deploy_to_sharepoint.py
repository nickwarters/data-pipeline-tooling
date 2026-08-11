#!/usr/bin/env python3
"""Sync the deployable runtime tree to SharePoint.

Uploads the framework's runtime source files to a SharePoint document library
under ``Style Library/CODE/CORA`` (see the README hosting model:
the Style Library is minimally cached and serves fresh files most consistently).

The deploy is a **sync**, not a blind copy:

- **add** local files missing from the target,
- **update** files whose content has changed,
- **delete** target files with no local counterpart.

A pre-flight gate, a dependency-ordered upload and a post-upload hash comparison
bracket that sync, and each of the three is a refusal rather than a repair.

See ``scripts/deploy_to_sharepoint.md`` for the runbook.

Only the sync *policy* lives here. Every call that touches the library — folder
creation, listing, upload, delete — goes through the
:class:`SharePointDeployClient` protocol, which is implemented separately (the
auth handshake plus whatever surface the transport offers: a REST call it shapes
itself, or a file-creation helper it is handed). This keeps the diff logic pure
and unit-testable, and lets the transport/auth choice (NTLM, Kerberos, app-only)
be swapped without touching the plan.

Standard library only — no ``requests``, no third-party packages.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable, Optional, Protocol, runtime_checkable
from urllib.parse import urlsplit


SCRIPT_ROOT = Path(__file__).resolve().parents[1]

# The document library and folder the runtime lives under. Everything the deploy
# touches is scoped beneath this path — the sync never reaches outside it.
DEFAULT_LIBRARY = "Style Library"
DEFAULT_TARGET_FOLDER = "CODE/CORA"

# Per-environment default target folders (ADR-0033). Each environment is a
# fully independent code copy; `--target-folder` still overrides either.
ENV_TARGET_FOLDERS = {"prod": DEFAULT_TARGET_FOLDER, "uat": "CODE/CORA-UAT"}

# The deployable runtime tree. There is no build step, so source JS is deployed
# JS. These roots deliberately exclude dev/, tests/, docs/,
# node_modules/, and config/dotfiles — they simply live outside the roots.
# `host/` holds the production Content Editor host page (host/index.html).
DEFAULT_INCLUDE_ROOTS = ("src", "case-types", "host")

# Only ship browser-loadable assets. A stray tool artefact under an include root
# (e.g. a generated .map or an editor backup) is not deployed.
DEFAULT_INCLUDE_SUFFIXES = (".js", ".css", ".html", ".aspx")

# Question Bank artifacts are JSON stored as .txt (see CLAUDE.md "Gotchas":
# SharePoint SE can block/mis-serve real .json files). `case-types/load-bank.js`
# fetches `./banks/{slug}.txt` relative to its deployed module URL at runtime, so
# these files must ship too. Unlike DEFAULT_INCLUDE_SUFFIXES this is scoped to
# BANKS_DIR only — a stray .txt tool artefact elsewhere under an include root
# (e.g. src/notes.txt) must still be excluded (#435). Every .txt file placed in
# BANKS_DIR is deployable runtime content; synthetic fixtures belong under tests/
# so they cannot accidentally ship to prod or UAT.
BANKS_DIR = "case-types/banks"
BANK_ARTIFACT_SUFFIX = ".txt"

# Suffixes whose content is templated at deploy time (see HOST_BASE_TOKEN).
TEMPLATED_SUFFIXES = (".html", ".aspx")

# Placeholder in host HTML for the deploy target's server-relative base. A
# Content Editor resolves relative URLs against the hosting .aspx page, not the
# Style Library, so host asset references must be absolute server-relative URLs —
# and the base embeds the site name, which is only known at deploy time.
HOST_BASE_TOKEN = "{{CORA_BASE}}"

# Placeholder in host HTML for the environment name ('prod' or 'uat'). The
# deployed host page is what declares its environment (ADR-0033): the app reads
# it back as `window.CORA_ENV` and derives the list prefix and export path.
ENV_TOKEN = "{{CORA_ENV}}"

# The repository's own gate, spelled exactly as the runbook spells it so the two
# cannot drift. It parses every module, resolves every reference case-sensitively,
# evaluates the Case Type configuration, and writes the dependency graph this
# script orders uploads from.
VERIFY_COMMAND = "npm run verify"

# Where that command leaves the graph, on a clean run only.
GRAPH_ARTIFACT = ".verify/import-graph.json"

# The artifact schema this script knows how to read.
GRAPH_VERSION = 2

# What the upload order guarantees, said once for both places that print it.
ORDER_DESCRIPTION = "dependencies first, host page last"


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
    request digest, and the transport surface. Every **target-side** path is
    POSIX and **relative to the target folder** (``Style Library/CODE/CORA``);
    the implementation joins them onto the library's server-relative URL.
    Implementations must never resolve a path outside the target folder.

    The two halves of the content transfer are deliberately asymmetric:
    :meth:`download_file` returns bytes while :meth:`upload_file` is handed a
    local file. Only the upload half has a known transport signature to match,
    and inventing one for the other half would be a guess.
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

        Called to decide add-vs-update when :attr:`RemoteFile.sha256` is
        ``None``, and for every file during post-upload verification.
        """
        ...

    def upload_file(self, source_path: Path, path: str) -> None:
        """Create or overwrite the target-relative file at ``path``.

        ``source_path`` is a :class:`pathlib.Path` to a local file whose bytes
        are exactly the bytes to be served; the implementation owns joining
        ``path`` onto the library. The engine guarantees the parent folder was
        passed to :meth:`ensure_folder` first, and removes the local file when
        the run ends — an implementation must not keep the path for later use.
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


def server_relative_base(site_url: str, library: str, target_folder: str) -> str:
    """Compute the server-relative base URL of the deploy target.

    ``https://sp.example.com/sites/cora`` + ``Style Library`` + ``CODE/CORA``
    -> ``/sites/cora/Style Library/CODE/CORA``. Spaces are kept literal (as in
    the working hand-deploy); the leading site path may be empty for a root-site
    URL. This is what :data:`HOST_BASE_TOKEN` expands to in host HTML.
    """
    site_path = urlsplit(site_url).path.strip("/")
    segments = [seg for seg in (site_path, library, target_folder) if seg]
    return "/" + "/".join(seg.strip("/") for seg in segments)


def render_templated_files(
    files: dict[str, "LocalFile"], tokens: dict[str, str]
) -> dict[str, "LocalFile"]:
    """Return ``files`` with each ``tokens`` placeholder expanded in host HTML.

    The substitution happens *before* hashing and comparison so the local hash
    reflects exactly the bytes uploaded — keeping re-runs idempotent against the
    rendered content stored remotely. Non-templated files pass through unchanged.
    """
    encoded = {
        token.encode("utf-8"): value.encode("utf-8")
        for token, value in tokens.items()
    }
    rendered: dict[str, LocalFile] = {}
    for rel, local_file in files.items():
        content = local_file.content
        if PurePosixPath(rel).suffix in TEMPLATED_SUFFIXES:
            for token, value in encoded.items():
                content = content.replace(token, value)
        if content is local_file.content:
            rendered[rel] = local_file
        else:
            rendered[rel] = LocalFile(rel, content)
    return rendered


def collect_local_files(
    root: Path,
    include_roots: Iterable[str] = DEFAULT_INCLUDE_ROOTS,
    include_suffixes: Iterable[str] = DEFAULT_INCLUDE_SUFFIXES,
) -> dict[str, LocalFile]:
    """Gather the deployable tree, keyed by target-relative POSIX path.

    Files are read from ``root/<include_root>/**`` and keyed *including* the
    include-root prefix, so ``src/lib/signal.js`` deploys to
    ``<target>/src/lib/signal.js`` and the layout is preserved.

    Question Bank artifacts (``case-types/banks/*.txt``) are collected as a
    scoped special case (see :data:`BANKS_DIR`), not via ``include_suffixes`` —
    a ``.txt`` file anywhere else under an include root is still excluded. Every
    artifact in ``BANKS_DIR`` is treated as deployable runtime content; test and
    benchmark fixtures must live outside the runtime include roots.
    """
    suffixes = tuple(include_suffixes)
    files: dict[str, LocalFile] = {}
    for include_root in include_roots:
        base = root / include_root
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            rel = PurePosixPath(path.relative_to(root).as_posix())
            is_bank_artifact = (
                path.suffix == BANK_ARTIFACT_SUFFIX
                and rel.parent == PurePosixPath(BANKS_DIR)
            )
            if not is_bank_artifact and path.suffix not in suffixes:
                continue
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
# Pre-flight gate and graph-derived upload order.
# --------------------------------------------------------------------------- #


class PreflightFailed(Exception):
    """The gate did not pass, or could not be run at all."""


class DeployAborted(Exception):
    """The graph cannot be turned into an upload order that is safe to run."""


def run_preflight(
    root: Path = SCRIPT_ROOT,
    runner=subprocess.run,
    log=print,
) -> Path:
    """Run the verify gate and return the graph artifact it wrote.

    Every way this can go wrong raises, including the gate being unrunnable:
    "gate unavailable, proceeding anyway" is the one outcome a deploy must never
    have. Stdio is inherited so the maintainer reads the gate's own failure lines.
    """
    log(f"Pre-flight: {VERIFY_COMMAND} (in {root})")
    try:
        result = runner(VERIFY_COMMAND.split(), cwd=root, check=False)
    except FileNotFoundError as error:
        raise PreflightFailed(
            f"could not run '{VERIFY_COMMAND}' in {root}: {error}. "
            "Install the dev dependencies (npm install) and try again."
        ) from error
    if result.returncode != 0:
        raise PreflightFailed(
            f"'{VERIFY_COMMAND}' exited {result.returncode} — see its output above"
        )

    artifact = root / GRAPH_ARTIFACT
    if not artifact.is_file():
        raise PreflightFailed(
            f"'{VERIFY_COMMAND}' reported success but wrote no {GRAPH_ARTIFACT}"
        )
    return artifact


def load_import_graph(artifact: Path) -> dict[str, list[str]]:
    """Read the gate's artifact as ``path -> the paths it references``.

    Also checks that the gate scanned the same files this script uploads. The
    two lists are maintained in different languages; asserting they match turns
    a silent hole in the upload order into an abort.
    """
    graph = json.loads(artifact.read_text(encoding="utf-8"))
    version = graph.get("version")
    if version != GRAPH_VERSION:
        raise DeployAborted(
            f"{artifact} is schema version {version!r}, not {GRAPH_VERSION} — "
            "regenerate it with a matching checkout"
        )

    scanned = graph.get("deployable") or {}
    expected = {
        "includeRoots": list(DEFAULT_INCLUDE_ROOTS),
        "includeSuffixes": list(DEFAULT_INCLUDE_SUFFIXES),
        "bankDir": BANKS_DIR,
        "bankSuffix": BANK_ARTIFACT_SUFFIX,
    }
    if scanned != expected:
        raise DeployAborted(
            "the verify gate and this script disagree about which files are "
            f"deployed: gate {scanned!r} vs deploy {expected!r}"
        )

    return {
        rel: [
            edge["resolved"]
            for edge in node.get("imports", [])
            if edge.get("resolved")
        ]
        for rel, node in graph["nodes"].items()
    }


def assert_graph_covers(
    local: dict[str, LocalFile], graph: dict[str, list[str]]
) -> None:
    """Refuse to upload a file the gate never saw.

    The include-rule check in :func:`load_import_graph` says the two scanners
    agree in principle; this says they agree about this checkout. A file with no
    node has no known dependents, so its place in the order would be a guess.
    """
    unknown = sorted(rel for rel in local if rel not in graph)
    if unknown:
        raise DeployAborted(
            "the verify gate produced no graph node for "
            + ", ".join(unknown)
            + " — the deploy and the gate are scanning different files"
        )


def upload_order(
    changed: Iterable[str],
    graph: dict[str, list[str]],
    deployed: set[str],
) -> list[str]:
    """Order ``changed`` so a file's dependencies upload before it does.

    Unchanged files are traversed but not emitted, so a transitive dependency
    still orders its dependent correctly. Sorted throughout, so the result is a
    function of the input alone.
    """
    changed_set = set(changed)
    order: list[str] = []
    finished: set[str] = set()
    on_path: set[str] = set()

    def visit(node: str) -> None:
        # A back edge means a cycle, which ES modules permit: there is no order
        # that puts every member of a cycle after its dependencies, so members
        # take whatever order the walk reaches them in.
        if node in finished or node in on_path:
            return
        on_path.add(node)
        for dep in sorted(dep for dep in graph.get(node, []) if dep in deployed):
            visit(dep)
        on_path.discard(node)
        finished.add(node)
        if node in changed_set:
            order.append(node)

    for start in sorted(changed_set):
        visit(start)
    return order


def deploy_order(
    plan: DeployPlan,
    local: dict[str, LocalFile],
    graph: dict[str, list[str]],
) -> list[str]:
    """The order to upload a plan's adds and updates in.

    Adds and updates are ordered as one stream: a renamed leaf sits in ``adds``
    while the importer that names it sits in ``updates``, and uploading every add
    before every update gets that pair right only by luck.

    A templated host page then sinks to the very end however few assets it names:
    it is the switch that puts a new tree in front of users.
    """
    return sorted(
        upload_order(plan.adds + plan.updates, graph, set(local)),
        key=lambda rel: PurePosixPath(rel).suffix in TEMPLATED_SUFFIXES,
    )


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
    order: list[str],
    log=print,
) -> None:
    """Apply ``plan`` through ``client``, uploading in ``order``.

    Assumes ``plan`` is non-empty. Deletes run after every upload. Folders are
    created before their uploads; a failure propagates (fail loudly on partial
    upload) rather than being swallowed. Uploads are staged into a temporary
    directory that is removed when the run ends, including a run that ends by
    raising.
    """
    client.ensure_folder("")
    ensured: set[str] = {""}

    # Mirroring the target layout under the staging root keeps every upload on
    # its own path — no iteration overwrites a file the transport may still
    # hold open — and deploys the right name if a client omits ``dest_filename``.
    with tempfile.TemporaryDirectory(
        prefix="cora-deploy-",
        # A leaked temp directory is the OS's problem; a cleanup error
        # propagating out of this block would abort the run after every upload
        # but before any delete — stale files left behind, and no verification
        # pass to report them.
        ignore_cleanup_errors=True,
    ) as staging:
        staging_root = Path(staging)
        for rel in order:
            for folder in parent_folders(rel):
                if folder not in ensured:
                    client.ensure_folder(folder)
                    ensured.add(folder)
            source = staging_root.joinpath(*PurePosixPath(rel).parts)
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(local[rel].content)
            client.upload_file(source, rel)
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


def print_order(order: list[str], log=print) -> None:
    for position, rel in enumerate(order, start=1):
        log(f"  {position:>3}. {rel}")


# --------------------------------------------------------------------------- #
# Post-upload verification — what the library now serves, byte for byte.
# --------------------------------------------------------------------------- #


@dataclass
class Verification:
    """What the target folder serves that the repository does not account for.

    Deliberately not a :class:`DeployPlan`: these are residuals after the work
    was supposed to be done, and printing them as "N to add, N to update" would
    read as progress rather than as failure.
    """

    missing: list[str] = field(default_factory=list)
    mismatched: list[str] = field(default_factory=list)
    unexpected: list[str] = field(default_factory=list)
    unreadable: list[str] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        return not (
            self.missing or self.mismatched or self.unexpected or self.unreadable
        )


def verify_deployment(
    local: dict[str, LocalFile],
    client: SharePointDeployClient,
) -> Verification:
    """Re-fetch every deployed file and compare it byte for byte with ``local``.

    A hash the client volunteers is not evidence about what the library serves,
    so every file is downloaded — including the ones this run did not touch,
    since a "nothing changed" run is exactly when a hand-edited file hides.
    ``local`` must be the rendered tree, or every deploy reports a mismatch.
    """
    remote = {remote_file.path for remote_file in client.list_files()}
    result = Verification()

    for rel in sorted(local):
        if rel not in remote:
            result.missing.append(rel)
            continue
        try:
            served = client.download_file(rel)
        except Exception as error:
            # A checked-out file, a permission, a 500: report the path rather
            # than ending the deploy in a traceback with nothing named.
            result.unreadable.append(f"{rel}: {error}")
            continue
        if hashlib.sha256(served).hexdigest() != local[rel].sha256:
            result.mismatched.append(rel)

    result.unexpected.extend(sorted(remote - set(local)))
    return result


def print_verification(
    result: Verification, deployed: int, log=print
) -> None:
    if result.clean:
        log(f"Verified: {deployed} files re-fetched, all sha256 match.")
        return
    for label, paths in (
        ("missing (not served at all)", result.missing),
        ("mismatched (served bytes differ)", result.mismatched),
        ("unreadable (could not be re-fetched)", result.unreadable),
        ("unexpected (served with no local counterpart)", result.unexpected),
    ):
        if not paths:
            continue
        log(f"Verification failed — {len(paths)} {label}:")
        for path in paths:
            log(f"  {path}")


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
    env: str = "prod"


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
        "--env",
        choices=sorted(ENV_TARGET_FOLDERS),
        default="prod",
        help=(
            "Deployment environment (ADR-0033). Picks the default target "
            "folder and the {{CORA_ENV}} substitution in host HTML. "
            'Defaults to "prod".'
        ),
    )
    parser.add_argument(
        "--target-folder",
        default=None,
        help=(
            "Folder within the library. Defaults to the environment's folder "
            f"({DEFAULT_TARGET_FOLDER} for prod, "
            f"{ENV_TARGET_FOLDERS['uat']} for uat)."
        ),
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
        target_folder=args.target_folder or ENV_TARGET_FOLDERS[args.env],
        dry_run=args.dry_run,
        env=args.env,
    )


def build_client(opts: DeployOptions) -> SharePointDeployClient:
    """Construct the concrete client for ``opts``.

    Implemented separately: wire up the SharePoint SE auth handshake (browser
    NTLM/Kerberos) and the transport here, then delete this guard. Given
    ``opts.target_folder`` (e.g. ``CODE/CORA``) and the engine's
    target-relative ``path``, the field client's upload call is::

        copy_or_move_local_file_to_sp(
            source_path,
            library_relative_path=str(
                PurePosixPath(target_folder) / PurePosixPath(path).parent
            ),
            dest_filename=PurePosixPath(path).name,
            raise_on_error=True,
            copy_or_move="copy",
        )

    ``library_relative_path`` is taken to be relative to the document library
    root, so the target folder is prefixed here; ``raise_on_error=True``
    because :func:`execute_plan` requires a failure to propagate.
    """
    raise NotImplementedError(
        "SharePointDeployClient is not implemented yet. Implement it (auth + a "
        "transport against Style Library/CODE/CORA) and construct it here, or "
        "run with --dry-run to preview the plan."
    )


def run(
    opts: DeployOptions,
    client_factory=build_client,
    preflight=run_preflight,
    log=print,
) -> int:
    """Deploy, or refuse to.

    Every refusal is reported and returns a non-zero exit rather than raising:
    the gate failing, the graph not yielding an order, and the post-upload
    comparison finding residuals are all expected outcomes of a deploy, not
    programming errors.
    """
    try:
        return _deploy(opts, client_factory, preflight, log)
    except (PreflightFailed, DeployAborted) as error:
        log(f"Deploy aborted: {error}")
        return 1


def _deploy(opts: DeployOptions, client_factory, preflight, log) -> int:
    if SCRIPT_ROOT != opts.root:
        # The gate can only run where the dev dependencies are installed, so an
        # order derived from it would describe a tree this deploy is not reading.
        raise DeployAborted(
            f"--root is {opts.root} but the verify gate runs in {SCRIPT_ROOT}; "
            "deploy from the checkout you verified"
        )
    graph = load_import_graph(preflight(log=log))

    target = f"{opts.library}/{opts.target_folder}"
    cora_base = server_relative_base(opts.site_url, opts.library, opts.target_folder)
    log(f"Deploy target: {opts.site_url} -> {target} (env: {opts.env})")
    log(f"Host asset base ({HOST_BASE_TOKEN}): {cora_base}")

    local = render_templated_files(
        collect_local_files(opts.root),
        {HOST_BASE_TOKEN: cora_base, ENV_TOKEN: opts.env},
    )
    if not local:
        log("No deployable files found. Nothing to do.")
        return 1
    assert_graph_covers(local, graph)
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
        log(f"Upload order ({ORDER_DESCRIPTION}):")
        print_order(deploy_order(plan, local, graph), log=log)
        return 0

    client = client_factory(opts)
    remote = {rf.path: rf for rf in client.list_files()}
    plan = compute_plan(local, remote, client.download_file)
    print_plan(plan, log=log)
    order = deploy_order(plan, local, graph)
    if plan.is_noop:
        log("No changes to apply.")
    else:
        log(f"Applying changes ({ORDER_DESCRIPTION}):")
        print_order(order, log=log)
        execute_plan(plan, local, client, order, log=log)

    log(
        f"Re-fetching all {len(local)} deployed files (one GET each) to "
        "compare hashes..."
    )
    result = verify_deployment(local, client)
    print_verification(result, len(local), log=log)
    if not result.clean:
        return 1
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
