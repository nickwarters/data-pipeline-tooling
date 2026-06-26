---
status: accepted
---

# SAS sources via remote execution, read locally

SAS is never executed on the machine running the framework: SAS does not run on
macOS (a development environment here), and the cross-platform constraint forbids a
Windows-only path with no fallback. Instead a self-contained `SasReader` is
configured with three knobs — `script`, `copy_glob`, `dest` — and internally (1)
runs the script on a remote SAS host, (2) copies the matching output files (glob)
back to a local landing `dest`, and (3) reads the landed files via the ordinary
file read path.

The remote exec and transfer sit behind a small **`RemoteRunner`** seam
(`run_script` + `fetch`). The default implementation is a `StubbedRemoteRunner`
that no-ops the exec and assumes the output files are already landed, so a SAS
feed is testable end-to-end against local fixtures with no SAS and no network. A
shell `ssh`/`scp` runner (and later a library such as paramiko) is the same seam's
richer adapter (ADR-0011).

## Why

- **Cross-platform read path.** Reading the copied output files works identically on
  Windows and macOS; only the remote box needs SAS.
- **Testability.** With remote exec behind a stubbable seam and outputs landed as
  files, the whole feed is tested against local fixture files.
- **Fits the migration goal.** SAS business logic migrates into Python transforms
  over time; this reads SAS *output* rather than depending on SAS as a permanent
  engine.

## Consequences

- Shelling to `ssh`/`scp` depends on those binaries: fine on macOS; on Windows they
  come from the OpenSSH optional feature (present on Win10+, sometimes disabled).
  The `RemoteRunner` seam keeps the transport swappable for a library if portability
  bites.
- The remote-exec/transfer logic is SAS-specific and not reused by other feed types
  — a deliberate simplicity trade-off over generic remote components. The same seam
  shape serves the SharePoint reader/writer, which is the outbound dual.
</content>
