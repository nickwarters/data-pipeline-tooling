# Case storage shape: everything on the Case row

A **Case** is one row in a per-Case-Type SharePoint list (`Cases-{CaseTypeSlug}`). The row carries:

- **Typed columns** for case-detail fields (vary per Case Type)
- **`Answers` (Note field, JSON)** — `{ "Q1": {value, justification?, remediationActions?[]}, "Q17": {...} }`
- **`Conversation` (Note field, JSON array)** — `[{author, timestamp, body},...]`
- **`Notes` (multi-line text)** — free-form reviewer notes
- **`AssignedReviewer` (User field)** — current Reviewer; reassignment history obtained from SharePoint list version history
- **`ResponsibleParty` (User field)**
- **`Status` (Choice)** — `In-progress | Completed`
- **`CompletedAt` (DateTime)** — set when `Status` transitions to `Completed`

**Question Definitions are not stored on the Case row or in a shared list.** They live in the per-Case-Type `case-types/banks/{slug}.txt` artifact stored in SharePoint and loaded by the Case Type config (ADR-0021). A reportable Case stores only the bank version hash needed to resolve its immutable as-reviewed export.

### Why one row per Case rather than a separate Answers list

Chosen for **simplicity and atomic loads**: one fetch loads the entire Case. No 500-row-per-case explosion in a shared Answers list. **Remediation Actions** nest naturally inside the Answer object inside the JSON blob.

### Trade-offs deliberately accepted

- **Trend reporting is not a free SharePoint view.** The README's "trends and problem areas" requirement now needs a separate path — either a periodic export job that parses Answer blobs into a reporting store, or in-app aggregation that fetches multiple Cases. Acceptable for now; revisit if reporting becomes heavy.
- **Every Answer save rewrites the whole `Answers` field.** At 500 answers ≈ ~100KB blob, this is fine over the wire (well under SharePoint Note field ~1MB limit) but informs the auto-save debounce strategy.
- **Concurrency must be handled explicitly.** Last-writer-wins on a JSON blob is dangerous if two tabs are open or an admin edits during a review. Mitigation: ETag-based optimistic concurrency on the Case row (see next ADR).

### Field-level PATCH semantics

The framework PATCHes individual fields (`Answers`, `Conversation`, `Notes`, `Status`) — never the whole row. Conversation messages arriving from a polling refresh therefore don't clobber an in-progress Answer save and vice versa.
