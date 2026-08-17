# Shared Readers — reading data your pipeline does not own

> **Owned by the pipeline → the medallion store.
> Not owned by the pipeline → a Shared Reader.**

A **Shared Reader** is a `Reader` over a named business dataset that crosses a
subject boundary. Its location and identity are declared **once**, in
`readers/<subject>.py`, and a consumer instantiates it with a `base_dir` and
nothing else:

```python
from readers.sharepoint_cases import CurrentCasesReader
from readers.users import UsersReader

CurrentCasesReader(base_dir=base_dir)
UsersReader(base_dir=base_dir)
```

The **import** names the subject. The **constructor** supplies the root.
Everything past that — layer, table, file, database, whether there is a database
at all — is the reader's.

This is a read-side indirection and nothing more. Every feed still *writes*
through its own medallion, single-writer-per-file still holds, and the numbered
SQL under `migrations/` still owns physical table shape. The reasoning behind
the decision is
[ADR-0026](adr/0026-shared-readers-declare-cross-subject-reads.md); this page is
how to work with it.

## Why a consumer must not name a layer or a table

Before this, a consumer of the Sync feed wrote:

```python
registry = StoreRegistry(context.base_dir)
sync = medallion(registry, SYNC_SUBJECT)
cases = sync.gold.reader(CASE_TABLE)
```

Three files did it independently, each separately declaring the subject, the
layer *and* the table. `sync.gold` there is one pipeline asserting another
pipeline's **storage shape** — and the per-subject medallion is a *storage*
decision that belongs to the producer
([ADR-0001](adr/0001-sqlite-per-subject-medallion-store.md)). Rename
`case_current`, turn it into a view, move it to another subject or out to a
warehouse, and every consumer changes.

Behind a Shared Reader, one file changes.

## The two shapes, by example

### Backed by a medallion — `readers/sharepoint_cases.py`

The common case. A private helper resolves the location; each class wraps the
Reader the store mints and delegates the three ports.

```python
_SUBJECT = "sharepoint_cases"
_CASE_CURRENT_TABLE = "case_current"


def _gold_reader(base_dir, table):
    return medallion(StoreRegistry(base_dir), _SUBJECT).gold.reader(table)


class CurrentCasesReader:
    """Every Case as it currently stands — one row per ``case_id``."""

    def __init__(self, base_dir: str | os.PathLike[str]) -> None:
        self._reader = _gold_reader(base_dir, _CASE_CURRENT_TABLE)

    @property
    def data_locations(self) -> list[dict[str, str]]:
        return self._reader.data_locations

    def read(self) -> Dataset:
        return self._reader.read()

    def describe(self) -> str:
        return self._reader.describe()
```

`data_locations` is a **property**, not a value copied in `__init__`. The
Readers underneath populate it when `read()` runs; snapshotting it at
construction would freeze the empty list and the run log would record that the
step touched nothing.

### Backed by nothing at all — `readers/users.py`

The `users` directory feed has no producer pipeline, no subject and no
medallion. It is a CSV bundled beside the module — and a consumer cannot tell,
which is the point.

```python
_BUNDLED_FEED = Path(__file__).resolve().parent / "sample_data" / "users.csv"


class UsersReader:
    def __init__(self, base_dir=None, *, path=None) -> None:
        self._reader = CsvReader(path or _BUNDLED_FEED)
```

It takes `base_dir` and does not use it. That is deliberate, not a placeholder:
resolving a location is a Shared Reader's job, and this reader's answer today
happens to be "a file next to me". The day it becomes a real feed under the base
directory, or a table in a database, the answer changes here and no call site
moves. A consumer handed a *path* instead would have been told the source is a
file — the same class of leak as a table name, and the one that breaks first.

`path` is a **test and spike seam**, keyword-only so it cannot be passed by
accident. Nothing in `pipelines/` should use it.

## Adding an entry

1. **Check it is admissible** (G2 below). One consumer inside its own subject
   does not qualify.
2. **Pick the module.** One per *subject*, named for the subject that owns the
   data — `readers/<subject>.py`. Create it if it does not exist.
3. **Name the class for the question it answers**, never the table it sits on:
   `<BusinessDataset>Reader`. `CurrentCasesReader`, not `CaseCurrentReader`. The
   name has to survive `case_current` being renamed, re-grained or split, which
   is the whole reason the consumer stopped naming it.
4. **Write the class, not a factory function.** A class is a nameable type in
   signatures and tests, it carries its own docstring as its contract, and its
   internals can change without the call site changing shape.
5. **Compose, do not subclass.** `Reader` is a structural Protocol, so wrap the
   Reader the store mints and delegate `read` / `describe` / `data_locations`.
6. **Keep the location names module-private** (`_SUBJECT`, `_TABLE`). If they
   are importable, a consumer will import them and you are back where you
   started.
7. **Declare no freshness requirement.** How current the data must be is the
   consuming pipeline's call, not the reader's — see below.
8. **Test it in `tests/readers/test_<subject>.py`**: rows seeded where the
   producer puts them come back, the ports delegate, and a base directory with
   nothing in it fails the way the underlying Reader already fails rather than
   in some new way of the wrapper's own.

Then delete the consumer's constants. An entry nothing routes through has
declared nothing.

## The guardrails

They are also in `readers/__init__.py`, so they are readable from inside the
package.

**G1 — Read-only.** `readers/` mints Readers, never Writers. This is what stops
it becoming a second store facade beside `tools.store`, and it is encoded in the
package name.

**G2 — Admission, and removal.** A dataset earns an entry when it is read by a
pipeline that does not produce it, or is a feed's published contract. One
consumer inside its own subject stays local.

*Removal is a rule too, and carries equal weight.* If an entry drops back to a
single in-subject consumer — the other consumer is retired, or two subjects
merge — it **goes back** to that consumer. An indirection with one caller on
each side is a layer of misdirection charging rent: the reader still has to be
opened to find out where anything is, and the thing it was protecting against no
longer exists. Removing it is not a regression, and a reviewer should say so
when they see one stranded.

**G3 — One declaration of location.** Once a dataset is in `readers/`, a
consumer may not rebuild the path to it. No `medallion(...)` in a consumer for
data it does not own. A pipeline still resolves the subject it *writes* — that
asymmetry is the design, not an inconsistency.

**G4 — The port is the contract.** `read() -> Dataset`, `describe()`,
`data_locations`. Parametrisation happens at construction, never through a query
method: no `reader.for_case_type(...)`, no `reader.since(...)`.

**G5 — Read what was written.** See below.

**G6 — Column guarantees stay consumer-side.** The reader declares no column
contract. `reviewer_activity` keeps its own `SOURCE_COLUMNS` and
`ColumnValidator`. A single tuple on the reader would become the union of every
consumer's needs — so each consumer would be gated on columns it does not use,
and the failure message would land somewhere other than the code that actually
depends on them.

## Freshness is the consumer's call, never the reader's

A Shared Reader carries no `FreshnessRequirement`, and `readers/` imports
nothing from `framework.run`. Each consuming pipeline declares its own
`UPSTREAMS`:

```python
# pipelines/notifications/pipeline.py
UPSTREAMS = (FreshnessRequirement("sharepoint_cases"),)
```

The tempting alternative is to declare it once on the reader so two pipelines
reading the same dataset cannot disagree about how fresh it has to be. They are
entitled to disagree. `notifications` must not tell anyone anything on
yesterday's picture, so a stale Sync should stop it; a monthly aggregate would
rather publish slightly stale than not publish at all. Freshness is a statement
about **what a consumer can safely act on**, not about where the data is — and a
reader serves more than one consumer by definition, so it has no basis to
choose. A shared default is also the quiet kind of coupling this package exists
to remove: whatever suited the first consumer becomes what every later one
inherits without deciding.

## What a Shared Reader must not do (G5)

A Shared Reader over a stored table is a **pass-through**. No projection, no
coercion, no re-shaping, **no joins, no aggregation, no as-of filtering.**

The reason is that a Shared Reader has more than one consumer by definition —
that is what admitted it. Shaping inside it is therefore shaping that every
consumer inherits without asking, and *invisibly*: a consumer's own `Filter` is
a node in the DAG and a line in the run log, while the same filter pushed into
the reader is neither. Two consumers of one named reader would silently be
looking at different questions' answers.

**The one carve-out** is a reader that *already* normalises an untrustworthy
source. `UsersReader` canonicalises logins, lower-cases emails, drops rows with
neither, and refuses a duplicate `login` — because the join fans out on that
column and every extra row is a person told the same thing twice. That behaviour
moved across as it stood. It is not a licence to add shaping to a new entry: the
test is whether the source is untrustworthy in a way that every consumer must
handle identically, not whether the shaping would be convenient.

**Not decided:** whether a reader may narrow *what it fetches* —
`CurrentCasesReader(base_dir, case_ids=...)`. That is predicate pushdown rather
than business logic, and `SqliteReader` already takes `columns=[...]`; but an
as-of window is also just a predicate, and that is exactly where the line gets
hard. It needs its own session. Until then, filter in the consumer.

## Where it is not

- **Not producer-owned** (`pipelines/sharepoint_cases/readers.py`). The unit is
  the subject, not the pipeline. `pipelines/` is deliberately flat and one-way —
  the operator CLI addresses a pipeline by its path on disk and imports
  `pipelines.<name>.pipeline` — and cross-pipeline reader imports would make it
  a dependency graph. Decisively, `users` has no pipeline package to live in.
- **Not `case_review/`.** The `users` directory is org-wide Reference Data
  covering every login, not case-review vocabulary.
- **Not `shared/`**, which holds declarations without operational behaviour, and
  **not `tools/`**, which holds no domain knowledge.

`readers/` is application code and speaks business nouns freely; nothing here
enters `framework/`, which keeps knowing only `Reader`, `Writer` and `Dataset`
([ADR-0013](adr/0013-keep-the-framework-domain-free.md)). It imports through the
same four facades every other application tree does, and
`tests/integration/test_public_api.py` holds it there
([public-api.md](public-api.md)).

## Related

- [ADR-0026](adr/0026-shared-readers-declare-cross-subject-reads.md) — why the
  decision was taken.
- [core-primitives.md](core-primitives.md) — the `Reader` port, `Store` /
  `StoreRegistry`, and the medallion profile a Shared Reader usually sits on.
- [adding-a-feed.md](adding-a-feed.md) — the producing side: scaffolding a feed
  that *writes* through its own medallion.
- [escape-hatch-store.md](escape-hatch-store.md) — the other reason to reach
  outside the medallion, and why it is debt while this is not.
