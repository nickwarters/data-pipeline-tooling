---
status: accepted
---

# One Sync subject (`cora_cases`) for every Case Type, keyed by `(case_type, source_item_id)`

The **Sync** store is **one medallion subject**, `cora_cases`, holding every
Case Type's Cases and Detail Tables in shared tables discriminated by a
`case_type` column — not one subject per Case Type list.

A Case's identity contract follows from that: the `case_id` namespace is the
subject name `cora_cases`, and the natural key is
`("case_type", "source_item_id")` — the Case Type **slug** plus the SharePoint
list item id.

The contract is declared as **module-level constants in the feed's
`schema.py`** (`NAMESPACE` / `NATURAL_KEY`), which every builder imports. There
is no `CaseType` object in this feed.

## Why

**One subject:**

- **The lists cannot diverge in shape.** Every Case list is provisioned from one
  template as `Cases-{PascalSlug}` (`platform_frontend/scripts/scaffold_case_type.py`),
  and the frontend reads them all through a single shared `CaseRow` typedef
  (`platform_frontend/src/sharepoint-client.js`). There is no per-Case-Type
  column set to keep apart.
- **Per-Case-Type variation is already rows, not columns.** Everything that
  differs between Case Types lives *inside* the blobs, and every one of those is
  key/value shaped — Case Details "live in the `CaseRow.details` JSON blob keyed
  by `key`", Issue Capture is groups of keyed `fields`, General Questions are
  keyed by catalogue key. The normalised tables absorb a new Case Type as
  **rows**. Onboarding one is zero schema change, which is the strongest
  evidence the grain is right.
- **Splitting would make every cross-Case-Type question expensive, forever.**
  ADR-0001 puts one SQLite database per subject, so per-Case-Type subjects turn
  "count failed answers across all Case Types" into an `ATTACH` or a Python-side
  union permanently. The reverse is cheap: a per-Case-Type view of one subject
  is `WHERE case_type = ...`.
- **Silver is Case-Type-agnostic by design.** Per-Case-Type typed pivots of
  capture and details are **Reporting** work over this gold, not Sync work.

**That key:**

- **One subject forces the namespace.** With several lists in one subject the
  namespace can no longer be the list name — two lists would mint keys in it and
  two Cases sharing an item id would collide. So the namespace becomes the
  subject and the Case Type discriminator moves *into* the key.
- **The item id is stable and always present.** The Case Reference (`Title`) can
  be absent, and its per-list uniqueness is an unconfirmed assumption in the
  frontend's own CONTEXT.md — it cannot carry identity.

## Considered options

- **One subject per Case Type list.** Blast-radius isolation per Case Type, and
  the granularity ADR-0001 already uses for Ingest. Rejected: it buys isolation
  nobody has asked for at the price of every cross-type query, for lists that
  are provisioned identically.
- **Namespace = list name, natural key = `source_item_id`** — what
  `pipelines/sharepoint_cases` ships today. Correct while exactly one list
  exists, and it fails quietly at the second. **Superseded by this ADR.**
- **`Title` (the Case Reference) as the natural key.** Rejected: nullable, and
  its uniqueness is unconfirmed.
- **The SharePoint list GUID as the namespace.** Rejected: it is still the
  `UUID(int=0)` placeholder, so keying on it would silently re-key every Case
  the day the real one lands.
- **A `CaseType` object carrying the contract** (as ADR-0009 describes for
  Ingest). Rejected here: `CaseType` is case-review business vocabulary being
  retired, and the requirement it serves — *one* declaration both the Case
  builder and every Detail builder read, so `case_id` derives identically with
  no cross-pipeline join — is met structurally by two module constants. The
  ADR-0009 property is preserved; the wrapper is not.

## Consequences

- **`cora_cases` and the Case Type slugs are a stable contract.** Renaming the
  subject re-keys everything; renaming a slug re-keys that Case Type's history.
  This is the same accepted shortfall ADR-0009 records, attached to different
  strings, and we again do not engineer a pinned-namespace escape hatch.
- **This re-keys the existing `sharepoint_cases` gold, and that is free exactly
  once.** Nothing has run in production, no downstream has persisted a
  `case_id`, and gold is `Refresh()` — so gold rebuilds from silver under the
  new key at no cost. That window closes at the first production run.
- **A field genuinely needed by only one Case Type becomes a nullable column on
  the shared table**, not a new subject. Splitting the store to avoid one null
  would cost every cross-Case-Type query.
- **All Case Types write one set of files.** Single-writer contention is shared
  rather than isolated per Case Type — a non-issue at this scale (10k Cases,
  ~500k answer rows, one daily poll), and the thing to revisit first if the poll
  ever goes concurrent.
- **`case_type` is a column on every table** in the subject, silver and gold,
  and part of the Case's natural key — so it is `NonNull` everywhere and is not
  a derived convenience column that can be dropped later.
- **The store-topology question CONTEXT.md parked** ("revisit the physical
  topology when Sync/Reporting are built") is answered for Sync. Reporting is
  still open.
</content>
