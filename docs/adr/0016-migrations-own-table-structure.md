---
status: accepted
---

# Migrations own table structure; Writers only ever write rows

Supersedes the Writer-owned-DDL position in
[ADR 0004](0004-per-feed-load-strategy-owned-by-writer.md): a load strategy is
still per-feed and Writer-owned (that decision is untouched), but *whether the
target table exists* is no longer the Writer's concern at all. After #322/#323
put a real migration runner and a truncate-not-drop `Refresh` in place, the
remaining `to_sql(if_exists="append")` call sites in `framework/io/writers.py`
were the last places a Writer could still mint a table's structure for itself,
with pandas-inferred dtypes, no primary key, and no constraint — exactly the
drift ADR 0015 exists to end. This closes that gap for the rest of the Writer
surface: `AccumulateByRunWriter`, `QuarantineWriter`, the streaming
`_AppendingChunkWriter`, and `SqliteInsertIfAbsentWriter`.

## The remaining sites become explicit, batched inserts

Every append site now goes through one shared helper (`_insert_rows`) that
issues hand-rolled `INSERT INTO ... VALUES (...), (...), ...` statements
against a table the caller has already confirmed exists — never
`frame.to_sql`. An explicit `INSERT` is structurally incapable of creating a
table, so this is not merely "don't call the creating form of `to_sql`", it is
"the call that lands rows literally cannot create one."

**Batch size is asked of the connection, not hardcoded.** SQLite caps the
number of bound placeholders one statement may carry
(`SQLITE_LIMIT_VARIABLE_NUMBER`) — 250,000 on the build this repo runs today
(3.45), but 32,766 on an older build and 999 pre-3.32. `frame.to_sql` hid this
by chunking internally; `_rows_per_statement(con, column_count)` asks
`con.getlimit(...)` for the real number and divides by the column count, so a
wide table (hundreds of columns) never trips the limit on whatever SQLite
build it happens to run against — including, plausibly, the Windows target. A
table wider than the limit *itself* has no valid batch size at all (a single
row already binds one placeholder per column, and `to_sql` could not carry it
either), so that is refused by name, quoting the build's limit and the column
count, rather than surfacing later as SQLite's context-free `too many SQL
variables`.

## The guard is a process-wide switch, not a Writer constructor argument

This is the central design decision of this step, so it is recorded here in
full rather than only in a docstring.

**The constraint.** A Writer is minted by a `LoadStrategy.writer_for(db_path,
table, ...)` and holds nothing but a database path and a table name — never an
environment (`docs/core-primitives.md`; `framework.io.strategy`'s whole point
is that `Store` resolves *location* and the strategy resolves *behaviour*,
with neither learning about environments). `framework/` must not import
`tools.environments` — that is the one-way dependency ADR 0013 draws, and
teaching a Writer what an "environment" is would cross it. `tools/store.py`
must stay a one-line delegation (`strategy.writer_for(...)`) with no new
parameter to thread through. And `framework.io.strategy`'s dispatch shape (one
class plus one export line) must not grow a `creates_table` flag or any branch
on which strategy a caller was handed.

Given all of that, there is no signature anywhere between "the environment is
resolved" and "a Writer is asked to write" that the guard can travel through
without breaking one of those constraints.

**The design.** `framework.io.writers` holds one process-wide flag
(`_require_declared_tables`, default `False`) behind two functions:
`set_require_declared_tables(value)` (a setter — called once) and
`require_declared_tables_enabled()` (the getter every guarded call site
reads). `tools.environments.base_dir_for(env, override=...)` — the one call
every entry point (a pipeline's `main()`, the operator CLI) makes to settle
which environment it is running in, before minting any Writer — calls the
setter, flipping the flag to match that environment's own
`require_declared_tables: bool` field on `_Environment`. `tools/` importing
`framework/` is the permitted direction; the reverse never happens, so
`framework.io.writers` never learns what an "environment" is — only that some
caller, somewhere, flipped a boolean.

**An explicit `--base-dir` does not opt out.** `base_dir_for` takes the
override *and* the environment name, and activates the environment either way:
`--base-dir /tmp/demo --env dev` runs under dev's guard exactly as `--env dev`
alone does. This is the whole reason activation is a named parameter of that
function rather than an incidental side effect of resolving a root — a path
says *where* a run lands, never *how strictly* it may create what it finds
missing, and every entry point here accepts both options. (An earlier draft
hung activation off `resolve_base_dir` alone, which the `--base-dir` branch
skipped entirely: dev runs driven that way — including this repo's own
documented `python -m pipelines.demo_csv_to_raw /tmp/demo` shape — silently
kept auto-creating undeclared tables.) `tools.environments.activate_environment`
exposes the activation half on its own for a caller that supplies its own root
by other means; a caller that wants to *read* an environment's flag without
activating it reads the pure query
`tools.environments.require_declared_tables(env)`, which touches nothing global.

**Why guarded, not simply always-on like `Refresh`.** #323 already made
`Refresh`/`UpsertStrategy`/`InsertOrIgnore` require their table
unconditionally, with no flag — that rollout's blast radius was three Writers
that a handful of fixtures exercise. The Writers this step covers are used far
more widely (every accumulating gold table, every quarantine table, the
streaming append path), and the risk section of #324 names the concrete
hazard directly: a table that exists in a live environment today, created long
ago by the very `to_sql` fallback this step removes, but never formally
declared or migrated. Flipping the guard everywhere at once would fail every
one of those on the next run with no warning. The guard lets `dev` (where this
repo's own tests run — see `conftest.py`'s autouse fixture, which flips the
guard on for the whole suite, so `pytest` genuinely exercises the strict path;
`tests/framework/io/test_writers/test_require_declared_tables.py` overrides it
to cover *both* states of every guarded site, so the branch prod still takes is
not the one branch nothing tests) go first, `prod` follow only after an operator has run
`python -m cli schema diff --env prod` and confirmed nothing there is relying
on being auto-created, and the `to_sql` fallback branch itself be deleted only
once no environment depends on it — three separate steps, only the first of
which ships in this change.

**Guard off (today's default outside `dev`) behaviour is unchanged from
before this step**: `frame.to_sql(table, con, if_exists="append")`, which
creates the table when it is absent, with pandas-inferred dtypes — exactly
what every one of these Writers did before #324. Guard on: the table must
already exist (`MissingTableError`, the same named error #323 introduced for
`Refresh`), and the rows land through the batched, table-creation-incapable
`_insert_rows`.

## Quarantine's shape is declared once, not per feed

`QuarantineWriter`'s target always carries the same *extra* columns regardless
of feed — `failed_rule` (the partitioner's reason) plus the run-identity stamp
`QuarantineNode` always adds (`logical_run_id`/`pipeline_run_id`/`load_date`,
unconditionally, unlike a bare `AccumulateByRun()`'s optional
`pipeline_run_id`). `tools.schema.QUARANTINE_COLUMNS` declares that constant
tuple once; `tools.schema.quarantine_table(name, row=...)` appends it to a
feed's own row schema (the same schema its `reject_writer` partitions against)
and returns the `Table` a feed's own `TABLES` includes — one line per feed,
not a repeated four-column literal. Namespace is the bare `"quarantine"`
layer, which `resolved_namespace` resolves to `<feed>/quarantine` — the same
`<subject>/quarantine.db` file `Store.quarantine_writer` already targets
(`db_path.parent / "quarantine.db"` against that feed's own `silver.db`).
`quarantine` joins `raw`/`silver`/`gold` in
`tools.migrations.scope.VALID_LAYERS`: the `subject/<subject>/<layer>/`
directory shape already fits it exactly, so this is one more recognised
value, not a new scope kind — `migrations make` and `migrate` need no other
change to produce and apply `migrations/subject/<feed>/quarantine/*.sql`
alongside a feed's other layers.

## `scaffold` emits real migrations; the hand-minted test table goes

A scaffolded feed's `schema.py` now declares `TABLES` for every table its
pipeline writes (raw/silver/gold, via `columns_of`/`text_columns` plus
`ACCUMULATE_BY_RUN_CONTEXT_COLUMNS`, and its quarantine table via
`quarantine_table`) — mirroring the pattern the three bundled `complaints_*`
feeds already used. `cli.scaffold.render()` loads that freshly-written
`schema.py` by file path (not by package import — the target root need not be
on `sys.path`) and generates the first migration for each declared table with
the same generator `migrations make` drives
(`tools.schema.generate_migration_sql`), so `python -m cli scaffold <feed>`
remains one command: `migrate` then `run` both work before a single line of
the generated code is edited, and `run` fails with the named
`MissingTableError` before `migrate` has run. This is what let the wart #323
left behind — every scaffolded feed's test hand-minting its gold table with a
hand-listed column set — go away for the generated *end-to-end* coverage
(`tests/framework/_cli/test_scaffold.py`, `tests/integration/test_scaffold_case_type.py`
now apply the scaffold's own generated migrations tree, real DDL and all,
rather than hand-minting anything). The bundled *template* files under
`cli/scaffold_templates/*/test_myfeed.py` are a narrower case: they exercise
the literal, never-scaffolded `myfeed` example directly, for which no real
`migrations/` entry exists or should exist in this repo (adding one would make
`migrate` create a phantom `myfeed` database in every real environment) — they
still hand-mint, unavoidably, but now for every layer the guard covers, not
only gold.

## Considered options

- **Thread the flag through `Store.writer`/`strategy.writer_for`.** Rejected:
  explicitly ruled out by #324's own scope (`tools/store.py` "still mints
  Readers/Writers and nothing more"; `framework/io/strategy.py`'s dispatch
  shape must stay "one class plus one export line") and it would teach both
  what an environment is.
- **An OS environment variable framework/io/writers.py reads directly**
  (`os.environ.get("PIPELINE_REQUIRE_DECLARED_TABLES")`), set by
  `tools.environments` as a side effect of the same call. Rejected in favour
  of an explicit setter function: a magic variable name shared by string
  literal between two modules is one more thing that can silently drift or
  typo, where a plain function call is checked by the import system.
- **Flip every remaining site unconditionally, like `Refresh`.** Rejected: the
  risk section above is exactly why — an environment that has never run
  `migrate` would fail its very next run with no rollout runway, and #323's
  own review called out that this step's blast radius (~46 fixtures, every
  environment) is not the same size as #323's.

## Consequences

- **`AccumulateByRunWriter` and the streaming path needed the most care.**
  `_replace_logical_run` (the whole-dataset write) and
  `AccumulateByRunWriter.writing_chunks` (the streamed session) both now check
  the table's presence *before* the delete they run to make a re-drive
  idempotent, via a shared `_ensure_table` helper: guard on, the check raises
  `MissingTableError` before a single chunk is read rather than lazily on the
  first chunk's `write` (a stream that turns out to write zero chunks would
  otherwise never touch `_AppendingChunkWriter` at all, and a missing table
  should fail the session loudly, not silently succeed at writing nothing);
  guard off, the check is exactly the old "does it exist, to decide whether
  there is anything to delete" probe, unchanged. Neither change touches when
  or how many transactions the write commits — the chunked-write contract
  (`ChunkWritable.writing_chunks()`) is otherwise untouched: chunk writers stop
  *creating*, they do not change *when* they commit.
- **`tools/schema/emit.py` now quotes every identifier it emits**
  (`framework.io.sql.quote_identifier`), not only when a name happens to need
  it. This was already latent drift — a raw `Table` seeded from a real feed
  file's header can carry column names with spaces — surfaced by scaffold now
  routinely driving migration generation for such feeds; existing committed
  migration files are unaffected (migrations are forward-only and applied
  exactly as written, never regenerated).
- **The switch is process-wide, with the costs that implies.** It is invisible
  at the call site, so a caller that mints a Writer without activating an
  environment gets the permissive default silently — deliberate for a library
  caller or a bare unit test, and closed for every real entry point by
  `base_dir_for` being the unconditional way they all settle their base dir.
  One process cannot run two environments at two strictnesses; nothing here
  does, and the orchestrator runs every scheduled pipeline under the one
  environment it was invoked with. `pytest` sets and resets it per test
  (`conftest.py`), so nothing leaks between tests; under `pytest-xdist` each
  worker is its own process, so nothing leaks between workers either. All of
  this stops mattering when the flag is deleted at the end of the rollout.
- **A missing table is still not a schema breach.** Nothing here routes
  through `SchemaValidator` or the quarantine path — `MissingTableError` stays
  an infrastructure error an operator fixes by running a command, exactly as
  #323 established.
- **The run registry and run log are unaffected**, by design:
  `tools/observability/run_registry.py`/`run_store.py` keep writing without an
  operator step, because gating them on this guard would mean a pipeline could
  not even *record* a run until someone had run `migrate` — backwards for
  observability.
- **The creation fallback (`frame.to_sql(if_exists="append")`, guard off)
  still exists**, deliberately, as the second step of a three-step rollout
  (`dev` → `prod` → delete the fallback). It is not deleted in this change; see
  the risk section for what has to be true (`schema diff --env prod` clean)
  before `prod`'s flag flips, at which point deleting the fallback becomes a
  follow-on, no-behaviour-change cleanup.
</content>
