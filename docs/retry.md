# Targeted retry at the I/O edges

Some failures are worth one more attempt; most are not. A remote source that is
briefly unavailable, a SharePoint/SAS fetch that drops, a SQLite
`database is locked` under a busy share — these are **transient edge failures**:
nothing is wrong with the data or the configuration, the I/O just needs another
go. A schema-validation breach or a missing-file/configuration error is the
opposite: retrying it only delays the inevitable abort and hides the real fault.

`framework.shared.retry` keeps that distinction explicit and **scoped to the I/O edge**.
It is deliberately *not* a blanket wrapper around a whole run — validation and
business rules are never retried, because retry lives at the `read()` / `write()`
seam, and those checks live in the pipeline's stages, not the seam.

## The pieces

Import through the `framework.io` facade (see [public-api.md](public-api.md)):

```python
from framework.io import RetryPolicy, RetryingReader, RetryingWriter
```

### `RetryPolicy` — what counts as transient

A `RetryPolicy` encodes the retry decision as an **allowlist** of exception
types:

```python
import sqlite3

policy = RetryPolicy(
    attempts=3,                              # total tries (1 = no retry)
    retry_on=(sqlite3.OperationalError, ConnectionError),
    backoff_seconds=0.5,                     # waited between attempts
)
```

- `retry_on` is the **only** thing retried. An exception that is *not* an
  instance of one of these types propagates immediately on the first failure —
  so `ValidationError`, `FileNotFoundError`, and other configuration errors are
  never retried.
- `attempts` bounds the tries; after the last one the transient error is
  re-raised, so an edge that stays down still aborts the run (fail-fast,
  [ADR-0007](adr/0007-fail-fast-atomic-runs-jsonl-observability.md)).
- `backoff_seconds` is slept between attempts through an injectable `sleep`,
  keeping the wait cross-platform and tests fast.

The default `retry_on=()` retries **nothing** — opting in is explicit.

### `RetryingReader` / `RetryingWriter` — applying it at the edge

Decorate the reader or writer you want to make resilient; everything else stays
the same:

```python
from framework.io import CsvReader, SqliteTruncateReloadWriter, Refresh
from framework.run import Pipeline

reader = RetryingReader(SasReader(...), policy)
writer = RetryingWriter(SqliteTruncateReloadWriter(db, "cases"), policy)

Pipeline("cases", reader).write_to(writer).run()
```

Only the wrapped `read()` / `write()` is retried. The decorators are ordinary
`Reader` / `Writer`s, so they compose anywhere a reader/writer is expected.

### Remote clients

`RetryPolicy` is a standalone collaborator: a remote client (a SharePoint or SAS
fetch) can call through it directly, without a reader/writer wrapper, and get the
same transient-only semantics:

```python
rows = policy.call(lambda: client.fetch(site, list_name, auth))
```

## What the run log records

A retried attempt is recorded on the **same** `read` / `write` step record that
already carries the step's final outcome. Each retry adds a note to that record's
`warn_hits` (and is logged to the console as it happens); the step's `status`
stays `ok` if a retry recovered, or becomes `error` if every attempt failed. No
new run-log fields — see [run-log-format.md](run-log-format.md).

## Where to use it — and where not to

| Use retry | Don't use retry |
|-----------|-----------------|
| Remote source/sink access (SAS, SharePoint) | Schema validation breaches |
| SQLite `database is locked` / busy timeouts on a shared store | Configuration errors (missing file, bad path, wrong column set) |
| Transient network blips at a reader/writer edge | Business-rule failures / quarantine decisions |

The rule of thumb: retry only an exception that a **second identical attempt
could plausibly resolve on its own**. If the input or configuration must change
for the next attempt to succeed, it is not transient — leave it off the
allowlist so the run fails fast and loud.
