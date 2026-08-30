# Shared Readers — reading data your pipeline does not own

> **Owned by the pipeline → the medallion store.
> Not owned by the pipeline → a Shared Reader.**

A **Shared Reader** is a `Reader` over a named business dataset that crosses a
subject boundary. Its location and identity are declared **once**, in
`readers/<subject>.py`, and a consumer instantiates it with a `base_dir` and
nothing else:

```python
from readers.sharepoint_cases import CaseObservationHistoryReader, CurrentCasesReader
from readers.users import UsersReader

CurrentCasesReader(base_dir=base_dir)
CaseObservationHistoryReader(base_dir=base_dir)
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

### Backed by a layer below gold — `CaseObservationHistoryReader`

Most of `readers/sharepoint_cases.py` sits on the subject's gold. One reader
does not: `CaseObservationHistoryReader` answers "what did each Case look like
each time we saw it", and only the accumulated observation history beneath the
current state can answer that — gold has already reduced it to one row per
Case. The layer is still the module's secret: the consumer asks for the
history, the reader knows it lives in silver today. `cora_platform_metric`'s
stage-dwell and hold tables are its consumers, and they are the reason the
question crosses a subject boundary at all.

### A family rather than a name — `readers/question_banks.py`

The other three entries each name **one** dataset. A **Question Bank** is not
one: it is two-dimensional in Case Type and version — `{slug}.txt` for the
current bank, `{slug}.{version}.txt` for the immutable snapshot a completed
Case was reviewed against — and neither dimension is enumerable from this side.
A class per dataset would be a class per Case Type per publication.

So the entry is a **store**, the same shape `tools.store`'s `Store.reader(table)`
has and for the same reason:

```python
from readers.question_banks import QuestionBankStore

store = QuestionBankStore(context.base_dir)

store.qb_reader()                     # every Case Type's current bank
store.qb_reader("complaints")         # that bank's mutable head
store.qb_reader("complaints", version, current=False)   # one immutable snapshot
store.qb_versions_reader()            # every published snapshot

store.outcomes_reader()               # the same four, at the other grain
store.outcomes_reader("complaints")
store.outcomes_reader("complaints", version, current=False)
store.outcomes_versions_reader()
```

**Four Readers, along two axes that are not the same axis.** The store's
`case_type` / `version` arguments say *which artifact*; which method you call
says *which of the two things that artifact declares*, and whether you want one
Case Type or all of them:

|                               | one bank                  | every current bank | every published version      |
| ----------------------------- | ------------------------- | ------------------ | ---------------------------- |
| **questions** (~50/bank)      | `qb_reader(ct[, v, ...])` | `qb_reader()`      | `qb_versions_reader()`       |
| **outcome options** (~4/bank) | `outcomes_reader(ct, …)`  | `outcomes_reader()`| `outcomes_versions_reader()` |

The prefix is the **grain** and the arguments are the **scope**. Two of the four
methods take arguments; naming no Case Type is what asks for all of them.

#### `current` and `version` name the same thing, so they must agree

A bank exists in two kinds — a mutable head (`{slug}.txt`) and immutable
snapshots beside it (`{slug}.{version}.txt`) — and `current` and `version` are
two ways of saying which kind you want. Each is refused without the other:

| call                                        | result                                  |
| ------------------------------------------- | --------------------------------------- |
| `qb_reader()`                               | every current bank                      |
| `qb_reader("complaints")`                   | that bank's head                        |
| `qb_reader("complaints", v, current=False)` | that snapshot                           |
| `qb_reader("complaints", v)`                | **refused** — a version is not the head |
| `qb_reader("complaints", current=False)`    | **refused** — which snapshot?           |
| `qb_reader(current=False)`                  | **refused** — use `qb_versions_reader()` |
| `qb_reader(None, v, current=False)`         | **refused** — a version needs its Case Type |

The first refusal is the one that earns its keep, because it is the
contradiction a Case row walks into. `questionBankVersion` is *absent* on an
in-progress Case and *present* on a completed one, so a consumer passing it
straight through would silently read a different kind of file depending on the
row. Refusing puts that branch at the call site:

```python
version = case.get("questionBankVersion")
reader = (
    store.qb_reader(slug, version, current=False) if version
    else store.qb_reader(slug)
)
```

`current` is **keyword-only**, so `qb_reader("complaints", v, False)` is a
`TypeError` rather than a silent third positional argument. And the last
refusal holds because a version identifier is minted per Case Type and shared
with none — "every bank at version X" names nothing.

`qb_versions_reader()` stays a method of its own precisely *because*
`qb_reader(current=False)` is refused. Folding it in would mean giving that call
a third meaning on top of the two it already cannot have. It is not
`qb_history_reader` either: a bank artifact already declares a `history` — the
ordered `{version, generatedAt}` list — and a Reader named for it would
plausibly be expected to return those few metadata rows rather than every
snapshot's questions.

The grain split is the reason there are two datasets rather than one: an
artifact declares a Case Type's questions *and* the outcomes those questions'
answers map onto, and denormalising ~4 rows across ~50 would make anyone
counting outcomes de-duplicate questions first. They join on `id` — a question's
`option_outcomes` maps each answer *wording* to an outcome `id`, so the outcomes
dataset is the key side of that map, carrying the `severity` score that makes
one outcome worse than another. Both carry `default_outcome_id`, so the failure
test — *an option mapped to anything other than the default fails* — can be
applied from either end.

The four right-hand cells take **no arguments** and stack many artifacts into
one dataset. Nothing is layered on top: the rows are the same rows, concatenated
in a deterministic order (directory iteration order is the filesystem's business
and differs between Windows and macOS), and `slug` + `version` are already on
every row so nothing is added to tell the artifacts apart. Nothing is
*reconciled* either — a question `id` is unique only within its own bank, and
two Case Types asking the same thing stay two rows. **Finding none is refused**
rather than returned as an empty dataset: a deployed banks folder always has at
least one of each, so zero means a broken sync or a wrong root, and a report of
nothing looks exactly like a report of nothing that is true.

#### The versions sweep is the snapshots, not "every file"

`qb_versions_reader()` reads the `{slug}.{version}.txt` artifacts and **not**
the `{slug}.txt` heads. Those two sets are not complements by accident — the
difference is a silent double count.

A current bank declares the version it was last published as, so today
`complaints.txt` and `complaints.49fee….txt` are the *same* bank at the *same*
version under two names, carrying the same 49 questions. A sweep over every file
lands each question twice: two identical rows, each perfectly correct on its
own, and every figure grouped by version silently doubled. De-duplicating them
afterwards would be shaping (G5) and would also hide a real disagreement if the
two ever diverged.

So the line is drawn where the artifacts themselves draw it — a
`{slug}.{version}.txt` is an **immutable published snapshot**, a `{slug}.txt` is
the **mutable head** — and each sweep reads one kind. A head whose version has
no snapshot beside it is absent from the versions sweep, correctly: it has not
been published as one. Comparing the two sweeps' `version` sets is how you find
that out, and it is a consumer's comparison to make, not something either Reader
asserts.

Ordering is by `(slug, version)` — deterministic, but a version identifier is
opaque and sorts meaninglessly. A consumer wanting *chronological* order sorts
on `generated_at`, which every snapshot carries (and which the current head does
not — one more reason the two are separate reads).

Neither sweep narrows to a Case Type. `slug` is on every row, so
`qb_versions_reader()` filtered in the consumer is one Case Type's whole bank
history; pushing that predicate into the Reader is the not-decided question at
the end of this page, not something to settle in passing.

This does not bend **G4**. The store is the factory, so the Reader it hands back
is fully parametrised by the time it exists and still answers `read()` and
nothing else; what is still forbidden is a `reader.for_version(...)` on the
Reader. It is the exception rather than a second default — reach for a store
only when naming every member is impossible rather than merely tedious, because
the store's argument list is the one thing a consumer *does* have to know.

Two things about it are worth reading across to other entries:

- **The location is still the module's secret.** Today it is
  `platform_frontend/case-types/banks/` — the frontend's source tree, which is
  also its deployed tree ([ADR-0041](../platform_frontend/docs/adr/0041-deployed-bytes-are-source-bytes.md)),
  so those are the published bytes and not a copy of them. The store takes
  `base_dir` and does not use it, exactly as `UsersReader` does, so the day the
  artifacts arrive as a synced drop under the base directory or over HTTP from
  the deployed folder, no call site moves.
- **Two Readers over one file is not two declarations of location** (G3). The
  store resolves the path once; which array of the envelope a Reader is a row
  per element of is the only thing that differs between them, and it is one
  overridden method inside the module.
- **Parsing JSON into rows is not shaping** (G5). `Dataset` is a tabular
  carrier and the artifact is a document, so *something* has to render one as
  the other; the entry does it once, faithfully, rather than every consumer
  doing it differently. Names are the artifact's own, canonicalised from
  camelCase and nothing more, and `options` / `optionOutcomes` / `showWhen` /
  `labelIds` / `remediationActions` are landed as JSON text columns so they
  survive whole and survive a write to a table. An absent key stays a **gap**
  rather than becoming the string `"null"`: a question with no `showWhen` is
  unconditional, which is not the same statement as one whose rule is null. No
  failure test, no applicability evaluation, no join to a Case — those are the
  consumer's, and [the reporting data contract](../platform_frontend/docs/reporting-data-contract.md)
  specifies them.

What the *contract* says about which file to read is not this module's to
decide either: a completed Case carrying a `questionBankVersion` should be read
against that version, and the reader is given it. Passing `None` and reporting
history against today's bank is a consumer's mistake, not one the store can
catch.

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
- [reporting-data-contract.md](../platform_frontend/docs/reporting-data-contract.md)
  — the review platform's specification of the Question Bank export
  `QuestionBankStore` reads, and the failure/applicability algorithms a consumer
  applies to it.
