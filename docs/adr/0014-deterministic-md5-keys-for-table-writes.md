---
status: accepted
---

# Deterministic MD5 keys for table writes

When a table write needs a surrogate primary key — that is, a stable, opaque
identifier not sourced directly from the business domain — that surrogate is
computed as the **MD5 hex digest of the row's declared natural key columns**,
joined in declared order with `"|"` as the separator. No random UUIDs, no
auto-increment sequences, no database-assigned identifiers.

```python
import hashlib

def md5_key(row: dict, key_columns: Sequence[str]) -> str:
    raw = "|".join(str(row[col]) for col in key_columns)
    return hashlib.md5(raw.encode("utf-8")).hexdigest()  # 32 hex chars
```

`hashlib.md5` is part of Python's stdlib, produces identical output on Windows
and macOS (no platform salt, no session salt — unlike the builtin `hash()`), and
requires no external dependency.

## Scope: write-level surrogates, not domain identity

This ADR governs **internal write-level surrogate keys** — the "id" column a
`Writer` mints for its own table's primary key when the table has no
externally-meaningful identity. It is **not** about `case_id`, which is a
domain-level identity that propagates to consumers and is derived via
`uuid5(namespace, natural_key)` (ADR-0009). The two coexist:

- `case_id` = `uuid5(CaseType namespace, natural key string)` — domain identity,
  UUID-formatted so it's consumable as a standard opaque handle by downstream
  systems.
- Write-level surrogate = `md5(natural key string)` — internal storage key, never
  exposed past the layer that minted it.

## Why

- **Idempotency by content addressing.** The same natural key produces the same
  surrogate on every run and every machine. A re-run writing the same row gets
  the same key, so `INSERT OR IGNORE` / `InsertIfAbsent` semantics are trivially
  correct: the key already exists, the row is skipped, no duplicate. A
  random-uuid4 surrogate breaks this — each run mints a different id for the
  same logical row, defeating idempotent writes (ADR-0006).

- **No coordination or state needed.** Sequential auto-increment (`max_id + 1`)
  requires reading the current maximum before each batch — a serial, stateful
  operation. MD5 is a pure function of the row's content: any number of writers
  can derive the same key independently and in any order, with no shared counter
  and no risk of gaps or races.

- **Simpler than `uuid5`.** `uuid5` requires a caller-supplied namespace UUID
  that must be stable and documented; the resulting key is UUID-formatted (36
  chars with hyphens). For a write-level surrogate that never leaves its own
  table, neither the namespace indirection nor the UUID format adds value — a raw
  32-char hex digest is shorter, self-contained, and easier to inspect in SQLite.

- **MD5 over SHA-256.** MD5 produces a 128-bit digest (32 hex chars). For
  surrogate keys the collision criterion is uniqueness within a single table's
  natural-key space, not cryptographic resistance; a birthday-bound collision
  requires ~2^64 rows — orders of magnitude beyond any realistic data volume here.
  SHA-256's 64-char output adds storage and index cost with no practical benefit
  at this scale.

- **Cross-platform determinism.** `hashlib.md5` is pure stdlib and produces
  bit-identical output on Windows and macOS regardless of locale, process
  identity, or Python version. The builtin `hash()` is session-salted since
  Python 3.3 and cannot be used for stored keys.

## Considered options

- **Random `uuid4`** — zero coordination cost, but non-deterministic: the same
  row gets a different id on every run, breaking idempotent re-runs. Rejected.

- **Auto-increment / `max_id + 1`** — produces compact integers but requires a
  read-before-write to find the current maximum; order-dependent (two batches run
  in different order produce different ids for the same rows); not content-
  addressed. Rejected for surrogate writes where re-run identity matters.

- **`uuid5(namespace, key_string)`** — deterministic UUID, but requires a stable
  namespace UUID owned by the caller (a non-trivial contract for a generic write
  strategy), and the UUID format is heavier than needed for an internal key. Used
  for domain-level `case_id` (ADR-0009) where the UUID format and namespace
  contract are appropriate; **not** chosen for generic write-level surrogates.

- **SHA-256 hex digest** — fully deterministic, but 64 chars doubles index size
  with no meaningful collision-resistance gain at realistic row counts. Rejected
  in favour of MD5.

## Consequences

- **The natural key declaration is a stable contract.** The surrogate is a pure
  function of the declared key columns and their order — changing either re-keys
  all existing rows. Treat `key_columns` the same as a column rename: a
  deliberate, versioned act, not a casual refactor.

- **Collision risk is negligible but real.** MD5 collisions are theoretically
  constructable (chosen-prefix attacks), but those require adversarial crafting
  of inputs. Within a single feed's natural key space, the birthday bound is
  ~2^64 rows before a random collision becomes likely. Accepted at current and
  forecast volumes.

- **No UUID formatting.** The surrogate is a plain 32-character lowercase hex
  string, not a UUID. Downstream code that expects a UUID format must not consume
  these keys; they are internal to the table that minted them.

- **`None` / null values in key columns must be handled explicitly.** `str(None)`
  is `"None"`, which is a valid but potentially ambiguous key component. Feed
  builders that allow nullable key columns must substitute a sentinel (e.g. `""`)
  before passing the value to the hash — this is a caller responsibility, not
  a strategy responsibility.
