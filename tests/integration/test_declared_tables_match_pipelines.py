"""``TABLES`` says where a table lives; so does the wiring in each pipeline's
``run`` -- a third source of truth that can silently drift from the other two.

This is the guard, in the same spirit as ``test_public_api.py``: run every
bundled feed for real against one throwaway ``base_dir`` (each ships its own
sample data, so this needs no fixtures of its own), then compare *every table a
run actually landed* against *every table declared across all feeds'*
``tools.schema.collect_declared_tables()``. Undeclared writes and unwritten
declarations are both failures -- this is not "declare everything you can
think of", it's "declare exactly what you write".

Reject/quarantine tables (``quarantine.db``) and the run-metadata stores
(``_runs/``, ``_registry/``, ``_orchestration/``) are out of scope: they are a
different concept (rejected rows; run history) from the medallion table shape
this issue declares.

The comparison itself is a small pure function (:func:`_drift`) so the self-test
below can feed it synthetic sets rather than having to break a real pipeline to
prove the guard would catch something -- in *both* directions, since a guard
that only caught one would look identical from the outside.

A feed nothing runs lands nothing, so it cannot fail the comparison at all.
:func:`test_every_feed_package_declares_its_tables` closes that by enumerating
``pipelines/`` and requiring every feed package to declare ``TABLES`` (or name
itself in :data:`FEEDS_WITHOUT_TABLES`), so a new feed cannot quietly opt out.
"""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

from framework.run import RunContext
from tests.framework_testing import migrate_all
from tools.schema import collect_declared_tables
from tools.schema.declaration import resolved_namespace

REPO_ROOT = Path(__file__).resolve().parents[2]


def _run_every_bundled_feed(base_dir: Path) -> None:
    """Run every feed with bundled sample data under one shared ``base_dir``.

    Mirrors what each feed's own test module already does to drive it (see
    e.g. ``tests/pipelines/test_complaints_a.py``); gathered here once so this
    module's only job is comparing the result against the declarations.
    """
    from pipelines.case_selection.pipeline import AS_OF as CASE_SELECTION_AS_OF
    from pipelines.case_selection.pipeline import SUBJECT as CASE_SELECTION_SUBJECT
    from pipelines.case_selection.pipeline import run as run_case_selection
    from pipelines.complaints_a.pipeline import FEED_NAME as COMPLAINTS_A
    from pipelines.complaints_a.pipeline import run as run_complaints_a
    from pipelines.complaints_b.pipeline import FEED_NAME as COMPLAINTS_B
    from pipelines.complaints_b.pipeline import run as run_complaints_b
    from pipelines.complaints_c.pipeline import FEED_NAME as COMPLAINTS_C
    from pipelines.complaints_c.pipeline import run as run_complaints_c
    from pipelines.comprehensive_examples.pipeline import (
        bronze_to_silver,
        silver_to_gold,
    )
    from pipelines.ingest.pipeline import AS_OF as INGEST_AS_OF
    from pipelines.ingest.pipeline import run as run_ingest
    from pipelines.ref_lookup.pipeline import run as run_ref_lookup
    from pipelines.retail_analytics.pipeline import run as run_retail_analytics
    from pipelines.selection.pipeline import run as run_selection

    # Every migration-gated table (Refresh's SqliteTruncateReloadWriter,
    # #323) must already exist -- bring the real tree into existence exactly
    # as an operator's `migrate` would, rather than let a Writer mint one.
    migrate_all(base_dir)

    landing = base_dir / "landing_zone"
    landing.mkdir(parents=True, exist_ok=True)
    for feed_name in (COMPLAINTS_A, COMPLAINTS_B, COMPLAINTS_C):
        sample = (
            REPO_ROOT / "pipelines" / feed_name / "sample_data" / f"{feed_name}.csv"
        )
        shutil.copy(sample, landing / f"{feed_name}.csv")

    run_complaints_a(RunContext(base_dir=base_dir, pipeline=COMPLAINTS_A))
    run_complaints_b(RunContext(base_dir=base_dir, pipeline=COMPLAINTS_B))
    run_complaints_c(RunContext(base_dir=base_dir, pipeline=COMPLAINTS_C))
    run_case_selection(
        RunContext(
            base_dir=base_dir,
            pipeline=CASE_SELECTION_SUBJECT,
            run_date=CASE_SELECTION_AS_OF,
        )
    )
    run_retail_analytics(RunContext(base_dir=base_dir, pipeline="retail_analytics"))
    run_ref_lookup(RunContext(base_dir=base_dir, pipeline="ref_lookup"))
    bronze_to_silver(base_dir)
    silver_to_gold(base_dir)
    run_ingest(RunContext(base_dir=base_dir, pipeline="ingest", run_date=INGEST_AS_OF))
    run_selection(
        RunContext(base_dir=base_dir, pipeline="selection", run_date=INGEST_AS_OF)
    )


def _landed_tables(base_dir: Path) -> set[tuple[str, str]]:
    """Every ``(namespace, table)`` any ``*.db`` under ``base_dir`` actually holds.

    ``namespace`` is derived the same way ``DirectoryStoreBackend`` builds a
    path from one, in reverse: a file's path relative to ``base_dir``, minus
    its ``.db`` suffix, with ``/`` joints. Reject tables (``quarantine.db``)
    and run-metadata stores (any ``_``-prefixed top-level directory) are out of
    this issue's scope, so they are skipped rather than asserted on. Since
    #323, each database also carries its own ``schema_migrations`` ledger
    (``migrate_all`` brings the tables into existence first) -- that is
    migration bookkeeping, not a medallion table, so it is skipped too.
    """
    landed: set[tuple[str, str]] = set()
    for db_path in base_dir.rglob("*.db"):
        relative = db_path.relative_to(base_dir)
        if relative.parts[0].startswith("_") or db_path.name == "quarantine.db":
            continue
        namespace = str(relative.with_suffix("")).replace("\\", "/")
        con = sqlite3.connect(db_path)
        try:
            rows = con.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        finally:
            con.close()
        for (table_name,) in rows:
            if table_name == "schema_migrations":
                continue
            landed.add((namespace, table_name))
    return landed


def _declared_tables() -> set[tuple[str, str]]:
    """Every ``(namespace, table)`` declared across every feed's ``TABLES``.

    A quarantine ``Table`` (``tools.schema.quarantine_table``) is skipped, to
    match ``_landed_tables``'s own skip of ``quarantine.db``: this cross-check
    is about the medallion shape a feed *always* writes, and a feed's sample
    data landing zero rejects (as every bundled feed's does) is not drift --
    "declared but never landed" would otherwise flag every quarantine table on
    every run. The two checks that *do* cover it are
    :func:`test_every_quarantining_bundled_feed_declares_its_quarantine_table`
    below (the wiring and the declaration agree) and
    ``tests/pipelines/test_complaints_a.py``'s rejected-row case (a real reject
    lands in the migrated quarantine table).
    """
    declared: set[tuple[str, str]] = set()
    for feed, tables in collect_declared_tables().items():
        for table in tables:
            namespace = resolved_namespace(table, feed)
            if namespace.rsplit("/", 1)[-1] == "quarantine":
                continue
            declared.add((namespace, table.name))
    return declared


def _drift(
    landed: set[tuple[str, str]], declared: set[tuple[str, str]]
) -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
    """``(undeclared, unwritten)`` -- what a Writer targets with no declaration,
    and what is declared but nothing lands. A pure function of two sets so the
    self-test below can drive it without running anything.
    """
    return landed - declared, declared - landed


def test_declared_tables_match_every_bundled_feeds_writes(tmp_path):
    _run_every_bundled_feed(tmp_path)

    landed = _landed_tables(tmp_path)
    declared = _declared_tables()
    undeclared, unwritten = _drift(landed, declared)

    assert not undeclared, (
        f"table(s) a Writer targets with no TABLES declaration: {sorted(undeclared)}"
    )
    assert not unwritten, (
        f"table(s) declared in TABLES but never landed: {sorted(unwritten)}"
    )


#: Feed packages deliberately exempt from declaring ``TABLES``. Empty today:
#: a feed mid-scaffold legitimately has none yet, but leaving that state
#: undeclared is how a feed quietly escapes the cross-check above, so name it
#: here (with a reason) rather than letting the guard shrink silently.
FEEDS_WITHOUT_TABLES: tuple[str, ...] = ()


def test_every_feed_package_declares_its_tables():
    """Enumerated, not listed: a *new* feed is covered without editing a list.

    ``collect_declared_tables()`` returns an entry per ``pipelines/<feed>``
    package and an empty tuple for one that declares nothing, so this catches
    both a feed that never declared its tables and a typo'd module name
    silently dropping one out of the collection.
    """
    collected = collect_declared_tables()

    # Walked here independently, so this compares two sources rather than
    # restating how collect_declared_tables() enumerates feeds.
    feed_packages = {
        entry.name
        for entry in (REPO_ROOT / "pipelines").iterdir()
        if entry.is_dir() and (entry / "__init__.py").exists()
    }
    assert set(collected) == feed_packages
    undeclared = sorted(
        feed
        for feed, tables in collected.items()
        if not tables and feed not in FEEDS_WITHOUT_TABLES
    )
    assert not undeclared, (
        f"feed(s) declaring no TABLES: {undeclared} -- declare them in the "
        "feed's schema.py, or add the feed to FEEDS_WITHOUT_TABLES with a reason"
    )
    # demo_fan_out.py and __init__.py are modules, not feed *packages*, so they
    # are simply absent rather than an error.
    assert "demo_fan_out" not in collected


def test_the_drift_check_itself_would_catch_a_planted_violation():
    """Self-test: prove :func:`_drift` fails loudly on each kind of violation.

    Without this, the guard above could quietly stop guarding anything (e.g. a
    refactor that made ``_landed_tables``/``_declared_tables`` always agree
    trivially) and no test would ever notice.
    """
    landed = {("cases/raw", "cases"), ("cases/silver", "cases")}
    declared = {("cases/raw", "cases"), ("cases/silver", "cases")}
    assert _drift(landed, declared) == (set(), set())

    # A Writer targets a table nothing declares.
    undeclared, unwritten = _drift(landed | {("cases/gold", "cases")}, declared)
    assert undeclared == {("cases/gold", "cases")}
    assert unwritten == set()

    # A declaration names a table nothing ever writes.
    undeclared, unwritten = _drift(landed, declared | {("cases/gold", "cases")})
    assert undeclared == set()
    assert unwritten == {("cases/gold", "cases")}


def test_every_quarantining_bundled_feed_declares_its_quarantine_table():
    # A quarantine Table is one opt-in line in a feed's TABLES, so a feed that
    # wires a reject_writer and forgets it would only fail in production, on
    # the first run that actually rejected a row. This is the cross-check that
    # would have caught that: the wiring and the declaration must agree.
    import importlib
    import inspect

    declared = collect_declared_tables()
    for feed, tables in declared.items():
        module = importlib.import_module(f"pipelines.{feed}.pipeline")
        wires_quarantine = "quarantine_writer(" in inspect.getsource(module)
        declares_quarantine = any(t.namespace == "quarantine" for t in tables)
        assert wires_quarantine == declares_quarantine, (
            f"{feed}: pipeline wires a quarantine writer={wires_quarantine} but "
            f"schema.py declares a quarantine table={declares_quarantine}"
        )
