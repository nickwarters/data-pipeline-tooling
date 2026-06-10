# Testing helpers for pipeline authors (#94)

`framework.testing` is a small, **test-only** surface that makes a concrete
pipeline script easy to test — without hand-wiring temp directories, SQLite
round-trips, or JSONL parsing in every test. Pipeline code never imports it at
runtime; your **tests** do:

```python
from framework.testing import given_rows, rows_of, read_rows
from framework.testing import RecordingWriter, RecordingRunLog, read_run_log
```

It sits *beside* the three production facades (`framework.io` /
`framework.transform` / `framework.run`), not inside them — see
[public-api.md](public-api.md). Everything stays behind the `Dataset` seam
([ADR-0002](adr/0002-python-only-processing-dumb-store-two-tier-carrier.md)):
the helpers take and return plain Python **row dicts**, never a pandas frame.

## The surface

| Helper | What it does |
|--------|--------------|
| `given_rows(rows)` | A `Reader` over in-memory row dicts — the *given-source-rows* entry point. Hands a pipeline its feed without a fixture file. |
| `make_dataset(rows)` | The engine-confined bridge `given_rows` uses: row dicts → `Dataset`. Reach for it when you need a `Dataset` directly. |
| `rows_of(source)` | Unwrap a `Dataset`, a `RecordingWriter`, or a `Reader` back to `list[dict]` — the *expect-output-rows* side, for a direct `==`. |
| `RecordingWriter()` | A `Writer` that captures writes in memory instead of persisting. Read it with `rows_of(writer)`; `.writes` / `.dataset` expose the raw captures (e.g. for checkpoint pipelines that write more than once). |
| `read_rows(store, layer, table)` | Read a landed layer table back as row dicts — collapses the `store.reader(layer, table).read().to_pandas()` chain. |
| `RecordingRunLog()` | A `RunLog` that captures records in memory. `.records`, `.records_for_step(step)`, `.warn_hits`, `.errors`. |
| `read_run_log(path)` | Parse an on-disk JSONL run-log file into the same record dicts a `RecordingRunLog` captures. |

## Given-source-rows / expect-output-rows

The most common pipeline test: feed rows in, run the real builder, assert the
output rows. No filesystem touched.

```python
from framework.run import Pipeline
from framework.transform import Filter
from framework.testing import given_rows, rows_of, RecordingWriter

def test_high_value_filter_keeps_only_the_cases_at_or_above_100():
    reader = given_rows([{"amount": 100}, {"amount": 50}, {"amount": 200}])
    writer = RecordingWriter()

    (
        Pipeline("selection", reader)
        .with_processor(Filter(lambda row: row["amount"] >= 100, name="high-value"))
        .write_to(writer)
        .run()
    )

    assert rows_of(writer) == [{"amount": 100}, {"amount": 200}]
```

## Reading a landed layer

When the pipeline writes to a real `Store`, `read_rows` reads the table back
through the Store's own Reader — the same seam a pipeline uses, not around it:

```python
from framework.io import RAW, Refresh, Store
from framework.testing import given_rows, read_rows
from framework.run import Pipeline

def test_landed_rows(tmp_path):
    store = Store(tmp_path / "cases")
    (
        Pipeline("cases", given_rows([{"case_id": "c1", "amount": 100}]))
        .write_to(store.writer(RAW, "cases", Refresh()))
        .run()
    )

    assert read_rows(store, RAW, "cases") == [{"case_id": "c1", "amount": 100}]
```

## Asserting run-log records and validation failures

Compose a `RecordingRunLog` to assert what a run recorded. A **warn**-severity
breach keeps the run going and rides `warn_hits`; an **error**-severity breach
aborts fail-fast ([ADR-0007](adr/0007-fail-fast-atomic-runs-jsonl-observability.md)),
recording an `error` for the failing step and the run summary *before* the
exception propagates — so a validation failure is asserted through the captured
records:

```python
import pytest
from framework.run import Pipeline
from framework.transform import ColumnValidator, ValidationError
from framework.testing import given_rows, RecordingWriter, RecordingRunLog

def test_missing_required_column_aborts_and_is_recorded():
    run_log = RecordingRunLog()
    writer = RecordingWriter()
    pipeline = (
        Pipeline("cases", given_rows([{"amount": 100}]), run_log=run_log)
        .with_validator(ColumnValidator(["missing_col"]))
        .write_to(writer)
    )

    with pytest.raises(ValidationError):
        pipeline.run()

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

The demo-pipeline tests (`tests/test_demo_pipeline.py`,
`tests/test_demo_selection.py`) use these helpers — a working reference.
