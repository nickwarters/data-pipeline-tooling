# Data dictionary template (for Confluence)

Every **table and Feed** the framework ingests must carry a **data dictionary**
entry — a human-readable description of what the table is and what each field
means. The Python schema (`schema.py`) is the machine-enforced contract (columns,
dtypes, nullability, value rules); the data dictionary is its **prose companion**,
the thing a reviewer, analyst, or new joiner reads to understand *what a column
represents*, not just what type it is.

This page is the **template** to copy when documenting a new Feed or table. It is
designed to be pasted straight into Confluence: the two blocks below are plain
Markdown tables, which Confluence Cloud converts to native tables on paste (or
via **`/Markdown`** → *Insert Markdown*). Keep this template and the Python
schema in lock-step — a new column in `schema.py` is not "done" until it has a
row here ([CLAUDE.md](../CLAUDE.md): "keep the docs in sync with every change").

> **Where these entries live.** The canonical store is **Confluence** — one page
> per Feed/table under the data-dictionary space, named for the table (e.g.
> *Data Dictionary — claims (silver)*). This file is the source-of-truth
> *template* checked into the repo so the shape stays versioned; the filled-in
> entries live in Confluence so non-engineers can read and edit them.

---

## How a dictionary entry maps to the framework

A dictionary entry describes **one table at one layer** (raw, silver, or gold),
because the columns differ by layer — raw carries the source's own column names
(spaces, punctuation, and all); silver and gold carry the schema's canonical
identifier-named shape. The fields therefore line up with the things the
framework already declares, so most of an entry can be lifted from the code:

| Dictionary column | Comes from |
|-------------------|------------|
| **Field** | the `schema.py` dataclass field name (the silver/gold column) |
| **Source column** | the raw feed's column (the `RENAME`/`RAW_FEED_COLUMNS` source side); same as Field when the source name is already a clean identifier |
| **Type** | the field's annotation — one of `str` / `int` / `float` / `bool` / `date` / `datetime` ([schema-enforcement.md](schema-enforcement.md)) |
| **Nullable** | `Nullable()` → *Yes*, `NonNull()` → *No* (plain fields default to nullable) |
| **Value rules** | the field's `Annotated[...]` rules — `Pattern` / `Length` / `Range` / `Unique` / `OneOf` |
| **Row checks** | the `@row_checks(...)` decorator's cross-field `RowCheck`s |
| **Identity** | whether the field is part of the Case Type's `natural_key` (and so feeds the deterministic `case_id`, ADR-0009) |

What the framework **cannot** capture, and the dictionary therefore must, is the
**meaning**: the *Description*, a representative *Example*, the data's
*Sensitivity/PII* class, and any business *Notes* (provenance, gotchas, known
quality issues). Those are the columns that earn the page.

---

## Template — copy everything from here into a new Confluence page

> Replace every `<…>` placeholder. Delete the guidance italics once filled in.
> Duplicate **Part B** per layer if you document raw *and* silver on one page.

### `<table name>` — `<raw | silver | gold>` layer

*One-paragraph summary: what this table is, what one row represents, and who
consumes it. Name the medallion layer and the subject it belongs to.*

#### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `<table>` |
| **Subject / Case Type** | `<subject>` *(the medallion dir + table name)* |
| **Medallion layer** | `<raw \| silver \| gold>` |
| **Grain** | *one row per `<…>` (e.g. "one row per Case", "one product line per Case")* |
| **Is this a Case Type?** | `<Yes — yields Cases \| No — Reference Data / Detail Table / staging>` |
| **Natural key → `case_id`** | `<natural_key column(s), or "n/a">` *(ADR-0009)* |
| **Source system** | `<e.g. Claims SAS export, Advisers SharePoint list, internal CSV>` |
| **Reader** | `<CsvReader \| ExcelReader \| SqliteReader \| GlobCsvReader \| SasReader \| SharePointReader>` |
| **Load strategy** | `<Refresh() \| AccumulateByRun(...)>` *(who owns history at this layer)* |
| **Upstream dependencies** | `<UPSTREAMS feeds/tables this one needs fresh, or "none — source feed">` |
| **Schedule / freshness** | `<e.g. daily by 07:00; freshness window 1 working day>` |
| **Owner / data steward** | `<name / team>` |
| **Source of truth doc** | `<link to the source system's own spec, if any>` |
| **Last reviewed** | `<YYYY-MM-DD>` |

#### Part B — Field dictionary

| Field | Source column | Type | Nullable | Value rules | Description | Example | Sensitivity | Notes |
|-------|---------------|------|----------|-------------|-------------|---------|-------------|-------|
| `<case_ref>` | `<Case Number>` | `str` | No | `Pattern(\d{9,10})`, `Unique` | *<what this field represents in business terms>* | `1234567890` | *<None / Internal / PII / Special category>* | *<provenance, gotchas, quality notes>* |
| `<amount>` | `<Amount>` | `int` | Yes | `Range(0, …)` | *<…>* | `500` | None | *<currency? minor units?>* |
| `<…>` | `<…>` | `<…>` | `<…>` | `<…>` | *<…>* | `<…>` | `<…>` | *<…>* |

#### Part C — Row checks (cross-field rules)

*Relationships the schema enforces between a row's fields (`@row_checks`). Omit
the section if the table has none.*

| Check | Fields | Rule (in words) |
|-------|--------|-----------------|
| `<opened_before_closed>` | `opened`, `closed` | *opened date must not be after closed date* |

#### Part D — Quarantine & data quality

*How invalid rows are handled and any known quality caveats. The silver hop
partitions value-rule / row-check rejects into a quarantine table rather than
aborting the run (`SchemaValueRulePartitioner`); note here which fields most
commonly send a row to quarantine, and where the quarantine table lands.*

- *<e.g. rows with a missing `case_ref` are quarantined; ~2% of a typical export>*

---

## Worked example — a filled-in entry

A realistic `claims` Case Type at the **silver** layer, to show the template in
use. (Its `schema.py` would declare these fields; the dictionary adds the
meaning the dataclass can't.)

### `claims` — silver layer

The validated, canonical claims table — one row per claim, the system of record
for the Claims Case Type that Selection reads through the `CasePool`. Refined
from the raw SAS export (`raw.claims`), schema-enforced at this boundary.

#### Part A — Table / Feed overview

| Attribute | Value |
|-----------|-------|
| **Table / Feed name** | `claims` |
| **Subject / Case Type** | `claims` |
| **Medallion layer** | silver |
| **Grain** | one row per claim |
| **Is this a Case Type?** | Yes — yields Cases |
| **Natural key → `case_id`** | `claim_ref` |
| **Source system** | Claims SAS export (`run_claims.sas`, daily CSV) |
| **Reader** | `CsvReader` (raw landed by `SasReader`) |
| **Load strategy** | `AccumulateByRun` (silver keeps the change-over-time record) |
| **Upstream dependencies** | `raw.claims` |
| **Schedule / freshness** | daily by 07:00; freshness window 1 working day |
| **Owner / data steward** | Claims Ops / Nick Warters |
| **Source of truth doc** | *<link to SAS export spec>* |
| **Last reviewed** | 2026-06-25 |

#### Part B — Field dictionary

| Field | Source column | Type | Nullable | Value rules | Description | Example | Sensitivity | Notes |
|-------|---------------|------|----------|-------------|-------------|---------|-------------|-------|
| `claim_ref` | `Claim Number` | `str` | No | `Pattern(\d{9,10})`, `Unique` | The claim's unique reference — the natural key from which `case_id` is derived. | `1002003004` | Internal | Source pads to 10 digits; older claims are 9. |
| `adviser` | `Adviser Name` | `str` | No | `Length(max=80)` | Name of the adviser whose work the claim concerns. | `A. Khan` | PII | Free text from source; not a stable id — join Advisers Reference Data for the canonical record. |
| `opened` | `Opened Date` | `date` | No | — | Date the claim was opened. | `2026-05-01` | None | Lands as text in raw; coerced to `date` at silver. |
| `closed` | `Closed Date` | `date` | Yes | — | Date the claim was closed; null while open. | `2026-06-10` | None | Null is meaningful (claim still open). |
| `status` | `Status` | `str` | No | `OneOf(open, closed)` | Current lifecycle state of the claim. | `open` | None | Drives the `closed_needs_a_date` row check. |
| `amount` | `Claim Amount` | `int` | Yes | `Range(0, …)` | Claimed amount in whole GBP. | `4500` | None | Whole pounds, not minor units; null where not yet assessed. |

#### Part C — Row checks (cross-field rules)

| Check | Fields | Rule (in words) |
|-------|--------|-----------------|
| `opened_before_closed` | `opened`, `closed` | A claim's opened date must not be after its closed date. |
| `closed_needs_a_date` | `status`, `closed` | A `closed` claim must carry a `closed` date. |

#### Part D — Quarantine & data quality

- Rows failing `OneOf(open, closed)` on `status` (occasional `pending` from the
  source) are routed to the silver quarantine table with `failed_rule` set, not
  dropped — re-classify upstream and re-run idempotently.
- `adviser` is free text and varies in spelling run-to-run; treat the Advisers
  Reference Data join as authoritative for the adviser's identity.

---

## Pasting into Confluence — practical notes

- **Markdown tables paste natively.** In Confluence Cloud, paste a copied
  Markdown table and it converts to a Confluence table; or type **`/Markdown`**
  and choose *Insert Markdown* to paste the whole block at once.
- **One page per table per layer.** Raw and silver describe different column
  shapes (source names vs. canonical names), so give each its own Part B — either
  separate pages or stacked sections on one page.
- **Link back to the code.** Add a Confluence link to the Feed's `schema.py` so a
  reader can jump from meaning (the dictionary) to the enforced contract (the
  dataclass). When the dataclass changes, update the matching dictionary row in
  the same change.
- **Use a Confluence label** (e.g. `data-dictionary`) on every page so the set is
  discoverable as a collection.
</content>
</invoke>
