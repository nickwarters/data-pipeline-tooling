# How to add a Feed

A **Feed** is one source of data ingested into a subject's medallion. Adding one
is: pick the `Reader` for the source type, compose it into a `Pipeline`, and
point the pipeline at a layer Writer minted by the subject's `Store`. No new
engine code is needed for the source types that already ship.

## 1. Pick a `Reader`

A `Reader` encapsulates *how one source type is read* behind a single method
(ADR-0002, ADR-0005):

```python
class Reader(Protocol):
    def read(self) -> DataHandle: ...
```

The concrete in-memory engine (pandas today) lives **inside** the Reader and
behind the `DataHandle` seam — it never appears in this signature, a pipeline
script, or the domain layer. Readers are tested against **local fixture files**:
no network, no SAS, no SharePoint. Paths are taken as `str | os.PathLike` and
held with `pathlib.Path`, so they behave identically on Windows and macOS.

Concrete Readers that ship:

| Reader | Source | Construct with |
|--------|--------|----------------|
| `CsvReader(path)` | A CSV file | the file path |
| `ExcelReader(path, sheet=0)` | One worksheet of an `.xlsx` workbook | path + sheet **name or zero-based index** (default the first sheet) |
| `SqliteReader(db_path, table)` | One table of a SQLite layer db | db path + table name |

`ExcelReader` reads `.xlsx` via pandas + **openpyxl** (a pure-Python,
cross-platform engine; in `requirements.txt`). `SqliteReader` is the read-side
dual of the Sqlite Writers — it opens through the shared `connect` factory, so
it inherits the share-tolerant settings (ADR-0001) and can read a subject's own
layer **or** another subject's read-only Reference Data medallion (joined in
Python — ADR-0002). `Sas`/`SharePoint` follow the same shape (ADR-0004; later
slice).

## 2. Compose the pipeline and land it

The Reader drops into the deferred `Pipeline` builder; the subject's `Store`
mints the destination Writer for the target layer, so the builder never learns
about medallion layers or load rules:

```python
from framework.builder import Pipeline
from framework.readers import ExcelReader
from framework.store import Store

store = Store("/path/to/share/cases")          # the "cases" subject's medallion
landed = (
    Pipeline("cases", ExcelReader("feed.xlsx", sheet="cases"))
    .with_validator(ColumnValidator(["case_id"]))   # optional: gate the input
    .write_to(store.writer("raw", "cases"))         # raw = full-refresh Writer
    .run()
)
```

Swapping the Reader is the only change needed to ingest the same feed from a
different source type — the rest of the pipeline is identical. Validators and
(later) processors compose in the same fluent way; see
[`core-primitives.md`](core-primitives.md).
