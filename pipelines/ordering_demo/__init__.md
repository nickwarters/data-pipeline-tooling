```python
"""A runnable demonstration of how orchestration orders due work within a set.

Seven tiny pipelines that differ only in the ordering fields they declare. Each
reads a couple of made-up rows already in memory, validates them against a
throwaway schema, and prints them to the console — nothing is written to a data
file, so the demo can be run anywhere, repeatedly, with only the framework's own
run metadata landing under the base directory.

The seven are flat siblings under ``pipelines/``, one package each, named
``demo_<item>``: a pipeline is known by the leaf of its path, so nesting them
here would give two pipelines in different folders the same run identity. This
package holds only what they share — the schedules, the common body, and the
calendar — and is not itself a pipeline.

Run the whole set::

    python -m cli orchestrate --app pipelines.ordering_demo.schedules \\
        --calendar pipelines/ordering_demo/calendar.yml \\
        --base-dir /tmp/ordering-demo --once

The bundled calendar makes every day a working day, so the demo has due work on
a Saturday too; omit it and a weekend run has nothing to order.

What each item demonstrates, and what to look for in the output:

``demo_steady``
    Due today with no deadline of its own. ``demo_report`` depends on it, so
    it *inherits* ``demo_report``'s deadline and is ordered under the same
    pressure — and it is attempted **before** ``demo_report`` despite being
    declared after it, because dependency order dominates deadline and
    priority alike.
``demo_overdue``
    Due today with a deadline an hour in the past. It interleaves with the two
    above by how overdue each one is.
``demo_very_overdue``
    Due today with a deadline two hours in the past, and declared **last** in
    the set. It is attempted first regardless: nothing in the pool presses
    harder, and no dependency holds it back.
``demo_urgent``
    Due today with ``priority=100`` and no deadline. It sorts after every
    overdue item — priority never outranks a deadline — but ahead of the rest of
    the deadline-free due work.
``demo_later``
    Due today but gated by an ``earliest_run`` an hour in the future. It is
    never invoked this pass and is recorded ``skipped``, with the window named
    in its reason.
``demo_tomorrow``
    Not due today at all. Work that is not due is reported after the day's work,
    whatever the others declare.

The relative times are computed when ``build_pipeline_sets()`` is called, so the
story holds whenever the demo is run. The rule itself is documented in
``docs/operator-cli.md`` under "Run order within a set".
"""

```
