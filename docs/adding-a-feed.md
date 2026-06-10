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
    def read(self) -> Dataset: ...
```

The concrete in-memory engine (pandas today) lives **inside** the Reader and
behind the `Dataset` seam — it never appears in this signature, a pipeline
script, or the domain layer. Readers are tested against **local fixture files**:
no network, no SAS, no SharePoint. Paths are taken as `str | os.PathLike` and
held with `pathlib.Path`, so they behave identically on Windows and macOS.

Concrete Readers that ship:

| Reader | Source | Construct with |
|--------|--------|----------------|
| `CsvReader(path)` | A CSV file | the file path |
| `GlobCsvReader(directory, pattern)` | Many local CSV files that together form one Feed snapshot | directory path + glob pattern |
| `ExcelReader(path, sheet=0)` | One worksheet of an `.xlsx` workbook | path + sheet **name or zero-based index** (default the first sheet) |
| `SqliteReader(db_path, table)` | One table of a SQLite layer db | db path + table name |
| `SasReader(script, copy_glob, dest)` | A SAS feed run on a remote box | script name + glob of outputs to copy back + local landing dir |
| `SharePointReader(site, list_name, auth)` | A SharePoint list | site URL + list name + auth config |

`GlobCsvReader` reads every file matching `directory / pattern` in sorted
deterministic order, concatenates them behind the `Dataset` seam, and returns
one `Dataset`. Use it when a source export is split across files but should be
validated, processed, written, and failed as one logical Feed snapshot. If no
files match, it raises `FileNotFoundError` naming the directory and pattern;
`columns=[...]` projects columns with the same pandas `usecols` behavior as
`CsvReader`.

`ExcelReader` reads `.xlsx` via pandas + **openpyxl** (a pure-Python,
cross-platform engine; in `requirements.txt`). `SqliteReader` is the read-side
dual of the Sqlite Writers — it opens through the shared `connect` factory, so
it inherits the share-tolerant settings (ADR-0001) and can read a subject's own
layer **or** another subject's read-only Reference Data medallion (joined in
Python — ADR-0002). `SasReader` and `SharePointReader` follow the same `read()`
shape but reach a remote source whose client is **stubbed for now** (ADR-0004);
see [Remote feeds (SAS, SharePoint)](#remote-feeds-sas-sharepoint) below.

## 2. Compose the pipeline and land it

The Reader drops into the deferred `Pipeline` builder; the subject's `Store`
mints the destination Writer for the target layer, so the builder never learns
about medallion layers or load rules:

```python
from framework.io import RAW, ExcelReader, Refresh, StoreCatalog
from framework.run import Pipeline
from framework.transform import ColumnValidator, SchemaDriftValidator

store = StoreCatalog("/path/to/share").store("cases")
landed = (
    Pipeline("cases", ExcelReader("feed.xlsx", sheet="cases"))
    .with_validator(ColumnValidator(["case_id"]))   # optional: gate the input
    # optional: warn (don't abort) when the source's columns drift from the
    # prior run's landed set — catches owner-controlled schema change at the
    # door (#51). First run has no prior, so it's a clean no-op.
    .with_validator(
        SchemaDriftValidator(store.columns_of(RAW, "cases")), severity="warn"
    )
    .write_to(store.writer(RAW, "cases", Refresh()))
    .run()
)
```

Swapping the Reader is the only change needed to ingest the same feed from a
different source type — the rest of the pipeline is identical. Validators and
(later) processors compose in the same fluent way; see
[`core-primitives.md`](core-primitives.md).

If a landing directory contains many files, choose the component by the logical
run boundary:

- Use `GlobCsvReader(directory, "*.csv")` when the files are one split snapshot:
  one read, one `Dataset`, one validation/write, one logical run id.
- Use `ForEach(files, pipeline_builder, ...)` when each file is an independent
  run that needs its own context, failure boundary, and idempotency key.

## Remote feeds (SAS, SharePoint)

Two source types live on a remote system the framework host can't run itself:
SAS (no macOS runtime, and the cross-platform constraint forbids a Windows-only
path) and SharePoint (**Subscription Edition on-prem**; the connection drops in
from a separate repo). Their Readers keep the same `read() -> Dataset` shape,
but the remote behaviour — shelling to `ssh`/`scp`, calling the SharePoint list
API — sits behind a **swappable seam in `framework.remote` that is stubbed
today** (ADR-0004, ADR-0005). The on-prem SE auth (NTLM/Kerberos/REST — **not**
Azure AD/Graph) is a client-seam concern designed once for both directions, and
keeping it behind the seam keeps the cross-platform constraint (Windows + macOS)
the framework's, not the caller's. Because the remote step is a seam, the whole
feed is testable against local fixtures with **no SSH, SAS box, network, or live
SharePoint**, and the real client drops in later without touching the Reader,
the Writer, or any pipeline script.

### `SasReader(script, copy_glob, dest)`

Configured with three knobs, and on `read()` does three things:

| Knob | Meaning |
|------|---------|
| `script` | the SAS script to run on the remote box |
| `copy_glob` | which output files to copy back (e.g. `"*.csv"`) |
| `dest` | the local landing directory the outputs are copied into |

1. **Run** `script` on the remote SAS host.
2. **Fetch** the files matching `copy_glob` into `dest`.
3. **Read** the landed files (sorted, concatenated) via the ordinary local file
   read path — the same CSV engine `CsvReader` uses, behind the Dataset seam.

Steps 1–2 are delegated to a `RemoteRunner` (the cross-platform shell/transfer
seam — `ssh`/`scp` today, a library such as `paramiko` later). The default is
`StubbedRemoteRunner`, a **no-op**: it runs nothing and copies nothing, assuming
the outputs are **already landed** in `dest` (a fixture in tests, a
previously-copied directory in practice). If nothing in `dest` matches
`copy_glob`, `read()` raises `FileNotFoundError` rather than masking a broken
fetch with an empty Dataset. Swap in a different `RemoteRunner` (keyword-only
`runner=`) to add the real exec/transfer behind the same interface.

```python
from framework.io import SasReader

# Reads cases.csv already landed in /data/landing/cases (stubbed transfer).
reader = SasReader("run_cases.sas", "*.csv", "/data/landing/cases")
dataset = reader.read()
```

### `SharePointReader(site, list_name, auth)`

Configured with the SharePoint `site` URL, `list_name`, and `auth` config; on
`read()` it delegates to a `SharePointFetcher` — the download seam — handing it
the `(site, list_name, auth)` config verbatim. Two fetchers ship:

- **`StubbedSharePointFetcher`** (the default): the real on-prem SE client is
  deferred (NTLM/Kerberos/REST auth out of scope — ADR-0004), so `read()` raises
  `NotImplementedError` rather than pretending to reach the network.
- **`LocalCsvFetcher(path)`**: an offline fetcher backed by a local CSV fixture;
  it ignores the SharePoint config and reads the file, so the read path is
  exercised with no live connection. It has the same shape a real client will
  take. (Tests that exercise **both** directions through one object use an
  in-memory fake list backend — see `tests/test_sharepoint_reader.py`.)

```python
from framework.io import SharePointReader
from framework.remote import LocalCsvFetcher  # internal seam: swappable fetcher

# Offline: reads a local fixture in place of the SharePoint list.
reader = SharePointReader(
    "https://contoso.sharepoint.com/sites/cases",
    "Advisers",
    fetcher=LocalCsvFetcher("fixtures/advisers.csv"),
)
dataset = reader.read()
```

### `SharePointWriter(site, list_name, auth, strategy=Refresh())`

The outbound dual of `SharePointReader` and the emitter of the canonical
**Selection** Deliverable — the SelectionPool pushed to **one list per Case
Type**. Configured with the target `site`, `list_name`, `auth`, and an explicit
Writer load strategy. On `write(dataset)`, it delegates to a `SharePointPusher`
— the upload seam — handing it the configured target, the `Dataset`, and the
strategy. The default `StubbedSharePointPusher` raises `NotImplementedError`
until the real on-prem SE client exists, so tests pass a recording or in-memory
fake pusher and never touch the network.

The Deliverable is emitted by a **second pipeline** that reads the gold
SelectionPool and writes here (`SqliteReader(gold, "selection_pool")` →
`SharePointWriter`) — consistent with ADR-0009's single-Writer pipelines over a
shared source, not a mid-run checkpoint (CONTEXT.md, #48):

```python
from framework.io import Refresh, SharePointWriter, SqliteReader
from framework.builder import Pipeline

Pipeline("selection-deliverable", SqliteReader(gold_db, "selection_pool")).write_to(
    SharePointWriter(site, f"Selection - {case_type}", strategy=Refresh(), pusher=client)
).run()
```

```python
from framework.io import Refresh, SharePointWriter

writer = SharePointWriter(
    "https://contoso.sharepoint.com/sites/cases",
    "SelectionPool",
    auth_config,
    Refresh(),
    pusher=real_pusher,  # later: a SharePointPusher implementation
)
```

Implementing either remote direction for real means writing one new class behind
the seam (a `RemoteRunner` that drives `ssh`/`scp`, a `SharePointFetcher` that
downloads list rows, or a `SharePointPusher` that uploads rows) and passing it
in — no change to the Reader/Writer, the builder, or the docs above.
