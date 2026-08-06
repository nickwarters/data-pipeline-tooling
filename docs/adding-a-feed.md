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
```

`pipeline.py` follows the framework's canonical pipeline contract: it exposes a
`run(context: RunContext, *, describe: bool = False) -> Dataset` callable (and an
`UPSTREAMS` tuple of freshness requirements — empty for a source feed). The
framework addresses the pipeline by its path — `python -m cli run
pipelines/orders` imports `pipelines.orders.pipeline` and executes
`run(context)`. Each medallion hop is factored into its own
`*_builder(reader, writer, run_log=None) -> Pipeline` returning the composed
(not-yet-run) pipeline — the *one* definition of what that hop does:

- **`raw_builder`** gates the source with a `ColumnValidator` and lands a
  faithful copy. It composes the shared `tools.recipes.source_to_raw` recipe.
- **`silver_builder`** renames source columns to the schema's vocabulary
  (`RENAME`), coerces the dtypes storage loses (`SchemaCoercion`), partitions
  bad rows into a quarantine dataset (`SchemaValueRulePartitioner`), and validates
  the declared schema (`SchemaValidator`). It composes the shared
  `tools.recipes.raw_to_silver` recipe.
- **`gold_builder`** is a passthrough to start — reads silver, writes gold — with
  a `TODO` to build the assembly (it's per-feed and an open decision).

### Recipe-first authoring, and how to diverge

The first two hops are the same in every feed, so they have **one definition**:
the hop recipes in [`tools/recipes.py`](../tools/recipes.py). A generated
`raw_builder` is a call, not a copy:

```python
from tools.recipes import raw_to_silver, source_to_raw

def raw_builder(reader, writer, run_log=None):
    return source_to_raw(
        reader,
        writer,
        expected_columns=[f.name for f in fields(OrdersRow)],
        name=f"{FEED_NAME}:raw",
        run_log=run_log,
    )
```

A recipe is **composition, not inheritance**. It returns a plain, not-yet-run
`Pipeline` that your builder owns and can go on wiring; there is no framework
hook calling back into your feed and nothing to subclass. That keeps the whole
point of scaffolding — a generated feed you can edit freely — while giving the
standard hop somewhere to evolve: adding a step to the standard raw hop is a
one-line change in `source_to_raw`, and every feed composed from it inherits the
change without a `grep` for the feeds you'd otherwise have to hand-edit.

**To diverge, inline the recipe's body into your builder and edit it.** The
recipes are short and deliberately readable for exactly this: copy the six or so
lines of `raw_to_silver` into `silver_builder`, add your step, and the feed stops
tracking the standard (which is the honest outcome — it isn't the standard hop
any more). Reach for that when the hop genuinely differs; take the recipe's
options (`expected_columns`, `rename`, `reject_writer`) when it doesn't.

The recipes take the hop's **ports** — a `Reader` and a `Writer` — rather than a
medallion profile, for two reasons: the *source* end of a raw hop isn't a
medallion layer at all, and injecting the ports is what lets the generated test
drive the real hop in memory against a `RecordingWriter`. `run()` wires the real
medallion layer Writers. They live in `tools.recipes` rather than the framework
because raw and silver are application vocabulary — the framework is kept
domain-free ([keep the framework domain-free](adr/0013-keep-the-framework-domain-free.md))
and the medallion moved out of it.

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
from `tools.environments`, defaulting to `dev` → `./data`.

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
slice that does two things the generic scaffold won't:

```
pipelines/claims/
  __init__.py
  schema.py            # @dataclass ClaimsRow — the column/dtype contract
  case_type.py         # CASE_TYPE = CaseType(schema, natural_key) — the identity contract
  pipeline.py          # source -> raw -> silver; gold left as a commented seam
  sample_data/claims.csv
tests/pipelines/
  test_claims.py
```

- **It declares the Case Type's identity contract** in `case_type.py`: a
  `CaseType` bundling the `schema` with its `natural_key`, from which the derived
  `namespace` and deterministic `case_id` come for free. This is the
  part that's tedious to hand-assemble, and the generic scaffold deliberately
  omits it.
- **It refines through the settled ingest spine** — source → raw (a faithful,
  accumulated copy, the system of record) → silver (schema coerced + validated,
  composing `SchemaCoercion` + `SchemaValidator` onto the hop) — through the same
  `tools.recipes` hop recipes the generic scaffold uses, importing only
  `case_review`, `tools.*` and the public facades, never framework internals.

**It deliberately stops at silver.** How accumulated silver is reduced or
assembled into **gold** — a single-feed current reduce, a multi-feed *join*
enriching one Case Type, Detail Tables — is unique per Case Type and is an open
design decision (snapshot-vs-join, single- vs multi-feed), so the
gold step is left to you rather than baked into the template. `pipeline.py`
sketches it as a commented seam with pointers to `ingest_silver_to_gold` (the
single-feed current-gold reduce) and, for repeated sections / child rows,
`detail_ingest_silver_to_gold` + [`pipelines/demo_fan_out.py`](../pipelines/demo_fan_out.py).
Add the gold step reading the **same** `CASE_TYPE` so any Detail Table's
`case_id` derives consistently.

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

The standard raw → silver recipe already takes this as its `rename` option —
`raw_to_silver(reader, writer, schema=CasesRow, rename={"Case Number":
"case_number"})` inserts the step in exactly this position. The hop is ordinary
composition underneath, so the manual form below is what that option expands to,
and what you'd write if the hop diverges further: a spaced feed adds a `Rename`
*before* `SchemaCoercion` and the validator, so the renamed columns reach the
schema check under their canonical names:

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
not inside it. A base directory now holds three kinds of thing: the medallion
**rows** (`tools.store`), the **run metadata** (`tools.observability.run_store`),
and this **source control state**. They are separate because their lifecycles
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
