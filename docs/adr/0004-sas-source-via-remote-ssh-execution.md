---
status: accepted
---

# SAS sources via remote SSH execution + scp, read locally

SAS is never executed on the machine running the framework (SAS doesn't run on macOS, the dev environment, and the cross-platform constraint forbids a Windows-only path with no fallback). Instead a self-contained `SasReader` is configured with three knobs — `script`, `copy_glob`, `dest` — and internally: (1) SSHes into a remote SAS box and runs the script (**stubbed/empty for now**, to be implemented later), (2) `scp`s the matching output files (glob) back to a local landing `dest`, (3) reads the landed files via the ordinary file read path. Exec/fetch/read are encapsulated in one SAS-specific component.

## Why

- **Cross-platform read path.** Reading the copied output files works identically on Windows and macOS; only the remote box needs SAS.
- **Testability.** With remote exec stubbed and outputs landed as files, the whole feed can be tested against local fixture files — no SAS, no network.
- **Fits the rewrite goal.** SAS business logic migrates into Python processors over time; this reads SAS *output* rather than depending on SAS as a permanent engine.

## Consequences

- Shelling to `ssh`/`scp` depends on those binaries: fine on macOS; on Windows they come from the OpenSSH optional feature (present on Win10+, sometimes disabled). Keep the transfer swappable for a library (e.g. `paramiko`) if portability bites.
- The remote-exec/transfer logic is SAS-specific and not reused by other feed types (a deliberate simplicity trade-off over generic remote components).
