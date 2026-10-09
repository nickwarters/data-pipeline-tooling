---
status: accepted
---

# A Shared Reader may narrow the columns it fetches

A table-backed Shared Reader takes an optional, keyword-only `columns` at
construction:

```python
CaseObservationHistoryReader(base_dir, columns=HISTORY_READ)
```

Omitted, it reads every column, as before. Named, it reads only those columns,
in that order, pushed into the `SELECT` by the `SqliteReader` underneath. A named
column the table lacks fails the read with a `ValidationError` naming every one
missing, the same error a `ColumnValidator` over the whole table would raise.

This settles the **column** half of what
[ADR-0026](0026-shared-readers-declare-cross-subject-reads.md) left open, and
amends its G5 ("no projection"). The **row** half, a reader narrowing which rows
it fetches (`CurrentCasesReader(base_dir, case_ids=...)`), is still not decided.

## Why

- **The history is too wide to load whole.** `cora_platform_metric` reads the
  Sync subject's observation history, about ten rows per Case, and every row
  carries the landed JSON blobs (`answers`, `conversation`, `appeals`,
  `details`) that no metric reads. On 100k observations with realistic blobs,
  the full read took 6.6s and held 914MB; narrowed to the 14 columns the metrics
  use, it took 1.1s and held 87MB. Scaled to the 2M observations of a
  200k-Case history, that is roughly 18GB against 1.7GB, and a source too big
  for memory is narrowed at the source
  ([ADR-0028](0028-a-source-too-big-for-memory-is-narrowed-at-the-source.md)).
- **It keeps what G5 protects.** G5 forbids shaping in a reader because every
  consumer inherits it, invisibly. A column list is chosen by **one** consumer at
  construction and returns the same values for the columns it names, so no
  other consumer is affected and no answer changes. It is also visible: it is
  written in the consumer's own code, and the reader's `describe()` names the
  columns it reads.
- **Everything by default suits exploration.** A new consumer starts with the
  whole table, finds what it needs, then narrows to it. Nothing has to be
  declared up front.

## Consequences

- **G6 still holds.** The reader declares no column contract of its own; the
  list is the consumer's, usually the union of the gates its steps already
  apply.
- **A missing column now fails at the read, not the step.** A consumer that
  narrows loses the per-step isolation where a missing column failed only the
  table that needed it. `cora_platform_metric` accepts that: its sources are the
  Sync subject's migrated tables, so a missing column is a deployment fault, and
  failing before any table is written is the clearer report.
- **Readers that are not a table pass-through do not take it.** `UsersReader`
  already reads a fixed column set and normalises it (the G5 carve-out), and
  the Question Bank store reads files, not tables.
- **`Store.reader(table, columns=None)`** carries the list to the `SqliteReader`,
  which already supported it.
