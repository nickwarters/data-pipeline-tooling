# Schema enforcement & what "silver" means

This documents the `Schema` + `SchemaValidator` adapter and the
`SchemaCoercion` processor that repairs raw's round-trip-lossy types ahead of the
validator, plus how they compose onto a `Pipeline` to enforce the schema at
the silver boundary. For the *why*, see
[graduated schema enforcement](adr/0006-graduated-schema-enforcement.md); for the
surrounding primitives, [core-primitives.md](core-primitives.md).

## The three layers, and where the schema bites

Enforcement is **graduated** across the medallion:

| Layer | Shape discipline |
|-------|------------------|
| **raw** | **Schema-light.** A faithful mirror of the source snapshot as landed — booleans still as `TRUE`/`FALSE` text, dates still unparsed, warts and all. At most a loud column-presence check so a wholesale source change fails immediately. |
| **silver** | **Validated — the schema boundary.** A Case Type's declared columns + dtypes are enforced here, as a post-validator, before the data lands. This is where "is this data valid and processable?" gets its authoritative answer. |
| **gold** | **Validated on the same footing as silver** — by composing the same `SchemaValidator` as a post-validator onto the gold-building pipeline (see below). |

**Why silver, not raw?** Raw must stay faithful to the source so the landing
zone is diagnosable and re-runnable; hardening the shape is a silver-stage
responsibility. Enforcing at silver catches problems exactly one layer before
Selection, while leaving raw a true mirror. Cheap *structural* checks (column
presence, row count) can still run as **pre**-validators when raw is read — the
difference is just which checks run where.

## `Schema` — a Case Type dataclass

A schema is an ordinary dataclass; its annotations *are* the contract — the
single source of truth for the Case Type's columns and types:

```python
from dataclasses import dataclass
from datetime import date

@dataclass
class CaseA:
    case_ref: str
    opened: date
    active: bool
```

No base class, no registration. Declaring the schema does **not** force you to
materialise typed objects — it is a *validation contract first*; typed objects
(`Iterator[CaseA]`) are an opt-in convenience for later.

Because the **field names are the column contract**, they must be valid Python
identifiers — a source whose columns carry spaces or punctuation (`Case Number`)
can't be declared directly. That's a `Rename` to the canonical names on the way
to silver, not a schema limitation; see
[adding-a-feed.md](adding-a-feed.md#when-source-column-names-arent-identifiers-spaces-punctuation).

## `SchemaValidator` — the dataclass→validator adapter

`SchemaValidator(CaseA)` derives column + dtype expectations from the dataclass
and checks a `Dataset` against them. It is a `Validator`
(`validate(dataset) -> None`, raising `ValidationError`), so it attaches to the
builder like any other — but it is **engine-confined** (see below).

What it checks:

- **Columns present** — every declared field must be a column. Columns the
  schema does not declare are ignored, so silver may carry more than the schema
  names.
- **Dtypes match** — each present column's dtype must match the declared Python
  type. The supported mapping:

  | Declared Python type | Accepted pandas dtype |
  |----------------------|-----------------------|
  | `str`                | object / string       |
  | `int`                | integer               |
  | `float`              | float                 |
  | `bool`               | bool / boolean        |
  | `date` / `datetime`  | datetime64            |

### A zero-row frame satisfies any declared schema

A dtype — like a null check, like a value rule — is a claim about *values*, and
a column with no rows has none. Nothing types an empty column either: a quiet
source's window arrives `object`-typed, and a column `DataFrame.reindex` had to
invent arrives `float64`. So on an **empty frame the validator checks column
presence only** — the declared shape is real even when the rows are not. The
value-level gates still *run* (a rule is called with the empty series, as a rule
author should expect); they simply have nothing to match.

This is why an incremental poll's steady state (an empty window) and an empty
chunk in a `.read_chunks` stream run the same hops as a busy one, with no
per-feed casting to get them past the gate.

**The coercer has the other half of the rule.** A dtype the validator waves
through still reaches storage, and an empty write is what *creates* a SQLite
table — a column landed as `object` takes `TEXT` affinity for the life of the
feed, so a feed whose first poll is quiet would store every later integer id as
text. So on an empty frame `SchemaCoercion` types **every** declared column,
including the round-trip-safe `str` / `int` / `float` it leaves alone when there
are rows. The target dtypes are chosen for the affinity they create — `object` →
`TEXT`, `int64` → `INTEGER`, `float64` → `REAL` — since fixing the created
table's column types is the whole point. A declared type the coercer cannot map
is left alone: an unsupported type is a schema configuration error, and
`SchemaValidator` reports it at build time naming the field. The gate stands
down and the shape is still declared.

Every breach is collected and reported **at once** in one located message
naming the column and the expected-vs-actual type, then raised:

```
CaseA schema: missing column 'case_ref'; column 'opened' expected date but found object
```

Two guard rails:

- A declared type the adapter cannot map (e.g. `list`) is a **configuration
  error**, raised when the validator is *built* — not a cryptic failure mid-run.
- The framework uses `from __future__ import annotations`, so a field's `.type`
  is a *string*; the adapter resolves it through the schema's module with
  `typing.get_type_hints`.

### Why engine-confined

The structural validators (`ColumnValidator`, `RowCountValidator`) read only the
dataset's engine-agnostic shape (`columns` / `len`) and never name pandas. A
schema check inspects column **dtypes**, and the value-level rules it will grow
into (format/pattern, length, uniqueness, encoding) need the engine's vectorised
operations over actual values. Re-exposing all of that engine-agnostically would
re-implement a dataframe API on the `Dataset` seam. So `SchemaValidator`
reaches the backing frame via `to_pandas()` exactly as a Reader/Writer/processor
does — keeping `Dataset`'s public surface tiny and the pandas-dtype mapping in
one place (`framework._internal.schema`).

## `SchemaCoercion` — repairing what storage loses

A `SchemaValidator` can only *assert* the dtype it is handed, and raw hands it
the dtypes a SQLite round-trip leaves behind: a `date` lands as text, a `bool`
as `1`/`0` or `TRUE`/`FALSE`. Without a repair step those columns would fail the
validator even when the underlying values are perfectly valid. `SchemaCoercion`
is that repair step — the **write-side companion** of `SchemaValidator`, derived
from the *same* dataclass:

```python
from framework.transform import SchemaCoercion

coerced = SchemaCoercion(CaseA)(dataset)   # returns a transformed dataset
```

It is a callable transform (`(dataset) -> Dataset`) and, like the validator,
**engine-confined** — a cast needs the engine's vectorised operations, so it
reaches the frame via `to_pandas()`/`from_pandas()`. It casts **only
the round-trip-lossy declared types**:

| Declared type | Coerced from | Coerced to |
|---------------|--------------|------------|
| `date` / `datetime` | text (`"2026-01-01"`) | datetime64 |
| `bool` | `TRUE`/`FALSE`, `Y`/`N`, `YES`/`NO` text, or `1`/`0` (incl. the `1.0`/`0.0` a nulled numeric column comes back as) | pandas `"boolean"` |
| `str` / `int` / `float` | **only when the frame has no rows** (see above) | `object` / `int64` / `float64` |

Boolean encodings are compared **case-folded and whitespace-stripped**, so
`true`, `True` and `TRUE ` all map.

A `bool` lands as pandas' **nullable `"boolean"`** dtype, not numpy `bool`. The
reason is that numpy `bool` has no null, so a gap would have to be invented as
`False`. **Nullability is enforced by the declared value rules, not the
coercer**: a null is the *absence* of an encoding, so the coercer passes it
through as `pd.NA` and never reports it as an unrecognized boolean encoding.
An `Annotated[bool, Nullable()]` column therefore coerces cleanly with its gaps
intact, while a null in a non-nullable column is reported by `SchemaValidator`
as the nullability breach it is (`column 'active' contains null value(s)`),
pointing at the declaration rather than blaming the feed's data. This keeps
`bool` consistent with every other declared type, which already leaves presence
to the rules.

The validator's `bool` dtype check accepts both `"boolean"` and numpy `bool`, so
nothing downstream has to know the difference. No storage migration is implied
either: SQLite is dynamically typed and stores a boolean column as `1`/`0`/NULL
whichever dtype was written, so `Refresh` and `AccumulateByRun` write and
re-read a table whose boolean dtype changed mid-life without a schema change.

`str` / `int` / `float` **survive storage**, so they pass through untouched and
stay the validator's gate — and columns the schema doesn't declare are left
alone. This keeps the division crisp: **coercion repairs representation lost to
storage; validation enforces the contract.**

A value the coercer cannot cast — an unparseable date, a boolean encoding
outside the known set (`"maybe"`) — is **not** silently dropped: it raises a
`CoercionError` with one located message naming the schema, the column, and the
reason, and the run aborts fail-fast:

```
CaseA coercion: column 'active' has unrecognized boolean encoding(s): 'maybe'
```

## Composing the boundary — coerce, then enforce

There is no recipe builder for this; the two primitives compose **explicitly**
onto a `Pipeline`, so the schema boundary is visible in the pipeline the same way
every other hop is. The raw→silver hop reads raw, coerces, validates, and writes
silver:

```python
from framework.io import Refresh
from tools.store import StoreRegistry
from framework.run import Pipeline
from framework.transform import SchemaCoercion
from framework.core import SchemaValidator
from tools.medallion import medallion

med = medallion(StoreRegistry("/path/to/share"), "cases")

p = Pipeline("cases")
raw = p.read(med.raw.reader("cases"), name="read")
coerced = p.transform(SchemaCoercion(CaseA), raw, name="coerce")
validated = p.validate(SchemaValidator(CaseA), coerced, name="post-validate")
p.write(med.silver.writer("cases", Refresh()), validated, name="write")
p.run()
```

The `med.raw` / `med.silver` namespaces are ordinary `Store`s scoped to one
logical database each (`<share>/cases/{raw,silver}.db`); a Store mints
`reader(table)` / `writer(table, strategy)` over its tables. The medallion
(`tools.medallion`) is an application profile over the framework's
`namespace → file` Store, not framework vocabulary.

`SchemaCoercion(CaseA)` runs as a **transform** step and `SchemaValidator(CaseA)`
as a **validate** step over that coerced output, before the **silver** write. The
per-run step order is:

```
read → coerce (transform) → post-validate (schema) → write
```

Because `.run()` is fail-fast and atomic, either a coercion failure at
the **transform** step or a schema breach at the **post-validate** step raises
*before* the Writer is called — so **no `silver.db` is written** and nothing
partial lands. The pipeline makes no write or load decisions: the `Store` mints
the Writer, which owns its location and carries the load strategy that realised
it. For the full feed pattern (raw accumulation, filtering the current run before
coercion), see [`pipelines/ingest/pipeline.py`](../pipelines/ingest/pipeline.py)
and [adding-a-feed.md](adding-a-feed.md).

## The same schema, at the gold boundary

Gold is validated *on the same footing as silver*: the **same**
`SchemaValidator` composes as a post-validator onto whatever pipeline builds gold,
before the gold write. Two deliberate differences from the silver hop:

- **No `SchemaCoercion`.** Gold reads already-coerced silver, so the round-trip
  repair step is unneeded — only the validator attaches.
- **Belt-and-braces, not the primary gate.** Silver is already schema-validated
  upstream, so gold enforcement guards *assembled* rows (rows built during gold
  reduction, not mirrored from ingest) rather than re-checking ingest mirrors. It
  is therefore **optional** — a gold builder may attach `SchemaValidator` or not.

A breach raises at the validate step, before the writer runs — so a
failed run writes no gold and leaves prior gold intact. How accumulated silver is
assembled into gold is an application concern (the `case_review.gold` helpers, and
the open snapshot-vs-join decision); see
[`gold-accumulation.md`](gold-accumulation.md).

## Value-level rules — format / length / uniqueness / value-set

Columns + dtypes check a column's *shape*; **value-level rules** check its
*contents*. They extend the **same** Case Type dataclass — attached to a field
via `typing.Annotated`, so the annotations stay the single source of truth — and
run on the same engine-confined `SchemaValidator` seam at silver **and** gold:

```python
from dataclasses import dataclass
from datetime import date
from typing import Annotated

from framework.core import NonNull, Nullable, Pattern, Length, Unique, OneOf

@dataclass
class CaseA:
    case_ref: Annotated[str, NonNull(), Pattern(r"\d{9,10}"), Unique()]  # required id
    name:     Annotated[str, Nullable(), Length(maximum=50)]             # optional name
    status:   Annotated[str, OneOf("open", "closed")]                    # nullable by default
    opened:   date                                                       # plain field — unchanged
```

A field can carry **several** rules (they all run), or none — a bare
`opened: date` keeps the exact columns+dtypes behaviour, so the plain
path is untouched.

## Nullability — nullable by default, non-null when declared

Nullability is field-level schema metadata, declared with the same
`typing.Annotated` form as value rules:

| Marker | Meaning | Breach phrase |
|--------|---------|---------------|
| `Nullable()` | the field may contain null values; this is also the default for plain fields | none |
| `NonNull()` | the field must not contain null values | `contains null value(s)` |

The default is **nullable** for compatibility with existing schemas and with the
value-rule model below. Use `Nullable()` when a contract should say that
explicitly; use `NonNull()` for required consumer-facing identifiers or fields
that must be populated before silver/gold writes.

Nullability is checked after column presence and dtype, and before value-rule
breaches are reported. It joins the same one-message validator output, for
example:

```
CaseA schema: column 'case_ref' contains null value(s)
```

An empty dataset satisfies `NonNull()` because there are no null values present.
Declaring both `Nullable()` and `NonNull()` on one field is a schema
configuration error raised when `SchemaValidator` is built.

### The rule vocabulary

| Rule | Checks | Breach phrase |
|------|--------|---------------|
| `Pattern(regex)` | every value **fully matches** the regex (e.g. a 9–10 digit id rejects letters / 11+ chars) | `violates pattern '\d{9,10}' (e.g. 'ABC', '12')` |
| `Length(minimum=, maximum=)` | string length within the inclusive `[min, max]`; either bound optional | `length not in [2, 4] (e.g. 'x', 'toolong')` |
| `Range(minimum=, maximum=)` | numeric **value** within the inclusive `[min, max]`; either bound optional | `value not in [0, 100] (e.g. '-5', '150')` |
| `Unique()` | no duplicate values in the column | `has duplicate value(s): 'dup'` |
| `OneOf(*allowed)` | membership in an allowed set (value-set / encoding) | `has value(s) outside {'closed', 'open'}: 'pending'` |

Four shared properties:

- **Value rules check present values only.** Null values are handled by the
  field's nullability marker: allowed for `Nullable()`/plain fields, rejected by
  `NonNull()`. A nullable `Pattern`, `Length`, `Range`, `Unique`, or `OneOf`
  field can therefore be missing without creating a value-rule breach. The null
  guard lives **once**, in the shared `ValueRuleBase` the five rules derive
  from; a rule only says which of the *present* values breach and how to phrase
  it.
- **Configuration errors fail where the schema is composed**, not mid-run: a
  malformed `Pattern` regex, a `Length`/`Range` with `min > max`, or an empty `OneOf`
  raises when the rule is constructed — mirroring the validator's
  unsupported-dtype guard.
- **Breaches are sampled, not dumped — in the *validator's* message.** An
  aborting validator message describes a **column**, so it lists up to five of
  that column's offending values (sorted, then `...`) and a wholly-wrong column
  stays one readable line. A **quarantined row's** `failed_rule` reason
  describes **one row**, so it names the rule's expectation and samples
  nothing — the row's own values are already beside the reason in the reject
  table. Two callers, two presentations, one traversal (see
  [opt-in row-level quarantine](adr/0007-row-level-quarantine.md)).
- **The breach mask is positional and plainly boolean.** `violating_mask()`
  marks rows by position, not by index label, so a frame whose index labels
  repeat — the ordinary result of concatenating two frames behind the `Dataset`
  seam — is masked correctly rather than raising or silently flagging the wrong
  rows. The mask's dtype is plain `bool`, never pandas' nullable `boolean`,
  because the validator and the quarantine partitioner select rows with it.

### Writing your own rule — an engine-confined act

A value rule is anything with `check(series)` and `violating_mask(series)`: the
`ValueRule` contract is a **structural protocol**, so a rule an application
writes itself, inheriting nothing, is as much a value rule as the five built-in
ones. `ValueRuleBase` — which hands the five built-ins their shared null guard
and mask construction — is **framework-internal**: it is deliberately not
exported from `framework.core`, so an application rule implements the two
methods directly rather than inheriting. That keeps inheritance from becoming
the de-facto contract, and keeps the base class free to change shape without
breaking application code.

One consequence worth knowing when you write your own: the built-in rules
describe a quarantine breach per row without sampling other rows' values, but a
rule that implements the protocol directly is asked for its message through
`check()`, which describes the whole column. Its rejected rows therefore carry a
column-sampled reason rather than a purely per-row one. The rejected row itself
is stored beside the reason either way, so the offending value is always
present.

Either way, authoring a rule means **working inside the engine seam**: the rule
is handed the column's pandas `Series` directly, because judging a whole column
one value at a time in plain Python would be unusably slow. This is the same
bargain readers, writers and transforms make, and
[Python-only processing with an opaque Dataset carrier](adr/0002-python-processing-opaque-dataset-carrier.md)
names value rules in its engine-confined list for exactly this reason. Pipeline
scripts and the domain layer still never name the engine — they only *declare* rules on a
schema.

### One message, naming column + rule

Value-rule breaches join the dtype/column breaches in the validator's **single**
located message (the "report at once" contract), each naming its column
and rule:

```
CaseA schema: column 'case_ref' violates pattern '\d{9,10}' (e.g. '12', 'ABC'); column 'status' has value(s) outside {'closed', 'open'}: 'pending'
```

A value rule is **skipped for a column whose dtype is wrong** — the dtype breach
is the prior problem to fix, and running a string-shaped rule over a mistyped
column would only add a spurious second failure.

### One traversal, two presentations

`SchemaValidator` (which *aborts*) and `SchemaValueRulePartitioner` (which
*routes rows aside*) read the **same** evaluation of the declared rules. A rule
author therefore satisfies **one** contract, not two subtly different ones, and
each rule is consulted exactly once per frame — one mask, one phrase, regardless
of how many rows breach.

Where the two callers agree, and where they deliberately differ:

| Concern | `SchemaValidator` | `SchemaValueRulePartitioner` |
|---|---|---|
| Missing column | rule **does not run**; the *column* is reported as a structural breach and the run aborts | rule **does not run**; nothing to route aside, and the validator ahead of the node already aborted |
| Ill-typed column | rules skipped, dtype breach reported | not applicable — a dtype breach has already aborted upstream |
| Breach phrasing | the rule's expectation **plus a sample** of the column's offenders | the rule's expectation, **no sample** (the row supplies its own values) |
| Row checks | every breaching row, deduplicated by phrase with a row count | every breaching row, per row |

The missing-column behaviour is now **identical in both** and chosen
deliberately: a rule over a column that isn't there never runs, and the absence
itself is the `SchemaValidator`'s to report. The consequence is worth knowing —
**a typo'd column name in a schema means its rules silently never run during
quarantine**, so the `SchemaValidator` in front of the quarantine node (the
quarantine ordering invariant) is what makes the typo visible.

### What a rule costs

- A **value rule** is vectorised: one pass over the column per rule, using the
  engine's own operations. Cost is `O(rows × rules)`.
- A **row check** is a Python callable over one row, so the framework constructs
  a `Series` per row per check and calls into Python each time. On a 1M-row feed
  (the stated ceiling) three row checks mean three million Python-level
  calls — **orders of magnitude** more than a value rule over the same data.

That is the deliberate trade for expressiveness: *which* cross-field
relationships matter is domain logic, and a callable is the honest shape for it.
But prefer a value rule when the expectation fits one column, and keep the
number of declared row checks small on the widest feeds.

### Where they bite

`SchemaValidator` carries the column/dtype, nullability, **and** value rules
together, so wherever it is composed — at the silver boundary, and again at gold —
nullability and value rules enforce with no extra wiring. As with dtype breaches, a nullability or value-rule
breach raises at the post-validate step **before** the writer runs — so the run
aborts fail-fast and atomically and nothing partial lands. `Unique`
here is the field-annotation form of uniqueness; the one-row-per-Case *grain*
on a (possibly composite) key stays the job of `UniqueValidator` at the gold
boundary.

## Row checks — relationships *between* a row's fields

A value rule is **vertical**: one column across many rows, handed a `Series`. A
**row check** is **horizontal**: one row across many fields — the relationship
*between* them. `opened <= closed`; "if a case is closed it must carry a
`closed_date`". This is a different shape, so it gets a different declaration:
not a field annotation (it belongs to no single field) but a `@row_checks(...)`
class decorator sitting **above** the dataclass, carrying `RowCheck`s:

```python
from dataclasses import dataclass
from datetime import date

import pandas as pd
from framework.core import RowCheck, row_checks


def opened_before_closed(row) -> str | None:
    # Author guards nulls explicitly — a row check sees every row (see below).
    if pd.notna(row["opened"]) and pd.notna(row["closed"]) and row["opened"] > row["closed"]:
        return "opened is after closed"
    return None


def closed_needs_a_date(row) -> str | None:
    if row["status"] == "closed" and pd.isna(row["closed_date"]):
        return "closed case is missing closed_date"
    return None


@row_checks(
    RowCheck(("opened", "closed"), opened_before_closed),
    RowCheck(("status", "closed_date"), closed_needs_a_date),
)
@dataclass
class CaseB:
    opened: date
    closed: date
    status: str
    closed_date: date
```

A `RowCheck` pairs a **footprint** — the tuple of columns it spans — with a
plain function over a single row (a pandas `Series` indexed by column). The
function **returns a breach phrase or `None`**, the *same* return-not-raise
contract as a value rule's `check`: a returned string is the breach; a real bug
(a typo'd column name → `KeyError`) propagates as a crash instead of
masquerading as a data breach. The framework ships only this mechanism — no
prebuilt comparison/conditional rules, because *which* relationships matter is
per-Case-Type domain logic, not framework vocabulary.

Two properties match the value rules:

- **Footprint guard.** A check is **skipped when any column it spans is missing
  or ill-typed** — the dtype/missing breach is the prior problem to fix, and
  running `opened <= closed` over an `opened` that arrived as text would crash
  rather than report. This is the per-column guard value rules already get; the
  footprint is what lets it apply per-check.
- **One message, collected.** Every breaching row joins the validator's single
  located message, distinct phrases reported with a row count:

  ```
  CaseB schema: opened is after closed (2 rows); closed case is missing closed_date (1 row)
  ```

One property **diverges** — and it's deliberate:

> **Row checks run over *every* row, including nulls.** Value rules drop nulls
> before testing ("nullability is a separate concern"). A row check must *not*,
> because presence can be the very thing it tests (`closed_needs_a_date` above is
> *about* a null). So the framework never pre-filters null rows for a row check —
> the function sees the row exactly as it is, and **the author guards nulls
> explicitly** (e.g. `pd.notna(...)` in an ordering check, or `pd.isna(...)` in a
> presence check). Carrying over the value-rule reflex that "nulls are always
> skipped" is the one thing that will surprise you here.

### Where they bite

Like value rules, row checks run on the same `SchemaValidator` seam, so they
enforce at **both** the silver and gold boundaries wherever it is composed, and
abort fail-fast before the writer runs. And like value rules they also feed
**quarantine**: a `SchemaValueRulePartitioner` routes a row-check-breaching row
to the reject table with its phrase in the `failed_rule` reason (the footprint
guard skips a check whose column is absent there too), so a horizontal breach
can be isolated row-by-row rather than aborting the run.

## Handling Schema Drift in Accumulating Layers (Silver/Gold)

When an upstream source changes its shape (e.g. adding a new column) and you want to accept this drift into your accumulating silver or gold tables, follow this four-step process:

1. **Identify**: The `SchemaDriftValidator` at the raw boundary will perform a soft check and surface a warning (visible in `runs_that_warned()`) when the columns differ from the prior run. Raw continues to land the data faithfully. When that data reaches the silver boundary, the `SchemaValidator` will intentionally fail-fast with a `ValidationError` (Schema Breach) to protect downstream logic.
2. **Update Schema**: Modify the Python `CaseType` dataclass for that feed to include the new column or changed type. This updates the hard contract so the `SchemaValidator` expects the new shape.
3. **Migrate the Database**: Because accumulating writers (`AccumulateByRunWriter`, `SqliteUpsertWriter`) rely on `pandas.to_sql(if_exists="append")`, and SQLite does not automatically evolve table schemas, you **must manually run an `ALTER TABLE` migration** against the target database (e.g. `silver.db`) before re-running:
   ```sql
   ALTER TABLE cases ADD COLUMN new_column_name TEXT;
   ```
4. **Re-run**: Because the pipelines are idempotent by logical run ID, simply re-run the pipeline. It will clear the partial/failed rows for that run and cleanly insert the new data under the updated schema. Historical rows will automatically receive `NULL` for the new column.
