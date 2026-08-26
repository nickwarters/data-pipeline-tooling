---
status: accepted
---

# Graduated schema enforcement: raw light, silver & gold validated

A Case Type's **schema** is a declared statement of its expected columns, types,
and field-level content rules — a dataclass whose annotations *are* the contract
(dataclass → Pydantic later is a seam). Enforcement is **graduated** by
layer:

- **Raw — schema-light.** Land what the (snapshot) source gives. Raw carries two
  column checks with opposite severities: a **hard presence check**
  (`ColumnValidator`, error) that the named columns downstream depends on are
  present, and a **soft drift check** (`SchemaDriftValidator`, warn) that diffs
  the incoming column set against the prior run's landed columns and surfaces
  added/dropped columns without stopping the run.
- **Silver & gold — validated.** A fail-fast `SchemaValidator`, derived from the
  Case Type's annotations, checks columns and dtypes before downstream logic
  touches the data.

The schema is a **validation contract first**; materializing typed objects
(`Iterator[CaseA]`) is an opt-in convenience, not required by declaring it.

## The content contract — value rules and row checks

Beyond columns and dtypes, a schema declares two axes of content rule, both
feeding the same two consumers (abort, collected into one `SchemaValidator`
message; or quarantine, as a `failed_rule` reason):

- A **value rule** is *vertical* — one column across many rows (format/`Pattern`,
  `Length`, `Range`, membership/`OneOf`, `Unique`, `NonNull`/`Nullable`) —
  declared on the field via `Annotated`.
- A **row check** is *horizontal* — one row across many fields, validating the
  relationship *between* fields (`opened <= closed`). A plain function over a row
  returning a breach phrase or `None`, paired with the **footprint** of columns it
  spans (so a column already failing its dtype check suppresses the check rather
  than crashing it); declared via the `@row_checks(...)` class decorator. A row
  check runs over **every** row including nulls — presence may be the very thing
  it tests — so the author handles nulls explicitly.

## Why

Without a declared schema, expectations scatter as "assume field X exists, do Y,"
producing two bad failure modes: instant errors by luck of access order, and
(worse) silent propagation that explodes mid-processing far from the cause. A
declared schema validated at the boundary collapses the scattered checks into one
statement and moves failure to a **predictable place with a precise message**
(which column/type/rule), before processing runs on bad data.

**Why drift warns and a breach aborts.** Raw must stay a faithful mirror of an
owner-controlled source (a SharePoint list, a SAS export); turning every
column add/drop into an abort would make raw refuse to land faithful data. Drift
is a *change* signal caught at the door, one layer before it would otherwise
surface as a silver **Schema Breach** far from its cause — so it warns. The hard
*contract* lives at silver/gold, where a missing column or wrong dtype is a
fail-fast abort. Drift is names-only and run-over-run, so a persistent drift
warns once, not every run.

## Consequences

- Each Case Type declares its silver/gold shape once; `SchemaValidator` is derived
  from it, and that dataclass → validator adapter is the dataclass → Pydantic seam.
- A schema breach aborts the run atomically with a located
  error — no silent wrong output. Raw remains a faithful mirror of the snapshot;
  shape hardening is silver's job.
- **The schema/value validators are engine-confined.** Structural validators
  (`ColumnValidator` / `RowCountValidator`) read only the engine-agnostic shape
  (`columns` / `len`). A schema check inspects dtypes, and value rules need the
  engine's vectorised operations over actual values, so `SchemaValidator` reaches
  the backing frame via `to_pandas()` exactly like a Reader/Writer/transform does
  — keeping `Dataset`'s public surface tiny. The Python-type ↔
  pandas-dtype mapping lives in one place so the rest of the system names only
  Python types, and an unmappable declared type fails where the validator is
  built, not mid-run.
- **Coercion is a separate, earlier step.** Types that do not survive a SQLite
  round-trip (dates, booleans) need a `SchemaCoercion` transform ahead of the
  silver validator; it slots in as a node before the validator without reshaping
  it.
- A truncated source export — every row valid, yet thousands missing — is invisible
  per-row; the `VolumeAnomalyValidator` catches it run-over-run by comparing a
  run's row count against a baseline derived from the feed's recent run history.

## Amendment (2026-08-18): coercion covers every declared type

The decision above is unchanged: enforcement is graduated, silver is the schema
boundary, and coercion is a separate, earlier step. What widens is **which types
that step repairs**.

- **Coercion is no longer limited to what a SQLite round-trip loses.** The
  original scope — `date` / `datetime` / `bool`, on the reasoning that
  `str` / `int` / `float` survive storage unchanged — held only while storage was
  the only thing between a source and the validator. It is not: a CSV read is
  bare type inference, so a digits-only reference arrives as `int64` and a number
  arrives as text, and nothing before the validator could repair either.
  `SchemaCoercion` now casts each declared column whose dtype the validator would
  not already accept — no more, since what it leaves alone is what validation
  accepts: an `object` column satisfies `str` whatever it holds, so the `str` arm
  does not see it. `int` lands as nullable `Int64`, for the same reason
  `bool` lands as `"boolean"`: a gap cannot be held otherwise.
- **The no-op rule is the validator's own dtype check**, asked directly. What
  coercion leaves alone is by construction what validation accepts, so the two
  halves of the adapter cannot drift.
- **Nullability stays the validator's question.** A gap is the absence of a
  value, never a bad one: it is excluded from every offender report and left to
  `NonNull()`. On the numeric and boolean paths a blank or whitespace-only cell
  counts as a gap too — it is how a CSV spells "nothing here" — but never on the
  `str` path, where the empty string is a value.
- **The zero-row special case is gone.** The frame-is-empty branch existed to fix
  a created table's column affinity, and with every declared type now having a
  real cast the empty case stops being special: the ordinary paths run over no
  rows and land the same dtypes. That the affinity is preserved is a free
  consequence rather than a load-bearing constraint —
  [ADR-0025](0025-sql-migrations-own-the-physical-table-shape.md) moved ownership
  of a table's physical shape to the numbered SQL, which demoted the affinity job
  this branch was written for.

**The cost to be aware of.** The coerce step sits *above* quarantine
([ADR-0007](0007-row-level-quarantine.md)): rules route rows aside, and rules run
in the validator, after the cast. So declaring `int` or `float` makes a single
unparseable value fatal to the whole run rather than a diverted row. That is the
right default where the type is load-bearing; a feed that would rather divert the
row declares `str` and gates the column with a value rule.

## Amendment (2026-08-19): the readers stop inferring

The previous amendment widened coercion because "a CSV read is bare type
inference, so a digits-only reference arrives as `int64`". That premise is now
removed at its source: the pandas-backed CSV readers (`CsvReader`,
`GlobCsvReader`) pass `dtype=str`, landing **every column as
text**. `keep_default_na` / `na_values` stay at their defaults, so a blank field
is still a gap rather than the empty string — nullability remains `NonNull()`'s
question.

Inference was a guess made over the first rows of one file, and it was lossy in
ways coercion could not undo afterwards: by the time `SchemaCoercion` saw a
reference read as `int64`, its leading zeros were already gone. It was also
unstable — inferred per file when globbing, so two parts of one logical
snapshot could disagree about a column's dtype. (This amendment originally cited
`ChunkedCsvReader`'s per-chunk inference as the other half of the argument;
that reader was removed by
[ADR-0028](0028-a-source-too-big-for-memory-is-narrowed-at-the-source.md).
The `GlobCsvReader` half stands, and with it the decision.)

- **The coercion widening above stands, unchanged.** Coercion is now the *only*
  place a CSV column's type is decided rather than the second place; and storage
  still loses dates and booleans, and `SqliteReader` / `ExcelReader` still hand
  back inferred types. What the `str` arm mostly does on a CSV feed now is
  nothing, because the column already carries text — which is the point.
- **A reference wider than `int64` declared `int` now aborts** with a located
  `CoercionError` where it previously passed as an inferred `uint64`. The coercer
  is deliberately not widened to accept it: a 20-digit reference declared as a
  whole number is a mis-declaration, and `str` — which now preserves it exactly —
  is the right declaration.
- **`StrictCsvReader` keeps its reason to exist.** It is the RFC 4180 grammar,
  not the text landing, and one behaviour still differs: an empty field is the
  empty string there, a gap here.

The declared types a table *stores* are left exactly as they were. A raw column
declared `INTEGER` still applies SQLite's affinity on write, so `00123` reaches
raw as text and is stored as `123`; what a feed declares is the feed author's
call, and `scaffold` seeds a starting point they edit. The reader no longer
decides it for them, which is the whole change.
