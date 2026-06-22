"""Scaffold a new feed from a template.

Renders the runnable template under ``framework/_cli/scaffold_templates/feed/``
into a new feed: the feed *code* (schema, an ingest pipeline that refines source
-> raw -> silver -> gold via the public facades, and a sample fixture) as a
subpackage ``pipelines/<feed>/``, and its *test* (given source rows -> expected
landed rows) under ``tests/pipelines/`` so it sits with the rest of the suite,
mirroring the source layout. The template is the source of truth; this module
only substitutes the feed name (and its PascalCase class form) into a fresh copy.

Pass ``--from-feed-file PATH`` to seed the scaffold from a real sample CSV: the
header becomes the schema's fields (names canonicalised to identifiers, dtypes
inferred from the first rows), the file's contents replace the bundled sample,
and the test's sample rows are taken from it. When any header name isn't already
a clean identifier (spaces, punctuation, capitals), the *source* column names are
emitted as a ``RAW_FEED_COLUMNS`` constant and the raw hop's ColumnValidator gates
on those raw names rather than the schema's canonical fields; the silver hop's
``RENAME`` map is populated from each source name to its canonical field -- raw
stays faithful to the source, silver renames to the schema's canonical shape.

Run from the repository root so the import-only ``framework`` package resolves::

    python -m cli scaffold orders
    python -m cli scaffold orders --force    # overwrite if it exists
    python -m cli scaffold orders --from-feed-file sample.csv

The generated feed runs as a module from the repo root::

    python -m pipelines.orders.pipeline /data
    python -m pytest tests/pipelines/test_orders.py
"""

from __future__ import annotations

import argparse
import csv
import keyword
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# The placeholder tokens in the template: substituted in file contents and paths.
_SLUG_TOKEN = "myfeed"
_CLASS_TOKEN = "Myfeed"

# A scaffold seeded from a feed file declares one schema field per source column.
# Past this many the generated schema stops being a useful starting point, so the
# extra columns are dropped (with a loud warning and a note in schema.py) rather
# than rendering an unwieldy dataclass.
_MAX_FEED_COLUMNS = 40

# How many data rows to read from a feed file: enough to infer dtypes, of which
# the first couple seed the generated test's sample rows.
_FEED_SAMPLE_ROWS = 50
_TEST_SAMPLE_ROWS = 2

_TEMPLATE_DIR_CASE_TYPE = Path(__file__).parent / "scaffold_templates" / "case_type"
_TEMPLATE_DIR = Path(__file__).parent / "scaffold_templates" / "feed"

# scaffold.py lives at ``framework/_cli/scaffold.py``, so the repo root under
# which the rendered ``pipelines/`` and ``tests/`` sit is three parents up.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent


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


@dataclass
class _FeedSpec:
    """The shape derived from a ``--from-feed-file`` sample CSV.

    ``columns`` are the kept source header names verbatim; ``names``/``inferred``
    are the canonical identifier and inferred dtype for each (positionally
    aligned). ``needs_raw`` is set when the canonical names diverge from the
    source names (spaces, punctuation, capitals, or de-duplicated collisions), in
    which case the validator must gate on the raw source names, not the schema's
    fields. ``raw_text`` is the file's contents (for the bundled sample), and
    ``sample_cells`` are the first data rows (for the generated test).
    """

    columns: list[str]
    names: list[str]
    inferred: list[str]
    needs_raw: bool
    dropped: int
    raw_text: str
    sample_cells: list[list[str]]


def _is_int(value: str) -> bool:
    try:
        int(value)
    except ValueError:
        return False
    return True


def _is_float(value: str) -> bool:
    try:
        float(value)
    except ValueError:
        return False
    return True


def _infer_type(values: list[str]) -> str:
    """Infer a field dtype from a column's sample values.

    A blank cell means the column is nullable. pandas can't hold a nullable
    integer as ``int64`` -- a null promotes the column to ``float64`` on
    read-back -- so an otherwise-integer column with any blank infers ``float``
    to match the type the storage round-trip actually yields (otherwise the
    declared ``int`` would fail the silver dtype gate against the float column).
    """
    non_blank = [v for v in values if v != ""]
    if not non_blank:
        return "str"
    has_blank = len(non_blank) < len(values)
    if all(_is_int(v) for v in non_blank):
        return "float" if has_blank else "int"
    if all(_is_float(v) for v in non_blank):
        return "float"
    return "str"


def _canonical_identifier(name: str) -> str:
    """Canonicalise a source column name to a valid lowercase identifier."""
    slug = re.sub(r"[^0-9a-zA-Z]+", "_", name).strip("_").lower()
    if not slug:
        slug = "column"
    if slug[0].isdigit():
        slug = f"col_{slug}"
    if keyword.iskeyword(slug):
        slug = f"{slug}_"
    return slug


def _esc(text: str) -> str:
    """Escape a string for embedding in a double-quoted Python literal."""
    return text.replace("\\", "\\\\").replace('"', '\\"')


def _literal(value: str, type_name: str) -> str:
    """Render a cell as a Python literal of the column's inferred dtype."""
    if value != "" and type_name == "int" and _is_int(value):
        return str(int(value))
    if value != "" and type_name == "float" and _is_float(value):
        return repr(float(value))
    return f'"{_esc(value)}"'


def _read_feed_file(path: str | Path) -> _FeedSpec:
    """Parse a sample CSV into the spec the renderers consume.

    Reads the header and the first rows (``utf-8-sig`` so a BOM is tolerated),
    truncates to ``_MAX_FEED_COLUMNS`` (warning loudly when it does), canonicalises
    each header to an identifier (de-duplicating collisions), and infers a dtype
    per column from the sample rows.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"feed file {path} does not exist")
    raw_text = path.read_text(encoding="utf-8-sig")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError(f"feed file {path} is empty (no header row)") from None
        data_rows = [row for _, row in zip(range(_FEED_SAMPLE_ROWS), reader)]

    dropped = max(0, len(header) - _MAX_FEED_COLUMNS)
    columns = header[:_MAX_FEED_COLUMNS]
    if dropped:
        print(
            f"warning: feed file has {len(header)} columns; keeping the first "
            f"{_MAX_FEED_COLUMNS} and dropping the remaining {dropped} from the "
            "generated schema, validator, and test",
            file=sys.stderr,
        )

    names: list[str] = []
    seen: dict[str, int] = {}
    for column in columns:
        base = _canonical_identifier(column)
        count = seen.get(base, 0)
        names.append(base if count == 0 else f"{base}_{count + 1}")
        seen[base] = count + 1

    inferred = [
        _infer_type([row[i] if i < len(row) else "" for row in data_rows])
        for i in range(len(columns))
    ]

    return _FeedSpec(
        columns=columns,
        names=names,
        inferred=inferred,
        needs_raw=columns != names,
        dropped=dropped,
        raw_text=raw_text,
        sample_cells=data_rows[:_TEST_SAMPLE_ROWS],
    )


def _render_schema(text: str, feed: str, spec: _FeedSpec) -> str:
    """Replace the template dataclass with one field per feed-file column."""
    cls = _pascal(feed) + "Row"
    lines = ["@dataclass", f"class {cls}:"]
    if spec.dropped:
        lines.append(
            f"    # {spec.dropped} column(s) beyond the scaffold's limit of "
            f"{_MAX_FEED_COLUMNS} were dropped from this schema."
        )
    lines += [
        f"    {name}: {type_name}" for name, type_name in zip(spec.names, spec.inferred)
    ]
    body = "\n".join(lines) + "\n"
    # The dataclass is the last thing in schema.py, so replace it to EOF; the
    # module docstring and imports above it are left intact.
    return re.sub(r"@dataclass\nclass .*", lambda _: body, text, flags=re.S)


def _raw_columns_literal(spec: _FeedSpec) -> str:
    lines = ["RAW_FEED_COLUMNS = ["]
    lines += [f'    "{_esc(column)}",' for column in spec.columns]
    lines.append("]")
    return "\n".join(lines) + "\n"


def _rename_literal(spec: _FeedSpec) -> str:
    """Render the ``RENAME`` map: each source column whose name isn't its
    canonical schema field, mapped to that field. silver renames raw's faithful
    source names to this vocabulary before coercing/validating the schema."""
    pairs = [
        (column, name)
        for column, name in zip(spec.columns, spec.names)
        if column != name
    ]
    lines = ["RENAME: dict[str, str] = {"]
    lines += [f'    "{_esc(column)}": "{name}",' for column, name in pairs]
    lines.append("}")
    return "\n".join(lines) + "\n"


def _render_pipeline(text: str, feed: str, spec: _FeedSpec) -> str:
    """Gate the raw validator on the source columns when they aren't identifiers.

    Only needed when ``needs_raw``: the source names can't be schema fields, so
    emit them as ``RAW_FEED_COLUMNS`` and gate the raw hop on those. The schema
    fields stay the silver target, and ``RENAME`` maps the faithful source names
    to them, so the schema import is kept (silver coerces/validates against it).
    """
    cls = _pascal(feed) + "Row"
    anchor = f'SAMPLE_CSV = Path(__file__).parent / "sample_data" / "{feed}.csv"\n'
    text = text.replace(anchor, anchor + "\n" + _raw_columns_literal(spec))
    # Replace ColumnValidator initialization to use RAW_FEED_COLUMNS
    text = text.replace(
        f"ColumnValidator([f.name for f in fields({cls})])",
        "ColumnValidator(RAW_FEED_COLUMNS)",
    )
    text = text.replace("RENAME: dict[str, str] = {}\n", _rename_literal(spec))
    text = text.replace("from dataclasses import fields\n", "")
    return text


def _source_literal(spec: _FeedSpec) -> str:
    lines = ["    reader = given_rows(["]
    for cells in spec.sample_cells:
        pairs = []
        for i, column in enumerate(spec.columns):
            cell = cells[i] if i < len(cells) else ""
            pairs.append(f'"{_esc(column)}": {_literal(cell, spec.inferred[i])}')
        lines.append("        {" + ", ".join(pairs) + "},")
    lines.append("    ])")
    return "\n".join(lines) + "\n"


def _render_test(text: str, feed: str, spec: _FeedSpec) -> str:
    """Seed the test's sample rows from the feed file; track the validator's columns."""
    cls = _pascal(feed) + "Row"
    text = re.sub(
        r"(?ms)^    reader = given_rows\(\s*\[.*?\]\s*\)\n",
        lambda _: _source_literal(spec),
        text,
    )
    if spec.needs_raw:
        # The raw hop validates the source names, and raw keeps them, so the
        # *landed* (raw) assertion checks RAW_FEED_COLUMNS. The silver assertion
        # still checks the schema fields -- silver renames to them -- so the
        # ``fields``/schema imports stay.
        text = text.replace(
            f"from pipelines.{feed}.pipeline import FEED_NAME",
            f"from pipelines.{feed}.pipeline import FEED_NAME, RAW_FEED_COLUMNS",
        )
        text = text.replace(
            f"{{f.name for f in fields({cls})}}.issubset(landed[0].keys())",
            "set(RAW_FEED_COLUMNS).issubset(landed[0].keys())",
        )
    return text


def render(
    feed: str,
    root: str | Path | None = None,
    *,
    force: bool = False,
    case_type: bool = False,
    feed_file: str | Path | None = None,
) -> list[Path]:
    """Render the feed under ``root`` and return the files made.

    Feed code lands in ``<root>/pipelines/<feed>/`` and the test in
    ``<root>/tests/pipelines/test_<feed>.py``. ``root`` is the repository root;
    it defaults to this repo (``_REPO_ROOT``), and tests pass a temporary one.

    ``case_type`` selects the case-review-flavoured template that declares the
    Case Type's identity contract (``case_type.py``) and refines source -> raw
    -> silver, stopping at silver. The default renders the generic source -> raw
    feed.

    ``feed_file`` seeds the scaffold from a real sample CSV (header -> schema
    fields, contents -> bundled sample, first rows -> the test's sample rows). It
    isn't supported with ``case_type`` (the Case Type variant also needs a
    natural-key decision -- #155/#163).

    Raises ``ValueError`` for an invalid feed name or an unsupported flag
    combination, ``FileNotFoundError`` for a missing feed file, and
    ``FileExistsError`` if any target already exists (pass ``force=True`` to
    overwrite in place).
    """
    _validate_feed_name(feed)
    if feed_file is not None and case_type:
        raise ValueError(
            "--from-feed-file is not supported with --case-type yet (the Case "
            "Type variant also needs a natural-key decision)"
        )
    spec = _read_feed_file(feed_file) if feed_file is not None else None
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
            if spec is not None:
                text = _render_test(text, feed, spec)
        else:
            target = feed_dir / relative
            if spec is not None:
                if relative.name == "schema.py":
                    text = _render_schema(text, feed, spec)
                elif relative.name == "pipeline.py" and spec.needs_raw:
                    text = _render_pipeline(text, feed, spec)
                elif relative.suffix == ".csv":
                    text = spec.raw_text
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


def _add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "feed", help="the feed name (a lowercase identifier, e.g. orders)"
    )
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
    parser.add_argument(
        "--from-feed-file",
        metavar="PATH",
        help=(
            "seed the scaffold from a sample CSV: header -> schema fields "
            "(dtypes inferred), contents -> bundled sample, first rows -> the "
            "test's sample rows (not supported with --case-type)"
        ),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m cli scaffold",
        description=(
            "Scaffold a new feed (code in pipelines/, test in tests/pipelines/)."
        ),
    )
    _add_arguments(parser)
    return parser


def register(subparsers) -> None:
    """Add the ``scaffold`` command to the unified ``python -m cli`` CLI."""
    parser = subparsers.add_parser(
        "scaffold",
        help="scaffold a new feed (code in pipelines/, test in tests/pipelines/)",
    )
    _add_arguments(parser)
    parser.set_defaults(func=_command)


def _command(args: argparse.Namespace) -> int:
    try:
        created = render(
            args.feed,
            force=args.force,
            case_type=args.case_type,
            feed_file=args.from_feed_file,
        )
    except (ValueError, FileNotFoundError, FileExistsError) as exc:
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


def main(argv: list[str] | None = None) -> int:
    """Parse scaffold-only args and run it (the ``scaffold`` command standalone)."""
    return _command(build_parser().parse_args(argv))


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())
