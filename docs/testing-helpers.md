# Testing helpers for pipeline authors

`tests.framework_testing` is a small, **test-only** surface that makes a concrete
pipeline script easy to test — without hand-wiring temp directories, SQLite
round-trips, or JSONL parsing in every test. Pipeline code never imports it at
runtime; your **tests** do:

```python
from tests.framework_testing import given_rows, rows_of, read_rows
from tests.framework_testing import RecordingWriter, RecordingRunLog, read_run_log
```

It sits *beside* the production facades (`framework.core` / `framework.io` /
`framework.transform` / `framework.run`), not inside them — see
[public-api.md](public-api.md). Everything stays behind the `Dataset` seam
([the opaque `Dataset` carrier](adr/0002-python-processing-opaque-dataset-carrier.md)):
the helpers take and return plain Python **row dicts**, never a pandas frame.

## The surface

| Helper | What it does |
|--------|--------------|
| `given_rows(rows)` | A `Reader` over in-memory row dicts — the *given-source-rows* entry point. Hands a pipeline its feed without a fixture file. |
| `given_csv(tmp_path, rows)` | Write `rows` to a CSV under `tmp_path` and return its path — the *file-source* counterpart, for exercising `CsvReader` / `GlobCsvReader`. |
| `make_dataset(rows)` | The engine-confined bridge `given_rows` uses: row dicts → `Dataset`. Reach for it when you need a `Dataset` directly. |
| `rows_of(source)` | Unwrap a `Dataset`, a `RecordingWriter`, or a `Reader` back to `list[dict]` — the *expect-output-rows* side, for a direct `==`. |
| `RecordingWriter()` | A `Writer` that captures writes in memory instead of persisting. Read it with `rows_of(writer)`; `.writes` / `.dataset` expose the raw captures (e.g. for checkpoint pipelines that write more than once). |
| `read_rows(store, table)` | Read a landed table back as row dicts — collapses the `store.reader(table).read().to_pandas()` chain. |
| `without_columns(rows, *names)` | Drop named columns from row dicts (missing names ignored) — strip volatile stamps before an `==`. |
| `assert_rows_equal(actual, expected, *, ignoring=(), unordered=False)` | Assert two row lists are equal; `actual` may be anything `rows_of` accepts. `ignoring` drops stamp columns (`logical_run_id` / `load_date`); `unordered` compares as multisets. |
| `RecordingRunLog()` | A `RunLog` that captures records in memory. `.records`, `.records_for_step(step)`, `.warn_hits`, `.errors`. |
| `read_run_log(path)` | Parse an on-disk JSONL run-log file into the same record dicts a `RecordingRunLog` captures. |
| `build_databases(base_dir, *specs)` | A base directory whose databases have been built from the checked-in migrations. A spec is a whole subject (`"sharepoint_cases"`) or one of its databases (`"sharepoint_cases/silver"`) — the branch a feed writing a migrated database actually takes in production. |
| `database_registry(base_dir, *specs)` | The same, handed back as a `StoreRegistry`. |
| the `databases` fixture | The fixture form: `base_dir = databases("sharepoint_cases/silver")` builds into pytest's `tmp_path`. |

The surface is split internally into `tests.framework_testing.rows` (the row helpers
above), `tests.framework_testing.run_log` (`RecordingRunLog` / `read_run_log`) and
`tests.framework_testing.databases` (the database helpers), all
re-exported from `tests.framework_testing` — import from the package, not the modules.

## Building the databases a test writes

A database with a checked-in baseline behaves differently at the write: no Writer
creates a missing table, and `Refresh` deletes-then-appends rather than dropping
the table its migration declared ([migrations.md](migrations.md)). A test that
runs against a bare `tmp_path` is therefore testing the *other* branch — the one
production no longer takes.

```python
from tests.framework_testing import build_databases

def test_the_feed_lands_its_rows(tmp_path):
    base_dir = build_databases(tmp_path, "sharepoint_cases")
    feed.run(RunContext(base_dir=base_dir), client=FakeClient())
```

or, as a fixture:

```python
def test_the_feed_lands_its_rows(databases):
    base_dir = databases("sharepoint_cases/silver")
```

Four things worth knowing:

- **It applies the real `migrations/` tree.** A test-only DDL path would defeat
  the point — what is worth testing is that the checked-in SQL and the code
  agree. A table a baseline forgot fails these tests exactly as it fails a run.
- **A spec is a subject or one of its databases.** `"sharepoint_cases"` builds
  every database that subject declares; `"sharepoint_cases/silver"` builds one.
  Name what the test actually writes — the whole subject is the convenient
  default, not the cheap one, and `sharepoint_cases` is 23 tables across four
  files.
- **The names come from the tree**, not from the medallion. Raw, silver, gold and
  quarantine are one application's profile over the store; a subject whose
  databases are called something else builds the same way.
- **Anything the tree does not declare is an error naming it**, rather than an
  unbuilt base directory quietly proving nothing — including `subject/typo`,
  which naming a subject alone could never have caught. Feeds without baselines
  (the demo and example pipelines) keep implicit creation and need no fixture.

Pass several specs when a pipeline reads one subject and writes another —
`build_databases(tmp_path, "sharepoint_cases/silver", "reviewer_activity/gold")`.

## Given-source-rows / expect-output-rows

The most common pipeline test: feed rows in, run the real builder, assert the
output rows. No filesystem touched.

```python
from framework.run import Pipeline
from framework.transform import Filter
from tests.framework_testing import given_rows, rows_of, RecordingWriter

def test_high_value_filter_keeps_only_the_cases_at_or_above_100():
    reader = given_rows([{"amount": 100}, {"amount": 50}, {"amount": 200}])
    writer = RecordingWriter()

    p = Pipeline("selection")
    r = p.read(reader, name="read")
    high = p.transform(
        Filter(lambda row: row["amount"] >= 100, name="high-value"), r, name="filter"
    )
    p.write(writer, high, name="write")
    p.run()

    assert rows_of(writer) == [{"amount": 100}, {"amount": 200}]
```

## Reading a landed layer

When the pipeline writes to a real `Store`, `read_rows` reads the table back
through the Store's own Reader — the same seam a pipeline uses, not around it:

```python
from framework.io import Refresh
from tools.store import Store
from tests.framework_testing import given_rows, read_rows
from framework.run import Pipeline

def test_landed_rows(tmp_path):
    store = Store(tmp_path / "cases.db")
    p = Pipeline("cases")
    r = p.read(given_rows([{"case_id": "c1", "amount": 100}]), name="read")
    p.write(store.writer("cases", Refresh()), r, name="write")
    p.run()

    assert read_rows(store, "cases") == [{"case_id": "c1", "amount": 100}]
```

## Comparing rows, ignoring stamps and order

A direct `==` gets brittle once a pipeline stamps `logical_run_id` / `load_date` or
doesn't guarantee row order. `assert_rows_equal` takes anything `rows_of` accepts
(here a `RecordingWriter`), drops the volatile columns, and compares as a
multiset:

```python
from tests.framework_testing import assert_rows_equal, given_rows, RecordingWriter
from framework.transform import Stamp
from framework.run import Pipeline

def test_scored_rows_ignoring_the_run_stamp():
    writer = RecordingWriter()
    p = Pipeline("cases")
    r = p.read(given_rows([{"case_id": "c1", "amount": 100}]), name="read")
    s = p.transform(Stamp("logical_run_id", "run-123"), r, name="stamp")
    p.write(writer, s, name="write")
    p.run()

    assert_rows_equal(
        writer, [{"case_id": "c1", "amount": 100}], ignoring=["logical_run_id"]
    )
```

`without_columns(rows, *names)` is the same column-dropping step on its own, and
`given_csv(tmp_path, rows)` writes the rows to a CSV when you need to exercise a
file-backed reader (`CsvReader` / `GlobCsvReader`) rather than an in-memory feed.

## Asserting run-log records and validation failures

Compose a `RecordingRunLog` to assert what a run recorded. A **warn**-severity
breach keeps the run going and rides `warn_hits`; an **error**-severity breach
aborts fail-fast ([fail-fast atomic runs](adr/0005-fail-fast-atomic-runs-and-observability.md)),
recording an `error` for the failing step and the run summary *before* the
exception propagates — so a validation failure is asserted through the captured
records:

```python
import pytest
from framework.run import Pipeline
from framework.core import ColumnValidator, ValidationError
from tests.framework_testing import given_rows, RecordingWriter, RecordingRunLog

def test_missing_required_column_aborts_and_is_recorded():
    run_log = RecordingRunLog()
    writer = RecordingWriter()
    p = Pipeline("cases", run_log=run_log)
    r = p.read(given_rows([{"amount": 100}]), name="read")
    v = p.validate(ColumnValidator(["missing_col"]), r, name="validate")
    p.write(writer, v, name="write")

    with pytest.raises(ValidationError):
        p.run()

    assert any("missing_col" in e for e in run_log.errors)
    assert writer.writes == []  # fail-fast: nothing reached the writer
```

For a pipeline that lands its `RunLog` to a file (like the demos), assert the
file with `read_run_log`:

```python
records = read_run_log(tmp_path / "runs.log")
warns = [w for r in records for w in r["warn_hits"]]
assert any("schema drift" in w for w in warns)
```

The demo-pipeline tests (`tests/pipelines/test_demo_pipeline.py`,
`tests/pipelines/test_demo_selection.py`) use these helpers — a working reference.

## The local zone is pinned to UTC for every test

Instants are UTC, calendar dates are local, and every comparison converts the
instant to the local date first — the rule `tools/observability/timestamps.py`
owns, described in [run-log-format.md](run-log-format.md). So a test that stamps
a run near midnight and asserts against a calendar date is really asking about
*the box's offset* unless it says which zone it means.

`tests/conftest.py` therefore pins the local zone to UTC for the whole suite,
via an autouse fixture over the `local_timezone` seam. Nothing needs to opt in,
and a near-midnight timestamp means the same thing in London, New York and
Kiritimati.

**Override it when the conversion *is* what you're testing.** Ask for your own
zone fixture and it wins — an autouse fixture is set up before the ones a test
names:

```python
BST = dt.timezone(dt.timedelta(hours=1))

@pytest.fixture
def uk_summer(monkeypatch):
    monkeypatch.setattr(timestamps, "local_timezone", lambda: BST)

def test_a_run_just_after_local_midnight_counts_as_today(uk_summer):
    # 23:10 UTC on the 27th is 00:10 local on the 28th.
    assert local_date("2026-07-27T23:10:00+00:00") == dt.date(2026, 7, 28)
```

`tests/framework/run/test_runner.py`,
`tests/tools/test_observability/test_timestamps.py` and
`tests/tools/test_orchestration/test_freshness_rule.py` all do this — the last
even over a zone that changes offset mid-year.

Keep such a fixture **function-scoped**. A module- or session-scoped one is set
up *before* the autouse pin and would be silently overwritten by it.

The pin covers the *zone*, not the *clock*: `date.today()` and `utc_now_iso()`
still read the real time, so a test that needs a fixed instant must inject one.
And because the pin substitutes a concrete zone, `local_timezone`'s production
default (`None` — the system zone, resolved per instant) is no longer reached by
the tests it displaces; `tests/test_suite_defaults.py` restores and exercises it
directly so that branch keeps its cover.
