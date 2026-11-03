# Person-targeted Selection — the rules, as pure functions

The decision and its reasoning are in
[ADR-0022](adr/0022-person-targeted-selection-plans-per-adviser.md), as amended
by [ADR-0033](adr/0033-person-targeted-selection-plans-across-a-selection-group-to-a-committed-ten.md);
the domain language is in [`../CONTEXT.md`](../CONTEXT.md). This document is the
**rule surface**: every business rule the framework applies, as a small named
pure function with its inputs, output and behaviour spelled out.

**Built** in [`../tools/person_targeted_selection.py`](../tools/person_targeted_selection.py),
in the same shape as `TargetedSelection`: a `PersonTargetedSelectionConfig` and a
`PersonTargetedSelection` processor that takes it (below). Every rule in this
document is a public function of that module under the name used here. They
follow the convention set by
[`../pipelines/case_selection/rules.py`](../pipelines/case_selection/rules.py):
each rule is a pure function of plain rows plus explicit configuration, testable
with a `dict` and a `date`, with no `Pipeline`, no pandas and no IO. The
processor only parses dates and re-frames. **Not built:** the Variation functions
in §2, whose pairing rule is still open, and the pipeline that reads Sync and
writes the outputs.

> **The existing `pipelines/case_selection/rules.py` is a demo approximation**
> written before these rules were settled. Its numbers differ (21 *calendar* days
> between checks, 15 *calendar* days of sale recency), it plans per Case Type
> rather than per **Selection group**, and it has no catch-up cadence. Read it for
> the function-per-rule shape, not for the policy.

## Using it

```python
from tools.person_targeted_selection import (
    PersonTargetedSelection,
    PersonTargetedSelectionConfig,
)

config = PersonTargetedSelectionConfig(
    case_types=("ct_a", "ct_b", "ct_c", "ct_d", "ct_e"),  # the Selection group
    quota_case_type="ct_a",                               # placeholder until named
)
selection = PersonTargetedSelection(
    config,
    checks=checks,            # Sync's monthly aggregate (a Dataset)
    current=current,          # Sync's per-Case-Type current state (a Dataset)
    as_of=run_date,
    calendar=calendar,        # a WorkingDayCalendar; weekends only if omitted
    voided_sale_ids=voided,   # sales that already produced a voided Case
    previous=previous_state,  # last run's adviser state, for unservable_since
)
pool = transform(selection, sales, name="person-targeted selection")

plan = selection.plan(sales)  # both outputs: plan.selected and plan.advisers
```

The input is the roster's **sales across the rolling window**, not just the
recent ones: the same rows decide active months. The processor returns the chosen
sales — every input column, in **selection order** — so it is one `transform`
step. `plan(sales)` returns those and the per-Adviser state table together, one
row per Adviser in the roster with the columns listed under `plan_checks` below.
Dates may arrive as dates, timestamps or ISO strings, and `month` as `YYYY-MM`;
a missing column is named when the step runs, and a bad config when it is built.

## Row shapes

Three inputs, all plain mappings. Each is still grained by Case Type; the rules
below sum across the Selection group's Case Types.

```python
Sale = {
    "adviser":     str,    # lower-cased bare account
    "case_type":   str,
    "sale_id":     str,
    "sale_date":   date,
    "risk_score":  int,
    "channel":     str,    # with the combined-exclusion rule, determines the variations
}

# One row of Sync's rule-neutral monthly aggregate. Only Cases that reached
# Reportable appear at all, bucketed by the calendar month they became
# Reportable — which is why a Case voided before Reportable is simply absent.
CheckCount = {
    "adviser":     str,
    "case_type":   str,
    "month":       tuple[int, int],   # (year, month) it became Reportable
    "variations":  str,               # "1" | "2" | "3" | "1+2" | "1+3"
    "status":      str,               # To-allocate | In-progress | Actions In Progress
                                      #   | Completed | Void
    "check_count": int,
}

# Sync's current-state companion, for the day-precise facts a month grain
# cannot hold.
AdviserCurrent = {
    "adviser":                str,
    "case_type":              str,
    "outstanding_case_count": int,
    "last_reportable_date":   date | None,
}
```

Everything below is a function of those three plus `as_of`, a
`WorkingDayCalendar`, and the declared numbers.

## The declared numbers

Application data in `case_review/`, **in the repository** so that git is the rule
store and a past run's rules are recoverable by checking out its `code_version`
(ADR-0022). Never constants inside a rule module — these are expected to be tuned,
and the monthly position review is where they are tuned (ADR-0033).

```python
@dataclass(frozen=True)
class PersonTargetedSelectionConfig:
    """Everything a Selection group declares for person-targeted Selection."""
    case_types:             tuple[str, ...]  # the group's Case Types, five or six
    quota_case_type:        str              # placeholder until named; one of case_types
    check_target:           int = 10   # the commitment, and the cap
    case_type_quota:        int = 2    # full-year, from quota_case_type; pro-rata'd below
    target_months:          int = 12   # the rolling window, in calendar months
    behind_band:            int = 2    # shortfall at which the catch-up cadence applies
    cadence_days:           int = 20   # working days after Reportable, normally (~4 weeks)
    catch_up_cadence_days:  int = 10   # working days after Reportable, while Behind (~2 weeks)
    due_days:               int = 25   # working days after Reportable, then overdue (~5 weeks)
    sale_window_days:       int = 15   # working days a sale stays selectable
    countable_statuses:     tuple[str, ...] = ("Actions In Progress", "Completed")
```

`countable_statuses` is what keeps the Sync aggregate rule-neutral: *which
statuses count as a check* is declared here, in Selection, not baked into the
upstream table.

---

## 1 — Activity and the pro-rata basis

### `rolling_months(as_of, count)`

**In:** the run date; how many months the window spans.
**Out:** the set of `(year, month)` buckets the window covers.
**Behaviour:** counted by **calendar month**, never by exact day — so the window
and Sync's monthly aggregate share one unit and never disagree at a boundary.
Unchanged from `rules.py:76`.

### `active_months(sales, as_of, config)`

**In:** all of one Adviser's sales; the run date; the config.
**Out:** an `int` in `0..12`.
**Behaviour:** the count of window months in which the Adviser made **at least
one sale in any of the Selection group's Case Types**. This is the denominator of
every pro-rata figure below. An Adviser with no sales at all scores `0`, which
makes their target `0` — they are compliant trivially, which is why **the sales
feed alone is a complete roster** and no separate Adviser list is needed.

```python
def active_months(sales: Sequence[Sale], as_of: date, config: PersonTargetedSelectionConfig) -> int:
    window = rolling_months(as_of, count=config.target_months)
    return len({
        (s["sale_date"].year, s["sale_date"].month)
        for s in sales
        if s["case_type"] in config.case_types
        and (s["sale_date"].year, s["sale_date"].month) in window
    })
```

### `pro_rata(full_year_value, months, config)`

**In:** a full-year figure; the Adviser's active months; the config.
**Out:** an `int`.
**Behaviour:** scales a full-year figure to the Adviser's activity, rounded half
up. **One rounding rule, shared by the target and the quota** — so the quota can
never round above the target it sits inside.

```python
def pro_rata(full_year_value: int, months: int, config: PersonTargetedSelectionConfig) -> int:
    return _round_half_up(full_year_value * months / config.target_months)
```

| Full-year | 12 months | 6 | 3 | 1 |
|---|---:|---:|---:|---:|
| target `10` | 10 | 5 | 3 | 1 |
| quota `2` | 2 | 1 | 1 | 0 |

The last row is the reason the quota pro-rates at all: fixed at `2`, a
one-active-month Adviser would owe two quota checks against a target of one —
unsatisfiable by construction (ADR-0022).

---

## 2 — Variations

> **Not built.** Selection does not read Variations, and which variation a
> default-combined check pairs with variation 1 is still open (ADR-0033), so
> these functions wait for that answer rather than guess it.

### `variations_for(sale, config)`

**In:** one sale; the config.
**Out:** a canonical variation string — `"1"`, `"2"`, `"3"`, `"1+2"` or `"1+3"`.
**Behaviour:** derived from the Case, never chosen by Selection. **Combined is the
default**: a check pairs variation 1 with one other unless the declared
`excluded_from_combined(sale)` rule says it should not (ADR-0033). That rule is a
placeholder until defined; which variation a combined check pairs with variation
1 is still open. Variation 1 is always present in a combined check; `"2+3"` does
not exist.

The canonical string is stored, and nothing derived from it is stored — no
`is_combined` column, no `has_variation_1` flag.

**Variations do not steer Selection.** They are recorded on the Case and carried
as a dimension of the Sync aggregate, but no quota reads them: with combined the
default, there is nothing to steer towards.

### `is_combined(variations)` / `covers_variation(variations, n)`

**In:** a canonical variation string.
**Out:** `bool`.
**Behaviour:** `is_combined` is "contains a `+`". `covers_variation` is set
membership. Kept for reporting.

```python
def is_combined(variations: str) -> bool:
    return "+" in variations

def covers_variation(variations: str, n: int) -> bool:
    return str(n) in variations.split("+")
```

---

## 3 — Counting checks

### `checks_in_window(counts, as_of, config, *, case_types=None)`

**In:** one Adviser's `CheckCount` rows; the run date; the config; optionally the
Case Types to count.
**Out:** an `int`.
**Behaviour:** sums `check_count` across the window months, keeping only rows
whose `status` is in `config.countable_statuses` and whose Case Type is in the
Selection group (or in `case_types`, when given). Because the aggregate is
bucketed by **Reportable** month, **a voided Case never appears and needs no
subtracting anywhere** — the single most load-bearing consequence of counting at
Reportable rather than at selection.

```python
def checks_in_window(
    counts: Sequence[CheckCount],
    as_of: date,
    config: PersonTargetedSelectionConfig,
    *,
    case_types: Collection[str] | None = None,
) -> int:
    window = rolling_months(as_of, count=config.target_months)
    wanted = config.case_types if case_types is None else case_types
    return sum(
        c["check_count"]
        for c in counts
        if c["month"] in window
        and c["case_type"] in wanted
        and c["status"] in config.countable_statuses
    )
```

The quota tally and the per-Case-Type tally the spread reads are the same
function narrowed:

```python
quota_checks = checks_in_window(
    counts, as_of, config, case_types={config.quota_case_type})
checks_by_case_type = {
    ct: checks_in_window(counts, as_of, config, case_types={ct})
    for ct in config.case_types
}
```

---

## 4 — Standing: shortfall and Behind

### `shortfall(counts, sales, as_of, config)`

**In:** the Adviser's check counts and sales; the run date; the config.
**Out:** an `int`, floored at `0`.
**Behaviour:** `pro-rata target − checks in window`, across the group. This is
the capacity gate (`shortfall == 0` means at target, so not selectable) — which is
also what **caps** an Adviser at 10, since a void never counts and only one check
is ever outstanding (ADR-0033) — **and** the cross-Adviser sort key.

```python
def shortfall(counts, sales, as_of, config) -> int:
    months = active_months(sales, as_of, config)
    target = pro_rata(config.check_target, months, config)
    return max(0, target - checks_in_window(counts, as_of, config))
```

### `quota_shortfall(counts, sales, as_of, config)`

**Out:** an `int`, floored at `0`.
**Behaviour:** the pro-rata Case Type quota minus the quota Case Type's tally.
Carried on the state row for reporting; Selection steers on `other_room` below.

### `other_room(counts, sales, as_of, config)`

**Out:** an `int`, floored at `0`.
**Behaviour:** how many more checks the Adviser may take from Case Types **other
than** the quota Case Type: `pro-rata target − pro-rata quota − other checks in
window` — 8 at a full year. **The quota is reserved, not preferred**: the 2 belong
to the quota Case Type and only the 8 are open to the rest, so once `other_room`
reaches `0` only quota Case Type sales are eligible. Quota Case Type checks fill
either share, so an Adviser who only works it meets the whole target from it.

```python
def other_room(counts, sales, as_of, config) -> int:
    months = active_months(sales, as_of, config)
    others = set(config.case_types) - {config.quota_case_type}
    allowance = (pro_rata(config.check_target, months, config)
                 - pro_rata(config.case_type_quota, months, config))
    return max(0, allowance - checks_in_window(counts, as_of, config, case_types=others))
```

Reserving rather than preferring is what keeps the quota from being
**front-loaded**: until the 8 are used, the quota Case Type competes on risk like
any other, so every Adviser's quota checks are not taken in the first weeks of
their year with the Case Type unchecked for the rest of it (ADR-0033).

### `is_behind(counts, sales, as_of, config)`

**In / Out:** as above; `bool`.
**Behaviour:** `shortfall >= config.behind_band`. **A tolerance band, not "below
target"** — every selectable Adviser is below target by construction, so a band of
1 makes every selectable Adviser Behind and the 20-day cadence governs nobody.
Drives *which* cadence applies, nothing else. The band is the number the monthly
position review moves if turnaround leaves Advisers settling at 8–9 (ADR-0033).

```python
def is_behind(counts, sales, as_of, config) -> bool:
    return shortfall(counts, sales, as_of, config) >= config.behind_band
```

---

## 5 — Cadence

One milestone — the previous check reaching **Reportable**, the latest across the
group's Case Types — read as a window: selectable from the cadence, overdue at
the due line.

### `next_eligible_date(last_reportable, behind, config, calendar)`

**In:** the Adviser's latest `last_reportable_date` across the group; whether
they are Behind; the config; a `WorkingDayCalendar`.
**Out:** a `date`, or `None` when they have never had a check.
**Behaviour:** `last_reportable` plus 20 working days normally, plus 10 while
Behind — the hard floor. An Adviser with no history is eligible immediately.

```python
def next_eligible_date(last_reportable, behind, config, calendar) -> date | None:
    if last_reportable is None:
        return None                       # never checked -> eligible now
    days = config.catch_up_cadence_days if behind else config.cadence_days
    return calendar.add_working_days(last_reportable, days)
```

> `WorkingDayCalendar.add_working_days(day, n)` was added for this
> ([`working-day-calendar.md`](working-day-calendar.md)); `day` itself is never
> counted.

### `due_date(last_reportable, config, calendar)`

**Out:** a `date`, or `None` when they have never had a check.
**Behaviour:** `last_reportable` plus 25 working days, Behind or not. **A
reporting line, not a gate** — Selection already selects at the first chance it
gets, so passing it changes nothing Selection does; it marks the Adviser
**overdue**.

### `is_overdue(shortfall, last_reportable, as_of, config, calendar)`

**Out:** `bool`.
**Behaviour:** under target, and `as_of` past `due_date`. An Adviser at target is
never overdue: they are waiting for a check to leave the window, and that wait is
supposed to be long.

### `has_outstanding_check(currents)`

**In:** the Adviser's `AdviserCurrent` rows across the group.
**Out:** `bool`.
**Behaviour:** any `outstanding_case_count > 0`. **One outstanding check per
Adviser across the group**, not per Case Type. **Outstanding begins at delivery,
not at allocation** — a Case sitting unallocated in the **Hopper** already counts.

### `within_cadence(currents, behind, as_of, config, calendar)`

**Out:** `bool`.
**Behaviour:** the Adviser is blocked by pacing — either something is outstanding,
or `as_of` has not yet reached `next_eligible_date`.

```python
def within_cadence(currents, behind, as_of, config, calendar) -> bool:
    if has_outstanding_check(currents):
        return True
    last = latest_reportable(currents)
    nxt = next_eligible_date(last, behind, config, calendar)
    return nxt is not None and as_of < nxt
```

**A void frees the Adviser immediately**, and it falls out of these functions
rather than needing a rule: a voided Case never reached Reportable, so
`last_reportable_date` still points at the *previous* check, and the voided Case
is no longer outstanding.

---

## 6 — Which Case

### `is_selectable_sale(sale, as_of, config, calendar)`

**Out:** `bool`.
**Behaviour:** the sale is in one of the group's Case Types and falls within the
last `sale_window_days` (15) **working** days on or before `as_of`.

### `eligible_cases(sales, other_room, as_of, config, calendar, *, voided_sale_ids)`

**In:** one Adviser's sales; their `other_room`; the run date; the config; the
calendar; the sale ids that already produced a **voided** Case.
**Out:** a list of sales, across the group's Case Types.
**Behaviour:** the selectable sales — **only the quota Case Type's once
`other_room` is `0`** — **minus any sale that already produced a voided Case**.
An Adviser who has used the 8 and has no quota Case Type sale gets `no eligible
case`, not a Case of another type: taking one would spend the last place the
quota had, and with 10 also the cap, the quota could not then be met until a
check left the window. That exclusion is the guard against the *void loop*: re-selecting a
sale voided as a `duplicate` mints the same deterministic `case_id` and
reproduces the duplicate (ADR-0022).

### `best_case(cases, checks_by_case_type)`

**In:** the Adviser's eligible sales; their checks per Case Type in the window.
**Out:** one sale.
**Behaviour:** the sort *within* one Adviser. **Highest risk score always wins** —
the quota is already enforced by `eligible_cases`, so nothing here overrides
risk. Only between equal risk scores does the **Case Type the Adviser has had
fewest checks in** win, so the spread across the group is a tie-break, never a
per-Case-Type target. Then `sale_id` to stay deterministic.

```python
def best_case(cases, checks_by_case_type) -> Sale:
    def key(sale):
        return (
            -int(sale["risk_score"]),
            checks_by_case_type.get(sale["case_type"], 0),
            sale["sale_id"],
        )
    return sorted(cases, key=key)[0]
```

---

## 7 — The verdict, and the run

### `check_verdict(...)`

**In:** everything above for one Adviser.
**Out:** `(verdict, reason, chosen_sale | None)`.
**Behaviour:** the gates in priority order, **first one wins**, so the reason is
one located phrase. Every Adviser in the roster gets a verdict — **including
those no Case was available for**, which is the whole point: the existing demo
skips them with `continue` and no record at all
(`pipelines/case_selection/selection.py:72`).

```python
def check_verdict(counts, sales, currents, as_of, config, calendar, voided_sale_ids):
    short = shortfall(counts, sales, as_of, config)
    if short == 0:
        return "at target", f"at the pro-rata target of {…}", None

    behind = short >= config.behind_band
    if within_cadence(currents, behind, as_of, config, calendar):
        return "within cadence", "…outstanding check / next eligible <date>", None

    room = other_room(counts, sales, as_of, config)
    cases = eligible_cases(sales, room, as_of, config, calendar,
                           voided_sale_ids=voided_sale_ids)
    if not cases:
        return "no eligible case", "…no sale within 15 working days / no quota Case Type sale, other checks used", None

    return "selected", "…", best_case(cases, checks_by_case_type)
```

| Verdict | Meaning | Alarming |
|---|---|---|
| `selected` | a Case was chosen | no |
| `at target` | already at their pro-rata target | no |
| `within cadence` | outstanding check, or inside the 20/10-day spacing | no |
| **`no eligible case`** | **owes a check, nothing available** | **yes — and a breach of spacing once overdue** |

### `selection_order(verdicts)`

**In:** every Adviser's verdict and standing.
**Out:** the selected Advisers, ordered.
**Behaviour:** **largest shortfall first**, then highest risk score of the chosen
Case. Self-correcting — anyone not served today is further behind tomorrow and
rises. Note this does **not** cap anything: nothing limits daily volume, which is
emergent from the roster (ADR-0022). The order matters for reporting, for
delivery sequence, and if a cap is ever introduced.

### `plan_checks(...)`

**In:** the whole roster's sales, check counts and current state, for one
Selection group.
**Out:** `(selection_pool_rows, adviser_state_rows)`.
**Behaviour:** the orchestrating pure function — the analogue of
`select_cases` in the demo. One `check_verdict` per Adviser in the roster, the
selected ones ordered by `selection_order`, and **one state row per Adviser
considered**, carrying target, shortfall, quota shortfall, `other_room`, `is_behind`,
`next_eligible_date`, `due_date`, `overdue`, verdict and `unservable_since`. Each
selected Case is delivered to **its own Case Type's list**, so one run can emit a
Deliverable per Case Type in the group.

Keeping the whole policy in one pure function over plain rows means the framework
wrapper only parses dates and re-frames — the entire rule surface stays testable
with in-memory dicts.

### `unservable_since(previous_state, verdict, as_of)`

**In:** the Adviser's row from the previous run; today's verdict; the run date.
**Out:** a `date` or `None`.
**Behaviour:** the first run date of an unbroken `no eligible case` streak, carried
forward across the state table's refresh (`apply_to_frame(frame, read_existing)`),
cleared the moment any other verdict is reached. This one column is why a
per-Adviser event log was not needed.

---

## Outputs

| Table | Grain | Strategy |
|---|---|---|
| `selection_pool` | one row per selected Case | `AccumulateByRun` |
| `adviser_check_state` | one row per Adviser per Selection group | `Refresh()` |
| `adviser_check_daily` | `date × selection_group × shortfall × verdict × overdue` | `Refresh()`, rebuilt |

`adviser_check_daily` is the monitoring surface — and the input to the monthly
position review that tunes the declared numbers — and it is a **distribution, not
a total**: a population mostly one check behind is healthy — those are tomorrow's
selections — while a cluster several behind is not. Crossing shortfall with
verdict is what separates an Adviser catching up from one who is starved, and
`overdue` separates one who is merely waiting from one whose spacing has been
breached.
