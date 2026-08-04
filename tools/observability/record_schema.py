"""The run-record schema, declared once as data.

A run record has three surfaces: the JSONL line a ``RunLog`` appends, the
``run_records`` row the ``RunRegistry`` stores, and the human-readable console
line the ``RunLog`` echoes. Stating the field set separately on
each surface is how a new field silently half-lands — added to the log and the
``CREATE TABLE`` but missed in the migration, so fresh deployments pass every
test while existing ones break.

So the field set is declared here, once and in order, and every surface is
derived from it: the DDL, the additive column migration, the ``INSERT``, the
row decode, and the console line. Adding a field is one entry in
:data:`RUN_RECORD_FIELDS`.

The declaration order is load-bearing. It is the order of the keys in a JSONL
line and of the columns in the table, and it must keep reproducing what already
exists on disk — reordering it rewrites a live format.

:class:`Field` and :func:`ensure_columns` are deliberately generic: the
orchestration decision store keeps its own, separate declaration of a different
contract and reuses the same machinery.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Sequence


@dataclass(frozen=True)
class Field:
    """One declared field of a record, and how each surface renders it.

    ``sql_type`` is the bare SQLite type of the column; a field with no
    ``sql_type`` lives in the JSONL record only and is never stored. ``encode``
    and ``decode`` translate between the Python value and its stored form (for
    example a list stored as JSON text); ``default`` supplies the value a
    falsy/absent field logs (an empty list rather than ``None``). ``console``
    renders the field for the human-readable line, or returns ``None`` to omit
    it — which is how a field states its own "only show this when set" rule. A
    field that declares no ``console`` at all is deliberately absent from the
    human line: stored and logged, but never rendered.
    """

    name: str
    sql_type: str | None = None
    not_null: bool = False
    logged: bool = True
    default: Callable[[], Any] | None = None
    encode: Callable[[Any], Any] | None = None
    decode: Callable[[Any], Any] | None = None
    console: Callable[[Any], str | None] | None = None

    @property
    def stored(self) -> bool:
        """Whether this field is a column of the store (it declares a SQL type)."""
        return self.sql_type is not None

    def for_log(self, value: Any) -> Any:
        """The value as it appears in the JSONL record."""
        if not value and self.default is not None:
            return self.default()
        return value

    def to_sql(self, value: Any) -> Any:
        """The value as it is bound to the ``INSERT``."""
        return self.encode(value) if self.encode is not None else value

    def from_sql(self, value: Any) -> Any:
        """The stored value decoded back to what the record carried."""
        return self.decode(value) if self.decode is not None else value


def stored_fields(fields: Iterable[Field]) -> tuple[Field, ...]:
    """The declared fields that are columns of the store, in declared order."""
    return tuple(f for f in fields if f.stored)


def columns_ddl(fields: Iterable[Field]) -> str:
    """The column clauses of a ``CREATE TABLE`` for the stored fields."""
    return ", ".join(
        f"{f.name} {f.sql_type}" + (" NOT NULL" if f.not_null else "")
        for f in stored_fields(fields)
    )


def create_table_sql(
    table: str, fields: Iterable[Field], primary_key: Sequence[str] = ()
) -> str:
    """``CREATE TABLE IF NOT EXISTS`` derived from the declared fields."""
    clauses = [columns_ddl(fields)]
    if primary_key:
        clauses.append(f"PRIMARY KEY ({', '.join(primary_key)})")
    return f"CREATE TABLE IF NOT EXISTS {table} ({', '.join(clauses)})"


def insert_sql(table: str, fields: Iterable[Field], *, or_ignore: bool = False) -> str:
    """``INSERT`` naming every stored field, with a matching placeholder each.

    Deriving the column list and the placeholders together is the point: they
    cannot drift out of step, and the bound tuple is built from the same order.
    """
    names = [f.name for f in stored_fields(fields)]
    verb = "INSERT OR IGNORE INTO" if or_ignore else "INSERT INTO"
    placeholders = ", ".join("?" * len(names))
    return f"{verb} {table} ({', '.join(names)}) VALUES ({placeholders})"


def select_columns(fields: Iterable[Field]) -> str:
    """The stored field names as a ``SELECT`` list, in declared order."""
    return ", ".join(f.name for f in stored_fields(fields))


def ensure_columns(con, table: str, fields: Iterable[Field]) -> set[str]:
    """Add any declared column the table lacks; return the names just added.

    The additive migration for a store that predates a field. These files live
    on a shared drive and are not disposable, so a missing column is added in
    place rather than the table re-created. Returning the added names lets a
    caller run a one-off backfill only when its column was actually just
    created, instead of on every connection.

    The column is added with its bare type: SQLite cannot add a ``NOT NULL``
    column without a default, and the not-null fields are all part of the
    original table anyway.
    """
    existing = {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
    added: set[str] = set()
    for field in stored_fields(fields):
        if field.name not in existing:
            con.execute(f"ALTER TABLE {table} ADD COLUMN {field.name} {field.sql_type}")
            added.add(field.name)
    return added


def _json_list_to_sql(value: Any) -> str:
    return json.dumps(value or [])


def _json_list_from_sql(value: Any) -> list:
    return json.loads(value) if value else []


def _json_object_to_sql(value: Any) -> str | None:
    return json.dumps(value) if value else None


def _json_object_from_sql(value: Any) -> dict | None:
    return json.loads(value) if value else None


def _count(label: str) -> Callable[[Any], str | None]:
    return lambda value: None if value is None else f"{label}={value}"


def _when_set(label: str) -> Callable[[Any], str | None]:
    return lambda value: f"{label}={value}" if value else None


def _joined(label: str) -> Callable[[Any], str | None]:
    return lambda value: f"{label}={'; '.join(value)}" if value else None


#: The run-record schema. One entry per field, in the order it appears in a
#: JSONL line and in the ``run_records`` table.
RUN_RECORD_FIELDS: tuple[Field, ...] = (
    # The event time the emitter writes; what the registry orders by.
    Field("timestamp", "TEXT"),
    # The concrete pipeline attempt: the correlating key every record of one run
    # shares, and what the registry groups a run's steps by.
    Field("pipeline_run_id", "TEXT", not_null=True),
    # The business run / idempotency key this attempt belongs to. Stable across
    # re-drives of the same run date, so it ties a re-driven attempt back to the
    # run it replaces.
    Field("logical_run_id", "TEXT"),
    Field("pipeline", "TEXT"),
    Field("step", "TEXT", not_null=True),
    Field("step_address", "TEXT"),
    # The store's own field: the position of a record among those sharing a
    # (pipeline_run_id, step), assigned at ingest. Never in the log line.
    Field("step_ordinal", "INTEGER", not_null=True, logged=False),
    Field("status", "TEXT"),
    Field("rows_in", "INTEGER", console=_count("rows_in")),
    Field("rows_out", "INTEGER", console=_count("rows_out")),
    Field("rows_quarantined", "INTEGER", console=_when_set("quarantined")),
    Field("rows_excluded", "INTEGER", console=_when_set("excluded")),
    Field(
        "duration",
        "REAL",
        console=lambda value: None if value is None else f"{value:.3f}s",
    ),
    Field(
        "errors",
        "TEXT",
        default=list,
        encode=_json_list_to_sql,
        decode=_json_list_from_sql,
        console=_joined("errors"),
    ),
    # The triage category of the failure (data/operational/config), or None for a
    # non-PipelineError bug. See framework.core.ErrorCategory.
    Field("error_category", "TEXT", console=_when_set("category")),
    Field(
        "warn_hits",
        "TEXT",
        default=list,
        encode=_json_list_to_sql,
        decode=_json_list_from_sql,
        console=_joined("warn"),
    ),
    # True when this step durably wrote an artifact (write / quarantine /
    # explain / checkpoint). Independently committed evidence — it stays on disk
    # even if a *later* step aborts the run.
    Field(
        "committed",
        "INTEGER",
        encode=lambda value: 1 if value else 0,
        decode=bool,
        console=lambda value: "committed" if value else None,
    ),
    # Run parameters, recorded only after caller-side redaction. Logged but not
    # stored: the registry has no column for them.
    Field("params", default=dict),
    # The per-column statistical profile a profile step recorded, or None where
    # the step is not a profile. A structured, queryable shape the registry
    # trends across runs — the statistical sibling of the operational metadata.
    Field(
        "profile",
        "TEXT",
        encode=_json_object_to_sql,
        decode=_json_object_from_sql,
        console=lambda value: (
            f"profiled {len(value.get('columns', []))} col(s)" if value else None
        ),
    ),
    # The file(s) or table(s) a read or write step actually touched, one
    # ``{"namespace", "name"}`` entry each (OpenLineage's dataset identity).
    # No ``console``: an audit field for the JSONL and the registry, where a
    # glob read yields an entry per file and would swamp the line an operator
    # scans.
    Field(
        "data_locations",
        "TEXT",
        default=list,
        encode=_json_list_to_sql,
        decode=_json_list_from_sql,
    ),
)

#: The fields that appear in a JSONL line, in order.
LOGGED_RUN_RECORD_FIELDS: tuple[Field, ...] = tuple(
    f for f in RUN_RECORD_FIELDS if f.logged
)

#: The fields that are columns of ``run_records``, in order.
RUN_RECORD_COLUMNS: tuple[Field, ...] = stored_fields(RUN_RECORD_FIELDS)

#: What makes an ingested record unique — the key ``INSERT OR IGNORE`` makes
#: re-ingestion of an already-consumed line a no-op.
RUN_RECORD_PRIMARY_KEY: tuple[str, ...] = ("pipeline_run_id", "step", "step_ordinal")


def build_run_record(**values: Any) -> dict[str, Any]:
    """One JSONL record: every logged field, in declared order, defaults applied.

    Keyword-only and strict about names, so a typo is an error rather than a key
    that silently never reaches the log.
    """
    unknown = set(values) - {f.name for f in LOGGED_RUN_RECORD_FIELDS}
    if unknown:
        raise TypeError(f"unknown run-record field(s): {', '.join(sorted(unknown))}")
    return {f.name: f.for_log(values.get(f.name)) for f in LOGGED_RUN_RECORD_FIELDS}


def console_parts(record: dict) -> list[str]:
    """The per-field fragments of the human-readable line, in declared order.

    Each field decides whether it shows at all, so a new field becomes visible
    to an operator by declaring a ``console`` renderer — not by editing a chain
    of ``if`` branches.
    """
    parts = []
    for field in RUN_RECORD_FIELDS:
        if field.console is None:
            continue
        rendered = field.console(record.get(field.name))
        if rendered is not None:
            parts.append(rendered)
    return parts
