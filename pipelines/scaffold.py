"""Scaffold a new feed from a template.

Renders the runnable template under ``pipelines/_scaffold_template/`` into a new
feed: the feed *code* (schema, an ingest pipeline CSV -> raw via the public
facades, and a sample fixture) as a subpackage ``pipelines/<feed>/``, and its
*test* (given source rows -> expected landed rows) under ``tests/pipelines/`` so
it sits with the rest of the suite, mirroring the source layout. The template is
the source of truth; this module only substitutes the feed name (and its
PascalCase class form) into a fresh copy.

Run from the repository root so the import-only ``framework`` package resolves::

    python -m pipelines.scaffold orders            # -> pipelines/orders/ + tests/pipelines/test_orders.py
    python -m pipelines.scaffold orders --force    # overwrite if it exists

The generated feed runs as a module from the repo root::

    python -m pipelines.orders.pipeline /data
    python -m pytest tests/pipelines/test_orders.py
"""

from __future__ import annotations

import argparse
import keyword
import re
import sys
from pathlib import Path

# The placeholder tokens in the template: substituted in file contents and paths.
_SLUG_TOKEN = "myfeed"
_CLASS_TOKEN = "Myfeed"

_TEMPLATE_DIR_CASE_TYPE = Path(__file__).parent / "_scaffold_template_case_type"
_TEMPLATE_DIR = Path(__file__).parent / "_scaffold_template"

# scaffold.py lives at ``pipelines/scaffold.py``, so its grandparent is the repo
# root under which ``pipelines/`` and ``tests/`` sit.
_REPO_ROOT = Path(__file__).resolve().parent.parent


def _pascal(feed: str) -> str:
    """The PascalCase form of a (possibly underscore-separated) feed slug."""
    return "".join(part.capitalize() for part in feed.split("_"))


def _validate_feed_name(feed: str) -> None:
    if not feed.isidentifier() or keyword.iskeyword(feed):
        raise ValueError(
            f"feed name {feed!r} is not a valid Python identifier; it becomes a "
            "package name, so use letters, digits, and underscores (e.g. orders)"
        )
    if feed != feed.lower():
        raise ValueError(
            f"feed name {feed!r} must be lowercase (package names are lowercase, "
            "e.g. orders or review_outcomes)"
        )


def _substitute(text: str, feed: str) -> str:
    """Replace the template's placeholder tokens with the real feed names.

    The class token is replaced first; the slug is lowercase and never a
    substring of the PascalCase result, so the two passes are independent.
    """
    return text.replace(_CLASS_TOKEN, _pascal(feed)).replace(_SLUG_TOKEN, feed)


def _is_test_file(relative: Path) -> bool:
    """Whether a template file is the feed's test (lands under ``tests/``)."""
    return relative.name.startswith("test_") and relative.suffix == ".py"


def _absolutise_imports(text: str, feed: str) -> str:
    """Rewrite the test's intra-package imports from relative to absolute.

    In the template the test sits *inside* the feed package, so it imports the
    pipeline and schema relatively (``from .pipeline import ...``). The rendered
    test lives under ``tests/pipelines/`` instead, outside the package, so those
    must become absolute (``from pipelines.<feed>.pipeline import ...``).
    """
    return re.sub(r"(?m)^from \.", f"from pipelines.{feed}.", text)


def render(
    feed: str,
    root: str | Path | None = None,
    *,
    force: bool = False,
    case_type: bool = False,
) -> list[Path]:
    """Render the feed under ``root`` and return the files made.

    Feed code lands in ``<root>/pipelines/<feed>/`` and the test in
    ``<root>/tests/pipelines/test_<feed>.py``. ``root`` is the repository root;
    it defaults to this repo (``_REPO_ROOT``), and tests pass a temporary one.

    ``case_type`` selects the case-review-flavoured template that declares the
    Case Type's identity contract (``case_type.py``) and refines source -> raw
    -> silver, stopping at silver. The default renders the generic source -> raw
    feed.

    Raises ``ValueError`` for an invalid feed name and ``FileExistsError`` if any
    target already exists (pass ``force=True`` to overwrite in place).
    """
    _validate_feed_name(feed)
    root = Path(root) if root is not None else _REPO_ROOT
    feed_dir = root / "pipelines" / feed
    tests_dir = root / "tests" / "pipelines"
    template_dir = _TEMPLATE_DIR_CASE_TYPE if case_type else _TEMPLATE_DIR

    # Plan every (target, contents) pair up front so an existing-file refusal
    # leaves the tree untouched rather than half-written.
    plan: list[tuple[Path, str]] = []
    for source in sorted(template_dir.rglob("*")):
        if source.is_dir() or "__pycache__" in source.parts:
            continue
        relative = Path(_substitute(str(source.relative_to(template_dir)), feed))
        text = _substitute(source.read_text(encoding="utf-8"), feed)
        if _is_test_file(relative):
            target = tests_dir / relative.name
            text = _absolutise_imports(text, feed)
        else:
            target = feed_dir / relative
        plan.append((target, text))

    clashing = [target for target, _ in plan if target.exists()]
    if clashing and not force:
        raise FileExistsError(
            f"{feed_dir} (or its test) already exists; pass force=True "
            "(CLI: --force) to overwrite"
        )

    created: list[Path] = []
    for target, text in plan:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        created.append(target)
    return created


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.scaffold",
        description="Scaffold a new feed (code in pipelines/, test in tests/pipelines/).",
    )
    parser.add_argument("feed", help="the feed name (a lowercase identifier, e.g. orders)")
    parser.add_argument(
        "--force",
        action="store_true",
        help="overwrite the feed's files if they already exist",
    )
    parser.add_argument(
        "--case-type",
        action="store_true",
        help=(
            "render the Case Type ingest variant: declares the Case "
            "Type's identity contract and refines source -> raw -> silver, "
            "stopping at silver (gold is yours to assemble)"
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        created = render(args.feed, force=args.force, case_type=args.case_type)
    except (ValueError, FileExistsError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    for path in created:
        print(f"created {path}")
    print(
        f"\nRun it from the repo root:\n"
        f"    python -m pipelines.{args.feed}.pipeline /data\n"
        f"    python -m pytest tests/pipelines/test_{args.feed}.py"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())
