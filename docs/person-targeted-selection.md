# Person-targeted Selection — the rules, as pure functions

The decision and its reasoning are in
[ADR-0022](adr/0022-person-targeted-selection-plans-per-adviser.md); the domain
language is in [`../CONTEXT.md`](../CONTEXT.md). This document is the **rule
surface**: every business rule the framework applies, as a small named pure
function with its inputs, output and behaviour spelled out.

Nothing here is built yet. The signatures are illustrative — the *shape* is the
deliverable, not the exact parameter list. They follow the convention already set
by [`../pipelines/case_selection/rules.py`](../pipelines/case_selection/rules.py):
each rule is a pure function of plain rows plus explicit configuration, testable
with a `dict` and a `date`, with no `Pipeline`, no pandas and no IO.

> **The existing `pipelines/case_selection/rules.py` is a demo approximation**
> written before these rules were settled. Its numbers differ (target 10 with no
> minimum, 21 *calendar* days between checks, 15 *calendar* days of sale
> recency), it has no catch-up cadence and no combined-check quota, and it names
> the risk bands "case type" where they are **Variations**. Read it for the
> function-per-rule shape, not for the policy.

## Row shapes

Three inputs, all plain mappings:

```python
Sale = {
    "adviser":     str,    # lower-cased bare account
    "case_type":   str,
    "sale_id":     str,
    "sale_date":   date,
    "risk_score":  int,
    "channel":     str,    # with risk_score, determines the Variation set
}

# One row of Sync's rule-neutral monthly aggregate. Only Cases that reached
# Reportable appear at all, bucketed by the calendar month they became
# Reportable — which is why a Case voided before Reportable is simply absent.
CheckCount = {
    "adviser":     str,
    "case_type":   str,
    "month":       tuple[int, int],   # (year, month) it became Reportable
    "variations":  str,               # "1" | "2" | "3" | "1+2" | "1+3"
    "status":      str,               # In-progress | Actions In Progress | Completed | Void
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
(ADR-0022). Never constants inside a rule module — these are expected to be tuned.

```python
@dataclass(frozen=True)
class CheckRegime:
    """Everything a Case Type declares for person-targeted Selection."""
    case_type:              str
    check_minimum:          int = 8    # the compliance floor
    check_target:           int = 10   # what Selection aims at, above the floor
    target_months:          int = 12   # the rolling window, in calendar months
    variation_1_quota:      int = 2    # full-year, pro-rata'd below
    combined_quota:         int = 2    # full-year, pro-rata'd below
    behind_band:            int = 2    # shortfall at which the catch-up cadence applies
    cadence_days:           int = 20   # working days after Reportable, normally
    catch_up_cadence_days:  int = 5    # working days after Reportable, while Behind
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

### `active_months(sales, as_of, regime)`

**In:** all of one Adviser's sales for this Case Type; the run date; the regime.
**Out:** an `int` in `0..12`.
**Behaviour:** the count of window months in which the Adviser made **at least
one sale for this Case Type**. This is the denominator of every pro-rata figure
below. An Adviser with no sales at all scores `0`, which makes their target `0` —
they are compliant trivially, which is why **the sales feed alone is a complete
roster** and no separate Adviser list is needed.

```python
def active_months(sales: Sequence[Sale], as_of: date, regime: CheckRegime) -> int:
    window = rolling_months(as_of, count=regime.target_months)
    return len({
        (s["sale_date"].year, s["sale_date"].month)
        for s in sales
        if s["case_type"] == regime.case_type
        and (s["sale_date"].year, s["sale_date"].month) in window
    })
```

### `pro_rata(full_year_value, months, regime)`

**In:** a full-year figure; the Adviser's active months; the regime.
**Out:** an `int`.
**Behaviour:** scales a full-year figure to the Adviser's activity, rounded half
up. **One rounding rule, shared by the target, the minimum and both quotas** — so
the quotas can never round above the target they sit inside.

```python
def pro_rata(full_year_value: int, months: int, regime: CheckRegime) -> int:
    return _round_half_up(full_year_value * months / regime.target_months)
```

| Full-year | 12 months | 6 | 3 | 1 |
|---|---:|---:|---:|---:|
| target `10` | 10 | 5 | 3 | 1 |
| minimum `8` | 8 | 4 | 2 | 1 |
| quota `2` | 2 | 1 | 1 | 0 |

The last row is the reason quotas pro-rata at all: fixed at `2`, a one-active-month
Adviser would owe two combined checks against a target of one — unsatisfiable by
construction (ADR-0022).

---

## 2 — Variations

### `variations_for(sale, regime)`

**In:** one sale; the regime.
**Out:** a canonical variation string — `"1"`, `"2"`, `"3"`, `"1+2"` or `"1+3"`.
**Behaviour:** derived from the sale's **channel** and its **risk attributes** —
determined by the Case, never chosen by Selection. Above a declared risk
threshold the check becomes **combined**, which pairs variation 1 with one other.
Variation 1 is always present in a combined check; `"2+3"` does not exist.

The canonical string is stored, and nothing derived from it is stored — no
`is_combined` column, no `has_variation_1` flag. Two stored spellings of one fact
invite two implementations of the quota rule.

### `is_combined(variations)` / `covers_variation(variations, n)`

**In:** a canonical variation string.
**Out:** `bool`.
**Behaviour:** `is_combined` is "contains a `+`". `covers_variation` is set
membership. Because every combined check contains variation 1,
`is_combined(v) implies covers_variation(v, 1)` — **a combined check ticks both
quota boxes**, and the variation-1 quota binds only as a fallback for an Adviser
who cannot get combined Cases.

```python
def is_combined(variations: str) -> bool:
    return "+" in variations

def covers_variation(variations: str, n: int) -> bool:
    return str(n) in variations.split("+")
```

---

## 3 — Counting checks

### `checks_in_window(counts, as_of, regime, *, variations_filter=None)`

**In:** one Adviser's `CheckCount` rows; the run date; the regime; an optional
predicate over the variation string.
**Out:** an `int`.
**Behaviour:** sums `check_count` across the window months, keeping only rows
whose `status` is in `regime.countable_statuses`. Because the aggregate is
bucketed by **Reportable** month, **a voided Case never appears and needs no
subtracting anywhere** — the single most load-bearing consequence of counting at
Reportable rather than at selection.

```python
def checks_in_window(
    counts: Sequence[CheckCount],
    as_of: date,
    regime: CheckRegime,
    *,
    variations_filter: Callable[[str], bool] | None = None,
) -> int:
    window = rolling_months(as_of, count=regime.target_months)
    return sum(
        c["check_count"]
        for c in counts
        if c["month"] in window
        and c["status"] in regime.countable_statuses
        and (variations_filter is None or variations_filter(c["variations"]))
    )
```

The variation-1 and combined tallies are the same function with a filter:

```python
variation_1_checks = checks_in_window(
    counts, as_of, regime, variations_filter=lambda v: covers_variation(v, 1))
combined_checks = checks_in_window(
    counts, as_of, regime, variations_filter=is_combined)
```

---

## 4 — Standing: shortfall and Behind

### `shortfall(counts, sales, as_of, regime)`

**In:** the Adviser's check counts and sales; the run date; the regime.
**Out:** an `int`, floored at `0`.
**Behaviour:** `pro-rata target − checks in window`. This is both the capacity
gate (`shortfall == 0` means at target, so not selectable) **and** the
cross-Adviser sort key.

```python
def shortfall(counts, sales, as_of, regime) -> int:
    months = active_months(sales, as_of, regime)
    target = pro_rata(regime.check_target, months, regime)
    return max(0, target - checks_in_window(counts, as_of, regime))
```

### `variation_shortfalls(counts, sales, as_of, regime)`

**Out:** `(variation_1_shortfall, combined_shortfall)`.
**Behaviour:** each pro-rata quota minus the matching tally, floored at `0`.
**Combined shortfall dominates when steering** — closing it closes both, so a
Case whose variations are combined is preferred over one that is merely
variation 1.

### `is_behind(counts, sales, as_of, regime)`

**In / Out:** as above; `bool`.
**Behaviour:** `shortfall >= regime.behind_band` (2). **A tolerance band, not
"below target"** — every selectable Adviser is below target by construction, so a
bare shortfall would make every Adviser permanently Behind and the 20-day cadence
dead code (ADR-0022). Drives *which* cadence applies, nothing else.

```python
def is_behind(counts, sales, as_of, regime) -> bool:
    return shortfall(counts, sales, as_of, regime) >= regime.behind_band
```

---

## 5 — Cadence

### `next_eligible_date(current, behind, regime, calendar)`

**In:** the Adviser's `AdviserCurrent` row; whether they are Behind; the regime;
a `WorkingDayCalendar`.
**Out:** a `date`, or `None` when they have never had a check.
**Behaviour:** **one milestone, two durations** — `last_reportable_date` plus 20
working days normally, plus 5 while Behind. An Adviser with no history is eligible
immediately.

```python
def next_eligible_date(current, behind, regime, calendar) -> date | None:
    last = current["last_reportable_date"]
    if last is None:
        return None                       # never checked -> eligible now
    days = regime.catch_up_cadence_days if behind else regime.cadence_days
    return calendar.add_working_days(last, days)
```

> `WorkingDayCalendar` has `last_n_working_days` but no forward-add or
> between-count today. `add_working_days(day, n)` and `working_days_between(a, b)`
> are the two small additions this framework needs
> ([`working-day-calendar.md`](working-day-calendar.md)).

### `has_outstanding_check(current)`

**Out:** `bool`.
**Behaviour:** `outstanding_case_count > 0`. **Outstanding begins at delivery,
not at allocation** — a Case sitting unallocated in the **Hopper** already counts.
This is the only role the Hopper plays in this framework: not a volume gate, just
the earliest observable state of this rule.

### `within_cadence(current, behind, as_of, regime, calendar)`

**Out:** `bool`.
**Behaviour:** the Adviser is blocked by pacing — either something is outstanding,
or `as_of` has not yet reached `next_eligible_date`.

```python
def within_cadence(current, behind, as_of, regime, calendar) -> bool:
    if has_outstanding_check(current):
        return True
    nxt = next_eligible_date(current, behind, regime, calendar)
    return nxt is not None and as_of < nxt
```

**A void frees the Adviser immediately**, and it falls out of these two functions
rather than needing a rule: a voided Case never reached Reportable, so
`last_reportable_date` still points at the *previous* check — long elapsed — and
the voided Case is no longer outstanding.

---

## 6 — Which Case

### `is_selectable_sale(sale, as_of, regime, calendar)`

**Out:** `bool`.
**Behaviour:** the sale falls within the last `sale_window_days` (15) **working**
days on or before `as_of`. The demo's `is_recent_sale` counts calendar days;
every duration in this framework is a working-day duration.

### `eligible_cases(sales, as_of, regime, calendar, *, voided_sale_ids)`

**In:** one Adviser's sales; the run date; the regime; the calendar; the sale ids
that already produced a **voided** Case.
**Out:** a list of sales.
**Behaviour:** the sales inside the working-day window, **minus any sale that
already produced a voided Case**. That exclusion is the guard against the *void
loop*: re-selecting a sale voided as a `duplicate` mints the same deterministic
`case_id` and reproduces the duplicate (ADR-0022).

### `best_case(cases, variation_shortfalls, regime)`

**In:** the Adviser's eligible sales; their `(variation_1, combined)` shortfalls.
**Out:** one sale.
**Behaviour:** the sort *within* one Adviser. **Combined shortfall dominates** —
prefer a Case whose variations close the outstanding quota, since a combined Case
closes both. Then **highest risk score**, then `sale_id` to stay deterministic.

```python
def best_case(cases, variation_shortfalls, regime) -> Sale:
    v1_short, combined_short = variation_shortfalls
    def key(sale):
        v = variations_for(sale, regime)
        return (
            0 if (combined_short > 0 and is_combined(v)) else
            1 if (v1_short > 0 and covers_variation(v, 1)) else 2,
            -int(sale["risk_score"]),
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
def check_verdict(counts, sales, current, as_of, regime, calendar, voided_sale_ids):
    short = shortfall(counts, sales, as_of, regime)
    if short == 0:
        return "at target", f"at the pro-rata target of {…}", None

    behind = short >= regime.behind_band
    if within_cadence(current, behind, as_of, regime, calendar):
        return "within cadence", "…outstanding check / next eligible <date>", None

    cases = eligible_cases(sales, as_of, regime, calendar,
                           voided_sale_ids=voided_sale_ids)
    if not cases:
        return "no eligible case", f"no sale within {regime.sale_window_days} working days", None

    return "selected", "…", best_case(cases, variation_shortfalls(...), regime)
```

| Verdict | Meaning | Alarming |
|---|---|---|
| `selected` | a Case was chosen | no |
| `at target` | already at their pro-rata target | no |
| `within cadence` | outstanding check, or inside the 20/5-day spacing | no |
| **`no eligible case`** | **owes a check, nothing available** | **yes** |

### `selection_order(verdicts)`

**In:** every Adviser's verdict and standing.
**Out:** the selected Advisers, ordered.
**Behaviour:** **largest shortfall first**, then highest risk score of the chosen
Case. Self-correcting — anyone not served today is further behind tomorrow and
rises. Note this does **not** cap anything: nothing limits daily volume, which is
emergent from the roster (ADR-0022). The order matters for reporting, for
delivery sequence, and if a cap is ever introduced.

### `plan_checks(...)`

**In:** the whole roster's sales, check counts and current state.
**Out:** `(selection_pool_rows, adviser_state_rows)`.
**Behaviour:** the orchestrating pure function — the analogue of
`select_cases` in the demo. One `check_verdict` per Adviser in the roster, the
selected ones ordered by `selection_order`, and **one state row per Adviser
considered**, carrying target, shortfall, quotas, `is_behind`,
`next_eligible_date`, verdict and `unservable_since`.

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
| `adviser_check_state` | one row per Adviser | `Refresh()` |
| `adviser_check_daily` | `date × case_type × shortfall × verdict` | `Refresh()`, rebuilt |

`adviser_check_daily` is the monitoring surface, and it is a **distribution, not a
total**: a population mostly one check behind is healthy — those are tomorrow's
selections — while a cluster four-to-six behind is not. Crossing shortfall with
verdict is what separates an Adviser catching up from one who is starved.
