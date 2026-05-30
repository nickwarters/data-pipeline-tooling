# Schema enforcement & what "silver" means

This documents the `Schema` + `SchemaValidator` adapter and the `raw_to_silver`
builder introduced in #7. For the *why*, see
[ADR-0008](adr/0008-graduated-schema-enforcement.md); for the surrounding
primitives, [core-primitives.md](core-primitives.md).

## The three layers, and where the schema bites

Enforcement is **graduated** across the medallion (ADR-0008):

| Layer | Shape discipline |
|-------|------------------|
| **raw** | **Schema-light.** A faithful mirror of the source snapshot as landed — booleans still as `TRUE`/`FALSE` text, dates still unparsed, warts and all. At most a loud column-presence check so a wholesale source change fails immediately. |
| **silver** | **Validated — the schema boundary.** A Case Type's declared columns + dtypes are enforced here, as a post-validator, before the data lands. This is where "is this data valid and processable?" gets its authoritative answer. |
| **gold** | Validated on the same footing as silver (the accumulating SelectionPool / Review Outcomes). |

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
and checks a `DataHandle` against them. It is a `Validator`
(`validate(handle) -> None`, raising `ValidationError`), so it attaches to the
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
handle's engine-agnostic shape (`columns` / `len`) and never name pandas. A
schema check inspects column **dtypes**, and the value-level rules it will grow
into (format/pattern, length, uniqueness, encoding) need the engine's vectorised
operations over actual values. Re-exposing all of that engine-agnostically would
re-implement a dataframe API on the `DataHandle` seam. So `SchemaValidator`
reaches the backing frame via `to_pandas()` exactly as a Reader/Writer/processor
does — keeping `DataHandle`'s public surface tiny and the pandas-dtype mapping in
one place (`framework.schema`). See ADR-0002 and ADR-0008.

## `raw_to_silver` — enforcing the schema at the boundary

The builder wires the convention together for one subject's table:

```python
from framework.silver import raw_to_silver
from framework.store import Store

store = Store("/path/to/share/cases")
raw_to_silver(store, "cases", CaseA).run()   # reads raw, validates, writes silver.db
```

It reads `store`'s **raw** `cases` table, attaches `SchemaValidator(CaseA)` as a
**post**-validator, and writes the **silver** `cases` table — all deferred until
`.run()`. Optional `name=` labels the run for observability (default the table)
and `run_log=` supplies a `RunLog` sink.

Because `.run()` is fail-fast and atomic (ADR-0007), a schema breach raises at
the silver **post-validate** step *before* the Writer is called — so **no
`silver.db` is written** and nothing partial lands. The builder itself makes no
write or load decisions: the `Store` mints the Writer, which owns its location
and load strategy (ADR-0003, ADR-0006).

## Not yet (follow-on tickets)

- **Coercion processors.** With no processor between raw and silver, silver
  dtypes are whatever the raw→silver read yields; types that do not survive a
  SQLite round-trip (dates, booleans) need a coercion step *before* the silver
  post-validator can assert them. The processor slots in ahead of the validator
  without reshaping it.
- **Value-level rules.** Format/pattern (e.g. a 9–10 digit id), length,
  uniqueness (duplicate keys), and encoding (`TRUE`/`FALSE` text vs `1`/`0`)
  extend the same dataclass and run on the same engine-confined seam.
