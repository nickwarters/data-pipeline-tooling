# Schema enforcement & what "silver" means

This documents the `Schema` + `SchemaValidator` adapter and the `raw_to_silver`
builder introduced in #7, plus the `SchemaCoercion` processor that repairs
raw's round-trip-lossy types ahead of the validator (#23). For the *why*, see
[ADR-0008](adr/0008-graduated-schema-enforcement.md); for the surrounding
primitives, [core-primitives.md](core-primitives.md).

## The three layers, and where the schema bites

Enforcement is **graduated** across the medallion (ADR-0008):

| Layer | Shape discipline |
|-------|------------------|
| **raw** | **Schema-light.** A faithful mirror of the source snapshot as landed — booleans still as `TRUE`/`FALSE` text, dates still unparsed, warts and all. At most a loud column-presence check so a wholesale source change fails immediately. |
| **silver** | **Validated — the schema boundary.** A Case Type's declared columns + dtypes are enforced here, as a post-validator, before the data lands. This is where "is this data valid and processable?" gets its authoritative answer. |
| **gold** | **Validated on the same footing as silver** (the accumulating SelectionPool / Review Outcomes) — via an optional `schema=` post-validator on `silver_to_gold` (see below). |

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
(`Iterator[CaseA]`) are an opt-in convenience for later (ADR-0008).

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
one place (`framework.transform.schema`). See ADR-0002 and ADR-0008.

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
reason, and the run aborts fail-fast (ADR-0007):

```
CaseA coercion: column 'active' has unrecognized boolean encoding(s): 'maybe'
```

## `raw_to_silver` — coerce, then enforce, at the boundary

The builder wires the convention together for one subject's table:

```python
from framework.io import StoreCatalog
from framework.run import raw_to_silver

store = StoreCatalog("/path/to/share").store("cases")
raw_to_silver(store, "cases", CaseA).run()   # reads raw, coerces, validates, writes silver.db
```

It reads `store`'s **raw** `cases` table, runs `SchemaCoercion(CaseA)` as the
**process** step, attaches `SchemaValidator(CaseA)` as a **post**-validator over
that coerced output, and writes the **silver** `cases` table — all deferred until
`.run()`. Optional `name=` labels the run for observability (default the table)
and `run_log=` supplies a `RunLog` sink. The per-run step order is:

```
read → pre-validate → process (coerce) → post-validate (schema) → write
```

Because `.run()` is fail-fast and atomic (ADR-0007), either a coercion failure
at the **process** step or a schema breach at the **post-validate** step raises
*before* the Writer is called — so **no `silver.db` is written** and nothing
partial lands. The builder itself makes no write or load decisions: the `Store`
mints the Writer, which owns its location and load strategy (ADR-0003, ADR-0006).

## `silver_to_gold` — the same schema, at the gold boundary

Gold is validated *on the same footing as silver* (ADR-0008): `silver_to_gold`
takes the **same** optional `schema=` and attaches the **same** `SchemaValidator`
as a post-validator before the gold write.

```python
from framework.run import silver_to_gold

silver_to_gold(
    store, "selection_pool",
    run_id="2026-05-30", load_date="2026-05-30",
    schema=CaseA,
).run()   # reads silver, validates, accumulates into gold.db
```

Two deliberate differences from `raw_to_silver`:

- **No `SchemaCoercion`.** Gold reads already-coerced silver, so the round-trip
  repair step is unneeded — only the validator attaches.
- **Belt-and-braces, not the primary gate.** Silver is already schema-validated
  upstream, so gold enforcement guards *selection-built* rows (rows assembled in
  the Selection Pipeline, not mirrored from ingest) rather than re-checking ingest
  mirrors. It is therefore **optional**: omit `schema=` and `silver_to_gold` is a
  pure accumulate pass-through.

A breach raises at **post-validate**, before the writer's delete-by-run/insert
transaction (ADR-0007) — so a failed run accumulates nothing and leaves prior
runs' gold rows intact. See [`gold-accumulation.md`](gold-accumulation.md).

## Value-level rules — format / length / uniqueness / value-set (#24)

Columns + dtypes check a column's *shape*; **value-level rules** check its
*contents*. They extend the **same** Case Type dataclass — attached to a field
via `typing.Annotated`, so the annotations stay the single source of truth — and
run on the same engine-confined `SchemaValidator` seam at silver **and** gold:

```python
from dataclasses import dataclass
from datetime import date
from typing import Annotated

from framework.transform import NonNull, Nullable, Pattern, Length, Unique, OneOf

@dataclass
class CaseA:
    case_ref: Annotated[str, NonNull(), Pattern(r"\d{9,10}"), Unique()]  # required id
    name:     Annotated[str, Nullable(), Length(maximum=50)]             # optional name
    status:   Annotated[str, OneOf("open", "closed")]                    # nullable by default
    opened:   date                                                       # plain field — unchanged
```

A field can carry **several** rules (they all run), or none — a bare
`opened: date` keeps the exact columns+dtypes behaviour from #7, so the plain
path is untouched.

## Nullability — nullable by default, non-null when declared (#90)

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
| `Unique()` | no duplicate values in the column | `has duplicate value(s): 'dup'` |
| `OneOf(*allowed)` | membership in an allowed set (value-set / encoding) | `has value(s) outside {'closed', 'open'}: 'pending'` |

Three shared properties:

- **Value rules check present values only.** Null values are handled by the
  field's nullability marker: allowed for `Nullable()`/plain fields, rejected by
  `NonNull()`. A nullable `Pattern`, `Length`, `Unique`, or `OneOf` field can
  therefore be missing without creating a value-rule breach.
- **Configuration errors fail where the schema is composed**, not mid-run: a
  malformed `Pattern` regex, a `Length` with `min > max`, or an empty `OneOf`
  raises when the rule is constructed — mirroring the validator's
  unsupported-dtype guard.
- **Breaches are sampled, not dumped.** A message lists up to five offending
  values (sorted, then `...`), so a wholly-wrong column stays one readable line.

### One message, naming column + rule

Value-rule breaches join the dtype/column breaches in the validator's **single**
located message (the "report at once" contract from #7), each naming its column
and rule:

```
CaseA schema: column 'case_ref' violates pattern '\d{9,10}' (e.g. '12', 'ABC'); column 'status' has value(s) outside {'closed', 'open'}: 'pending'
```

A value rule is **skipped for a column whose dtype is wrong** — the dtype breach
is the prior problem to fix, and running a string-shaped rule over a mistyped
column would only add a spurious second failure.

### Where they bite

`SchemaValidator` is already the post-validator on both `raw_to_silver` and
`silver_to_gold`, so nullability and value rules enforce at **both** boundaries
with no builder change. As with dtype breaches, a nullability or value-rule
breach raises at the post-validate step **before** the writer runs — so the run
aborts fail-fast and atomically (ADR-0007) and nothing partial lands. `Unique`
here is the field-annotation form of uniqueness; the one-row-per-Case *grain*
on a (possibly composite) key stays the job of `UniqueValidator` at the gold
boundary (#37, ADR-0009).
