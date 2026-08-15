"""Operator CLI for common pipeline tasks.

A small command surface so operators do not need to write wrapper scripts to run
pipelines or inspect their history. It sits on top of the public ``framework.run``
orchestration (``PipelineRunner``), ``RunRegistry``, and ``RunLog``. Everything
stays local SQLite + JSONL, with no external services.

Run from the repository root so the import-only ``framework`` package resolves::

    python -m cli run pipelines/orders --base-dir /data --run-date 2026-05-29
    python -m cli status --base-dir /data --subject cases
    python -m cli runs --base-dir /data --pipeline cases/ingest --limit 5
    python -m cli runs --base-dir /data --run fd76eda3
    python -m cli runs --base-dir /data --table case_current
    python -m cli log cases --base-dir /data --pipeline-run-id <pipeline-run-id>
    python -m cli migrate --base-dir /data --check

The base directory is the option ``--base-dir`` (or ``--env <name>``, which
resolves one), never a positional argument.

``migrate`` applies the SQL migrations that own the *shape* of those databases.
It walks the repository's ``migrations/`` tree — the only registry of which
databases are under migration control — and brings each ``<subject>/<database>``
it names, under the resolved base directory, up to date; ``--check`` reports
instead of writing.

``run`` addresses a pipeline by *its location on disk*: ``pipelines/orders`` maps
to the module ``pipelines.orders.pipeline``, imported at runtime, whose
``run(context)`` callable the framework executes (reading an optional
``UPSTREAMS`` tuple for freshness). The dependency stays one-way -- the framework
imports the pipeline *by path at runtime*, never statically -- so ``pipelines/``
depends on ``framework``, not the reverse.

``orchestrate`` runs the *same* path-addressed pipelines on a schedule. It knows
the scheduled machinery but not *which* pipelines an application schedules, so it
takes a required ``--app`` naming a module that exposes ``build_pipeline_sets()``
(the schedules); execution itself is by path, exactly as ``run`` does it, so no
handler registry is wired up front. Its working-day calendar is seeded by the
optional ``--calendar <file>`` (a YAML calendar file of ``holidays`` and
``weekend``); omitted, the calendar is weekends-only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib
import json
import sys
from pathlib import Path

from framework.core import PipelineError, format_failure
from framework.run import (
    RunRegistry,
    UnknownPipelineError,
    dry_run_pipeline,
    load_pipeline,
    run_pipeline,
)
from tools.calendar import WorkingDayCalendar
from tools.environments import ENV_VAR, known_environments, resolve_base_dir
from tools.migrations import (
    MIGRATIONS_ROOT,
    MigrationError,
    MigrationRunner,
    discover_targets,
)
from tools.observability.run_store import RunStore
from tools.orchestration import Orchestrator
from tools.store import StoreRegistry


def _resolve_app(name: str):
    """Import the application module that supplies the orchestration schedules.

    A thin seam so the framework imports the app by name at runtime (keeping the
    dependency one-way) and so tests can substitute a fake ``build_pipeline_sets``.

    A mistyped or unimportable module is an operator-facing configuration error,
    so it is raised as :class:`UnknownPipelineError` and rendered through the
    same clean failure block every other CLI error path uses.
    """
    try:
        module = importlib.import_module(name)
    except ImportError as exc:
        raise UnknownPipelineError(
            f"cannot import application module {name!r} for --app "
            "(expected a module exposing build_pipeline_sets(), "
            "importable from the repo root)"
        ) from exc
    if not callable(getattr(module, "build_pipeline_sets", None)):
        raise UnknownPipelineError(
            f"application module {name!r} defines no build_pipeline_sets() callable"
        )
    return module


def _base_dir_or_report(args: argparse.Namespace) -> Path | None:
    """Resolve ``base_dir`` from ``--base-dir`` or ``--env``.

    An explicit ``--base-dir`` always wins; when omitted it is resolved from
    ``--env`` (or ``$PIPELINE_ENV``) via
    :func:`tools.environments.resolve_base_dir`. Returns ``None`` after printing
    an actionable message when the environment can't be resolved.
    """
    if getattr(args, "base_dir", None):
        return Path(args.base_dir)
    try:
        return resolve_base_dir(getattr(args, "env", None))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return None


def _calendar_or_report(args: argparse.Namespace) -> WorkingDayCalendar | None:
    """Resolve the working-day calendar from the optional ``--calendar`` file.

    Without the flag the calendar is the weekends-only default, so every
    existing invocation keeps working. Returns ``None`` — reserved strictly for
    the failure case, never for "no flag given" — after printing an actionable
    message when the file is missing or malformed.
    """
    if not getattr(args, "calendar", None):
        return WorkingDayCalendar()
    try:
        return WorkingDayCalendar.from_yaml(args.calendar)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return None


def _add_base_dir_args(parser: argparse.ArgumentParser) -> None:
    """Add the shared ``--base-dir`` and ``--env`` options to a command."""
    parser.add_argument(
        "--base-dir",
        dest="base_dir",
        default=None,
        help="medallion root directory; omit to resolve it from --env",
    )
    parser.add_argument(
        "--env",
        help="named environment to resolve base_dir from when no --base-dir is "
        f"given ({', '.join(known_environments())}); defaults to ${ENV_VAR} or "
        "the dev environment",
    )


def _open_registry(base_dir: str | Path) -> RunRegistry | None:
    """Open the run registry under ``base_dir``, or ``None`` if none exists yet."""
    store = RunStore(base_dir)
    if not store.registry_path.exists():
        return None
    return store.registry()


def _load_registry_or_report(base_dir: str | Path) -> RunRegistry | None:
    """Open the registry, printing a clear operator message when it is absent."""
    registry = _open_registry(base_dir)
    if registry is None:
        print(
            f"no run registry under {base_dir!r}; run a pipeline first",
            file=sys.stderr,
        )
    return registry


def _format_run(record: dict) -> str:
    """One human-readable line for a ``run`` summary record from the registry."""
    parts = [
        record.get("timestamp") or "?",
        record.get("pipeline") or "?",
        record.get("status") or "?",
    ]
    if record.get("rows_out") is not None:
        parts.append(f"rows_out={record['rows_out']}")
    if record.get("warn_hits"):
        parts.append(f"warn={'; '.join(record['warn_hits'])}")
    parts.append(f"[run {(record.get('pipeline_run_id') or '')[:8]}]")
    return "  ".join(parts)


def _run(args: argparse.Namespace) -> int:
    try:
        loaded = load_pipeline(args.pipeline)
    except UnknownPipelineError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    base_dir = _base_dir_or_report(args)
    if base_dir is None:
        return 1
    params = dict(args.params)
    if args.dry_run:
        report = dry_run_pipeline(
            loaded.run,
            loaded.name,
            base_dir,
            run_date=args.run_date,
            logical_run_id=args.logical_run_id,
            params=params,
            freshness_days=args.freshness_days,
        )
        print(report.render())
        if report.failed:
            print(format_failure(report.error), file=sys.stderr)
            return 1
        return 0
    try:
        run_pipeline(
            loaded.run,
            loaded.name,
            base_dir,
            upstreams=() if args.skip_freshness else loaded.upstreams,
            run_date=args.run_date,
            logical_run_id=args.logical_run_id,
            params=params,
            freshness_days=args.freshness_days,
        )
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    return 0


def _orchestrate(args: argparse.Namespace) -> int:
    base_dir = _base_dir_or_report(args)
    if base_dir is None:
        return 1
    calendar = _calendar_or_report(args)
    if calendar is None:
        return 1
    try:
        app = _resolve_app(args.app)
        orchestrator = Orchestrator(
            app.build_pipeline_sets(),
            calendar,
        )
        # The two modes are mutually exclusive at the parser, and a single pass
        # is the default when neither is named.
        if args.once or not args.loop:
            result = orchestrator.run_due_once(base_dir, run_date=args.run_date)
            decisions = list(result.decisions)
        else:
            results = orchestrator.run_until_complete(
                base_dir,
                run_date=args.run_date,
                poll_seconds=args.poll_seconds,
                max_idle_polls=args.max_idle_polls,
            )
            decisions = [d for result in results for d in result.decisions]
    except PipelineError as exc:
        print(format_failure(exc), file=sys.stderr)
        return 1
    for decision in decisions:
        line = (
            f"{decision.run_date.isoformat()}  {decision.set_name}  "
            f"{decision.pipeline}  {decision.status}"
        )
        if decision.reason:
            line += f"  {decision.reason}"
        print(line)
    if any(decision.status == "failed" for decision in decisions):
        return 1
    return 0


def _migrate(args: argparse.Namespace) -> int:
    """``migrate``: bring every database the migrations tree names up to date.

    The tree is walked rather than a list of databases being configured
    anywhere — one under migration control is one with a directory in it. Each is
    an independent file with its own ledger, so a failure in one is reported and
    the walk continues to the rest (the same per-item failure isolation
    ``orchestrate`` uses); the command exits non-zero at the end if anything
    failed.

    ``--check`` reports what is outstanding and exits non-zero if anything is,
    writing nothing — a CI gate. It is deliberately not wired into
    ``run`` / ``orchestrate``: a pipeline can be invoked directly as
    ``python -m pipelines.<name>``, which would bypass such a check anyway, and
    a run against an unmigrated database already fails at the write.
    """
    base_dir = _base_dir_or_report(args)
    if base_dir is None:
        return 1
    root = Path(args.migrations_root) if args.migrations_root else MIGRATIONS_ROOT
    targets = discover_targets(root)
    if not targets:
        print(f"no migrations under {root}")
        return 0
    registry = StoreRegistry(base_dir)
    width = max(len(target.namespace) for target in targets)
    outstanding = current = failed = 0
    for target in targets:
        db_path = registry.db_file(target.namespace)
        label = f"{target.namespace.ljust(width)}  {db_path}"
        runner = MigrationRunner(db_path, target.directory)
        try:
            migrations = runner.pending() if args.check else runner.apply()
        except MigrationError as exc:
            print(f"{label}  FAILED: {exc}", file=sys.stderr)
            failed += 1
            continue
        if not migrations:
            print(f"{label}  up to date")
            current += 1
            continue
        outstanding += 1
        names = ", ".join(migration.name for migration in migrations)
        verb = "pending" if args.check else "applied"
        print(f"{label}  {verb} {len(migrations)}: {names}")
    action, state = ("checked", "pending") if args.check else ("migrated", "applied")
    print(
        f"{action} {len(targets)} database(s): {outstanding} {state}, "
        f"{current} up to date, {failed} failed"
    )
    if failed or (args.check and outstanding):
        return 1
    return 0


def _runs(args: argparse.Namespace) -> int:
    base_dir = _base_dir_or_report(args)
    if base_dir is None:
        return 1
    registry = _load_registry_or_report(base_dir)
    if registry is None:
        return 1
    if args.run is not None:
        return _runs_wrote(registry, args.run)
    if args.table is not None:
        return _runs_wrote_table(registry, args.table, args.namespace)
    summaries = registry.query_runs(pipeline=args.pipeline, status=args.status)
    if not summaries:
        print("no matching runs")
        return 0
    for record in summaries[-args.limit :]:
        print(_format_run(record))
    return 0


def _runs_wrote(registry: RunRegistry, pipeline_run_id: str) -> int:
    """``runs --run <id>``: what one run wrote, one line per location it landed."""
    writes = registry.writes_for_run(pipeline_run_id)
    if not writes:
        print(f"no committed writes for run {pipeline_run_id!r}")
        return 0
    for record in writes:
        for location in record.get("data_locations") or []:
            print(_format_write(record, location))
    return 0


def _runs_wrote_table(registry: RunRegistry, name: str, namespace: str | None) -> int:
    """``runs --table <name>``: the run that last committed a write to it."""
    record = registry.last_write_of(name, namespace=namespace)
    if record is None:
        where = f" in namespace {namespace!r}" if namespace else ""
        print(f"no committed write to {name!r}{where}")
        return 0
    print(_format_run(record))
    for location in record.get("data_locations") or []:
        if location.get("name") == name:
            print(f"  {_format_write(record, location)}")
    return 0


def _format_write(record: dict, location: dict) -> str:
    """One human-readable line for a location a run's step committed to."""
    parts = [
        record.get("step_address") or record.get("step") or "?",
        f"{location.get('namespace', '?')} -> {location.get('name', '?')}",
    ]
    if record.get("rows_out") is not None:
        parts.append(f"rows_out={record['rows_out']}")
    parts.append(f"[run {(record.get('pipeline_run_id') or '')[:8]}]")
    return "  ".join(parts)


def _format_record(record: dict) -> str:
    """One human-readable line for any RunLog step/summary record."""
    parts = [f"{record.get('step', '?')}: {record.get('status', '?')}"]
    for field in ("rows_in", "rows_out", "rows_quarantined", "rows_excluded"):
        value = record.get(field)
        if value is not None:
            parts.append(f"{field}={value}")
    if record.get("duration") is not None:
        parts.append(f"{record['duration']:.3f}s")
    if record.get("errors"):
        parts.append(f"errors={'; '.join(record['errors'])}")
    if record.get("warn_hits"):
        parts.append(f"warn={'; '.join(record['warn_hits'])}")
    return "  ".join(parts)


def _log(args: argparse.Namespace) -> int:
    base_dir = _base_dir_or_report(args)
    if base_dir is None:
        return 1
    path = RunStore(base_dir).log_path_for(args.subject)
    if not path.exists():
        print(f"no run log at {path}", file=sys.stderr)
        return 1
    records = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if args.pipeline_run_id is not None:
        records = [
            r
            for r in records
            if (r.get("pipeline_run_id") or "").startswith(args.pipeline_run_id)
        ]
        if not records:
            print(
                f"no records for run {args.pipeline_run_id!r} in {path}",
                file=sys.stderr,
            )
            return 1
    summary = [r for r in records if r.get("step") == "run"]
    print(f"run log: {path}")
    for record in records:
        print(f"  {record.get('pipeline', '?')}  {_format_record(record)}")
    warned = sum(1 for r in summary if r.get("warn_hits"))
    failed = sum(1 for r in summary if r.get("status") != "ok")
    print(
        f"{len(records)} step records across {len(summary)} run(s): "
        f"{failed} failed, {warned} warned"
    )
    return 0


def _status(args: argparse.Namespace) -> int:
    base_dir = _base_dir_or_report(args)
    if base_dir is None:
        return 1
    registry = _load_registry_or_report(base_dir)
    if registry is None:
        return 1
    if args.pipeline is not None:
        # One named pipeline: its most recent run summary.
        summaries = registry.query_runs(pipeline=args.pipeline)
        latest = summaries[-1:] if summaries else []
    else:
        latest = registry.latest_run_per_pipeline()
        if args.subject is not None:
            prefix = f"{args.subject}/"
            latest = [r for r in latest if (r.get("pipeline") or "").startswith(prefix)]
    if not latest:
        print("no matching runs")
        return 0
    for record in latest:
        print(_format_run(record))
    return 0


def register(sub) -> None:
    """Add the operator commands to the unified ``python -m cli`` CLI."""
    run = sub.add_parser("run", help="run a pipeline by its pipelines/ path")
    run.add_argument(
        "pipeline",
        help="the pipeline's location under pipelines/, e.g. pipelines/orders",
    )
    _add_base_dir_args(run)
    run.add_argument("--run-date", type=_date, default=dt.date.today())
    run.add_argument(
        "--logical-run-id",
        help="re-drive this business run: a re-run with the same id replaces its "
        "rows (default: <pipeline>:<run-date>)",
    )
    run.add_argument("--freshness-days", type=int, default=0)
    run.add_argument(
        "--skip-freshness",
        action="store_true",
        help="skip declared upstream freshness checks for an explicit re-drive",
    )
    run.add_argument(
        "--param",
        dest="params",
        action="append",
        type=_param,
        default=[],
        metavar="KEY=VALUE",
        help="pass a run parameter to run(context), e.g. source_file=/path/file.csv",
    )
    run.add_argument(
        "--dry-run",
        action="store_true",
        help="preview the pipeline (read/process/validate) without writing any "
        "artifacts; prints columns, dtypes, row counts, and a row sample per step",
    )
    run.set_defaults(func=_run)

    orchestrate = sub.add_parser("orchestrate", help="run scheduled due work")
    _add_base_dir_args(orchestrate)
    orchestrate.add_argument("--run-date", type=_date, default=dt.date.today())
    mode = orchestrate.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="run one due-work pass")
    mode.add_argument("--loop", action="store_true", help="poll until due work settles")
    orchestrate.add_argument(
        "--poll-seconds",
        type=float,
        default=5,
        help="seconds between loop polls (default 5)",
    )
    orchestrate.add_argument(
        "--max-idle-polls",
        type=int,
        default=3,
        help="stop a loop after N idle polls (default 3)",
    )
    orchestrate.add_argument(
        "--app",
        required=True,
        help="application module exposing build_pipeline_sets() (the schedules)",
    )
    orchestrate.add_argument(
        "--calendar",
        default=None,
        metavar="FILE",
        help="YAML calendar file seeding the working-day calendar's holidays "
        "and weekend rule; omit for the default (weekends only, no holidays)",
    )
    orchestrate.set_defaults(func=_orchestrate)

    migrate = sub.add_parser(
        "migrate", help="apply SQL migrations to every database the tree names"
    )
    _add_base_dir_args(migrate)
    migrate.add_argument(
        "--check",
        action="store_true",
        help="report what is outstanding and exit non-zero if anything is, "
        "without writing (a CI gate)",
    )
    migrate.add_argument(
        "--migrations-root",
        dest="migrations_root",
        default=None,
        metavar="DIR",
        help=f"the migrations tree to apply (default: {MIGRATIONS_ROOT}); for an "
        "alternate checkout",
    )
    migrate.set_defaults(func=_migrate)

    runs = sub.add_parser("runs", help="list recent runs from the run registry")
    _add_base_dir_args(runs)
    runs.add_argument(
        "--pipeline", help="narrow to one pipeline label, e.g. cases/ingest"
    )
    runs.add_argument("--status", help="narrow to a run status, e.g. ok or error")
    runs.add_argument(
        "--limit", type=int, default=10, help="show the most recent N (default 10)"
    )
    # The two lineage directions, each replacing the listing rather than
    # narrowing it, so they are exclusive of one another.
    direction = runs.add_mutually_exclusive_group()
    direction.add_argument(
        "--run",
        metavar="RUN_ID",
        help="instead of listing runs, show what this run wrote (id or prefix)",
    )
    direction.add_argument(
        "--table",
        metavar="NAME",
        help="instead of listing runs, show the run that last wrote this table "
        "(or file); for a Refresh() target that run wrote every row in it",
    )
    runs.add_argument(
        "--namespace",
        help="disambiguate --table when the same name exists in two databases, "
        "e.g. sqlite:/data/cases/silver.db",
    )
    runs.set_defaults(func=_runs)

    status = sub.add_parser("status", help="show the latest run status per pipeline")
    _add_base_dir_args(status)
    status.add_argument("--pipeline", help="one pipeline label, e.g. cases/ingest")
    status.add_argument("--subject", help="narrow to a subject's pipelines, e.g. cases")
    status.set_defaults(func=_status)

    log = sub.add_parser("log", help="inspect/summarize a run log file")
    _add_base_dir_args(log)
    log.add_argument("subject", help="the subject whose _runs/<subject>.log to read")
    log.add_argument(
        "--pipeline-run-id",
        dest="pipeline_run_id",
        help="only records whose pipeline run id starts with this",
    )
    log.set_defaults(func=_log)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m cli")
    register(parser.add_subparsers(dest="command", required=True))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


def _date(value: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"expected YYYY-MM-DD date, got {value!r}"
        ) from exc


def _param(value: str) -> tuple[str, str]:
    key, separator, param_value = value.partition("=")
    if not separator or not key:
        raise argparse.ArgumentTypeError(f"expected KEY=VALUE parameter, got {value!r}")
    return key, param_value


if __name__ == "__main__":  # pragma: no cover - thin CLI entry
    raise SystemExit(main())
