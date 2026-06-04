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
| `ExcelReader(path, sheet=0)` | One worksheet of an `.xlsx` workbook | path + sheet **name or zero-based index** (default the first sheet) |
| `SqliteReader(db_path, table)` | One table of a SQLite layer db | db path + table name |
| `SasReader(script, copy_glob, dest)` | A SAS feed run on a remote box | script name + glob of outputs to copy back + local landing dir |
| `SharePointReader(site, list_name, auth)` | A SharePoint list | site URL + list name + auth config |

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

## Remote feeds (SAS, SharePoint)

Two source types live on a remote system the framework host can't run itself:
SAS (no macOS runtime, and the cross-platform constraint forbids a Windows-only
path) and SharePoint (tenant + auth out of scope for now). Their Readers keep
the same `read() -> Dataset` shape, but the remote behaviour — shelling to
`ssh`/`scp`, calling the SharePoint API — sits behind a **swappable seam in
`framework.remote` that is stubbed today** (ADR-0004, ADR-0005). Because the
remote step is a seam, the whole feed is testable against local fixtures with
**no SSH, SAS box, network, or tenant**, and the real client drops in later
without touching the Reader or any pipeline script.

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
from framework.readers import SasReader

# Reads cases.csv already landed in /data/landing/cases (stubbed transfer).
reader = SasReader("run_cases.sas", "*.csv", "/data/landing/cases")
dataset = reader.read()
```

### `SharePointReader(site, list_name, auth)`

Configured with the SharePoint `site` URL, `list_name`, and `auth` config; on
`read()` it delegates to a `SharePointFetcher` — the download seam — handing it
the `(site, list_name, auth)` config verbatim. Two fetchers ship:

- **`StubbedSharePointFetcher`** (the default): the real client is deferred
  (auth/tenant out of scope — ADR-0004), so `read()` raises `NotImplementedError`
  rather than pretending to reach the network.
- **`LocalCsvFetcher(path)`**: an offline fetcher backed by a local CSV fixture;
  it ignores the SharePoint config and reads the file, so the read path is
  exercised with no tenant. It has the same shape a real client will take.

```python
from framework.readers import SharePointReader
from framework.remote import LocalCsvFetcher

# Offline: reads a local fixture in place of the SharePoint list.
reader = SharePointReader(
    "https://contoso.sharepoint.com/sites/cases",
    "Advisers",
    fetcher=LocalCsvFetcher("fixtures/advisers.csv"),
)
dataset = reader.read()
```

Implementing either feed for real means writing one new class behind the seam (a
`RemoteRunner` that drives `ssh`/`scp`, or a `SharePointFetcher` that calls the
API) and passing it in — no change to the Readers, the builder, or the docs
above.
