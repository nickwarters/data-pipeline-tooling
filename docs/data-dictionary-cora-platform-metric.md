# Data dictionary — `cora_platform_metric`

Nineteen gold **Aggregate tables** measuring how the Case Review Platform is
operating, reduced from the Sync subject's published current state and its
observation history. They belong to the `cora_platform_metric` Reporting
subject and are rebuilt whole (`Refresh()`) on every run, so a re-run over the
same Sync snapshot produces the same numbers. Every table carries the Sync
snapshot's `as_of_utc`; no table carries a Case.

The Python contracts are
[`pipelines/cora_platform_metric/schema.py`](../pipelines/cora_platform_metric/schema.py);
the reductions are
[`pipelines/cora_platform_metric/metrics.py`](../pipelines/cora_platform_metric/metrics.py);
the wiring is
[`pipelines/cora_platform_metric/pipeline.py`](../pipelines/cora_platform_metric/pipeline.py).

## Four things to know before reading a number

**1. Three of the tables measure what the polls saw, not what happened.**
`case_stage_dwell_current`, `case_hold_current` and `case_backlog_daily` are
reduced from the Sync
subject's *observation history* — one row each time a poll saw a Case. A state a
Case entered and left between two polls (put on hold in the morning, released
before the next poll; claimed and completed inside one interval) was never
observed and is not counted. This is a known, accepted limit of polling rather
than a defect: the hold count is a floor, the dwell intervals are those
whose boundaries a poll witnessed, and a backlog day's status split is what the
polls had seen by its close. Sync polls hourly
([ADR-0023](adr/0023-sync-polls-hourly-publishes-gold-daily.md)), which bounds
what can be missed to changes reversed within an hour.

**2. Brand is a placeholder.** Every Case-counting table carries `brand`,
filled with the literal `(unknown)` for the same reason the Sync subject's own
aggregates do: no source reachable from these pipelines carries Brand yet, and
carrying the column now means the shape does not change the day a source lands.

**3. Every statistic is over what could be measured.** A mean, percentile or
maximum column is NULL where the group had nothing to summarise — a status
nobody has yet been observed leaving, an Appeal family none of whose members
are resolved. The paired count column (`interval_count`, `resolved_count`,
`late_count`) says how many measurements the statistic stands on. Days and
hours are decimal (a three-hour hold is `0.125` days), rounded to three places.

**4. A reopened Case is counted at its current state.** A Maintainer's Reopen
returns a Reportable Case to `In-progress` and clears the stamps the milestone
wrote (`reportable_at`, `completed_at`, `outcome_at_completion`,
`had_remediation`, the `effective_*` columns); what they held is kept in the
Support Log, not on the Case. Every table here reads
each Case's latest state, so a reopened Case leaves every Reportable and
Completed count until it is sent or completed again, and then counts once, on
its new date; the earlier completion is not counted a second time and not
remembered by these tables. A month already published can therefore fall when
a Case from it is reopened. The tables built from the observation history
(item 1) keep the interval the Case spent in each status, so a reopened Case
adds a second `In-progress` interval rather than rewriting the first; the spell
it spent `Completed` before the reopen is not a stage and is not published as
one. `reviewer_workload_current` ages a reopened `In-progress` Case from the
reopen, read off the same history, not from its original `assigned_at`.

## Part A — Subject overview

| Attribute | Value |
|-----------|-------|
| **Subject** | `cora_platform_metric` Reporting subject |
| **Medallion layer** | gold only |
| **Is this a Case Type?** | No — Reporting aggregates |
| **Source system** | Sync gold `case_current`, `answer`, `answer_action`, `appeal`, `conversation_message`; Sync silver `case_version` (the observation history) |
| **Readers** | `readers.sharepoint_cases.CurrentCasesReader`, `AnswersReader`, `AnswerActionsReader`, `AppealsReader`, `ConversationMessagesReader`, `CaseObservationHistoryReader` — the Shared Readers over the Sync subject ([ADR-0026](adr/0026-shared-readers-declare-cross-subject-reads.md)). This pipeline names no layer and no table for data it does not own; the physical sources above are facts about the data, not couplings in the code |
| **Load strategy** | `Refresh()`, every table |
| **Upstream dependencies** | `sharepoint_cases` Sync pipeline (`UPSTREAMS`) |
| **Schedule / freshness** | Daily, in the `case_management` set after `reviewer_activity`, with the Sync freshness check |
| **Run parameters** | `calendar` — path to a YAML working-day calendar (`holidays` + `weekend`, the same file `orchestrate --calendar` takes) for `case_sla_attainment_monthly`; omitted, weekends-only |
| **Migrations** | `migrations/cora_platform_metric/gold/` |
| **Owner / data steward** | *<team>* |
| **Last reviewed** | 2026-10-09 |

The Sync snapshot instant, `as_of_utc`, is read off `case_current` — one
literal on every row — once at the top of the run, and is what an open hold is
measured to and what every table is stamped with. Each reduction is handed that
instant, so the nineteen tables cannot disagree about which snapshot they
describe. An empty `case_current` has no snapshot to report against and fails
the run rather than publishing nineteen empty tables.

## Part B — The tables

Every table also carries `as_of_utc` (`str`, non-null, the Sync snapshot
instant) and the reserved run-provenance column every table-backed Writer
stamps. Neither is repeated below.

### `case_stage_dwell_current` — how long Cases sit in each status

Reduced from the observation history. Grain: `brand` × `case_type` × `status`.

Each Case's observations are walked in the source's `Modified` order — two
observations sharing a `Modified` are ordered by their parsed `source_version`,
as Sync's own current-state rule orders them; every change of `status` closes
an interval at that observation's `Modified` and opens the next. Where a Case's *first* observation already carries
`To-allocate` or `In-progress`, the interval starts at the source's own
`created` / `assigned_at` stamp rather than at the poll that first saw it — the
source knows when it entered the state, the poll only knows when it looked. A
Case's last interval is *open* unless its status is terminal (`Completed`,
`Void`), and a terminal status is never an interval: a reopened Case's time
`Completed` is the gap until the reopen, so leaving it closes nothing. Statistics are over closed intervals only: an open one has no length
yet, and the Sync subject's age-bucket aggregates already answer "how long has
it been waiting".

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `brand` | `str` | No | `(unknown)` — see above. |
| `case_type` | `str` | No | Case Type slug. |
| `status` | `str` | No | The open status dwelt in, as the source spells it; never `Completed` or `Void`. |
| `interval_count` | `int` | No | Closed intervals: times a Case was observed leaving this status. |
| `open_interval_count` | `int` | No | Cases whose latest observation is in this status. |
| `dwell_days_mean` / `_p50` / `_p90` / `_max` | `float` | Yes | Over the closed intervals, in decimal days; NULL when `interval_count` is 0. |

### `case_hold_current` — how often and how long Cases are held

Reduced from the observation history. Grain: `brand` × `case_type` ×
`assigned_reviewer_name`.

A hold opens at the first observation carrying `on_hold` — from the source's
`placed_on_hold_at` where it has one, else that observation's `Modified` — and
closes at the first later observation without it. A hold still open at the
Case's last observation is measured to `as_of_utc` and counted in
`open_hold_count` — unless the Case is by then `Completed` or `Void`, when the
hold ends where the Case entered that status and counts as closed. Holds are attributed to the Reviewer the Case's *latest*
observation names, so a reassigned Case's holds follow the Case.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_name` | `str` | No | The Reviewer's bare account, as the source holds it; `(unassigned)` where the latest observation names nobody. |
| `case_count` | `int` | No | Cases with at least one observed hold. |
| `hold_count` | `int` | No | Observed holds (a Case held twice counts twice). |
| `open_hold_count` | `int` | No | Holds still open at `as_of_utc` on a Case that is itself still open. |
| `held_days_total` | `float` | No | Sum of hold lengths, open ones to `as_of_utc`. |
| `held_days_mean` | `float` | No | `held_days_total / hold_count`. |

### `case_sla_attainment_monthly` — completed Cases against their SLA

Reduced from `case_current` over `status = Completed` with a `completed_at`.
Grain: `sla_kind` × `completed_month` × `brand` × `case_type` ×
`assigned_reviewer_manager_name`.

Two row families. `review` judges `completed_at` against `due_date`.
`remediation` judges it against `remediation_due_date`, over only the Cases
that carry one: the source stamps no remediation-complete instant of its own,
and the Case's final `Completed` transition comes after its Actions close, so
the completion instant is the one available proxy. Lateness is counted in
**working days**: the working days after the due date's **local** date up to and
including the completion's, on the calendar the run was given. A Case is late
when that count is above zero, so a completion whose lateness falls only on
non-working days — the Saturday after a Friday due date — is on time.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `sla_kind` | `str` | No | `review` or `remediation`. |
| `completed_month` | `str` | No | `YYYY-MM` of `completed_at`'s local date. |
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_manager_name` | `str` | No | The Reviewer Manager's bare account; `(unassigned)` where absent. |
| `case_count` | `int` | No | Completed Cases in the group. |
| `on_time_count` | `int` | No | Completed with no working day late. |
| `late_count` | `int` | No | Completed one or more working days late. |
| `no_due_date_count` | `int` | No | In `case_count` but judged neither way (`review` only — a `remediation` row is by construction over Cases with a due date). |
| `late_working_days_mean` / `_max` | `float` | Yes | Over the late Cases; NULL when `late_count` is 0. |

### `case_void_monthly` — voided Cases by reason and by whom

Reduced from `case_current` over `status = Void` with a `voided_at`. Grain:
`void_month` × `brand` × `case_type` × `void_reason` × `voided_by_name`.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `void_month` | `str` | No | `YYYY-MM` of `voided_at`'s local date. |
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `void_reason` | `str` | No | The Void Reason key as the source holds it; `(unstated)` where absent. |
| `voided_by_name` | `str` | No | Who voided it, as the source holds it; `(unassigned)` where absent. |
| `case_count` | `int` | No | Voided Cases in the group. |
| `age_at_void_days_mean` / `_max` | `float` | Yes | `voided_at − created` in decimal days, a void stamped before `created` counting as zero; NULL where no Case in the group carries `created`. |

`void_reason_note` — the free text behind an `other` void — deliberately does not
reach this table. It is a per-Case sentence, not a dimension: grouping on it
would give one row per distinct note and turn an aggregate back into a listing.
The note stays on `case_current`, where a reader who has a group can go and read
it.

### `answer_action_load_current` — remediation Actions per question

Reduced from the `answer_action` Detail Table over the Actions on current
non-void Cases, with `case_current` for the denominator. Grain: `case_type` ×
`question_id`. Numerator and denominator are the same live population, so
`share_of_cases` is at most 1.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `case_type` | `str` | No | Case Type slug; leads because question ids are per-Case-Type. |
| `question_id` | `str` | No | The question the Actions hang off. |
| `case_count` | `int` | No | Cases with at least one Action on this question. |
| `action_count` | `int` | No | Actions across those Cases. |
| `actions_per_case_mean` | `float` | No | `action_count / case_count`. |
| `actions_per_case_max` | `int` | No | Most Actions any one Case carries on this question. |
| `share_of_cases` | `float` | Yes | `case_count` over the Case Type's current non-void Cases, in `[0, 1]`; NULL when that denominator is 0. |

### `answer_remediation_by_manager_current` — remediation under each Responsible Party Manager

Reduced from the `answer` Detail Table inner-joined to `case_current` on
`case_id`. Grain: `case_type` × `responsible_party_manager_name` ×
`remediation_required` × `remediation_status`. The Sync subject's
`answer_remediation_current` has the same decision and status dimensions with
no people on them; this is the cut by who answers for the remediation. An
Answer whose Case is not in `case_current` cannot name a manager and is
dropped.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `case_type` | `str` | No | Case Type slug. |
| `responsible_party_manager_name` | `str` | No | The manager's bare account; `(unassigned)` where absent. |
| `remediation_required` | `str` | No | `yes` / `no` / `(undecided)`. |
| `remediation_status` | `str` | No | `complete` / `partial` / `cancelled` / `(unresolved)`. |
| `answer_count` | `int` | No | Answers in the group. |
| `case_count` | `int` | No | Distinct Cases behind them. |

### `appeal_cycle_time_current` — how long Appeals take to resolve

Reduced from the `appeal` Detail Table. Grain: `case_type` × `state` ×
`resolution_verdict`. Cycle days run from `raised_at` to `resolution_at`; the
statistics are over the Appeals carrying both, a resolution stamped before the
raise counting as zero.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `case_type` | `str` | No | Case Type slug. |
| `state` | `str` | No | `raised` / `underReview` / `resolved` / `(unstated)`. |
| `resolution_verdict` | `str` | No | `agreed` / `rejected` / `(unresolved)`. |
| `appeal_count` | `int` | No | Appeals in the group. |
| `resolved_count` | `int` | No | Of those, with both instants. |
| `cycle_days_mean` / `_p50` / `_p90` / `_max` | `float` | Yes | Over the resolved ones; NULL when `resolved_count` is 0. |

### `appeal_question_citations_current` — which questions get appealed

Reduced from the `appeal` Detail Table's `cited_question_ids_json`, exploded.
Grain: `case_type` × `question_id`. An Appeal citing several questions counts
once under each; a blob that is not a JSON list cites nothing rather than
aborting the table, and a list member that is not a string or a number (a
JSON `true`, a `null`) is not a question id.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `case_type` | `str` | No | Case Type slug. |
| `question_id` | `str` | No | A cited question. |
| `appeal_count` | `int` | No | Distinct Appeals citing it. |
| `case_count` | `int` | No | Distinct Cases those Appeals belong to. |

### `conversation_response_time_current` — how quickly Conversations are replied to

Reduced from the `conversation_message` Detail Table, over the Messages on
current non-void Cases — the population the volume and posting-pattern tables
count. Grain: `brand` × `case_type`.

Each Case's thread is walked in `seq` order. A Message whose `author_login`
differs from the previous Message's is a **reply**, and its hours run from that
previous Message; two consecutive Messages by one author are one turn, not a
reply to oneself. The measure is deliberately **author-agnostic** — it does not
say which *side* replied: the source's own `awaiting_responsible_party` /
`awaiting_since` already state who is being waited on right now. This table
answers the other question: across a Case Type, how long does a reply take.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `thread_count` | `int` | No | Cases with at least one reply. |
| `reply_count` | `int` | No | Replies across them. |
| `reply_hours_mean` / `_p50` / `_p90` / `_max` | `float` | No | Over the replies, in decimal hours. |

### `conversation_volume_current` — how much Conversation Cases carry

Reduced from the `conversation_message` Detail Table joined to `case_current`.
Grain: `brand` × `case_type`, over the **current non-void Cases** of the Case
Type — Completed Cases included, since their Conversation is what they carried;
a Message on a void Case, or on a Case no longer current, is not counted. So
`message_count` is the volume on the live population, not a row count of the
Detail Table, and a Case Type row exists whenever the Type has a live Case,
Messages or not.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `case_count` | `int` | No | Current non-void Cases of the Type. |
| `thread_count` | `int` | No | Of those, with at least one Message. |
| `no_conversation_count` | `int` | No | `case_count − thread_count`. |
| `no_conversation_share` | `float` | No | `no_conversation_count / case_count`, to four places. |
| `message_count` | `int` | No | Messages across the threads. |
| `messages_per_thread_mean` / `_p50` / `_p90` / `_max` | `float` | Yes | Over the threads; NULL when `thread_count` is 0. |

### `conversation_posting_pattern_current` — when Messages get posted

Reduced from the same join. Grain: `brand` × `case_type` × `weekday_order` ×
`hour_of_day` — the **full 7 × 24 grid** for every Case Type with at least one
counted Message, so a quiet cell is a row holding `0` rather than a hole a
heat-map would have to infer. Weekday and hour are on the **local clock**, the
same zone every calendar date in the system is expressed in
(`tools.observability.timestamps.local_timezone`), converted per instant so a
thread spanning a summer-time change files each Message under the hour it was
actually posted at. Like the reply-time table it is author-agnostic: it says
when the platform is being used, not by whom. A Message whose `posted_at` does
not parse is not counted.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `weekday_order` | `int` | No | ISO weekday, `1` Monday … `7` Sunday; sort on this. |
| `weekday` | `str` | No | Its English name; read this. |
| `hour_of_day` | `int` | No | `0`–`23`, local clock. |
| `message_count` | `int` | No | Messages posted in that cell; `0` where none. |

### `case_intake_daily` — how many Cases arrive each day

Reduced from `case_current`. Grain: `intake_date` × `brand` × `case_type` ×
`status`.

Every current Case counts once, on the **local** date of its `created` stamp,
under the status it holds **now**. So a day's intake is the sum across
`status`, and the split says how much of that day's arrivals is still open, done
or voided. Voided Cases are included: they arrived too. Pair it with the Sync
subject's `case_throughput_daily` (the outflow) for net flow. A day with no
arrivals has **no row** — read a missing day as zero, and average over calendar
days rather than over rows.

There is no Reviewer: a Case arrives `To-allocate` with nobody holding it, and
the Reviewer it names today is not who it arrived to. This is the one
Case-counting table on this subject that leaves `assigned_reviewer_name` out of
its floor for that reason, rather than by omission.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `intake_date` | `str` | No | `YYYY-MM-DD` of `created`'s local date; `(unstamped)` where `created` is missing or unparseable. |
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `status` | `str` | No | The Case's status at `as_of_utc`, as the source spells it. |
| `case_count` | `int` | No | Cases created that day now in that status. |

### `case_backlog_daily` — how many Cases were open at the close of each day

Reduced from the observation history. Grain: `backlog_date` × `brand` ×
`case_type` × `status`.

For each day, the Cases that were **open** (not `Completed` or `Void`) at the
close of that local day, by the status they closed it in. A Case that changed
status twice in one day is counted that day only under the second. It is
**rebuilt from the history on every run** rather than accumulated one snapshot
per day, so it has no gap for a day the pipeline did not run, it reaches back
before the table existed, and it stays a `Refresh()` like every other table
here. The grid is **dense**: every day from the Case Type's first open day to
`as_of_utc`'s local date, for each of `To-allocate`, `In-progress` and
`Actions In Progress` (and any other open status observed), so a status nobody
was in that day is a `0`, not a missing row. The last day is as at
`as_of_utc`, since that day is not over.

A Case is open from its `created` stamp. Where the first poll to see a Case
found it already past `To-allocate`, the time between `created` and the moment
it entered the status it was found in is counted as **`(unobserved)`**. That
moment comes from the source's own stamp where it has one (`assigned_at` for
`In-progress`, `reportable_at` for `Actions In Progress`, `completed_at` /
`voided_at` for a Case first seen terminal),
and otherwise from the poll. So the *total* open count is right even for Cases
that predate Sync, and the status split says only what was seen. Expect
`(unobserved)` to dominate the days before Sync went live and to all but vanish
after, since an hourly poll sees a new Case `To-allocate` within the hour.

Like the other two history tables, it measures what the polls saw: a status
change observed by the first poll after local midnight lands on the next day.
Polling hourly bounds that to the last hour of a day. There is no Reviewer
dimension: this table answers whether the backlog is growing per Case Type, and
who holds the open Cases right now is already `case_counts_current` on the
Sync subject.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `backlog_date` | `str` | No | `YYYY-MM-DD`, local. |
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `status` | `str` | No | An open status as the source spells it, or `(unobserved)`. |
| `case_count` | `int` | No | Cases open at the close of that day in that status; `0` where none. |

### `case_lifecycle_duration_monthly` — how long each leg of the lifecycle takes

Reduced from `case_current` over the **non-void** Cases, the population the
Outcome and Appeal-rate tables count. Grain: `leg` × `ended_month` × `brand` ×
`case_type` × `assigned_reviewer_name`.

Each leg runs between two stamps **the source writes itself**, so unlike
`case_stage_dwell_current` nothing between two polls is missed. **Reportable
comes before Completed.** A Case with Remediation Actions becomes Reportable
when the Actions are sent (`Actions In Progress`) and Completed when they close.
A Case without Actions is Reportable and Completed at the same instant. A Case a
Maintainer has reopened carries neither stamp until it is sent again, so it has
no `review`, `remediation`, `to_reportable` or `end_to_end` leg meanwhile, and
its legs then run to the new stamps; only `allocation` is unaffected.

| `leg_order` | `leg` | From | To | Over |
|---|---|---|---|---|
| 1 | `allocation` | `created` | `assigned_at` | every Case carrying both |
| 2 | `review` | `assigned_at` | `reportable_at` | every Case carrying both |
| 3 | `remediation` | `reportable_at` | `completed_at` | Cases stamped `had_remediation` only — every other Case's would be a zero diluting the ones that waited |
| 4 | `to_reportable` | `created` | `reportable_at` | every Case carrying both |
| 5 | `end_to_end` | `created` | `completed_at` | every Case carrying both |

A leg is filed under the local month its **closing** stamp falls in, and under
the Reviewer the Case names **now**. `assigned_at` is the *latest* hand-over, so
`allocation` measures the wait to the last assignment, not the first. A Case
reassigned after it became Reportable has a `review` leg that runs backwards.
Such a leg is counted in `out_of_order_count` and kept out of every statistic,
rather than clamped to zero inside them. Days are calendar days, decimal, to
three places.

**Rolling up.** `case_count`, `out_of_order_count` and `days_total` sum, and
`days_max` takes a max, so a Case-Type or monthly mean is
`sum(days_total) / sum(case_count)` over the rows being combined. The
percentiles do **not** roll up: a median of medians is not a median. Read
`days_p50` / `days_p90` at this grain only.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `leg` | `str` | No | One of the five legs above. |
| `leg_order` | `int` | No | `1`–`5`, lifecycle order; sort on this. |
| `ended_month` | `str` | No | `YYYY-MM` of the closing stamp's local date. |
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_name` | `str` | No | The Reviewer's bare account, as the source holds it; `(unassigned)` where absent. |
| `case_count` | `int` | No | Legs measured — `0` where every leg in the group was out of order. |
| `out_of_order_count` | `int` | No | Legs whose closing stamp is before their opening one. |
| `days_total` | `float` | No | Sum of the measured legs, in decimal days. |
| `days_mean` / `_p50` / `_p90` / `_max` | `float` | Yes | Over the measured legs; NULL when `case_count` is 0. |

### `case_outcome_monthly` — what Reportable Cases were found

Reduced from `case_current`. Grain: `reportable_month` × `brand` × `case_type`
× `assigned_reviewer_name` × `effective_outcome`.

Over the **non-void** Cases with a parseable `reportable_at`, the population a
**Check** is counted over and the same rule `reviewer_activity_daily` counts
by. A month's `case_count` here therefore agrees with that table's days summed,
except that this table keeps an `(unassigned)` Reviewer that one drops. Grouped
on `effective_outcome`, the Outcome as corrected by any Amended Outcome, rather
than the frozen `outcome_at_completion`. `remediation_count` reads
`effective_had_remediation` for the same reason, and `overridden_count` says how
many of the group an Amended Outcome changed. All counts are additive across
every dimension.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `reportable_month` | `str` | No | `YYYY-MM` of `reportable_at`'s local date. |
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_name` | `str` | No | The Reviewer's bare account; `(unassigned)` where absent. |
| `effective_outcome` | `str` | No | As the source holds it, in the Case Type's own vocabulary; `(unstated)` where absent. |
| `case_count` | `int` | No | Reportable Cases in the group. |
| `remediation_count` | `int` | No | Of those, carrying `effective_had_remediation`. |
| `overridden_count` | `int` | No | Of those, carrying `outcome_overridden`. |

### `case_due_profile_current` — open Cases by how far they are from their due date

Reduced from `case_current`. Grain: `sla_kind` × `brand` × `case_type` ×
`assigned_reviewer_name` × `due_bucket`.

The forward-looking twin of `case_sla_attainment_monthly`, which only judges
Cases once they are Completed. A Case is on exactly one clock at a time. The
`review` clock runs over `In-progress` Cases against `due_date`; it stops at
Reportable. The `remediation` clock then starts and runs over
`Actions In Progress` Cases against `remediation_due_date`. A `To-allocate` Case
is on no clock, because its due date is stamped by the claim, so it is not here.

Days are whole **local calendar** days from `as_of_utc`'s date to the due date's
date, the way the platform's Action Centre counts them: "due today" holds until
local midnight, and "1 day over" begins as it passes. That keeps these figures
in line with what a Reviewer sees. (The SLA attainment table counts *working*
days late, because it measures against the SLA policy rather than the worklist.)
A held Case stays in its bucket, and `on_hold_count` says how many of the bucket
are held.

| `due_bucket_order` | `due_bucket` | Days to the due date |
|---|---|---|
| 1 | `overdue_8_plus` | −8 or fewer |
| 2 | `overdue_1_7` | −7 to −1 |
| 3 | `due_today` | 0 |
| 4 | `due_1_7` | 1 to 7 |
| 5 | `due_8_plus` | 8 or more |
| 6 | `no_due_date` | no parseable due date |

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `sla_kind` | `str` | No | `review` or `remediation`. |
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_name` | `str` | No | The Reviewer's bare account; `(unassigned)` where absent. |
| `due_bucket` | `str` | No | One of the six above. |
| `due_bucket_order` | `int` | No | `1`–`6`, most urgent first; sort on this. |
| `case_count` | `int` | No | Cases on that clock in that bucket. |
| `on_hold_count` | `int` | No | Of those, carrying `on_hold`. |

### `remediation_overdue_current` — remediation outstanding past its Remediation Due Date

Reduced from `case_current` with the `answer` and `answer_action` Detail Tables.
Grain: `brand` × `case_type` × `assigned_reviewer_name` ×
`responsible_party_name` × `days_over_bucket`.

Over the `Actions In Progress` Cases whose `remediation_due_date` falls on an
earlier local date than `as_of_utc`'s. Days over are counted the same way as in
`case_due_profile_current`. An **outstanding Answer** is one with
`remediation_required = yes` and no `remediation_status` yet (`complete`,
`partial` and `cancelled` all resolve it). The **outstanding Actions** are that
Answer's Actions. A Case past its date whose Answers are all resolved still
counts in `case_count`: it is waiting to be Completed, not waiting on
remediation.

`responsible_party_name` appears here **as itself**, the person the
remediation is owed by, which is exactly the Responsible Party's role. It is
not a stand-in for the Adviser (see *Adviser* in `CONTEXT.md`). There is no
Responsible Party *Manager*: `responsible_party_manager_name` is written only
when the Responsible Party is saved, so it is empty on older Cases, and
resolving the manager from the directory would add a `users` reference-feed
dependency this subject does not yet have.

On naming: the platform's own glossary keeps "Overdue" for the review clock and
says "past its Remediation Due Date" for this one. The table keeps the name it
was asked for, and the clock is stated here.

| `days_over_bucket_order` | `days_over_bucket` | Days past the Remediation Due Date |
|---|---|---|
| 1 | `over_1_7` | 1 to 7 |
| 2 | `over_8_14` | 8 to 14 |
| 3 | `over_15_28` | 15 to 28 |
| 4 | `over_29_plus` | 29 or more |

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_name` | `str` | No | The Reviewer's bare account; `(unassigned)` where absent. |
| `responsible_party_name` | `str` | No | The Responsible Party's bare account, as the source holds it; `(unassigned)` where absent. |
| `days_over_bucket` | `str` | No | One of the four above. |
| `days_over_bucket_order` | `int` | No | `1`–`4`; sort on this. |
| `case_count` | `int` | No | Cases past their date in the group. |
| `outstanding_answer_count` | `int` | No | Outstanding Answers on those Cases. |
| `outstanding_action_count` | `int` | No | Actions on those Answers. |
| `days_over_max` | `int` | No | The furthest past its date any Case in the group is; rolls up as a max. |

### `reviewer_workload_current` — what each Reviewer holds, and how fast they clear it

Reduced from `case_current`, with the observation history for the age of the
work in hand. Grain: `brand` × `case_type` × `assigned_reviewer_name`.

- `in_progress_count` is the review work in hand. Less
  `in_progress_on_hold_count`, it is what the platform's **Allocation
  Capacity** counts: at most three non-held `In-progress` Cases per Reviewer
  *across every Case Type*. So sum a Reviewer's rows before comparing against
  three.
- `reportable_last_28_days_count` is their output: Cases from the Check
  population (non-void, with a `reportable_at`) whose `reportable_at` falls in
  the 28 local days ending on `as_of_utc`'s date.
- `weeks_of_work` is `in_progress_count` divided by the weekly rate
  (`reportable_last_28_days_count / 4`). It is NULL where there was no output to
  divide by. It is the only ratio here: to roll it up, recompute it from the
  summed counts rather than averaging it.
- `actions_in_progress_count` is reported alongside but kept out of
  `weeks_of_work`, because that phase is the Responsible Party's work, not the
  Reviewer's.
- `oldest_in_progress_days` ages each `In-progress` Case from the moment the
  history last saw it **enter** `In-progress`, so a reopened Case counts from
  its reopen and its spell `Completed` is not work in hand. A reassignment
  within `In-progress` changes no status and does not restart it. A Case the
  history has not seen in `In-progress` falls back to its `assigned_at`.

A Reviewer with no work in hand and no output in the window has no row.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_name` | `str` | No | The Reviewer's bare account; `(unassigned)` where absent. |
| `in_progress_count` | `int` | No | `In-progress` Cases held. |
| `in_progress_on_hold_count` | `int` | No | Of those, on hold. |
| `actions_in_progress_count` | `int` | No | `Actions In Progress` Cases held. |
| `oldest_in_progress_days` | `float` | Yes | Local calendar days since the oldest `In-progress` Case entered that status (above); NULL where none has a start. Rolls up as a max. |
| `reportable_last_28_days_count` | `int` | No | Cases made Reportable in the window. |
| `weeks_of_work` | `float` | Yes | As above; NULL with no output. |

### `appeal_rate_by_reviewer_monthly` — how often each Reviewer's Cases are appealed

Reduced from `case_current` and the `appeal` Detail Table. Grain:
`reportable_month` × `brand` × `case_type` × `assigned_reviewer_name`.

Over the same Reportable population as `case_outcome_monthly`, so
`reportable_count` matches that table's `case_count` summed across Outcomes.
Every Reviewer-month with a Reportable Case has a row, with zeros where nothing
was appealed, so a rate is always `appealed_case_count / reportable_count`.

Each Case's Appeals are counted onto the **Case's** Reportable month and
Reviewer, not the month the Appeal was raised. A row reads "of the Cases this
Reviewer made Reportable that month, how many were appealed". That makes each
month a cohort which keeps filling in as late Appeals arrive, so the latest
months' rates are lower bounds. An Appeal is open until its `state` is
`resolved`. An `agreed` one amends the Outcome (it is the
`amended_from_appeal_id` link on `case_current`), and a `rejected` one changes
nothing. An Appeal on a Case outside the population (a voided Case) is not
counted.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `reportable_month` | `str` | No | `YYYY-MM` of the Case's `reportable_at` local date. |
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_name` | `str` | No | The Reviewer's bare account; `(unassigned)` where absent. |
| `reportable_count` | `int` | No | Reportable Cases in the group. |
| `appealed_case_count` | `int` | No | Of those, with at least one Appeal. |
| `appeal_count` | `int` | No | Appeals on those Cases (a Case appealed twice counts twice). |
| `open_appeal_count` | `int` | No | Of those, not yet `resolved`. |
| `agreed_appeal_count` | `int` | No | Resolved `agreed`. |
| `rejected_appeal_count` | `int` | No | Resolved `rejected`. |

## Part C — Row checks

None. Each group-by produces its declared grain, so no uniqueness gate is
attached — the same reasoning as the Sync subject's aggregates. Every table is
gated by its `SchemaValidator` (columns, types, nullability, `OneOf` on
`sla_kind`, `Range` on the counts and on `share_of_cases`) before it is written.

## Part D — Quarantine & data quality

- Nothing is quarantined: these are reductions of already-published gold and
  silver, whose row contracts the Sync subject enforces.
- Each source is read once for the run. `case_current` is gated as it is read,
  since the snapshot instant is taken off it there, and the observation history
  is gated on the columns that order it and put in order once (`history:order`)
  for every reduction that walks it; every other source is gated
  by the step that reduces it, with a `ColumnValidator` on the columns that
  reduction reads. So a Sync shape change fails that step with the column named
  rather than publishing a wrong number; the tables before it in publication
  order are already refreshed, and the next run rebuilds them all.
- An instant that does not parse (`errors="coerce"`) drops that row from the
  measure it feeds — a Completed Case with an unparseable `completed_at` is not
  in the SLA table; an Appeal with an unparseable `resolution_at` is in
  `appeal_count` but not `resolved_count`.
- An observation whose `source_modified_at` does not parse has no place in a
  Case's order, so it is dropped from every reduction of the history alike
  (silver declares the column non-null, so this guards rather than expects).
- A negative interval (a `placed_on_hold_at` after the observation that first
  showed the hold; a reply posted before the Message it follows; an Appeal
  resolved before it was raised; a void stamped before `created`) is clamped to
  zero rather than subtracting from a total. `case_lifecycle_duration_monthly`
  is the exception: a leg that runs backwards is a real thing to see (a Case
  reassigned after it became Reportable), so it is counted in
  `out_of_order_count` and excluded from the statistics instead.

## What is deliberately not here

- **Time held as a share of time assigned.** It needs each Case's assignment
  span alongside its holds and a rule for Cases assigned more than once; a
  per-Case table is the honest home for that, not a ratio of two aggregates.
- **Conversation latency by side.** See `conversation_response_time_current`
  above.
- **A Reviewer on intake and backlog.** Both stop at Case Type: a Case arrives
  with nobody holding it, and who holds the open Cases today is
  `case_counts_current` on the Sync subject. A per-Reviewer backlog *history*
  is computable from the same observations, but it would be a new table with
  its own question, not a widened grain on this one.
- **Roll-up-able duration percentiles.** `case_lifecycle_duration_monthly`'s
  medians and p90s hold at its own grain only. Publishing a duration histogram
  (counts per day-band) would make an approximate percentile available at any
  roll-up, if a consumer asks for one.
- **A per-Case status-transition log.** The history tables are reduced
  from one in memory, and publishing it would be the first non-aggregate table
  on a Reporting subject; if a second consumer wants transitions at Case grain
  that is the point to publish it, from the Sync subject rather than from here.
