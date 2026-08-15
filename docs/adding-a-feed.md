# How to add a Feed

A **Feed** is one source of data ingested into a subject's medallion. Adding one
is: pick the `Reader` for the source type, compose it into a `Pipeline`, and
point the pipeline at a layer Writer minted by the subject's `Store`. No new
engine code is needed for the source types that already ship.

## 0. Scaffold the feed (the quickest start)

For a fresh CSV feed, generate a runnable starting point instead of writing the
files by hand:

```sh
python -m cli scaffold orders            # -> pipelines/orders/ + tests/pipelines/test_orders.py
python -m cli scaffold orders --force    # overwrite if it exists
python -m cli scaffold orders --from-feed-file sample.csv  # seed from a real CSV
```

This renders, from the template under `cli/scaffold_templates/feed/`, the feed
**code** as a subpackage and its **test** under `tests/pipelines/` (with the rest
of the suite, mirroring the source layout) — wired together and ready to run:

```
pipelines/orders/
  __init__.py
  schema.py            # @dataclass OrdersRow — the column/dtype contract
  pipeline.py          # raw_/silver_/gold_builder compose each hop; run()/main wire the real ones
  sample_data/orders.csv
tests/pipelines/
  test_orders.py       # drives raw_builder() with sample rows + a recording writer
migrations/orders/
  raw/0001_create_initial_tables.sql         # the feed's baseline DDL, one per
  silver/0001_create_initial_tables.sql      # database it writes — including
  gold/0001_create_initial_tables.sql        # quarantine, whose reject table
  quarantine/0001_create_initial_tables.sql  # would otherwise be undeclared
```

**The feed is born under migration control.** Its baselines declare the schema's
columns plus what the wiring stamps — `logical_run_id` / `load_date` from
`AccumulateByRun`, `pipeline_run_id` from every table-backed Writer, and
`failed_rule` on the reject table. Apply them before the first run:

```sh
python -m cli migrate --base-dir /tmp/demo
python -m cli run pipelines/orders --base-dir /tmp/demo
```

Edit those files freely until you have applied them somewhere; after that a shape
change is a **new numbered migration** beside the baseline, never an edit to it —
the runner records each file's checksum when it applies it and refuses one that
has changed since ([migrations.md](migrations.md)). The generated test uses
`migrated_base_dir(tmp_path, FEED_NAME)`, so it runs against the same write path
production takes: no Writer creates a missing table, and a column the baseline
forgot fails there rather than in a live run.

With `--from-feed-file`, the **raw** baseline is declared in the source's own
column names and silver's in the canonical ones — the same split
`RAW_FEED_COLUMNS` / `RENAME` make in the code, since raw lands the source
faithfully and the rename happens at silver. The Case Type variant renders no
gold baseline, matching the pipeline it renders, which stops at silver.

`pipeline.py` follows the framework's canonical pipeline contract: it exposes a
`run(context: RunContext, *, describe: bool = False) -> Dataset` callable (and an
`UPSTREAMS` tuple of freshness requirements — empty for a source feed). The
framework addresses the pipeline by its path — `python -m cli run
pipelines/orders` imports `pipelines.orders.pipeline` and executes
`run(context)`. Each medallion hop is factored into its own
`*_builder(reader, writer, run_log=None) -> Pipeline` returning the composed
(not-yet-run) pipeline — the *one* definition of what that hop does:

- **`raw_builder`** gates the source with a `ColumnValidator` and lands a
  faithful copy.
- **`silver_builder`** renames source columns to the schema's vocabulary
  (`RENAME`), coerces the dtypes storage loses (`SchemaCoercion`), partitions
  bad rows into a quarantine dataset (`SchemaValueRulePartitioner`), and validates
  the declared schema (`SchemaValidator`).
- **`gold_builder`** is a passthrough to start — reads silver, writes gold — with
  a `TODO` to build the assembly, because *what* gold means is per-feed. For a
  worked example of a real one, see
  `pipelines/sharepoint_cases/gold.py`: a current-state reduce with a declared
  grain, plus five aggregates, all refreshed whole on every run.

### Each hop is wired where you can see it

Every builder wires its own hop inline. There is no shared recipe to look
through, and nothing to subclass — a generated `raw_builder` is the whole hop:

```python
def raw_builder(reader, writer, run_log=None):
    p = Pipeline(f"{FEED_NAME}:raw", run_log=run_log)
    node = p.read(reader, name="read")
    expected = [f.name for f in fields(OrdersRow)]
    node = p.validate(ColumnValidator(expected), node, name="columns")
    p.write(writer, node, name="write")
    return p
```

To change what the hop does, edit those lines. The cost of that is real and
accepted: a policy change to "the standard raw hop" is now a change in each
feed, not one. It buys a feed a junior developer can read top to bottom.

A builder takes the hop's **ports** — a `Reader` and a `Writer` — rather than a
medallion profile, for two reasons: the *source* end of a raw hop isn't a
medallion layer at all, and injecting the ports is what lets the generated test
drive the real hop in memory against a `RecordingWriter`. `run()` wires the real
medallion layer Writers.

`run()` wires the real `CsvReader` and the subject's layer Writers (deriving the
raw/silver `AccumulateByRun` strategy from the `RunContext`, so re-drives under
the same logical run id replace rather than duplicate), then runs the three hops
in order and returns the gold `Dataset`. Pass `describe=True` (CLI `--describe`)
to print each pipeline's plan before it runs. `main()` is the thin entry for
running the module directly — it parses args with `argparse` (an optional
`base_dir`, `--env`, and `--describe`), builds a default `RunContext`, then
catches the
`PipelineError` family and prints `framework.core.format_failure(exc)` to
`stderr` with a non-zero exit, so an expected fail-fast abort (a failed check)
reads as a clear message rather than an unhandled traceback (a genuine bug is not
a `PipelineError` and keeps its trace). The generated `test_orders.py` calls
`raw_builder` directly with sample rows (`given_rows`) and a `RecordingWriter`, so
the first test exercises the real hop rather than a hand-rebuilt copy of it — a
second test runs the full `run(context)` filesystem path against the bundled
sample and asserts it refines through to gold.

The feed name must be a lowercase Python identifier (it becomes the package
name); `--force` overwrites an existing feed's files. The generated code imports
only through the public facades (no engine types, no case-review assumptions);
the pipeline uses **relative** intra-package imports, and the relocated test
imports the feed absolutely (`from pipelines.orders.pipeline import …`):

```sh
python -m cli run pipelines/orders --base-dir /data   # run via the framework (freshness + run log)
python -m cli run pipelines/orders --env dev  # resolve base_dir from a named environment
python -m cli run pipelines/orders --base-dir /data --dry-run  # preview each step, write nothing
python -m pipelines.orders.pipeline --base-dir /data  # or directly: refine the bundled sample to gold
python -m pipelines.orders.pipeline --env dev    # directly, base_dir from the dev environment
python -m pipelines.orders.pipeline --base-dir /data --describe  # print each hop's plan, then run it
python -m pytest tests/pipelines/test_orders.py  # the generated test passes as-is
```

Both `--base-dir` and `--env` resolve the medallion root the same way the
operator CLI does (see [operator-cli.md](operator-cli.md)): an explicit
`--base-dir` wins, otherwise `--env` (or `$PIPELINE_ENV`) selects an environment
from `tools.environments`, defaulting to `dev` → the committed `data` root.
`shared.constants` supplies the `data` and `~/pipelines_prod` defaults;
`PIPELINE_DATA_DIR_DEV` and `PIPELINE_DATA_DIR_PROD` override them, expanding a
leading `~` to the current user's home directory. Resolving `prod` without its
override emits a warning because it is using the committed fallback.

`--dry-run` is the local-development inner loop: it runs the feed end to end
against real data but **lands nothing**, printing per-step columns, dtypes, row
counts, a small row sample, and any validation failure (it stops fast on an
error-severity one, just like a real run). Use it to confirm a schema, a
`RENAME` map, or a processor reshapes the way you expect before you commit a
single row. Because it skips the *current* run's writes, preview a feed whose
upstream hops have already been landed for real — see
[the operator CLI's `--dry-run`](operator-cli.md#previewing-a-pipeline----dry-run).

Then **customise**: edit `schema.py`'s fields to your source columns (and add
`Annotated` value rules as needed — see
[schema-enforcement.md](schema-enforcement.md)), replace the sample CSV, swap
`CsvReader` for another Reader (next section) if the source isn't a CSV, fill in
the `silver_builder` `RENAME` and build out the `gold_builder`
(`def assemble_gold`). grow `test_<feed>.py` to assert the rows and processors you add. The
silver hop already enforces the schema (`SchemaCoercion` + `SchemaValidator` — see
[`schema-enforcement.md`](schema-enforcement.md)); the gold hop is a passthrough
until you shape it.

Finally, **document the feed's tables in a data dictionary** — one entry per
table per layer describing what the table is and what each field means (the prose
companion to `schema.py`). Copy the Confluence-ready template in
[`data-dictionary-template.md`](data-dictionary-template.md); a new column in the
schema isn't done until it has a dictionary row.

#### Seed it from a real feed file: `--from-feed-file`

Most of that customising is mechanical — retyping a source's column names into
`schema.py`, the sample CSV, and the test. Hand the scaffold a sample export
instead and it does that for you:

```sh
python -m cli scaffold orders --from-feed-file path/to/sample.csv
```

From the CSV's **header** it derives the schema's fields (one per column,
canonicalised to identifiers, with dtypes **inferred** from the first rows —
all-int → `int`, all-float → `float`, else `str`; an otherwise-integer column
with any **blank** infers `float`, because a nullable integer round-trips through
storage as `float64` and a declared `int` would then fail the silver dtype gate);
the file's **contents**
replace the bundled `sample_data/orders.csv`; and the first rows seed
`test_orders.py`'s sample rows. The schema is capped at **40 columns** — past
that the extra columns are dropped (with a loud warning and a note in `schema.py`
recording how many) so the generated dataclass stays a usable starting point.

When a header name **isn't already a clean identifier** (spaces, punctuation,
capitals — e.g. `Case Number`), it can't be a dataclass field, so the scaffold
emits the verbatim source names as a `RAW_FEED_COLUMNS` constant and gates the raw
hop's `ColumnValidator` on **those** rather than the schema's fields. It also fills
in the `silver_builder`'s `RENAME` map from each source name to its canonical
field, so the generated feed already does the raw-stays-faithful /
silver-canonicalises split end-to-end: raw validates and keeps the source's own
names; silver renames them to the schema's identifier-named shape before coercing
and validating. (The clean-identifier case leaves `RENAME` empty — an identity
no-op.) `--from-feed-file` is the generic scaffold only — it isn't supported with
`--case-type` yet (a Case Type also needs a `natural_key` decision).

### When your feed *is* a Case Type: `--case-type`

The generic scaffold above refines source → raw → silver → gold but is
**case-review-agnostic** — silver enforces only the declared schema and gold is a
plain passthrough; there's no Case identity (a Feed isn't necessarily a Case Type
— Reference Data feeds are ordinary Feeds with no Case identity). When the feed's
rows *are* a Case Type, reach for the additive variant instead:

```sh
python -m cli scaffold --case-type claims   # -> pipelines/claims/ + tests/pipelines/test_claims.py
```

It renders, from `cli/scaffold_templates/case_type/`, a case-review-flavoured
slice with this literal tree:

```
pipelines/claims/
  __init__.py
  schema.py            # NAMESPACE, NATURAL_KEY, @dataclass ClaimsRow
  pipeline.py          # source -> raw -> silver; gold left as a commented seam
  sample_data/claims.csv
tests/pipelines/
  test_claims.py
```

- **Declare the Case Type's identity contract as data** beside its row schema:
  `NAMESPACE = "claims"` and `NATURAL_KEY = ("claim_ref",)`. These explicit
  values are the inputs that mint the deterministic `case_id`; the generic
  scaffold deliberately omits them because an ordinary Feed has no Case
  identity.
- **It refines through the settled ingest spine** — source → raw (a faithful,
  accumulated copy, the system of record) → silver (schema coerced + validated,
  wiring `SchemaCoercion` + `SchemaValidator` onto the hop) — the same shape the
  generic scaffold renders, importing only
  `case_review`, `tools.*` and the public facades, never framework internals.

**It deliberately stops at silver.** How accumulated silver is reduced or
assembled into **gold** — a single-feed current reduce, a multi-feed *join*
enriching one Case Type, Detail Tables — is unique per Case Type and is an open
design decision (snapshot-vs-join, single- vs multi-feed), so the
gold step is left to you rather than baked into the template. `pipeline.py`
sketches it as a commented seam with pointers to `ingest_silver_to_gold` (the
single-feed current-gold reduce) and, for repeated sections / child rows,
`detail_ingest_silver_to_gold` + [`pipelines/demo_fan_out.py`](../pipelines/demo_fan_out.py).
Add the gold step by passing those declarations and the row schema explicitly,
so any Detail Table receives the same identity inputs and derives a matching
`case_id`:

```python
from case_review.gold import ingest_silver_to_gold

from .schema import NATURAL_KEY, NAMESPACE, ClaimsRow

gold = ingest_silver_to_gold(
    med,
    NAMESPACE,
    NATURAL_KEY,
    ClaimsRow,
)
gold.run()
```

Reach for the **generic** `scaffold <feed>` when the feed has no Case identity
(Reference Data, an outbound staging table); reach for `--case-type` when the
feed yields Cases.

## When source column names aren't identifiers (spaces, punctuation)

A schema is an ordinary dataclass, so its **field names are the column contract**
(`SchemaValidator` derives the required columns from `fields(schema)` — see
[`schema-enforcement.md`](schema-enforcement.md)). Dataclass fields must be valid
Python identifiers, so a source whose columns carry spaces (`Case Number`) or
punctuation **cannot be declared as schema fields directly**. This is not a
validation rule rejecting spaces — it's the declaration form: there is no way to
write `Case Number: str`.

(The `--from-feed-file` scaffold above handles this split for you when it sees
non-identifier headers: it gates the raw validator on a `RAW_FEED_COLUMNS`
constant of the verbatim source names, declares the canonical schema, and fills
in the `silver_builder`'s `RENAME` map so the generated feed performs the silver
step described here. The rest of this section is the manual form of what it
generates — useful when you're writing or adjusting the silver hop by hand.)

The fix is not a workaround — it's the canonicalisation that **raw → silver**
exists to do. Raw stays faithful to the source (spaced names and all, so the
landing zone is diagnosable and re-runnable); silver carries the **canonical,
identifier-named** shape the schema declares. Renaming the columns is therefore a
silver-stage reshape, in exactly the place the medallion already puts
shape-hardening (`schema-enforcement.md`). The step order is:

1. **`Rename`** the spaced/punctuated source names to the schema's canonical
   identifiers — the canonicalisation.
2. **`SchemaCoercion`** — repair the dtypes storage round-trips lose.
3. **`SchemaValidator`** (as a post-validator) — check at the silver boundary.

Add a `Rename(RENAME)` node to `silver_builder`, *before* `SchemaCoercion` and
the validator, so the renamed columns reach the schema check under their
canonical names — which is what a feed scaffolded with `--from-feed-file` from a
spaced header already renders:

```python
from framework.io import Refresh
from tools.store import StoreRegistry
from framework.run import Pipeline
from framework.transform import Rename, SchemaCoercion
from framework.core import ColumnValidator, SchemaValidator
from tools.medallion import medallion

med = medallion(StoreRegistry("/path/to/share"), "cases")
p = Pipeline("cases")
raw = p.read(med.raw.reader("cases"), name="read")
# optional: gate the *source* columns in the source's own vocabulary, so a
# missing/renamed source column fails as "missing 'Case Number'" rather than
# surfacing later as a confusing "missing 'case_number'" after the rename.
gated = p.validate(
    ColumnValidator(["Case Number", "Adviser Name"]), raw, name="source-columns"
)
renamed = p.transform(
    Rename({"Case Number": "case_number", "Adviser Name": "adviser_name"}),
    gated,
    name="rename",
)
coerced = p.transform(SchemaCoercion(CasesRow), renamed, name="coerce")
validated = p.validate(SchemaValidator(CasesRow), coerced, name="post-validate")
p.write(med.silver.writer("cases", Refresh()), validated, name="write")
p.run()
```

The leading `ColumnValidator` is **optional** and is about error legibility, not
correctness: it asserts the expected *source* columns arrived, named as the
source names them, so a feed whose upstream vocabulary you don't control fails at
the door instead of mid-rename. Skip it when the rename's failure mode is already
obvious.

The rest of this guide is the reference behind that scaffold: every Reader, and
the stubbed remote (SAS / SharePoint) seams.

## Wide feeds (hundreds of columns)

Some sources are very wide — a few hundred columns, sometimes 600+. The framework
handles these with the medallion split it already has, not a special mode: **raw
stays faithfully wide; silver carries only the columns you actually model.** Three
levers, from most to least important:

1. **Don't declare all of them.** A schema is a dataclass and `SchemaValidator`
   **ignores columns it doesn't declare** ("silver may carry more than the schema
   names" — [schema-enforcement.md](schema-enforcement.md)). So you declare the
   subset that Selection / Reporting consume — typically a few dozen — and let raw
   keep the rest faithfully. Modelling 600 fields you never read is the mistake;
   project to the ones that matter.

2. **Project the silver write.** Narrow the wide raw down to the modelled subset
   with `SelectColumns([...])` (or `DropColumns([...])`) on the raw → silver path,
   so silver is a clean, enforced, *narrow* table and the wide landing stays in
   raw for diagnosis. (`SelectColumns` / `DropColumns` are in
   [processors.md](processors.md).)

3. **Project at read for cost, not just shape.** `CsvReader(path, columns=[...])`
   and `GlobCsvReader(directory, pattern, columns=[...])` pass through to pandas
   `usecols`, so the unwanted columns are **never materialised in memory** in the
   first place. Use this when you don't even need the full width in raw — at large
   row counts, reading 30 of 600 columns is the difference that keeps the run
   inside its memory envelope. (If raw must stay a faithful full-width mirror,
   skip this and project only at step 2.)

A genuinely wide feed that's *one Case table plus repeated Detail Tables* is a
different shape again — fan it out into N single-table pipelines over the shared
raw table rather than one mega-row
([case identity and the gold grain](adr/0009-case-identity-and-gold-grain.md),
`pipelines/demo_fan_out.py`).

> **Scaffolding caps at 40 columns.** `scaffold --from-feed-file` deliberately
> stops generating fields past 40 (with a loud warning) so the starting dataclass
> stays usable — it is *not* sized for a 600-column feed. For a wide feed, scaffold
> from a header trimmed to the columns you intend to model, or scaffold bare and
> hand-declare that subset; the dropped width lives in raw regardless.

## 1. Pick a `Reader`

A `Reader` encapsulates *how one source type is read* behind a single method:

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
| `CsvReader(path)` | A CSV file (pandas, with type inference) | the file path |
| `StrictCsvReader(path)` | A CSV file that honours the RFC 4180 grammar but defeats pandas / the stdlib `csv` module (embedded delimiters, embedded newlines, doubled-quote escapes) | the file path |
| `GlobCsvReader(directory, pattern)` | Many local CSV files that together form one Feed snapshot | directory path + glob pattern |
| `ExcelReader(path, sheet=0)` | One worksheet of an `.xlsx` workbook | path + sheet **name or zero-based index** (default the first sheet) |
| `SqliteReader(db_path, table)` | One table of a SQLite layer db | db path + table name |
| `SasReader(script, copy_glob, dest)` | A SAS feed run on a remote box | script name + glob of outputs to copy back + local landing dir |
| `SharePointReader(site, list_name, auth)` | A SharePoint list, whole (a snapshot) | site URL + list name + auth config |
| `SharePointModifiedReader(site, list_name, columns, window)` | A SharePoint list, only the items changed in one `Modified` window | site URL + list name + the columns to project + the window |

`GlobCsvReader` reads every file matching `directory / pattern` in sorted
deterministic order, concatenates them behind the `Dataset` seam, and returns
one `Dataset`. Use it when a source export is split across files but should be
validated, processed, written, and failed as one logical Feed snapshot. If no
files match, it raises `FileNotFoundError` naming the directory and pattern;
`columns=[...]` projects columns with the same pandas `usecols` behavior as
`CsvReader`.

`StrictCsvReader` parses the file **character by character** through a
hand-written RFC 4180 state machine instead of delegating to pandas, so a
grammar-correct feed that pandas mis-tokenises (a quoted field carrying the
delimiter, a newline, or a doubled `""` quote) round-trips faithfully. It
accepts `CR`/`LF`/`CRLF` line endings (line breaks inside a quoted field are
kept verbatim), tolerates a BOM, defaults to RFC 4180 doubled-quote (`""`)
escaping but takes an `escapechar` (e.g. `escapechar="\\"`) for feeds that
escape an inner quote with a preceding character (`\"`), lands every value as
**text** (no type
inference — leave dtype to silver's `SchemaCoercion`), supports the same
`columns=[...]` projection, and raises a located `StrictCsvParseError` on a
ragged record or an unterminated quote. Reach for it when `CsvReader` mangles a
source that is, in fact, valid CSV.

`ExcelReader` reads `.xlsx` via pandas + **openpyxl** (a pure-Python,
cross-platform engine; in `requirements.txt`). `SqliteReader` is the read-side
dual of the Sqlite Writers — it opens through the shared `connect` factory, so
it inherits the share-tolerant settings and can read a subject's own
layer **or** another subject's read-only Reference Data medallion (joined in
Python). `SasReader` and `SharePointReader` follow the same `read()`
shape but reach a remote source whose client is **stubbed for now**;
see [Remote feeds (SAS, SharePoint)](#remote-feeds-sas-sharepoint) below.

## 2. Compose the pipeline and land it

The Reader drops into the deferred `Pipeline` builder; the subject's `Store`
mints the destination Writer for the target layer, so the builder never learns
about medallion layers or load rules:

```python
from framework.io import ExcelReader, Refresh
from tools.store import StoreRegistry
from framework.run import Pipeline
from framework.core import ColumnValidator, SchemaDriftValidator
from tools.medallion import medallion

med = medallion(StoreRegistry("/path/to/share"), "cases")
p = Pipeline("cases")
raw = p.read(ExcelReader("feed.xlsx", sheet="cases"), name="read")
gated = p.validate(ColumnValidator(["case_id"]), raw, name="columns")  # optional: gate input
# optional: warn (don't abort) when the source's columns drift from the
# prior run's landed set — catches owner-controlled schema change at the
# door. First run has no prior, so it's a clean no-op.
checked = p.validate(
    SchemaDriftValidator(med.raw.columns_of("cases")),
    gated,
    name="drift",
    severity="warn",
)
p.write(med.raw.writer("cases", Refresh()), checked, name="write")
landed = p.run()
```

Swapping the Reader is the only change needed to ingest the same feed from a
different source type — the rest of the pipeline is identical. Validators and
processors compose as explicit steps wired to their upstream node; see
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
API — sits behind a **swappable seam in `tools.integrations.remote` that is stubbed
today**. The on-prem SE auth (NTLM/Kerberos/REST — **not**
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
from tools.integrations.remote import SasReader

# Reads cases.csv already landed in /data/landing/cases (stubbed transfer).
reader = SasReader("run_cases.sas", "*.csv", "/data/landing/cases")
dataset = reader.read()
```

### `SharePointReader(site, list_name, auth)`

Configured with the SharePoint `site` URL, `list_name`, and `auth` config; on
`read()` it delegates to a `SharePointFetcher` — the download seam — handing it
the `(site, list_name, auth)` config verbatim. Two fetchers ship:

- **`StubbedSharePointFetcher`** (the default): the real on-prem SE client is
  deferred (NTLM/Kerberos/REST auth out of scope), so `read()` raises
  `NotImplementedError` rather than pretending to reach the network.
- **`LocalCsvFetcher(path)`**: an offline fetcher backed by a local CSV fixture;
  it ignores the SharePoint config and reads the file, so the read path is
  exercised with no live connection. It has the same shape a real client will
  take. (Tests that exercise **both** directions through one object use an
  in-memory fake list backend — see `tests/framework/test_sharepoint_reader.py`.)

```python
from tools.integrations.remote import SharePointReader
from tools.integrations.remote import LocalCsvFetcher  # internal seam: swappable fetcher

# Offline: reads a local fixture in place of the SharePoint list.
reader = SharePointReader(
    "https://contoso.sharepoint.com/sites/cases",
    "Advisers",
    fetcher=LocalCsvFetcher("fixtures/advisers.csv"),
)
dataset = reader.read()
```

### `SharePointModifiedReader(site, list_name, columns, window)`

The **incremental** counterpart of `SharePointReader`, in
`tools.integrations.sharepoint_rest`. Where `SharePointReader` answers "give me
the whole list", this one answers "give me the items whose `Modified` falls in
*this* window" — the shape an incremental feed needs and the one a snapshot
cannot express.

The window is the **caller's**, always: `ModifiedWindow(start, end)` is passed
in and never computed here. Where the previous window ended, how much overlap to
re-read, and where that is persisted are a
[*checkpoint's*](#sharepointcheckpointstorebase_dir--where-the-polling-got-to)
concerns; keeping them
out means the Reader has no state and one read is reproducible from its
constructor arguments alone. `start=None` is the first-load shape — every
current item strictly before `end`.

The window is **half-open** (`Modified ge start and Modified lt end`), so
consecutive windows tile without dropping or double-counting an item whose
`Modified` lands exactly on a boundary. Both bounds must be timezone-aware and
are converted to UTC **once**, so a Windows box and a macOS box send the same
predicate; a naive bound is refused rather than read as the local zone.

Fetching is somebody else's: the organisational SharePoint client (auth,
transport, and server paging) sits behind the `SharePointListClient` seam —
anything with

```python
fetch_items(list_name, expand_fields, select_fields, filters) -> DataFrame
```

— and this Reader only *configures* the query, supplying the projection
(`Id`, `Modified`, then the caller's `columns`) and the `Modified` predicates.
Nothing here builds a URL, follows a paging link, or holds a credential; the
default `StubbedSharePointListClient` raises `NotImplementedError` until a real
client is passed, and tests use a fake. Retry is **not** built in — wrap it in
`RetryingReader` so one policy covers every source (see [retry.md](retry.md)).

Every row comes back with immutable observation metadata (`METADATA_COLUMNS`)
appended, so downstream can tell "this item changed again" from "we read the
same item twice" without asking SharePoint a second time:

| Column | What it holds |
|--------|---------------|
| `source_list_name` | the list the item came from |
| `source_item_id` | the item's SharePoint `Id` |
| `source_modified_at` | its `Modified`, normalised to a UTC ISO-8601 instant |
| `source_version` | the list's own version stamp (`odata.etag`, `ETag`, `OData__UIVersionString` or `Version`, in that order of preference) when supplied, otherwise a `sha256` digest of the item's values |
| `source_observation_id` | the identity of "this item, at this version, in this list" |
| `observed_at` | when the read happened |

Both hashes are `sha256` over a canonical, key-sorted JSON rendering — never
Python's `hash()`, which is salted per process and would give the same item a
different identity on every run and on every machine. JSON rather than a
`field=value` join because a join is forgeable: a value *containing* the
separator can reproduce another item's payload exactly.

**Two properties of the version worth knowing before you build on it.**

The version is decided **per row**, not per response. One row's missing stamp
must not re-identify its neighbours — otherwise an item that did not change comes
back with a new `source_observation_id` and downstream reads it as "changed
again". For the same reason the fallback digest excludes the version columns
themselves.

Where the list supplies no stamp, the digest covers the item's **projected**
values — so **widening `columns` re-identifies every item** on the next read.
Keep the projection stable, or accept one re-observation of the whole list when
it changes.

An item missing `Id`, or carrying a `Modified` that will not parse, raises a
located `SharePointFeedError` naming the list and the row: the identity contract
is what the metadata is built from, so a breach fails rather than landing
un-addressable rows. Every flavour of null counts as missing — a nullable `Int64`
`pd.NA` and a float `NaN` are rejected, not stringified into an id that looks
present.

An empty window is **not** an error: it returns a zero-row `Dataset` carrying the
declared projection plus the metadata columns, so a schema check over **those**
does not depend on volume. The limit is worth knowing — a column the *client*
adds that was never projected (an expanded lookup such as `Owner/Title`) cannot
be invented for an empty window, so hold a downstream check to the declared
columns rather than to whatever a populated read happened to carry.

```python
import datetime as dt

from tools.integrations.sharepoint_rest import ModifiedWindow, SharePointModifiedReader

reader = SharePointModifiedReader(
    "https://sharepoint/sites/case-review",
    "Cases",
    ("CaseRef", "Status", "Owner"),
    ModifiedWindow(
        start=dt.datetime(2026, 8, 5, 8, tzinfo=dt.timezone.utc),
        end=dt.datetime(2026, 8, 5, 9, tzinfo=dt.timezone.utc),
    ),
    client=sharepoint_client,
)
dataset = reader.read()
```

**The hard-delete limitation.** A `Modified` window can only see items that
still exist: an item *deleted* from the list has no `Modified` to fall inside
any window, so no sequence of window reads will ever report it. An incremental
feed built on this Reader therefore accumulates rows that may no longer be in
SharePoint. Detecting deletions needs a different mechanism — a periodic
snapshot (`SharePointReader`) reconciled against what has been landed, or a
change-API feed — and is deliberately **not** this Reader's job.

### `SharePointCheckpointStore(base_dir)` — where the polling got to

The other half of the split above, in `tools.integrations.sharepoint_checkpoint`.
The Reader is handed a window; this is what computes the next one and remembers
where the last one ended.

**"Checkpoint" here is not the pipeline sense.** A `Pipeline` checkpoint is a
mid-graph `.write()` node landing an intermediate dataset for lineage. This one
is **source control state**: how far a source has been polled.

The window rule, in three lines:

```text
end   = server_now - safety_lag
start = committed_watermark - overlap   # None when nothing is committed yet
window = ModifiedWindow(start, end)     # None when end <= committed_watermark
```

`start=None` is the **first load**: no watermark has been committed, so the run
fetches the full current list up to `end`.

The **overlap** re-reads a little of what the previous window already covered,
and that is safe because the observation metadata is immutable: the same item at
the same version yields the same `source_observation_id`
([the metadata table above](#sharepointmodifiedreadersite-list_name-columns-window)),
so a re-read is recognised as the same observation rather than as a change. The
**safety lag** holds `end` behind SharePoint's own clock, because an item written
*while* a window is being read can be stamped inside that window and still be
invisible to the read — without the lag those items are lost for good. Both are
the caller's numbers; `server_now` is **SharePoint's** clock, not the box's, since
the bounds are a predicate the list evaluates.

An **empty window is routine**: when `server_now - safety_lag` has not yet passed
the committed `watermark`, `window(...)` returns `None`. That is a run repeated too
soon after the last commit — ordinary operation, so it is not an error and there
is simply nothing to poll.

**The commit is the last act of a successful run**, and nothing else advances the
watermark: `commit(source, window_end=…, ingestion_batch_id=…, pipeline_run_id=…)`
is called once the run's writes have landed. A run that fails part-way therefore
re-polls the same window next time. An *equal* `window_end` is accepted (not
advancing is not going backwards) and refreshes the provenance columns, so
repeating an identical commit is a no-op in effect; an *earlier* one raises,
because a watermark that moved backwards would quietly re-poll covered ground and
hide that a run had lost its place. The `ingestion_batch_id` is opaque provenance
handed in by the caller, not derived here.

The state lives at **`<base>/_checkpoints/sharepoint.db`** — beside `_runs/`,
not inside it. A base directory now holds four kinds of thing: the medallion
**rows** (`tools.store`), the **run metadata** (`tools.observability.run_store`),
the **deliverable outbox** (`tools.deliverables` at
`<base_dir>/deliverables/<destination>/…`), and this **source control state**.
They are separate because their lifecycles
are: pruning run logs must not lose a feed's place, and re-landing silver must
not either.

A source is identified by the list's **GUID**, not its title — even though the
Reader addresses lists by name. A title is a mutable display name, and keying a
watermark on it would fork the checkpoint the moment somebody renames the list,
with the new key looking like a first load of the whole list. The site part of
the key has any embedded credentials removed (persisted control state is never
where a credential survives) and a trailing `/` stripped, so `.../sites/X` and
`.../sites/X/` are one source. The host folds to lower case, since DNS does not
distinguish them; the path does not, because a site path's case is the tenant's
business and two spellings may be two addresses.

#### Finding a list's GUID

A one-off lookup, done once when the feed is written. Either:

- **From the browser.** Open the list, then the gear menu → **List settings**.
  The address ends `...&List=%7B1B6F2A3C-0000-4A1F-9C7E-5F2D8A4B1E01%7D`;
  `%7B` and `%7D` are the encoded braces, so the GUID is what sits between them.
- **From the REST API**, if the organisational client is already to hand:
  `GET <site>/_api/web/lists/getbytitle('Cases')/id`. Send
  `Accept: application/json;odata=nometadata` and the GUID is the `value`;
  without it the response is XML and the GUID is the `<d:Id>` element. A title
  containing an apostrophe needs it doubled (`getbytitle('O''Brien')`).

Record it as a constant beside the list title in the feed's module. The pair
is the point: the title is what the Reader asks for and may change, the GUID is
what the checkpoint is keyed on and does not.

```python
import datetime as dt
from uuid import UUID

from tools.integrations.sharepoint_checkpoint import (
    SharePointCheckpointStore,
    SharePointSource,
)
from tools.integrations.sharepoint_rest import SharePointModifiedReader

checkpoints = SharePointCheckpointStore(base_dir)
source = SharePointSource(
    "https://sharepoint/sites/case-review",
    UUID("1b6f2a3c-0000-4a1f-9c7e-5f2d8a4b1e01"),
)

window = checkpoints.window(
    source,
    server_now=sharepoint_client.server_time(),
    overlap=dt.timedelta(minutes=5),
    safety_lag=dt.timedelta(minutes=2),
)
if window is not None:  # None: nothing new is safe to poll
    reader = SharePointModifiedReader(source.site, "Cases", COLUMNS, window)
    ...  # land the rows, then — and only then:
    checkpoints.commit(
        source,
        window_end=window.end,
        ingestion_batch_id=batch_id,
        pipeline_run_id=context.pipeline_run_id,
    )
```

Committing is not automatic: no Reader, node, or runner advances the watermark
for you. Deliberately — the store cannot know whether the rows it would be
vouching for actually landed.

#### A worked incremental feed — `pipelines/sharepoint_cases/`

The two halves above wired into a real feed: **every** Case list declared in
`CASE_LISTS`, each polled by its own `Modified` window into the same append-only
raw and silver tables, then reduced to gold once and checkpointed per list. It
follows the ordinary scaffold shape — a `*_builder` per hop, driven by
`run(context)` — and the first two hops are deliberately thin. Landing the list's rows as immutable
versions is one job and interpreting them is another: raw and silver do no
derivation and no parsing, and everything that reads meaning into a Case happens
in the third hop (`gold.py`, thirteen tables refreshed whole on every poll — see the
[data dictionary](data-dictionary-sharepoint-cases.md)).

**0. One declaration says what is polled.** `schema.py` holds a frozen
`CaseList` (Case Type slug, list name, site, list GUID) and the `CASE_LISTS`
tuple of them. All Case Types share one SharePoint list template, so every list
gets identical processing and onboarding one is a new entry with its own GUID.
`run(context, *, client=None, case_lists=CASE_LISTS)` loops over them, doing
source → raw → silver per list, publishes gold once over the accumulated
history of all of them, and only then commits each list's watermark. It returns
one `ListPoll` per list polled — a list polled again inside the safety lag is
skipped, not failed.

**1. The read is narrowed to what raw stores.** `storable_observation` is a
named transform in the raw hop that projects the response onto the source
columns plus the stamped metadata. `Modified` and `odata.etag` are dropped — `source_modified_at` and
`source_version` say the same thing in the vocabulary every hop below reads — and
so is `observed_at`, for the reason in point 4. Note the split it has to make: an
**empty** window comes back as the declared projection only, and this list is read
with `$select=*`, so almost every column is there because the client expanded the
star and none of them can be present when there are no rows. An empty frame is
therefore reindexed onto the target columns (and cast to object — `reindex` types
a column it had to invent as float), while a populated one is selected strictly
and any missing column is named in a `SharePointFeedError`. This transform is
the feed's only column gate: the raw hop wires no `ColumnValidator`, because a
presence check downstream of a projection that already guarantees the columns
could never fire.

The same transform **flattens the expanded people**. SharePoint answers an
expanded lookup as a nested object on the property —
`{"AssignedReviewer": {"Name": …}}` — and a role nobody holds as a plain `null`
there, not an object of null members. The slash form the read asks with
(`AssignedReviewer/Name`) is OData `$select` syntax for *which sub-field to bring
back*; it says nothing about the response's shape. A tabular carrier has nowhere
to put a nested cell, so the feed undoes the nesting itself rather than obliging
every client to do it — the client's contract stays "return the items as
SharePoint returned them", which is the only contract a client author could
satisfy without reading this feed's source. A person value that is neither an
object nor null fails with a `SharePointFeedError` naming the list, item and
column, and so does an object carrying no `Name`: these columns hold only people
here, an expanded person carries a claims login, so a `Name`-less object was
never expanded and reading it as an empty role would hide a broken read. A
missing `Title` is *not* an error — only the Responsible Party's display name is
selected at all, and a directory display name is optional even then.

**2. A quiet window runs the same hops as a busy one**, and the feed no longer
pays for it below raw. A zero-row batch has no value to breach a declared type,
so [the silver gate checks presence
only](schema-enforcement.md#a-zero-row-frame-satisfies-any-declared-schema), and
`SchemaCoercion` types every declared column on the way past — which matters
because a quiet *first* poll is what creates the silver table, and a column
landed as `object` would take `TEXT` affinity for the life of the feed. The feed
once cast its integer column itself where it narrows the batch for silver; that
workaround came out when both halves of the rule moved into the framework
(#394), which is where they belong — the next quiet source would have
rediscovered the same failure. What stays feed-side is the *raw* reindex in point
1: raw stores what the list returned, so declaring an empty window's columns
there is the feed's shape decision, not the schema's. Skipping the hop on an
empty batch would have been the smaller change and the wrong one — a quiet poll
is not a different pipeline, and an operator reading the run log should see the
same steps against the same tables, with zero rows.

**3. Silver is the rename, the Case Type, and the type contract.** One
exception to "silver derives nothing": a `case-type` node stamps the polled
list's *declared* Case Type over the list's own `CaseType` cell. Raw keeps that
cell as the list holds it, but the cell is nullable and editable by hand in the
SharePoint web UI, and gold keys a Case on it — `DeriveKey` refuses a null
natural-key value, so one blank cell would abort gold for every list. After
silver, `case_type` is always the Case Type of the list the row came from.

The rename
is one mechanical rule rather than a curated map: split each source name on word
boundaries and on `/`, lower-snake-case it (`DueDate` → `due_date`,
`ResponsibleParty/Title` → `responsible_party_title`). Forty hand-written pairs
would be forty chances to drift from the list. The rules are equally thin —
provenance non-null, the item id non-null, and `Status` in the four values the
review application actually persists. Columns whose constraints live in that
application get typed and nothing more: a rule the feed cannot justify is one
that will eventually reject good data.

**4. No "when we saw it" column.** `AppendOnly` compares every non-key column of
a re-presented row, so a per-read timestamp would make each overlapping re-read
of an unchanged item look like a changed row. The same reasoning excludes the
ingestion batch id and the pipeline run id. When we saw it lives in the run log
and in the returned `ingestion_batch_id` instead.

**5. Every watermark is committed last, after gold.** Advancing one vouches for
its window having been *published*, not merely fetched — so the commits are the
final statement of `run`, in one block below every list's hops and every gold
table. That is why they are not committed per list after its silver hop.

Each list has its own watermark, keyed on `(site, list_id)`, so a newly onboarded
list does a first load while the others resume. Where a partial failure lands:

| Failure point | Committed |
|---|---|
| A list's raw or silver hop | The lists before it are in raw/silver (append-only, committed per hop). **No gold, no watermark advanced.** The next run re-polls every list from unchanged watermarks, `AppendOnly` no-ops the re-reads, and gold rebuilds whole. |
| A gold table | Earlier gold tables stay refreshed. No watermark advanced — same convergence. |
| Inside the commit loop | The lists before it advanced; the rest simply re-poll a wider window next time. Gold was already published from the whole history. |

`run` returns a `ListPoll` per list, each carrying that list, its window, its
batch id and its row counts.

Under a dry run nothing is committed, and the two halves of that come from
different places. Every hop — raw, silver, and each gold table — is a bare
`p.run()`, so it inherits the **ambient** run context the runner makes active
and previews its writes; nothing in the feed's own code decides that. The
checkpoint is not a pipeline step, so it has no ambient skip to inherit and is
guarded explicitly by `if not context.dry_run`. That is the one in-code skip in
the feed.

It is deliberately *not* wired as a `p.action(...)` node on the last gold
pipeline, which would inherit the dry-run skip for free: the checkpoint is
source-control state rather than a data step, and burying it inside a pipeline
named for an aggregate would make "visibly last" less true than the plain `if`
does.

Two smaller notes. The batch id is
`f"{list_id}:{watermark.isoformat() if watermark else 'first-load'}"` —
it identifies the *source window resumed from*, not the run, so a re-drive of a
failed window mints the same id. And `server_now` comes from the client's own
clock (`client.server_time()`), read **once per run** and shared by every list's
window, never a local `utcnow`: the window bounds a predicate the list
evaluates, so a skewed local clock silently widens or narrows it. Because
`window()` derives its end as `server_now - safety_lag` independently of the
source, every list's window ends at the same instant — which is the instant gold
is published as of. The
feed states that requirement as a local `CaseListClient` Protocol extending
`SharePointListClient`, because the upstream seam declares the fetch alone.

**Two provisioning prerequisites**, both recorded rather than solved:

- **`Modified` must be indexed on the list, while it is still small.** It is not
  one of the 14 columns the Case Review Platform indexes at creation, and
  SharePoint cannot add an index to a list already past the 5,000-row List View
  Threshold. A `Modified`-windowed poll works on a small list and starts failing
  as it grows.
- **The site URL and every list GUID are placeholders in the code.** The review
  application derives its site from page context and addresses lists by title, so
  no GUID exists anywhere to copy. The watermark is keyed on the GUID, and a
  wrong one silently forks the feed's place rather than failing — and two
  `CaseList` entries sharing a GUID would share one watermark.

Run the bundled fixture pages offline — the feed's `LocalJsonListClient` is
opt-in via `--sample`, because a production run that forgot its client must
refuse rather than quietly ingest five fake Cases:

```sh
python -m pipelines.sharepoint_cases.pipeline --base-dir /tmp/demo --sample
```

**Needing a client does not cost the feed its ordinary addressing.** `run` takes
one so a test can pass a fake and `--sample` can pass the fixture replayer, and
an unattended run — the operator CLI, the orchestrator, both of which reach a
feed by calling `run(context)` — asks `_resolve_client` for the organisation's:

```sh
python -m cli run pipelines/sharepoint_cases --base-dir /tmp/demo
```

There is no organisational client to hand back yet, so that form refuses today
with a `NoClientError`, categorised `CONFIG` because the fix is in the wiring.
Both entry points therefore fail the same way, as a caught, categorised failure
rather than a stack trace. Wiring a real client is a change in one function; it
is what scheduling this feed waits on, not anything in the dataflow.

The two tables it lands, field by field, are documented in
[`data-dictionary-sharepoint-cases.md`](data-dictionary-sharepoint-cases.md).

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
`SharePointWriter`) — consistent with single-Writer pipelines over a
shared source, not a mid-run checkpoint (CONTEXT.md):

```python
from framework.io import Refresh, SqliteReader
from framework.run import Pipeline
from tools.integrations.remote import SharePointWriter

p = Pipeline("selection-deliverable")
r = p.read(SqliteReader(gold_db, "selection_pool"), name="read")
p.write(
    SharePointWriter(site, f"Selection - {case_type}", strategy=Refresh(), pusher=client),
    r,
    name="write",
)
p.run()
```

```python
from framework.io import Refresh
from tools.integrations.remote import SharePointWriter

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
