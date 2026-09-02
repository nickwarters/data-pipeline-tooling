---
status: accepted
---

# SAS runs outside the framework; the framework reads what landed

**SAS runs outside the framework.** A SAS job lands a file; a pipeline reads the
landed file with an ordinary `Reader`. The framework has no remote-execution
seam.

This supersedes [ADR-0012](0012-sas-sources-via-remote-execution.md), which
built a `SasReader` over a `RemoteRunner` seam — run the script on a remote SAS
host, copy the outputs back, read what landed. `SasReader`, `RemoteRunner` and
its one no-op implementation `StubbedRemoteRunner` are removed. `SasFileReader`,
the streamed read of an already-landed SAS file, went with the streaming seam in
[ADR-0028](0028-a-source-too-big-for-memory-is-narrowed-at-the-source.md).

## The decision this records

The gate was the second of two questions asked in
[#807](https://github.com/nickwarters/data-pipeline-tooling/issues/807): *should
the framework ever execute SAS remotely?* The answer recorded there on
2026-08-25, in its own words:

> No SAS execution belongs inside the framework. Fetch/execution remains
> upstream; pipelines read landed files. The SAS epic may proceed and ADR-0012
> should be retired there.

The first question — whether any feed needs a *streamed* SAS read — was answered
no in the same place, and is ADR-0028's record.

## Why

- **The arrangement already exists.** Three real feeds source from SAS:
  `complaints_a`, `complaints_b` and `complaints_c` are one SAS complaints export
  split three ways. None of them used `SasReader`. Each reads a landed CSV from
  the base directory's `landing_zone` with `CsvReader`, and says so in a comment
  ("Production lands this CSV upstream from SAS"). The decision names what was
  built, not what was planned.
- **`SasReader` had no consumer, and its seam had no implementation.** The only
  `RemoteRunner` was `StubbedRemoteRunner`, whose two methods both returned
  `None` under `# pragma: no cover`. The `ssh`/`scp` runner ADR-0012 promised —
  and the library adapter it named after that — was never written. `read()`
  therefore did nothing, then nothing, then `GlobCsvReader(dest, glob).read()`.
- **ADR-0011's own rule.** [ADR-0011](0011-progressive-enhancement-behind-seams.md)
  allows a future seam to be *named* but forbids *building past it* until a
  second real consumer exists. A seam with zero consumers, one no-op
  implementation, and a `Reader` wrapped around it is the speculative-enhancement
  failure mode that ADR was written to prevent. This decision applies that ADR;
  it does not overrule it.
- **It matches the outbound side.**
  [ADR-0018](0018-report-feeds-published-locally-delivered-outside-the-framework.md)
  publishes a Report Feed locally and leaves delivery to a process outside the
  framework; the Forwarder then took delivery out of the repository entirely.
  Inbound now agrees with outbound: **the framework's job starts and stops at
  the local file.**

## Consequences

- **The framework cannot trigger an upstream job.** Landing the file is the
  orchestrator's or the upstream team's problem, and the framework has no way
  to ask for it. Accepted deliberately. If a feed ever needs the framework to
  trigger a fetch, that is grounds to revisit this ADR — not to reintroduce a
  seam quietly.
- **Freshness is the guard, not the fetch.** With no fetch step, nothing in the
  framework can assert that the SAS job ran. What replaces that is the upstream
  freshness rule in `framework/run/freshness.py`, wrapped by the runner's
  `FreshnessGuard`: a consumer declares `UPSTREAMS` on the ingest pipelines that
  read the landed files, and refuses to run when their last successful run is
  older than the export's cadence allows. `pipelines/complaint_selection` does
  exactly this over the three complaints ingests, with slack for a weekly
  export. A file that did not arrive at all fails the ingest's read — `CsvReader`
  raises `FileNotFoundError` rather than landing an empty dataset — and the
  missing run record is what the guard then sees.
- **`GlobCsvReader` stays.** `SasReader` was its only non-test consumer, but it
  is the natural reader for a multi-part landed export (`part_*.csv`), which is
  precisely the arrangement the complaints feeds would use if their export were
  ever split. Whether it earns its keep is judged with the rest of the reader
  family, not here.
- **The SharePoint seams are untouched.** `SharePointFetcher`,
  `SharePointPusher`, their stubs, `LocalCsvFetcher`, `SharePointReader` and
  `SharePointWriter` shared a module with the SAS code but not a line of it, and
  they have real consumers. `tools/integrations/remote.py` is now SharePoint-only;
  the file keeps its name pending the separate decision on where the SharePoint
  integration lives.
- **SAS remains a name in this repository** — the name of an upstream system that
  writes a CSV. The comments in the complaints pipelines and the Case Type
  scaffold template ("Fetched by the SAS script or orchestrator") describe the
  surviving arrangement and are the clearest statement of this decision in the
  tree. ADR-0012's body is left intact as the record of what was decided at the
  time; ADR-0011's remote-execution bullet is struck through rather than deleted,
  because a seam built ahead of its consumer and later removed is the best
  illustration of the discipline that ADR preaches.
