# Reviewing a pull request

What a review of a change to this repository should cover. The suite already
holds most of what can be held mechanically — the public-API boundary, migration
coverage, the frontend column contract, ~1600 tests — so this is deliberately
about the things a test cannot ask, and about the handful of places where a
change is *silently* incomplete rather than broken.

Read it as prompts, not a form to fill in. Most changes touch three or four of
these; a review that says "nothing here applies" about all of them is reviewing
a change that probably did not need one.

## Start with the shape of the change

- **Does the diff match the ticket?** Scope quietly widened, or quietly
  narrowed, is the most common thing worth saying. Narrowing especially: the
  parts left out have to be *said*, not just absent.
- **Is this the right layer?** `framework/` is the reusable engine, `tools/` the
  cross-cutting siblings, `case_review/` the application, `pipelines/` the
  scripts. The framework must not import `tools`; a fact both sides need lives in
  `framework/_internal/` and is imported *upward*
  ([public-api.md](public-api.md)).
- **Does application code reach behind a facade?** `pipelines/` and
  `case_review/` import through `framework.core` / `framework.io` /
  `framework.transform` / `framework.run`, never the modules behind them.
  `tests/integration/test_public_api.py` enforces this — if you find yourself
  wanting to relax it, that is a design conversation, not a review comment.

## Data changes, from both sides

**New data on the Case Review Platform is assumed to need a pipeline change.**
This is the rule most likely to be broken silently, because adding a column
downstream of nothing breaks nothing: the feed keeps polling what it polled, the
reports keep reporting what they reported, and nobody finds out until somebody
asks where the new field went.

- A new `Cases-{slug}` column, or a new field inside one of the JSON blobs, has
  to be considered for the pipelines. Deciding it does not need to flow through
  is the rare case, and it must be **recorded with a reason** — "not considered"
  and "considered and declined" are indistinguishable afterwards unless one of
  them was written down.
- Consider it from **both** sides of the model: the frontend's column schema in
  [`platform_frontend/docs/case-type-onboarding.md`](../platform_frontend/docs/case-type-onboarding.md)
  *and* this project's declared row schemas. The two projects keep separate
  glossaries and **neither is authoritative for the other** — a term that matches
  by spelling may not match by meaning.
- **Nothing checks this.** A test comparing the documented column list against
  `RAW_FEED_COLUMNS` was built and rejected: it coupled the suite to a document
  that may move out of the repository, and could not see inside the JSON blobs
  where a good share of new fields appear
  ([#730](https://github.com/nickwarters/data-pipeline-tooling/issues/730)). So
  this one is on the reviewer — which is the whole reason it is written here.

## A change to a deployed table's shape

The dataclass says what a row **means**; the numbered SQL under
`migrations/<subject>/<database>/` says what the table **is**
([ADR-0025](adr/0025-sql-migrations-own-the-physical-table-shape.md),
[migrations.md](migrations.md)).

The single most important thing to check on a change touching either:

- **Did a field change on a dataclass without a migration beside it?** Adding,
  removing or retyping a field in a declared row schema is a change to a table
  that already exists in a real environment. It needs a **new numbered
  migration** in the same PR. Editing the baseline is not an option — the runner
  records each file's checksum and refuses one that changed after it was
  applied — so the fix after the fact is more expensive than the review comment.
- **The reverse, too:** a migration that adds a column no dataclass declares.
  Sometimes right (the framework's own stamped columns are not any feed's), often
  a half-finished change.
- **Do the types agree in the way SQLite actually cares about?** Compare storage
  *affinity*, not the type name. SQLite has no date or boolean type: `DATE` and
  `TIMESTAMP` are one physical column (both NUMERIC), `TEXT` and `INTEGER` are
  genuinely two. A declared `date` lands as `DATE` where the frame carries
  `datetime.date` objects and as `TIMESTAMP` where `SchemaCoercion` has cast it
  to `datetime64` — the same declaration, two names, one column. Do not ask for a
  change over that.
- **Is a gold rebuild's column set changing?** That is a migration too. So is a
  quarantine reject table's.
- **Is a new feed heading for a real environment?** Nothing checks that a
  deployed subject has a `migrations/<subject>/` directory — a feed without one
  does not fail, it quietly keeps creating its tables. `scaffold` renders the
  baselines for a feed it generates, so this is really a question about anything
  it did not generate. Tracked as
  [#729](https://github.com/nickwarters/data-pipeline-tooling/issues/729).
- **Is the migration in its own numbered file, applied in its own transaction?**
  Production is a UNC share under the rollback journal, where a writer's lock is
  exclusive.

## Tests

- **Was the guard verified negatively?** A new test that passes on the first run
  has proved nothing yet. Break the thing it guards — delete the baseline, retype
  the column, add the doc row — and check it fails, and that the message names
  what went wrong. Say so in the PR description; a reviewer cannot see it
  otherwise.
- **Does an assertion infer something from an absence?** "The table does not
  exist", "the directory was not created", "the row is missing". These are the
  assertions that rot: they hold for a reason unrelated to what the test is
  about, and go quiet when that reason changes. Under migration control, every
  table exists before the run, so a whole class of them stopped meaning anything
  at once. Prefer the positive form — ask the run's own record, or assert the
  table is *empty*.
- **Is a test in the right tree?** `tests/` mirrors the source shape; anything
  spanning trees goes in `tests/integration/`. Every test directory is a package
  (`__init__.py`) so module paths stay unique under pytest's default import
  mode — a missing one is a basename collision waiting to happen.
- **Does a new test build the databases it writes?** A feed under migration
  control tested against a bare `tmp_path` exercises the branch production no
  longer takes ([testing-helpers.md](testing-helpers.md)).

## Cross-platform

Windows is the deployment target; macOS is where it is developed. Both, always.

- No hardcoded path separators, drive letters or POSIX assumptions — `pathlib`
  throughout.
- No shelling out to a platform-specific command without a fallback.
- Line endings (CRLF vs LF), case-sensitivity and file-locking semantics all
  differ. A checksum, a sort order or a filename comparison that disagrees across
  the two is a real bug that will only ever reproduce on one machine.

## Documentation

**Stale docs are a defect in the change, not a follow-up.** A change is not done
until the affected documentation reflects it:

- the relevant per-slice doc under `docs/`;
- [`docs/README.md`](README.md), if the surface changed;
- [`CONTEXT.md`](../CONTEXT.md), if a term changed or a new one appeared;
- any ADR the change touches — and a new ADR if the change *is* a decision;
- the per-project docs stay with their project. The frontend's live under
  `platform_frontend/docs/`, the Forwarder's under `forwarder/`.

## Before approving

- Did the pre-commit gate actually run? `ruff check` / `ruff format` / the root
  `pytest` hook are what the commit passes through; a green PR whose author
  skipped hooks is not the same thing.
- Are the commit messages worth reading in a year? The *why*, not the what — the
  diff already says the what.
- Anything you decided not to do, or did differently from the ticket, is worth a
  sentence in the PR description. It is the only place a reviewer can see the
  road not taken.
