# Data dictionary — `cora_platform_metric`

Eleven gold **Aggregate tables** measuring how the Case Review Platform is
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

## Three things to know before reading a number

**1. Two of the tables measure what the polls saw, not what happened.**
`case_stage_dwell_current` and `case_hold_current` are reduced from the Sync
subject's *observation history* — one row each time a poll saw a Case. A state a
Case entered and left between two polls (put on hold in the morning, released
before the next poll; claimed and completed inside one interval) was never
observed and is not counted. This is a known, accepted limit of polling rather
than a defect: the hold count is a floor, and the dwell intervals are those
whose boundaries a poll witnessed. Sync polls hourly
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
| **Last reviewed** | 2026-08-28 |

The Sync snapshot instant, `as_of_utc`, is read off `case_current` — one
literal on every row — once at the top of the run, and is what an open hold is
measured to and what every table is stamped with. Each reduction is handed that
instant, so the eleven tables cannot disagree about which snapshot they
describe. An empty `case_current` has no snapshot to report against and fails
the run rather than publishing eleven empty tables.

## Part B — The tables

Every table also carries `as_of_utc` (`str`, non-null, the Sync snapshot
instant) and the reserved run-provenance column every table-backed Writer
stamps. Neither is repeated below.

### `case_stage_dwell_current` — how long Cases sit in each status

Reduced from the observation history. Grain: `brand` × `case_type` × `status`.

Each Case's observations are walked in the source's `Modified` order; every
change of `status` closes an interval at that observation's `Modified` and
opens the next. Where a Case's *first* observation already carries
`To-allocate` or `In-progress`, the interval starts at the source's own
`created` / `assigned_at` stamp rather than at the poll that first saw it — the
source knows when it entered the state, the poll only knows when it looked. A
Case's last interval is *open* unless its status is terminal (`Completed`,
`Void`). Statistics are over closed intervals only: an open one has no length
yet, and the Sync subject's age-bucket aggregates already answer "how long has
it been waiting".

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `brand` | `str` | No | `(unknown)` — see above. |
| `case_type` | `str` | No | Case Type slug. |
| `status` | `str` | No | The status dwelt in, as the source spells it. |
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
`open_hold_count`. Holds are attributed to the Reviewer the Case's *latest*
observation names, so a reassigned Case's holds follow the Case.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_name` | `str` | No | The Reviewer's claims login as the source holds it; `(unassigned)` where the latest observation names nobody. |
| `case_count` | `int` | No | Cases with at least one observed hold. |
| `hold_count` | `int` | No | Observed holds (a Case held twice counts twice). |
| `open_hold_count` | `int` | No | Holds still open at `as_of_utc`. |
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
the completion instant is the one available proxy. A Case is late when its
completion falls on a later **local** date than its due date; days late are the
working days after the due date up to and including the completion date, on the
calendar the run was given.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `sla_kind` | `str` | No | `review` or `remediation`. |
| `completed_month` | `str` | No | `YYYY-MM` of `completed_at`'s local date. |
| `brand` | `str` | No | `(unknown)`. |
| `case_type` | `str` | No | Case Type slug. |
| `assigned_reviewer_manager_name` | `str` | No | The Reviewer Manager's claims login; `(unassigned)` where absent. |
| `case_count` | `int` | No | Completed Cases in the group. |
| `on_time_count` | `int` | No | Completed on or before the due date. |
| `late_count` | `int` | No | Completed after it. |
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
| `age_at_void_days_mean` / `_max` | `float` | Yes | `voided_at − created` in decimal days; NULL where no Case in the group carries `created`. |

`void_reason_note` — the free text behind an `other` void — deliberately does not
reach this table. It is a per-Case sentence, not a dimension: grouping on it
would give one row per distinct note and turn an aggregate back into a listing.
The note stays on `case_current`, where a reader who has a group can go and read
it.

### `answer_action_load_current` — remediation Actions per question

Reduced from the `answer_action` Detail Table, with `case_current` for the
denominator. Grain: `case_type` × `question_id`.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `case_type` | `str` | No | Case Type slug; leads because question ids are per-Case-Type. |
| `question_id` | `str` | No | The question the Actions hang off. |
| `case_count` | `int` | No | Cases with at least one Action on this question. |
| `action_count` | `int` | No | Actions across those Cases. |
| `actions_per_case_mean` | `float` | No | `action_count / case_count`. |
| `actions_per_case_max` | `int` | No | Most Actions any one Case carries on this question. |
| `share_of_cases` | `float` | Yes | `case_count` over the Case Type's current non-void Cases; NULL when that denominator is 0. |

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
| `responsible_party_manager_name` | `str` | No | The manager's claims login; `(unassigned)` where absent. |
| `remediation_required` | `str` | No | `yes` / `no` / `(undecided)`. |
| `remediation_status` | `str` | No | `complete` / `partial` / `cancelled` / `(unresolved)`. |
| `answer_count` | `int` | No | Answers in the group. |
| `case_count` | `int` | No | Distinct Cases behind them. |

### `appeal_cycle_time_current` — how long Appeals take to resolve

Reduced from the `appeal` Detail Table. Grain: `case_type` × `state` ×
`resolution_verdict`. Cycle days run from `raised_at` to `resolution_at`; the
statistics are over the Appeals carrying both.

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
aborting the table.

| Field | Type | Nullable | Description |
|-------|------|----------|-------------|
| `case_type` | `str` | No | Case Type slug. |
| `question_id` | `str` | No | A cited question. |
| `appeal_count` | `int` | No | Distinct Appeals citing it. |
| `case_count` | `int` | No | Distinct Cases those Appeals belong to. |

### `conversation_response_time_current` — how quickly Conversations are replied to

Reduced from the `conversation_message` Detail Table. Grain: `brand` ×
`case_type`.

Each Case's thread is walked in `seq` order. A Message whose `author_login`
differs from the previous Message's is a **reply**, and its hours run from that
previous Message; two consecutive Messages by one author are one turn, not a
reply to oneself. The measure is deliberately **author-agnostic** — it does not
say which *side* replied. Splitting by side needs the bare-login-to-claims-login
join the Sync data dictionary refuses on principle (see *Bare account logins vs.
claims logins* there), and the source's own `awaiting_responsible_party` /
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

## Part C — Row checks

None. Each group-by produces its declared grain, so no uniqueness gate is
attached — the same reasoning as the Sync subject's aggregates. Every table is
gated by its `SchemaValidator` (columns, types, nullability, `OneOf` on
`sla_kind`, `Range` on the counts) before it is written.

## Part D — Quarantine & data quality

- Nothing is quarantined: these are reductions of already-published gold and
  silver, whose row contracts the Sync subject enforces.
- Each source is read once for the run. `case_current` is gated as it is read,
  since the snapshot instant is taken off it there; every other source is gated
  by the step that reduces it, with a `ColumnValidator` on the columns that
  reduction reads. So a Sync shape change fails that step with the column named
  rather than publishing a wrong number; the tables before it in publication
  order are already refreshed, and the next run rebuilds them all.
- An instant that does not parse (`errors="coerce"`) drops that row from the
  measure it feeds — a Completed Case with an unparseable `completed_at` is not
  in the SLA table; an Appeal with an unparseable `resolution_at` is in
  `appeal_count` but not `resolved_count`.
- A negative interval (a `placed_on_hold_at` after the observation that first
  showed the hold; a reply posted before the Message it follows) is clamped to
  zero rather than subtracting from a total.

## What is deliberately not here

- **Time held as a share of time assigned.** It needs each Case's assignment
  span alongside its holds and a rule for Cases assigned more than once; a
  per-Case table is the honest home for that, not a ratio of two aggregates.
- **Conversation latency by side.** See `conversation_response_time_current`
  above.
- **A per-Case status-transition log.** The two history tables are reduced
  from one in memory, and publishing it would be the first non-aggregate table
  on a Reporting subject; if a second consumer wants transitions at Case grain
  that is the point to publish it, from the Sync subject rather than from here.
