# Problem statement

Let me describe a current multi-stage data pipeline which we'd want to port over to this new framework. Use it to determine how easy it would be to do so, any gaps in functionality required to achieve, and anything else you feel appropriate to cover. These stages are not currently in medallion architecture style. 

Stage 1: script 1 (ingest) - check a network drive location for newly received CSV files from an external source. These files represent the "latest state of the external system's cases", there is one file per day. On a Monday would receive files for the previous Friday, Saturday and Sunday. Tuesday we would received Monday's state. It is not all cases from the external system, it's only cases which were modified on the day of the file. These files have 661 columns, most of which we don't need. We parse the CSV character by character to be able to read it correctly because pandas.read_csv and stdlib CSV reader don't read it correctly. These files are added to an append only SQLite database, only for holding these files. It also exports the latest state of ALL cases from the database into an XLSX file on the network drive. The columns in this are a cut down set, renamed to the expectation of the next script.

Stage 1: script 2 (ingest) - read the XLSX file and apply column mapping, filtering and joining with a CSV file representing a user ID mapping from one system to another, to create a CSV file in the format the next script requires. 

Stage 2: script 1 (ingest) - read all files in a network drive directory, for the pattern of file output from the previous step read the data into memory, then remap all of the columns to that which the downstream database requires. The downstream database (pool.db) was created years ago to match the structure of a feed file we received at the time, which has since been demised and replaced by one system, then another. The upstream scripts repesent the first replacement (stage 1, script 2) and the latest replacement (stage 1, script 1). Each of those scripts attempted to align the "new" system to the "old". This script then applies a lot of splitting, joining, filtering logic throughout (it's a 2K line script so it's hard to cover everything), before then applying risk rules to the feed data. These risk rules could be things like "If ABC case type and XYZ features of the data, apply Z points", the rows of data will likely match multiple rules and accumulate points. Once all this is done, the feed is inserted into the pool where the status field from stage 1, script 1 is equal to "5". Finally the script runs a query over the database to get all cases which are "available for selection" - essentially all cases received in XYZ time period, re-format the data and export a dated "selection pool" XLSX file.

Stage 3: script 1 (selection) - (determine alignment with requirements) Read the selection pool file, read the check platform's synced database, read a hierarchy file. Using all this data, determine which advisers need a check and how many they need. If they have been adctive for 12 months (a month must contain at least one sale to be deemed active) then they need 8 checks, if not then calculate pro-rata for the amount of months they have been active. Next determine how many checks they have had from the synced databas data. Filter out anyone who's had the right amount, then filter out any who currently have a case in progress in the platform. Export an XLSX file of all the advisers and the amount of checks they need, have had, how many they are behind by, etc. 

Stage 3: script 2 (selection) - (determine specific extra case type) Read the output from stage 3 script 1 and stage 2 script 1, and a separate feed and determine which of these need "the extra part of the case", essentially a second type which will be added later. Output to an XLSX file.

Stage 3: script 3 (selection) - (select cases) Read the output of stage 3 script 1 and stage 2 script 1 and filter down to select 1 case per adviser which needs one. Output another XLSX file. 

Stage 3: script 4 (selection) - (merge the cases) Read the outputs of scripts 2 and 3 from stage 3 and merge them together, overwrite the output from stage 3 script 3. 

Stage 3: script 5 (selection) - (apply platform flags and upload) Read the output from stage 3, script 4 and apply row level logic to apply flags to the cases which then all get uploaded. There are about 150 different functions/flags with different combinatory logic. The actual logic within them is simple (if X == Y then True else False), but they need to be applied in a specific order due to the combinatory nature (if result of A B and C are true then X else Y). Finally, upload the cases to the platform. 

Issues we currently experience: certain fields are expected to be different types in different scripts and are read differently (str in one, int in another, float in another), there's no validation of data at any stage, scripts have a lot of unhandled exceptions, they are extremely fragile (deeply nested loops and conditions make it hard to change logic), lot's of unnecessary processing, coercing data to match an old legacy system format which is no longer in use at all, scripts share logic but apply differently, scripts do more than they should, they are are too many scripts for these stages

# Report

## Short assessment

Porting this is feasible, but it is not a straight script-by-script lift. The current pipeline is doing several concerns at once: ingest history, source normalization, legacy feed emulation, risk scoring, adviser eligibility, case selection, platform flag derivation, and upload. The new framework can absorb much of that, but the migration should be cut around domain outputs, not existing scripts.

Overall difficulty: medium-high, mostly because of business-rule complexity and source quirks, not because the framework primitives are a poor fit.

## Best target shape

1. Ingest Pipeline
   - Read external daily modified-case CSV files.
   - Land source rows append-only in raw/silver.
   - Normalize into a current CasePool in gold: one row per current Case.
   - Remove the obsolete "make it look like the old feed" layer.

2. Reference Data Ingest
   - User ID mapping.
   - Adviser hierarchy.
   - Platform sync data.
   - Any extra feed used for case-type logic.

   These should be separate Reference Data subjects with their own medallions.

3. Selection Pipeline
   - Read CasePool plus Reference Data.
   - Determine adviser check requirements.
   - Exclude advisers with enough checks or cases in progress.
   - Select cases, apply extra-case-type logic, merge selection outputs.
   - Write SelectionPool plus selection trace.

4. Deliverable / Upload Pipeline
   - Read finalized SelectionPool.
   - Apply ordered platform flags.
   - Upload to the platform or produce an outbound file.

## Good framework fit

The framework already has several pieces that directly address the current pain:

- `Schema` / `SchemaValidator` would fix the inconsistent `str` / `int` / `float` interpretation between scripts.
- `SchemaCoercion` gives one controlled place for date/bool repair instead of scattered ad hoc casting.
- `Validator` and value rules provide fail-fast checks instead of silent bad-data propagation.
- `RunLog` / `RunRegistry` gives traceable runs and downstream freshness checks.
- `Filter`, `Score`, `Sort`, `JoinWith`, `TopNPerGroup`, and `SamplePerGroup` fit much of the selection logic.
- `Selection trace` is a good match for "why was this adviser/case selected or excluded?"
- `Store` per subject fits isolating case data, hierarchy data, user mappings, platform sync data, etc.
- Python processors are a good place for rules that are too domain-specific for generic SQL.

## Main gaps

1. Custom CSV Reader

   The current `CsvReader` will not be enough if both pandas and stdlib CSV fail. The framework likely needs a dedicated `ExternalCasesCsvReader` behind the same `Reader.read() -> Dataset` port, using the existing character-by-character parser. That is a clean framework extension.

2. File discovery / incremental landing

   The framework has Readers for files, but this source is "scan a network drive for newly received files, possibly multiple per run." The framework likely needs a `DirectoryFeedReader` or domain ingest handler that:

   - finds files by naming/date pattern,
   - detects already-landed files,
   - reads files in deterministic order,
   - stamps source file/date metadata,
   - handles Monday multi-file batches.

3. History-upstream / current-gold

   This is exactly the right model for the daily modified-case files, but the docs indicate parts of this are "decided, not yet built": accumulated raw/silver plus current-only gold via `LatestPerKey`. That capability is important for this migration.

4. Case identity

   A deterministic `case_id` from a stable natural key is crucial because each daily file contains only modified cases, not all cases. Without stable identity, "latest state of all cases" remains fragile.

5. Outbound Writers

   XLSX export exists as a reader, but the framework docs currently emphasize SQLite writers. The migration will need `ExcelWriter`, likely `CsvWriter`, and eventually a platform upload writer, all behind `Writer.write(dataset)`.

6. Rule organization

   The risk rules and 150 platform flags should not become 150 anonymous lambdas chained inline. They need named, testable rule sets, probably something like:

   - `RiskRule`
   - `RuleSet`
   - `FlagRule`
   - ordered flag application processor
   - explanation/audit output for rule hits

7. Nullability / required fields

   Current schema docs say nullability is not yet covered. For this pipeline, required fields will matter. The framework will need a `Required` rule or equivalent.

8. Quarantine vs abort

   Some bad rows should probably quarantine rather than abort a whole run. The framework has quarantine concepts, but the migration should decide which failures are fatal versus row-level rejects.

## Biggest design correction

Do not port the legacy "old feed shape" as a central model. That old `pool.db` structure is now historical baggage. The clean target is:

- source-specific raw rows,
- normalized Case schema,
- explicit Reference Data joins,
- explicit SelectionPool,
- explicit Deliverable shape for the platform.

The old pool format can exist temporarily as a compatibility deliverable during migration, but it should not be the new core schema.

## Suggested migration path

1. Build the custom CSV reader and directory discovery for Stage 1 script 1.
2. Land daily modified-case files append-only with source metadata.
3. Define the canonical Case schema and deterministic `case_id`.
4. Build current CasePool gold from accumulated history.
5. Ingest user mapping, hierarchy, platform sync, and extra feed as Reference Data.
6. Port risk rules into named tested processors.
7. Port adviser requirement calculation as a Selection domain component.
8. Port selection and extra-case-type logic into one coherent Selection pipeline.
9. Port ordered platform flags into a named ordered rule processor.
10. Add outbound file/platform writers.
11. Retire intermediate XLSX/CSV handoffs once equivalent outputs are verified.

The framework is directionally well aligned. The main work is hardening the missing I/O/rule pieces and resisting a script-by-script migration that preserves the fragility the migration is intended to remove.
