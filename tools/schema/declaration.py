"""The declaration vocabulary: ``Table`` / ``Column`` / ``Index``, and collecting
every feed's ``TABLES``.

A ``Table`` is one **landing site**: a namespace (the same opaque logical
database ``tools.store`` addresses), a table name, and its expected shape. It is
deliberately not a dataclass adapter of ``framework.core.SchemaValidator`` --
that dataclass is the *validation* contract (checked as data flows through a
pipeline); ``Table`` is a *storage* contract (what a live database should look
like), read once by :mod:`tools.schema.live` and never enforced mid-run. A
schema module may hold more row dataclasses than it declares tables for -- e.g.
a read contract for a table this pipeline only reads and never writes, as
``pipelines/retail_analytics/schema.py``'s ``OrderRow`` / ``CatalogRow`` are --
so ``TABLES`` names only the shapes a feed *writes*.

A feed declares its tables in a module-level ``TABLES`` tuple (conventionally in
its ``schema.py``, beside the row dataclasses ``columns_of`` derives them from);
:func:`collect_declared_tables` walks every package under ``pipelines/`` and
gathers them, so the ``schema diff`` command and the cross-check test both read
one collection.
"""

from __future__ import annotations

import dataclasses
import datetime
import importlib
import types
import typing
from collections.abc import Iterable, Sequence
from pathlib import Path

import pipelines
from framework.core import NonNull

__all__ = [
    "ACCUMULATE_BY_RUN_COLUMNS",
    "ACCUMULATE_BY_RUN_CONTEXT_COLUMNS",
    "QUARANTINE_COLUMNS",
    "Column",
    "Index",
    "Table",
    "collect_declared_tables",
    "columns_of",
    "quarantine_table",
    "resolved_namespace",
    "retype",
    "text_columns",
]


@dataclasses.dataclass(frozen=True)
class Column:
    """One declared column of a :class:`Table`."""

    name: str
    sql_type: str = "TEXT"
    nullable: bool = True


@dataclasses.dataclass(frozen=True)
class Index:
    """One declared index of a :class:`Table`.

    Declared, but not yet diffed: today's Writers create neither indexes nor
    primary keys, so comparing them against a live table would report the same
    drift on every table in every environment and drown the column-level signal
    this step exists to surface. See the "not yet diffed" note in
    ``docs/schema-declaration.md``.
    """

    column: str
    unique: bool = False


@dataclasses.dataclass(frozen=True, init=False)
class Table:
    """One landing site: a namespace, a table name, and its declared shape.

    ``namespace`` is either a bare medallion layer (``"raw"`` / ``"silver"`` /
    ``"gold"``) -- resolved against the feed's own subject by
    :func:`resolved_namespace` -- or a full ``"<subject>/<layer>"`` string when
    the table lives under a different subject (a shared platform namespace,
    e.g. a Reference Data set, or a Case Type whose subject differs from its
    pipeline's directory name). Either form is what :mod:`tools.store` calls a
    namespace; ``Table`` carries it verbatim.

    Construct with exactly one of ``row=`` (a dataclass whose fields become the
    columns, via :func:`columns_of`) or ``columns=`` (an explicit tuple, e.g.
    from :func:`text_columns`).

    ``columns`` is the only part :mod:`tools.schema.live` diffs today;
    ``primary_key`` / ``indexes`` are declared for the migration generator to
    read later (see :class:`Index`).
    """

    namespace: str
    name: str
    columns: tuple[Column, ...]
    primary_key: tuple[str, ...] = ()
    indexes: tuple[Index, ...] = ()

    def __init__(
        self,
        namespace: str,
        name: str,
        *,
        row: type | None = None,
        columns: Sequence[Column] | None = None,
        primary_key: Sequence[str] = (),
        indexes: Sequence[Index] = (),
    ) -> None:
        if (row is None) == (columns is None):
            raise ValueError(
                f"Table({namespace!r}, {name!r}): pass exactly one of row= or columns="
            )
        resolved = columns_of(row) if row is not None else tuple(columns)  # type: ignore[arg-type]
        object.__setattr__(self, "namespace", namespace)
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "columns", resolved)
        object.__setattr__(self, "primary_key", tuple(primary_key))
        object.__setattr__(self, "indexes", tuple(indexes))

    @property
    def label(self) -> str:
        """``<namespace>/<name>``, for a diff/log message."""
        return f"{self.namespace}/{self.name}"


def resolved_namespace(table: Table, feed: str) -> str:
    """The full store namespace ``table`` lands in, given its declaring feed.

    A bare layer name (``"raw"`` / ``"silver"`` / ``"gold"``, no ``/``) is
    resolved against ``feed`` -- the pipeline's own subject, normally its
    directory name under ``pipelines/``. A namespace that already names a
    subject (contains ``/``) is a platform namespace and is returned unchanged.
    """
    if "/" in table.namespace:
        return table.namespace
    return f"{feed}/{table.namespace}"


# The Python -> SQLite type mapping used to derive a Column's sql_type from a
# row dataclass's declared field type. Deliberately its own small mapping --
# not framework._internal.schema's Python<->pandas one -- because this is a
# separate, storage-facing contract that must not reach into framework
# internals (see docs/public-api.md) or grow coupled to the validation adapter.
_SQL_TYPE_BY_PYTHON_TYPE: dict[type, str] = {
    str: "TEXT",
    int: "INTEGER",
    float: "REAL",
    bool: "INTEGER",
    datetime.date: "TEXT",
    datetime.datetime: "TEXT",
}


def _unwrap(hint: object) -> tuple[object, bool, tuple[object, ...]]:
    """Split a resolved annotation into ``(base type, nullable, value rules)``.

    Strips ``Annotated[type, *rules]`` down to its base type and rules (the
    same shape ``framework._internal.schema`` reads, reimplemented here rather
    than imported -- this module stays independent of the framework's private
    seam). ``X | None`` / ``Optional[X]`` unwraps to ``X`` with ``nullable``
    forced ``True``; otherwise a field is nullable unless it carries a
    ``NonNull()`` rule, matching ``SchemaValidator``'s own default.
    """
    rules: tuple[object, ...] = ()
    if hasattr(hint, "__metadata__"):
        hint, rules = hint.__origin__, hint.__metadata__  # type: ignore[attr-defined]
    if typing.get_origin(hint) in (typing.Union, types.UnionType):
        args = typing.get_args(hint)
        non_none = [a for a in args if a is not type(None)]
        if type(None) in args and len(non_none) == 1:
            return non_none[0], True, rules
    nullable = not any(isinstance(rule, NonNull) for rule in rules)
    return hint, nullable, rules


def columns_of(row_type: type) -> tuple[Column, ...]:
    """Derive a table's columns from a row dataclass's annotations.

    One :class:`Column` per field, in declaration order: its declared Python
    type maps to a bare SQLite type (unmapped types default to ``TEXT``, the
    schema-light landing default), and it is nullable unless annotated
    ``NonNull()`` (or made nullable explicitly by ``X | None``).
    """
    hints = typing.get_type_hints(row_type, include_extras=True)
    columns = []
    for field in dataclasses.fields(row_type):
        base, nullable, _ = _unwrap(hints[field.name])
        sql_type = _SQL_TYPE_BY_PYTHON_TYPE.get(base, "TEXT")
        columns.append(Column(field.name, sql_type, nullable=nullable))
    return tuple(columns)


def text_columns(names: Iterable[str]) -> tuple[Column, ...]:
    """Every column ``TEXT`` and nullable -- the schema-light raw landing shape.

    Raw mirrors the source faithfully with no dtype inference (see
    ``docs/core-primitives.md``), so its declared shape is a flat column list,
    not a row dataclass -- this is the ``row=`` constructor's sibling for that
    case, and the one place a wide feed's ``raw_columns.txt`` list becomes a
    :class:`Table`.
    """
    return tuple(Column(name, "TEXT", nullable=True) for name in names)


#: The extra columns a bare ``framework.io.AccumulateByRun(...)``'s Writer
#: stamps onto every row it lands (``logical_run_id`` / ``load_date`` -- both
#: mandatory, per its own ``__post_init__``). Append this to a ``Table``'s
#: declared ``columns`` for any table written with that strategy, so the stamped
#: columns read as declared rather than permanent "live only (undeclared)"
#: drift.
ACCUMULATE_BY_RUN_COLUMNS: tuple[Column, ...] = (
    Column("logical_run_id", "TEXT", nullable=False),
    Column("load_date", "TEXT", nullable=False),
)

#: The same, for a strategy built via ``AccumulateByRun.from_context(context)``
#: -- which additionally stamps ``pipeline_run_id``. Two constants rather than
#: one because a bare ``AccumulateByRun(...)`` with no ``pipeline_run_id`` never
#: adds that column at all, and the diff is column-exact: declaring a column
#: nothing stamps reports as ``- pipeline_run_id   declared, missing``.
ACCUMULATE_BY_RUN_CONTEXT_COLUMNS: tuple[Column, ...] = ACCUMULATE_BY_RUN_COLUMNS + (
    Column("pipeline_run_id", "TEXT"),
)


#: The extra columns every ``QuarantineWriter`` target carries, regardless of
#: which feed it belongs to (see ``framework.io.writers.QuarantineWriter`` and
#: ``framework.run.builder.QuarantineNode``): ``failed_rule`` -- the
#: partitioner's semicolon-joined reason, added before the writer ever sees
#: the frame -- plus the same run-identity columns ``QuarantineNode`` stamps on
#: every rejected row (``logical_run_id`` / ``pipeline_run_id`` / ``load_date``,
#: unconditionally -- unlike a bare ``AccumulateByRun()`` this stamp is never
#: optional, since ``pipeline_run_id`` comes straight off the ``RunContext``).
#: Declared once here -- not repeated in every quarantining feed's ``TABLES`` --
#: because the shape is framework-owned, not a feed's own choice; see
#: :func:`quarantine_table`.
QUARANTINE_COLUMNS: tuple[Column, ...] = (
    Column("failed_rule", "TEXT", nullable=False),
    *ACCUMULATE_BY_RUN_CONTEXT_COLUMNS,
)


def quarantine_table(name: str, *, row: type) -> Table:
    """Declare a feed's quarantine landing site: ``row``'s columns + the
    framework-owned :data:`QUARANTINE_COLUMNS`.

    ``row`` is the same schema passed to ``SchemaValueRulePartitioner`` /
    ``raw_to_silver``'s ``reject_writer`` -- a rejected row carries that
    schema's columns verbatim plus ``failed_rule`` and the run-identity stamp,
    so this is the one call a quarantining feed needs rather than hand-listing
    those extra columns itself.

    Namespace is always the bare ``"quarantine"`` layer: :func:`resolved_namespace`
    resolves it against the feed like any other bare layer name, to
    ``<feed>/quarantine`` -- the same ``<subject>/quarantine.db`` file
    ``Store.quarantine_writer`` already targets (``db_path.parent /
    "quarantine.db"``, where ``db_path`` is that feed's own ``silver.db``).
    The migration generator's ``subject/<subject>/quarantine/`` scope
    (``tools.migrations.scope``) composes into that same file.
    """
    return Table("quarantine", name, columns=columns_of(row) + QUARANTINE_COLUMNS)


def retype(columns: tuple[Column, ...], **overrides: str) -> tuple[Column, ...]:
    """Return ``columns`` with the named columns' ``sql_type`` overridden.

    A silver/gold table's column list is usually ``columns_of(Row)`` verbatim,
    but a ``date``/``datetime`` field a pipeline re-parses into a real Python
    object right before *this particular write* lands with SQLite's
    ``TIMESTAMP`` affinity, not ``columns_of``'s default ``TEXT`` -- pandas'
    ``to_sql`` types a column by its *current* dtype, not its declared Python
    type, and a value read back from an earlier hop without being re-parsed
    stays plain text. Override just the affected column(s) here rather than
    hand-writing the whole column list; see the per-table comments in each
    feed's ``TABLES`` for which write does which.
    """
    by_name = {column.name: column for column in columns}
    for name, sql_type in overrides.items():
        if name not in by_name:
            raise ValueError(
                f"retype: no column named {name!r} to override; "
                f"these columns are: {', '.join(by_name)}"
            )
        by_name[name] = dataclasses.replace(by_name[name], sql_type=sql_type)
    return tuple(by_name[column.name] for column in columns)


def _feed_names() -> tuple[str, ...]:
    """Every ``pipelines/<feed>`` package, in a stable (sorted) order."""
    pkg_dir = Path(pipelines.__file__).parent
    return tuple(
        sorted(
            entry.name
            for entry in pkg_dir.iterdir()
            if entry.is_dir() and (entry / "__init__.py").exists()
        )
    )


def _tables_for_feed(feed: str) -> tuple[Table, ...]:
    """A feed's declared ``TABLES``, read off its ``schema`` module if it has
    one, else its ``pipeline`` module (see the ``ingest``/``selection``
    placement note in ``docs/schema-declaration.md``).

    ``()`` when the feed declares none -- a feed mid-scaffold shouldn't break
    ``schema diff`` for every other feed. A feed with *no such module* is
    likewise ``()``, but a module that exists and fails to import propagates:
    that is a broken feed, not an undeclared one, and swallowing it would make
    it look clean.
    """
    for module_name in (f"pipelines.{feed}.schema", f"pipelines.{feed}.pipeline"):
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError as exc:
            if exc.name != module_name:
                raise
            continue
        tables = getattr(module, "TABLES", None)
        if tables:
            return tuple(tables)
    return ()


def collect_declared_tables() -> dict[str, tuple[Table, ...]]:
    """Every feed's declared ``TABLES``, keyed by its ``pipelines/`` subject.

    The one place ``schema diff`` and the cross-check test
    (``tests/integration/test_declared_tables_match_pipelines.py``) both read
    the full declaration set from, so they cannot disagree about what "every
    feed's tables" means.
    """
    return {feed: _tables_for_feed(feed) for feed in _feed_names()}
