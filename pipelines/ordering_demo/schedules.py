"""The demo's schedules: one set whose items differ only in their ordering.

The module an operator names on the command line::

    python -m cli orchestrate --app pipelines.ordering_demo.schedules \\
        --base-dir /tmp/ordering-demo --once

Every relative time is computed when :func:`build_pipeline_sets` is called, so
the demo tells the same story whenever it is run.
"""

from __future__ import annotations

import datetime as dt

from framework.run import FreshnessRequirement
from tools.observability.timestamps import local_now
from tools.orchestration import (
    PipelineSet,
    Schedule,
    ScheduledPipeline,
    SpecificWeekdays,
)

_HOUR = dt.timedelta(hours=1)


def build_pipeline_sets():
    """The demo's single :class:`PipelineSet`, timed against the local clock."""
    now = local_now()
    an_hour_ago = _clamped(now - _HOUR, now.date(), edge=dt.time(0, 0))
    two_hours_ago = _clamped(now - 2 * _HOUR, now.date(), edge=dt.time(0, 0))
    in_an_hour = _clamped(now + _HOUR, now.date(), edge=dt.time(23, 59))

    return (
        PipelineSet(
            "ordering_demo",
            (
                ScheduledPipeline(
                    "pipelines/ordering_demo/overdue",
                    Schedule.daily(),
                    due_time=an_hour_ago,
                ),
                ScheduledPipeline(
                    "pipelines/ordering_demo/later",
                    Schedule.daily(),
                    earliest_run=in_an_hour,
                ),
                ScheduledPipeline(
                    "pipelines/ordering_demo/urgent",
                    Schedule.daily(),
                    priority=100,
                ),
                ScheduledPipeline(
                    "pipelines/ordering_demo/report",
                    Schedule.daily(),
                    depends_on=(FreshnessRequirement("steady"),),
                    due_time=an_hour_ago,
                ),
                # No deadline of its own: it inherits report's, so it is ordered
                # under the same pressure as the item waiting on it.
                ScheduledPipeline(
                    "pipelines/ordering_demo/steady",
                    Schedule.daily(),
                ),
                ScheduledPipeline(
                    "pipelines/ordering_demo/tomorrow",
                    _tomorrow_only(now.date()),
                ),
                # Declared last and attempted first: the tightest deadline in
                # the pool, held back by no dependency.
                ScheduledPipeline(
                    "pipelines/ordering_demo/very_overdue",
                    Schedule.daily(),
                    due_time=two_hours_ago,
                ),
            ),
        ),
    )


def _clamped(moment: dt.datetime, run_date: dt.date, *, edge: dt.time) -> dt.time:
    """The moment's time of day, held inside the run date it belongs to.

    Both fields are times on the run date with no next-day meaning, so an hour
    either side of midnight would otherwise wrap and read as the opposite of
    what it means — an hour ago becoming late tonight. Clamping to the edge of
    the day keeps the demo saying what it intends near midnight.
    """
    if moment.date() != run_date:
        return edge
    return moment.time().replace(second=0, microsecond=0)


def _tomorrow_only(today: dt.date) -> Schedule:
    """A schedule due on tomorrow's weekday, and so genuinely not due today.

    Not due rather than switched off: the item is reported ``skipped`` because
    its schedule does not match today, which is the case the ordering puts last.
    A disabled item would read as ``disabled`` and demonstrate something else.
    """
    return SpecificWeekdays([(today + dt.timedelta(days=1)).weekday()])
