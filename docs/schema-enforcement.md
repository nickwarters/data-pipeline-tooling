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
one place (`framework.schema`). See ADR-0002 and ADR-0008.

## `SchemaCoercion` — repairing what storage loses

A `SchemaValidator` can only *assert* the dtype it is handed, and raw hands it
the dtypes a SQLite round-trip leaves behind: a `date` lands as text, a `bool`
as `1`/`0` or `TRUE`/`FALSE`. Without a repair step those columns would fail the
validator even when the underlying values are perfectly valid. `SchemaCoercion`
is that repair step — the **write-side companion** of `SchemaValidator`, derived
from the *same* dataclass:

```python
from framework.schema import SchemaCoercion

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
from framework.silver import raw_to_silver
from framework.store import Store

store = Store("/path/to/share/cases")
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
from framework.gold import silver_to_gold

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

## Not yet (follow-on tickets)

- **Value-level rules.** Format/pattern (e.g. a 9–10 digit id), length,
  uniqueness (duplicate keys), and value-set/encoding membership extend the same
  dataclass and run as later validators on the same engine-confined seam (#24).
