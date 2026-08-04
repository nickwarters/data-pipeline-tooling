# Palimpsest 500-question performance gate

Date: 2026-07-18

## Result

The technical gate passes: the headed Microsoft Edge steady-state keystroke
p95 was **0.30 ms**, below the approximately 5 ms tripwire in ADR-0034.

The project owner subsequently accepted the result on issue #408 and PR #433.
The temporary browser harness, synthetic bank, and generator used to gather the
measurements were removed after the Palimpsest migration completed. This report
is retained as the historical evidence behind ADR-0034, not as a live benchmark
runbook.

Terminology: this report predates ADR-0039, which renamed `morph()` to
`render()`. The `morph()`/"morphed" wording below is left as it was measured;
read it as today's `src/core/render.js`.

## Fixture and workload

The synthetic fixture contained 500 Question Definitions in 20 Question Groups
of 25. The first group contained the free-text Answer used by the steady-state
scenario and the fan-out gate. Setting the gate Answer to `Yes` changed
applicability for 125 downstream Question Definitions across five Question
Groups.

The mock-only harness loaded that fixture through the standard bank loader and
mounted through the route-local store, `memo()`, and `morph()`. A normal text
edit morphed one dirty Question Group; toggling the fan-out gate morphed its
group plus the five groups whose applicability changed.

## Environment

- Microsoft Edge 150.0.4078.83, headed (user agent `Edg/150.0.0.0`)
- macOS 26.3.1, arm64
- Base commit `28d512b9d96519b4f42e09b437fc8265748aacfd`
- Local HTTP server, mock mode; Edge background networking and component
  updates disabled for the run

## Method

Ten clean route loads were measured. Each load captured one initial mount, 100
steady-state text keystrokes after one warm-up edit, and 20 alternating fan-out
gate dispatches. Percentiles use the nearest-rank method over the combined raw
samples.

The initial-mount timer starts when the route creates its state slice and ends
after the initial shell and every Question Group have been morphed. It includes
initial state derivation and route-store construction, but excludes lazy module
and `.txt` transfer/parsing time because the bank must exist before the slice
can be created.

The timing boundary starts in the text control's `keydown` handler (or the
fan-out control's change handler) and ends after synchronous dispatch, store
update, memo lookup, and every dirty-group `morph()` completes. This is the
presentation-ready point inside the current frame; it deliberately excludes
the display's refresh interval, which the application cannot reduce and which
is outside ADR-0034's keydown → dispatch → store → group-morph gate.

## Measurements

| Scenario                    | Samples |     p50 |         p95 |      Max | Work performed                                                           |
| --------------------------- | ------: | ------: | ----------: | -------: | ------------------------------------------------------------------------ |
| Initial route mount         |      10 | 5.90 ms |    10.00 ms | 10.00 ms | State/store creation plus initial processing of 500 definitions          |
| Steady-state text keystroke |   1,000 | 0.20 ms | **0.30 ms** |  2.30 ms | One Answer, one Question Group; unchanged cards return memoised nodes    |
| Worst-case fan-out dispatch |     200 | 1.40 ms |     2.50 ms |  3.90 ms | Gate Answer plus 125 applicability changes across six dirty groups total |

The steady-state p95 has 4.70 ms of headroom against the approximately 5 ms
tripwire.

## Human decision

The project owner signed off the go decision through the acceptance checkbox on
PR #433, recorded on issue #408 on 2026-07-18. ADR-0034 records the accepted
decision and the completed migration status.
