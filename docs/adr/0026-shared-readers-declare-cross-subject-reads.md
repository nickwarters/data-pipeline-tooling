---
status: accepted
---

# Shared Readers declare a cross-subject read once

> **Owned by the pipeline → the medallion store. Not owned by the pipeline → a
> Shared Reader.**

A **Shared Reader** is a `Reader` over a named business dataset that crosses a
subject boundary. Its location and identity are declared **once**, in a module
named for the subject that owns the data, and a consumer instantiates it with a
`base_dir` and nothing else.

```python
from readers.sharepoint_cases import CurrentCasesReader
from readers.users import UsersReader

CurrentCasesReader(base_dir=context.base_dir)
UsersReader(base_dir=context.base_dir)
```

The **import** names the subject. The **constructor** supplies the root.
Everything past that — layer, table, file, database, whether there is a database
at all — belongs to the reader.

## What breaks today

Three files independently declare the same physical fact about data none of them
owns:

| Where | What it declares |
|---|---|
| `pipelines/sharepoint_cases/gold.py` | `CURRENT_TABLE = "case_current"` — the producer |
| `pipelines/notifications/pipeline.py` | `SYNC_SUBJECT`, `CASE_TABLE`, `MESSAGE_TABLE` |
| `pipelines/reviewer_activity/gold.py` | `SYNC_SUBJECT = FEED_NAME`, `SYNC_TABLE = "case_current"` |

Each consumer separately knows the subject, the layer *and* the table, and
separately rebuilds the path:

```python
registry = StoreRegistry(context.base_dir)
sync = medallion(registry, SYNC_SUBJECT)
cases = sync.gold.reader(CASE_TABLE)
```

The coupling is current state, not a future risk: `reviewer_activity/gold.py`
already imports `FEED_NAME` from `pipelines.sharepoint_cases.schema` to name the
subject it reads. And the reader that prompted this — the `users` feed behind
`notifications` — has **no producer pipeline at all**; its CSV sits inside
`pipelines/notifications/` because that is who needed it first.

## The decisions

### 1. A consumer names no layer and no table

`sync.gold.reader("case_current")` inside `notifications` is `notifications`
asserting `sharepoint_cases`'s **storage shape**. That is what makes the
medallion load-bearing outside the subject that owns it: the per-subject
medallion is a *storage* decision belonging to the producer
([ADR-0001](0001-sqlite-per-subject-medallion-store.md), amended to demote the
medallion to an application-level profile over an opaque namespace). If
`case_current` ever stops being a gold table in a per-subject SQLite medallion —
a view, a different subject, an external warehouse — every consumer changes.

Behind a Shared Reader, renaming `case_current` changes one file. The producer
keeps writing through its own medallion; only the read side gains the
indirection.

### 2. `base_dir` and nothing else — even for a reader that does not need it yet

`UsersReader` currently takes a **path**, because its source is a CSV. A
consumer holding that path has been told the source is a file, which is the same
class of leak as a table name and the one that breaks first: the day `users`
becomes a table in a real subject, every call site changes even though the
question it answers has not.

So the constructor signature is uniform — `base_dir`, resolved by the reader —
including for a reader that ignores it today. Uniformity is the point: a
consumer cannot tell from the call site which entries are file-backed and which
are table-backed, so it cannot depend on the difference.

### 3. A class, not a factory function

A class is a nameable type in signatures and tests, it carries its own docstring
as its contract, and its internals can change — injecting a different
`StoreBackend`, moving from a file to a table — without the call site changing
shape. A factory returning a bare `Reader` gives the first of those and none of
the rest.

Names follow the **question the dataset answers**, never the table it sits on:
`CurrentCasesReader`, not `CaseCurrentReader`. The name has to survive
`case_current` being renamed, re-grained or split, which is the whole point of
decision 1.

Composition, not subclassing: `Reader` is a structural Protocol, so an entry
wraps the Reader the medallion mints and delegates `read` / `describe` /
`data_locations`. `UsersReader` already has this shape.

### 4. A new top-level `readers/` package, one module per subject

```
readers/
    __init__.py             # what a Shared Reader is + the admission rules
    sharepoint_cases.py     # CurrentCasesReader, ConversationMessagesReader
    users.py                # UsersReader
    sample_data/users.csv
```

**Not producer-owned** (`pipelines/sharepoint_cases/readers.py`): the unit is
the *subject*, not the pipeline. `pipelines/` is deliberately flat and one-way —
the operator CLI addresses a pipeline by its path on disk and imports
`pipelines.<name>.pipeline`, so the framework never statically depends on
`pipelines/` — and cross-pipeline reader imports would turn it into a dependency
graph. Decisively, the `users` reader has no pipeline package to live in: you
would either leave it in `pipelines/notifications/`, so a second consumer
imports the pipeline that merely got there first, or invent a `pipelines/users/`
containing a reader and no pipeline.

**Not `case_review/`**: the `users` directory is org-wide Reference Data
covering every login, not case-review vocabulary. **Not `shared/`**, which holds
declarations without operational behaviour, and **not `tools/`**, which holds no
domain knowledge.

This does not weaken [ADR-0013](0013-keep-the-framework-domain-free.md).
`readers/` is application code and speaks business nouns freely; nothing here
enters `framework/`, which keeps knowing only `Reader`, `Writer` and `Dataset`.
It sits beside `pipelines/` and `case_review/` on the application side of that
line, and imports through the same four facades every other consumer does.

Named `readers/` rather than `subjects/` because it is narrow and
self-limiting — G1 below is encoded in the package name.

## Guardrails

- **G1 — Read-only.** `readers/` mints Readers, never Writers. This is what
  stops it becoming a second store facade beside `tools.store`.
- **G2 — Admission.** A dataset earns an entry when it is read by a pipeline
  that does not produce it, or is a feed's published contract. One consumer
  inside its own subject stays local. **Removal is a rule too** — if it drops
  back to one in-subject consumer, it goes back.
- **G3 — One declaration of location.** Once a dataset is in `readers/`, a
  consumer may not rebuild the path. No `medallion(...)` in a consumer for data
  it does not own.
- **G4 — The port is the contract.** `read() -> Dataset`, `describe()`,
  `data_locations`. Parametrisation happens at construction, never through a
  query method.
- **G5 — Read what was written.** A Shared Reader over a stored table is a
  pass-through: no projection, no coercion, no re-shaping, **no joins, no
  aggregation, no as-of filtering.** Carve-out: where a reader *already*
  normalises an untrustworthy source — `UsersReader` canonicalising logins and
  refusing a duplicate — that behaviour moves across as-is. It is not a licence
  to add shaping to a new entry.
- **G6 — The upstream travels with the reader.** Each module declares its
  `FreshnessRequirement`, so a consumer that reads a subject also inherits the
  statement of what must have run first, rather than restating it.
- **G7 — Column guarantees stay consumer-side.** The reader declares no column
  contract; `reviewer_activity` keeps its own `SOURCE_COLUMNS` and
  `ColumnValidator`. Nothing at the reader grows into the union of every
  consumer's needs.

G1, G3 and G5 are the load-bearing three. G1 keeps the package from becoming a
second way to reach the store. G3 is the decision itself — an entry that
consumers are free to bypass declares nothing. G5 is what keeps a Shared Reader
a *location* indirection rather than a shared transformation layer: the moment
one consumer's filter lands in the reader, the next consumer inherits an answer
it did not ask for, invisibly, because the shaping is no longer a node in its
DAG.

## Consequences

- Every feed still writes through its own medallion. Single-writer-per-file,
  migrations owning physical table shape, `tools.store` / `tools.medallion` /
  `Store` / `StoreRegistry` are all unchanged. This adds a read-side
  indirection and removes nothing.
- A cross-subject read is now traceable from one place: the module names who
  owns the data, what the dataset is called, and what must have run first.
- A reader carrying more than a `base_dir` — `CurrentCasesReader(base_dir,
  case_ids=...)` to fetch only some Cases — is **deliberately not decided
  here.** It sits directly on G5, and the question is where the line falls
  between a reader narrowing what it fetches and a reader deciding what the
  answer is. In its favour: that is predicate pushdown, not business logic, and
  `SqliteReader` already takes `columns=[...]`. Against: a consumer's `Filter`
  is visible in the DAG and the run log, and pushed into the reader it is not;
  two consumers of one named reader would get different row sets; and an as-of
  window is also just a predicate.

## Not decided here

**Whether the `users` feed and the Staff Hierarchy are the same thing.** They
are expected to converge; they have not. This decision relocates the `users`
reader as it stands and names it for what it is, and asserts nothing either way.
Recorded so the silence is not later read as a decision. (Adjacent to, and
distinct from, the separate question of converging the platform's
`assignedReviewerManager` cache on `current_hierarchy`.)
