# 59. Answers store the response id, not its wording

Date: 2026-10-18

## Status

Accepted. Raised by the owner in the project thread: an Answer captured the
response's wording rather than its id, so changing the wording misaligned the
data the pipelines process for reporting, while the Case's own Outcome snapshot
already stored the Outcome id.

Amends [ADR-0021](./0021-versioned-question-bank-snapshots-for-completed-cases.md)
only in what a published version's `outcome` questions list as their `options`;
the freeze it describes is unchanged.

## Context

An `outcome` question answers in the Case Type's Outcome vocabulary. Each
Outcome has an `id`, a `wording` and a `severity`, and the Question Bank editor
lets a Case Type Owner change the wording without changing the id. The id is
what the rest of the system treats as the Outcome: `outcomeAtCompletion`,
`effectiveOutcome` and an Amended Outcome all store it.

The compiled bank derived an `outcome` question's options from the vocabulary's
**wordings** (`options: ["Good", "Poor", …]`, `optionOutcomes: { "Good": "good", … }`),
and the Review tab wrote the chosen option straight into `Answer.value`. So an
Answer recorded `"Poor"`, not `poor`. Rewording `Poor` to `Below standard` and
republishing then did three things silently:

- every In-progress Answer holding `"Poor"` stopped matching any option — it
  rendered unselected, stopped failing, and stopped scoring the Outcome;
- a `showWhen` comparing against `"Poor"` could never be true again; and
- the data the pipelines land held two spellings of one response either side of
  the change, which no report can group without knowing the history.

## Decision

1. **An `outcome` question's options are the Outcome ids.** The compiled bank
   lists `options: ["good", "poor", …]` and maps each to itself in
   `optionOutcomes`. `Answer.value` therefore holds the id. `showWhen` values
   comparing against an `outcome` question name ids too, and the verify gate
   already refuses one that names anything else.
2. **The wording is derived where a catalogue is materialised, never stored on
   the question.** `withResponseLabels` stamps `optionLabels` (id → wording) from
   the Outcome vocabulary the catalogue was published with — the live bank's, or
   a frozen Case's versioned export's — exactly as `failureValues` is stamped.
   Every place a response is shown reads it through `responseLabel`. Rewording an
   Outcome changes what a Reviewer reads and nothing that was recorded.
3. **Other response types are unchanged.** A `yes-no-na`, `single-choice` or
   `multi-choice` option has no id separate from its text, so its text is its id.
   Editing one is a different response, which is what it always was.
4. **Answers recorded as wordings are upgraded on load, not backfilled.**
   `withResponseIds` reads a stored value that is not one of the question's
   options, but is the wording of an Outcome whose id is, as that id. It is
   judged against the question's own options, so a Case frozen against a version
   published before this change — whose options are still the wordings — keeps
   the wordings it was reviewed with and stays consistent with the version it
   resolves. The upgrade is in memory and reaches the row with the next write of
   the Answers. Completion carries the Answers in its PATCH when they differ from
   the loaded row, so a Case completed without another edit cannot freeze a
   wording against a version that lists ids.
5. **The Complaints bank is republished** as a new version with id options. The
   three earlier published versions are immutable and keep their wording options.

## Consequences

- An Outcome can be reworded freely. Its **id** is now the thing that must not
  change once Cases have answered with it — which was already true of the Case
  snapshot columns. Renaming an id in the bank editor rewrites the bank's own
  `optionOutcomes` and default but not recorded Answers, and the verify gate
  fails on any `showWhen` still naming the old id.
- No SharePoint data is rewritten. Completed Cases keep the wording their
  version maps; In-progress Cases converge on ids as they are worked.
- Reporting groups on the Outcome id, not the raw value: `optionOutcomes[value]`
  from the export a Case resolves against gives the id for both kinds of version.
  `reporting-data-contract.md` says so. The `sharepoint_cases` feed lands `value`
  verbatim and interprets nothing, so it needs no change; the bank-aware
  answer-outcome aggregate it defers is where that translation belongs.
- The bank editor's simulator reads a sampled historical Case's wordings through
  the published bank's vocabulary, so a draft that only rewords an Outcome
  reports no impact, which is now the truth.
