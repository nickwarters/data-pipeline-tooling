# Targeted retry at the I/O edges

Some failures are worth one more attempt; most are not. A remote source that is
briefly unavailable, a SharePoint fetch that drops, a SQLite
`database is locked` under a busy share — these are **transient edge failures**:
nothing is wrong with the data or the configuration, the I/O just needs another
go. A schema-validation breach or a missing-file/configuration error is the
opposite: retrying it only delays the inevitable abort and hides the real fault.

`tools.retry` keeps that distinction explicit and **scoped to the I/O edge**.
It is deliberately *not* a blanket wrapper around a whole run — validation and
business rules are never retried, because retry lives at the `read()` / `write()`
seam, and those checks live in the pipeline's stages, not the seam.

## The pieces

Import from the top-level `tools.retry` package (see
[public-api.md](public-api.md)):

```python
from tools.retry import RetryPolicy, RetryingReader, RetryingWriter
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
  [fail-fast atomic runs](adr/0005-fail-fast-atomic-runs-and-observability.md)).
- `backoff_seconds` is slept between attempts through an injectable `sleep`,
  keeping the wait cross-platform and tests fast.

The default `retry_on=()` retries **nothing** — opting in is explicit.

### `RetryingReader` / `RetryingWriter` — applying it at the edge

Decorate the reader or writer you want to make resilient; everything else stays
the same:

```python
from framework.io import CsvReader, SqliteTruncateReloadWriter, Refresh
from framework.run import Pipeline
from tools.integrations.remote import SharePointReader

reader = RetryingReader(SharePointReader(site, list_name, auth), policy)
writer = RetryingWriter(SqliteTruncateReloadWriter(db, "cases"), policy)

p = Pipeline("cases")
r = p.read(reader, name="read")
p.write(writer, r, name="write")
p.run()
```

Only the wrapped `read()` / `write()` is retried. The decorators are ordinary
`Reader` / `Writer`s, so they compose anywhere a reader/writer is expected.

### Remote clients

`RetryPolicy` is a standalone collaborator: a remote client (a SharePoint
fetch) can call through it directly, without a reader/writer wrapper, and get the
same transient-only semantics:

```python
rows = policy.call(lambda: client.fetch(site, list_name, auth))
```

## What the run log records

A retried attempt is recorded on the **same** `read` / `write` step record that
already carries the step's final outcome. Each retry adds a note to that record's
`warn_hits` (and is logged to the console as it happens); the step's `status`
stays `ok` if a retry recovered, or becomes `error` if every attempt failed.

The step record also counts them: `retry_attempts` is how many attempts were
retried and `retry_wait_seconds` what they cost, each failed attempt plus the
backoff after it (the attempt that finally failed or succeeded is not a retry).
The `run` summary carries the totals for the run. This counts every
`RetryPolicy` the step ran through, a bare `policy.call(...)` included; a test
can pin the time with the policy's injectable `clock`. See
[run-log-format.md](run-log-format.md#waiting-versus-working).

`retry_wait_seconds` and `external_wait_seconds` are **not additive**. When the
retried operation is itself an external call (a `RetryingReader` over a
SharePoint reader), a failed attempt's time is counted in both: once as a retry
and once as a call that failed. Subtract `external_wait_seconds` alone from a
step's `duration` to estimate its own work.

The record field `retry_attempts` is a count. It is not the
`RetryingReader` / `RetryingWriter` attribute of the same name, which is the
list of human retry notes the step drains into `warn_hits` (a duck-typed
convention the framework reads, so it keeps its name).

## Where to use it — and where not to

| Use retry | Don't use retry |
|-----------|-----------------|
| Remote source/sink access (SharePoint) | Schema validation breaches |
| SQLite `database is locked` / busy timeouts on a shared store | Configuration errors (missing file, bad path, wrong column set) |
| Transient network blips at a reader/writer edge | Business-rule failures / quarantine decisions |

The rule of thumb: retry only an exception that a **second identical attempt
could plausibly resolve on its own**. If the input or configuration must change
for the next attempt to succeed, it is not transient — leave it off the
allowlist so the run fails fast and loud.

The retry decorators delegate `describe()` to the component they wrap, so
applying retry keeps the plan line that says where the data comes from instead
of replacing it with the decorator's own name.
