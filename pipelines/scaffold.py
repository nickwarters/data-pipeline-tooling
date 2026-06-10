"""Scaffold a new feed from a template (issue #97).

Renders the runnable template under ``pipelines/_scaffold_template/`` into a
self-contained feed subpackage ``<dest>/<feed>/`` -- a schema file, an ingest
pipeline (CSV -> raw, via the public facades), a sample fixture, and a test that
shows source rows becoming landed output rows. The template is the source of
truth; this module only substitutes the feed name (and its PascalCase class
form) into a fresh copy.

Run from the repository root so the import-only ``framework`` package resolves::

    python -m pipelines.scaffold orders                 # -> pipelines/orders/
    python -m pipelines.scaffold orders --dest /tmp/x   # -> /tmp/x/orders/
    python -m pipelines.scaffold orders --force         # overwrite if it exists

The generated feed runs as a module from the repo root::

    python -m pipelines.orders.pipeline /data
"""

from __future__ import annotations

import argparse
import keyword
import os
import sys
from pathlib import Path

# The placeholder tokens in the template: the feed slug and its PascalCase form.
# Both are substituted in file contents and in file/directory names.
_TEMPLATE_DIR = Path(__file__).parent / "_scaffold_template"
_SLUG_TOKEN = "myfeed"
_CLASS_TOKEN = "Myfeed"


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


def render(
    feed: str,
    dest: str | os.PathLike[str],
    *,
    force: bool = False,
) -> list[Path]:
    """Render the feed template into ``<dest>/<feed>/`` and return the files made.

    Raises ``ValueError`` for an invalid feed name and ``FileExistsError`` if the
    feed directory already exists (pass ``force=True`` to overwrite in place).
    """
    _validate_feed_name(feed)
    feed_dir = Path(dest) / feed
    if feed_dir.exists() and not force:
        raise FileExistsError(
            f"{feed_dir} already exists; pass force=True (CLI: --force) to overwrite"
        )

    created: list[Path] = []
    for source in sorted(_TEMPLATE_DIR.rglob("*")):
        if source.is_dir() or "__pycache__" in source.parts:
            continue
        relative = Path(_substitute(str(source.relative_to(_TEMPLATE_DIR)), feed))
        target = feed_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            _substitute(source.read_text(encoding="utf-8"), feed), encoding="utf-8"
        )
        created.append(target)
    return created


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m pipelines.scaffold",
        description="Scaffold a new feed subpackage from the template.",
    )
    parser.add_argument("feed", help="the feed name (a lowercase identifier, e.g. orders)")
    parser.add_argument(
        "--dest",
        default="pipelines",
        help="directory the <feed>/ package is created under (default: pipelines)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="overwrite the feed directory if it already exists",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        created = render(args.feed, args.dest, force=args.force)
    except (ValueError, FileExistsError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    for path in created:
        print(f"created {path}")
    print(
        f"\nRun it from the repo root:\n"
        f"    python -m {args.dest.replace(os.sep, '.')}.{args.feed}.pipeline /data"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())
