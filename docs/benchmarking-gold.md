# Benchmarking a gold publication

The `sharepoint_cases` feed rebuilds gold whole on every poll. Once the feed
polls hourly across eight Case lists, the obvious question is whether that is
too much work to repeat every hour — and, if it is, which part to move.

`scripts/benchmark_gold.py` answers it by measuring, so the decision is not made
from intuition about which code *looks* expensive.

## Run it

```sh
python -m scripts.benchmark_gold --base-dir /tmp/bench
python -m scripts.benchmark_gold --base-dir /tmp/bench --sweep
python -m scripts.benchmark_gold --base-dir /tmp/bench --lists 8 --cases 5000
```

On Windows, against the storage the feed will really use:

```bat
python -m scripts.benchmark_gold --base-dir \\server\share\bench
```

`--base-dir` is where the medallion databases are written, so **pointing it at a
network share is how you measure that share**. The script creates one
`benchmark_gold/` subdirectory underneath, and removes only that; it refuses to
start if the subdirectory already exists rather than deleting anything it did not
create. `--keep` leaves the databases behind.

`--sweep` and `--keep` are unrelated: the first chooses *what* to measure (the
ladder below instead of a single point, ignoring `--lists` / `--cases` /
`--versions`), the second chooses whether to delete the databases afterwards.

Mind the disk, because this data is not small. Silver runs about 0.4KB a row —
the largest sweep rung is 640MB of silver plus 40MB of gold. Each rung is freed
before the next one starts, so peak usage is the biggest single scenario rather
than the ladder's total; `--keep` holds all of them, which over the full sweep is
roughly 1.2GB.

The data is synthetic but shaped like the real silver table, and the hop it times
is the real `case_current_hop` — not a stand-in. Treat the ratios as the
finding and the absolute seconds as specific to the machine and the disk.

## The two phases, and why only one of them grows

`gold.publish_gold` does two different things:

| Phase | Reads | Grows with |
|---|---|---|
| `case_current` | the **whole** silver history | every observation ever polled — forever |
| the four `case_current`-sourced aggregates (`case_counts_current`, `case_age_buckets_current`, `case_age_from_assigned_buckets_current`, `case_throughput_daily`) | the resulting current-state frame, already in memory | the **Case count** — bounded by the team's workload |

Silver is append-only, so the first phase has no natural ceiling. The second
touches one row per Case, and never sees the history at all.

**This script measures neither of the two Detail Table aggregates
(`answer_remediation_current`, `appeal_outcomes_current`)**: it runs only
`case_current_hop` and `publish_aggregates`, never the Detail hops
(`gold_detail_hop`, `publish_gold`) those two aggregates reduce from, so
they are out of scope rather than measured at zero — do not read the numbers
below as covering them.

## Measured baseline

macOS, local SSD, one warm pass then one timed pass:

| lists × cases × versions | Silver rows | Cases | `case_current` | Aggregates | Total | Agg % |
|---|---:|---:|---:|---:|---:|---:|
| 1 × 5,000 × 4 | 20,000 | 5,000 | 0.31s | 0.04s | 0.35s | 10.8% |
| 8 × 5,000 × 4 | 160,000 | 40,000 | 2.96s | 0.26s | 3.22s | 8.0% |
| 8 × 5,000 × 10 | 400,000 | 40,000 | 6.96s | 0.26s | 7.23s | 3.6% |
| 8 × 5,000 × 20 | 800,000 | 40,000 | 13.73s | 0.26s | 13.99s | 1.9% |
| 8 × 10,000 × 20 | 1,600,000 | 80,000 | 29.54s | 0.58s | 30.13s | 1.9% |

The aggregate column is the finding: **0.26s at 160,000 silver rows, and 0.26s
at 800,000**. It is flat in history depth, exactly as the table above predicts,
and it moves only when the Case count doubles. `case_current` is linear in total
observations at roughly 18.5µs per row.

## What follows from that

**The aggregates are published on the sync's schedule, not their own.** Moving
them to a separate daily pipeline would save around a quarter of a second per
hour while leaving the phase that actually grows exactly where it is. It would
also cost a pipeline, a schedule entry, a freshness dependency and a re-read of
`case_current` from disk that the in-process version gets for free.

There is a second reason, independent of cost. `case_counts_current`,
`case_age_buckets_current` and `case_age_from_assigned_buckets_current` are
*current-state* tables — who is holding what, and what is ageing. Publishing
them daily while the feed syncs hourly would leave them up to a day stale,
which defeats the point of syncing hourly.

**When it does become a problem, `case_current` is the thing to attack.** Taking
~60s per hourly run as the point where the work starts to feel wasteful, that is
somewhere around 3 million silver rows on a local disk. The fix then is to stop
rescanning the whole history to find each Case's latest version — not to relocate
the group-bys. Note that `case_current` is `Refresh()` today, so it is rebuilt
whole every run by design; making it incremental is a real change with its own
convergence story, which is why it is not worth pre-paying for.

## Reading the `read` column on a share

The script times the silver read on its own, as a component of `case_current`
rather than in addition to it. On the local SSD above, 3.06s of `case_current`'s
6.96s at 400,000 rows is that read.

That ratio is what a network share changes. If `read` dominates on the share, the
bottleneck is fetching the database over the network and the phase split above
still holds — more strongly, in fact, because the aggregates never touch silver.
Caching means a second run can read faster than a first; compare like with like.

`seed` is the script writing its own test data and is not work a real run does,
but on a share it is a useful sanity check on write throughput.
