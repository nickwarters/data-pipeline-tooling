# Schema enforcement & what "silver" means

This documents the `Schema` + `SchemaValidator` adapter and the
`SchemaCoercion` processor that repairs raw's round-trip-lossy types ahead of the
validator, plus how they compose onto a `Pipeline` to enforce the schema at
the silver boundary. For the *why*, see
[ADR-0006](adr/0006-graduated-schema-enforcement.md); for the surrounding
primitives, [core-primitives.md](core-primitives.md).

## The three layers, and where the schema bites

Enforcement is **graduated** across the medallion (ADR-0006):

| Layer | Shape discipline |
|-------|------------------|
| **raw** | **Schema-light.** A faithful mirror of the source snapshot as landed — booleans still as `TRUE`/`FALSE` text, dates still unparsed, warts and all. At most a loud column-presence check so a wholesale source change fails immediately. |
| **silver** | **Validated — the schema boundary.** A Case Type's declared columns + dtypes are enforced here, as a post-validator, before the data lands. This is where "is this data valid and processable?" gets its authoritative answer. |
| **gold** | **Validated on the same footing as silver** (ADR-0006) — by composing the same `SchemaValidator` as a post-validator onto the gold-building pipeline (see below). |

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
(`Iterator[CaseA]`) are an opt-in convenience for later (ADR-0006).

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
  | `bool`               | bool                  |
  | `date` / `datetime`  | datetime64            |

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
one place (`framework._internal.schema`). See ADR-0002 and ADR-0006.

## `SchemaCoercion` — repairing what storage loses

A `SchemaValidator` can only *assert* the dtype it is handed, and raw hands it
the dtypes a SQLite round-trip leaves behind: a `date` lands as text, a `bool`
as `1`/`0` or `TRUE`/`FALSE`. Without a repair step those columns would fail the
validator even when the underlying values are perfectly valid. `SchemaCoercion`
is that repair step — the **write-side companion** of `SchemaValidator`, derived
from the *same* dataclass:

```python
from framework.transform import SchemaCoercion

coerced = SchemaCoercion(CaseA).process(dataset)   # returns a transformed dataset
```

It is a `Processor` (`process(dataset) -> Dataset`) and, like the validator,
**engine-confined** — a cast needs the engine's vectorised operations, so it
reaches the frame via `to_pandas()`/`from_pandas()` (ADR-0002). It casts **only
the round-trip-lossy declared types**:

| Declared type | Coerced from | Coerced to |
|---------------|--------------|------------|
| `date` / `datetime` | text (`"2026-01-01"`) | datetime64 |
| `bool` | `TRUE`/`FALSE` text (case-insensitive) or `1`/`0` | bool |

`str` / `int` / `float` **survive storage**, so they pass through untouched and
stay the validator's gate — and columns the schema doesn't declare are left
alone. This keeps the division crisp: **coercion repairs representation lost to
storage; validation enforces the contract.**

A value the coercer cannot cast — an unparseable date, a boolean encoding
outside the known set (`"maybe"`) — is **not** silently dropped: it raises a
`CoercionError` with one located message naming the schema, the column, and the
reason, and the run aborts fail-fast (ADR-0005):

```
CaseA coercion: column 'active' has unrecognized boolean encoding(s): 'maybe'
```

## Composing the boundary — coerce, then enforce

There is no recipe builder for this; the two primitives compose **explicitly**
onto a `Pipeline`, so the schema boundary is visible in the pipeline the same way
every other hop is. The raw→silver hop reads raw, coerces, validates, and writes
silver:

```python
from framework.io import Refresh, StoreCatalog
from framework.run import Pipeline
from framework.transform import SchemaCoercion
from framework.core import SchemaValidator

store = StoreCatalog("/path/to/share").store("cases")

p = Pipeline("cases")
raw = p.read(store.reader("raw", "cases"), name="read")
coerced = p.transform(SchemaCoercion(CaseA), raw, name="coerce")
validated = p.validate(SchemaValidator(CaseA), coerced, name="post-validate")
p.write(store.writer("silver", "cases", Refresh()), validated, name="write")
p.run()
```

`SchemaCoercion(CaseA)` runs as a **transform** step and `SchemaValidator(CaseA)`
as a **validate** step over that coerced output, before the **silver** write. The
per-run step order is:

```
read → coerce (transform) → post-validate (schema) → write
```

Because `.run()` is fail-fast and atomic (ADR-0005), either a coercion failure at
the **transform** step or a schema breach at the **post-validate** step raises
*before* the Writer is called — so **no `silver.db` is written** and nothing
partial lands. The pipeline makes no write or load decisions: the `Store` mints
the Writer, which owns its location and load strategy (ADR-0003, ADR-0004). For
the full feed pattern (raw accumulation, filtering the current run before
coercion), see [`pipelines/ingest/pipeline.py`](../pipelines/ingest/pipeline.py)
and [adding-a-feed.md](adding-a-feed.md).

## The same schema, at the gold boundary

Gold is validated *on the same footing as silver* (ADR-0006): the **same**
`SchemaValidator` composes as a post-validator onto whatever pipeline builds gold,
before the gold write. Two deliberate differences from the silver hop:

- **No `SchemaCoercion`.** Gold reads already-coerced silver, so the round-trip
  repair step is unneeded — only the validator attaches.
- **Belt-and-braces, not the primary gate.** Silver is already schema-validated
  upstream, so gold enforcement guards *assembled* rows (rows built during gold
  reduction, not mirrored from ingest) rather than re-checking ingest mirrors. It
  is therefore **optional** — a gold builder may attach `SchemaValidator` or not.

A breach raises at the validate step, before the writer runs (ADR-0005) — so a
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

Three shared properties:

- **Value rules check present values only.** Null values are handled by the
  field's nullability marker: allowed for `Nullable()`/plain fields, rejected by
  `NonNull()`. A nullable `Pattern`, `Length`, `Range`, `Unique`, or `OneOf`
  field can therefore be missing without creating a value-rule breach.
- **Configuration errors fail where the schema is composed**, not mid-run: a
  malformed `Pattern` regex, a `Length`/`Range` with `min > max`, or an empty `OneOf`
  raises when the rule is constructed — mirroring the validator's
  unsupported-dtype guard.
- **Breaches are sampled, not dumped.** A message lists up to five offending
  values (sorted, then `...`), so a wholly-wrong column stays one readable line.

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

### Where they bite

`SchemaValidator` carries the column/dtype, nullability, **and** value rules
together, so wherever it is composed — at the silver boundary, and again at gold —
nullability and value rules enforce with no extra wiring. As with dtype breaches, a nullability or value-rule
breach raises at the post-validate step **before** the writer runs — so the run
aborts fail-fast and atomically (ADR-0005) and nothing partial lands. `Unique`
here is the field-annotation form of uniqueness; the one-row-per-Case *grain*
on a (possibly composite) key stays the job of `UniqueValidator` at the gold
boundary (ADR-0009).

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
