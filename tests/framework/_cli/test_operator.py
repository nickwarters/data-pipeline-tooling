"""Operator CLI (`python -m cli`).

Drives the CLI as a subprocess so the tests exercise the same entry point an
operator does: argument parsing, dispatch, exit codes, and console output. These
tests cover the CLI *plumbing* only, so they run against the throwaway fixture
pipelines under ``tests/fixtures/clipipelines/`` rather than the real application
pipelines -- nothing here should break when ``pipelines/ingest`` or
``pipelines/selection`` change. The real pipelines' own end-to-end CLI coverage
lives in ``tests/integration/test_operator_cli_e2e.py``. Everything runs on local
SQLite only, with no external services.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "tests" / "fixtures"


def _cli(*args):
    # Put the fixture pipelines on the import path so `run clipipelines/<name>`
    # resolves to tests/fixtures/clipipelines/<name>/pipeline.py.
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            [str(FIXTURES), os.environ.get("PYTHONPATH", "")]
        ),
    }
    return subprocess.run(
        [sys.executable, "-m", "cli", *args],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=env,
    )


def test_run_executes_a_pipeline_by_its_path(tmp_path):
    result = _cli(
        "run",
        "clipipelines/_source",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "fixture" / "raw.db").exists()
    assert (tmp_path / "_registry" / "runs.db").exists()


def test_run_passes_params_to_path_addressed_pipeline(tmp_path):
    result = _cli(
        "run",
        "clipipelines/_source",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-06-22",
        "--param",
        "source_file=/share/upstream/claims/claims_20260622_a.csv",
        "--param",
        "batch=claims-20260622-a",
    )

    assert result.returncode == 0, result.stderr
    assert "source_file=/share/upstream/claims/claims_20260622_a.csv" in result.stdout


def test_run_redrives_a_business_run_under_a_logical_run_id(tmp_path):
    from tools.medallion import medallion
    from tools.store import StoreRegistry

    assert (
        _cli(
            "run",
            "clipipelines/_source",
            "--base-dir",
            str(tmp_path),
            "--run-date",
            "2026-05-29",
        ).returncode
        == 0
    )

    def downstream():
        return _cli(
            "run",
            "clipipelines/_downstream",
            "--base-dir",
            str(tmp_path),
            "--run-date",
            "2026-05-29",
            "--logical-run-id",
            "REDRIVE-7",
        )

    assert downstream().returncode == 0, downstream().stderr
    # Re-drive the same business run a second time.
    assert downstream().returncode == 0

    pool = (
        medallion(StoreRegistry(tmp_path), "fixture")
        .gold.reader("pool")
        .read()
        .to_pandas()
    )
    # Replaced under the one logical run id, not accumulated into duplicates.
    assert set(pool["logical_run_id"]) == {"REDRIVE-7"}
    assert list(pool["case_ref"]) == ["c1", "c2"]


def test_run_downstream_succeeds_after_fresh_source_history(tmp_path):
    # With a current successful _source run on record, the freshness gate passes
    # and _downstream runs to completion.
    assert (
        _cli(
            "run",
            "clipipelines/_source",
            "--base-dir",
            str(tmp_path),
            "--run-date",
            "2026-05-29",
        ).returncode
        == 0
    )

    downstream = _cli(
        "run",
        "clipipelines/_downstream",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
    )

    assert downstream.returncode == 0, downstream.stderr
    assert "FixturePool" in downstream.stdout


def test_orchestrate_runs_path_addressed_pipelines(tmp_path):
    # orchestrate now addresses each scheduled pipeline by its pipelines/<name>
    # path (via --app's build_pipeline_sets()), with no build_runner() registry.
    # One due-work pass runs _source then its freshness-gated _downstream, both
    # imported by path at runtime, and lands their medallion artifacts.
    result = _cli(
        "orchestrate",
        "--app",
        "cliapp",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
        "--once",
    )

    assert result.returncode == 0, result.stderr
    assert "fixture  _source  succeeded" in result.stdout
    assert "fixture  _downstream  succeeded" in result.stdout
    assert (tmp_path / "fixture" / "raw.db").exists()
    assert (tmp_path / "fixture" / "gold.db").exists()
    # The decisions are recorded in the orchestration store, keyed by leaf name.
    assert (tmp_path / "_orchestration" / "runs.db").exists()


def test_orchestrate_skips_a_pipeline_on_a_calendar_seeded_holiday(tmp_path):
    # The contrast with the test above: same app, same run date -- a Friday, so
    # only the seeded holiday can explain the skip -- but a --calendar file that
    # names it. The absent raw.db is what makes this end-to-end rather than a
    # string assertion. The printed reason names the *weekday*, because that is
    # what Weekdays.not_due_detail judges.
    calendar = tmp_path / "calendar.yml"
    calendar.write_text("holidays:\n  - 2026-05-29\n", encoding="utf-8")

    result = _cli(
        "orchestrate",
        "--app",
        "cliapp",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
        "--calendar",
        str(calendar),
        "--once",
    )

    assert result.returncode == 0, result.stderr
    assert "fixture  _source  skipped" in result.stdout
    assert not (tmp_path / "fixture" / "raw.db").exists()


def test_orchestrate_missing_calendar_file_reports_clear_error(tmp_path):
    result = _cli(
        "orchestrate",
        "--app",
        "cliapp",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
        "--calendar",
        str(tmp_path / "absent.yml"),
        "--once",
    )

    assert result.returncode != 0
    assert "no calendar file" in result.stderr
    assert "Traceback" not in result.stderr


def test_orchestrate_malformed_calendar_file_reports_clear_error(tmp_path):
    calendar = tmp_path / "calendar.yml"
    calendar.write_text("holidays: [not-a-date]\n", encoding="utf-8")

    result = _cli(
        "orchestrate",
        "--app",
        "cliapp",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
        "--calendar",
        str(calendar),
        "--once",
    )

    assert result.returncode != 0
    assert "holidays[0]" in result.stderr
    assert "Traceback" not in result.stderr


def _orchestrate_monthly(base_dir, run_date, calendar=None):
    """One orchestrate pass over the month-walk fixture app, in its own base dir.

    Each pass gets a fresh base directory so an earlier pass's run history can
    never be what satisfies a later one.
    """
    base_dir.mkdir(parents=True, exist_ok=True)
    extra = ("--calendar", str(calendar)) if calendar is not None else ()
    return _cli(
        "orchestrate",
        "--app",
        "clicalapp",
        "--base-dir",
        str(base_dir),
        "--run-date",
        run_date,
        *extra,
        "--once",
    )


def test_seeded_calendar_shifts_the_nth_working_day_of_month(tmp_path):
    # June 2026: the 1st is a Monday and so the month's first working day.
    calendar = tmp_path / "calendar.yml"
    calendar.write_text("holidays:\n  - 2026-06-01\n", encoding="utf-8")

    default = _orchestrate_monthly(tmp_path / "a", "2026-06-01")
    assert default.returncode == 0, default.stderr
    assert "monthly_nth  _source  succeeded" in default.stdout

    on_the_holiday = _orchestrate_monthly(tmp_path / "b", "2026-06-01", calendar)
    assert on_the_holiday.returncode == 0, on_the_holiday.stderr
    assert "monthly_nth  _source  skipped" in on_the_holiday.stdout
    assert not (tmp_path / "b" / "fixture" / "raw.db").exists()

    # The point of the third pass: with the 1st seeded as a holiday, Tuesday the
    # 2nd *is* the month's first working day. The month walk counts against the
    # seeded calendar, not merely the is_working_day gate.
    day_after = _orchestrate_monthly(tmp_path / "c", "2026-06-02", calendar)
    assert day_after.returncode == 0, day_after.stderr
    assert "monthly_nth  _source  succeeded" in day_after.stdout


def test_dry_run_previews_without_writing_artifacts(tmp_path):
    result = _cli(
        "run",
        "clipipelines/_source",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
        "--dry-run",
    )

    assert result.returncode == 0, result.stderr
    # Dry run must not land any store or registry.
    assert not (tmp_path / "fixture" / "raw.db").exists()
    assert not (tmp_path / "_registry" / "runs.db").exists()
    assert "dry run" in result.stdout.lower()
    assert "rows" in result.stdout


def test_dry_run_passes_params_to_the_previewed_pipeline(tmp_path):
    # A preview must see the same run parameters a real run does, or a pipeline
    # that reads context.params fails only under --dry-run.
    result = _cli(
        "run",
        "clipipelines/_source",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-06-22",
        "--param",
        "source_file=/share/upstream/claims/claims_20260622_a.csv",
        "--dry-run",
    )

    assert result.returncode == 0, result.stderr
    assert "source_file=/share/upstream/claims/claims_20260622_a.csv" in result.stdout
    assert not (tmp_path / "fixture" / "raw.db").exists()


def test_orchestrate_unknown_app_reports_clear_error(tmp_path):
    result = _cli(
        "orchestrate",
        "--app",
        "no_such_app_module",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
    )

    assert result.returncode != 0
    assert "no_such_app_module" in result.stderr
    assert "Traceback" not in result.stderr


def test_run_unknown_pipeline_reports_clear_error(tmp_path):
    result = _cli("run", "clipipelines/nope", "--base-dir", str(tmp_path))

    assert result.returncode != 0
    assert "no pipeline at 'clipipelines/nope'" in result.stderr
    assert "Traceback" not in result.stderr


def test_runs_lists_recent_runs_from_the_registry(tmp_path):
    assert (
        _cli(
            "run",
            "clipipelines/_source",
            "--base-dir",
            str(tmp_path),
            "--run-date",
            "2026-05-29",
        ).returncode
        == 0
    )

    result = _cli("runs", "--base-dir", str(tmp_path))

    assert result.returncode == 0, result.stderr
    assert "_source" in result.stdout
    assert "ok" in result.stdout


def _run_fixture_source(tmp_path, run_date="2026-05-29"):
    result = _cli(
        "run",
        "clipipelines/_source",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        run_date,
    )
    assert result.returncode == 0, result.stderr
    return result


def test_runs_shows_what_a_given_run_wrote(tmp_path):
    # The lineage question in the run direction, from the CLI: the run id an
    # operator reads off a run line, back to the table(s) that run landed.
    _run_fixture_source(tmp_path)
    listing = _cli("runs", "--base-dir", str(tmp_path))
    run_id = listing.stdout.split("[run ")[1].split("]")[0]

    result = _cli("runs", "--base-dir", str(tmp_path), "--run", run_id)

    assert result.returncode == 0, result.stderr
    assert "raw.db -> cases" in result.stdout
    assert run_id in result.stdout


def test_runs_shows_which_run_last_wrote_a_table(tmp_path):
    # The reverse direction: a table name back to the run behind it, with the
    # later of two runs winning.
    _run_fixture_source(tmp_path, run_date="2026-05-29")
    _run_fixture_source(tmp_path, run_date="2026-05-30")
    listing = _cli("runs", "--base-dir", str(tmp_path))
    latest_run_id = listing.stdout.strip().splitlines()[-1].split("[run ")[1].strip("]")

    result = _cli("runs", "--base-dir", str(tmp_path), "--table", "cases")

    assert result.returncode == 0, result.stderr
    assert latest_run_id in result.stdout
    assert "raw.db -> cases" in result.stdout


def test_runs_reports_a_table_nothing_has_written(tmp_path):
    _run_fixture_source(tmp_path)

    result = _cli("runs", "--base-dir", str(tmp_path), "--table", "no_such_table")

    assert result.returncode == 0, result.stderr
    assert "no committed write" in result.stdout


def test_status_shows_latest_run_per_pipeline(tmp_path):
    assert (
        _cli(
            "run",
            "clipipelines/_source",
            "--base-dir",
            str(tmp_path),
            "--run-date",
            "2026-05-29",
        ).returncode
        == 0
    )

    result = _cli("status", "--base-dir", str(tmp_path), "--pipeline", "_source")

    assert result.returncode == 0, result.stderr
    assert "_source" in result.stdout
    assert "ok" in result.stdout


def test_log_summarizes_a_run_log_file(tmp_path):
    assert (
        _cli(
            "run",
            "clipipelines/_source",
            "--base-dir",
            str(tmp_path),
            "--run-date",
            "2026-05-29",
        ).returncode
        == 0
    )

    result = _cli("log", "_source", "--base-dir", str(tmp_path))

    assert result.returncode == 0, result.stderr
    assert "_source" in result.stdout
    assert "ok" in result.stdout
    assert "step records" in result.stdout


def test_format_record_includes_zero_row_metrics():
    from cli.operator import _format_record

    line = _format_record(
        {
            "step": "write",
            "status": "ok",
            "rows_in": None,
            "rows_out": 0,
            "rows_quarantined": 0,
            "rows_excluded": 0,
            "duration": None,
            "errors": [],
            "warn_hits": [],
        }
    )

    assert "rows_in=" not in line
    assert "rows_out=0" in line
    assert "rows_quarantined=0" in line
    assert "rows_excluded=0" in line


def test_status_without_a_registry_reports_clear_error(tmp_path):
    result = _cli("status", "--base-dir", str(tmp_path))

    assert result.returncode != 0
    assert "no run registry" in result.stderr
    assert "Traceback" not in result.stderr


def test_log_without_a_log_file_reports_clear_error(tmp_path):
    result = _cli("log", "_source", "--base-dir", str(tmp_path))

    assert result.returncode != 0
    assert "no run log" in result.stderr
    assert "Traceback" not in result.stderr


def test_run_stale_upstream_reports_clear_error(tmp_path):
    # _downstream declares _source as a freshness upstream; with only stale
    # _source history the run must abort with a clear stale-upstream message, not
    # a crash. The shared registry catches up from every _runs/*.log, so a record
    # in the upstream's own log is enough to drive the freshness verdict.
    log = tmp_path / "_runs" / "_source.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(
        json.dumps(
            {
                "timestamp": "2026-05-20T00:00:00+00:00",
                "pipeline_run_id": "old",
                "pipeline": "_source",
                "step": "run",
                "status": "ok",
                "errors": [],
                "warn_hits": [],
            }
        )
        + "\n",
        encoding="utf-8",
    )

    result = _cli(
        "run",
        "clipipelines/_downstream",
        "--base-dir",
        str(tmp_path),
        "--run-date",
        "2026-05-29",
    )

    assert result.returncode != 0
    assert "upstream _source is stale" in result.stderr
    assert "Traceback" not in result.stderr


def test_skip_freshness_is_generic_and_params_keep_their_pipeline_meaning(
    tmp_path, monkeypatch
):
    import cli.operator as operator

    loaded = SimpleNamespace(
        name="_downstream", run=lambda context: None, upstreams=("fresh",)
    )
    captured = []
    monkeypatch.setattr(operator, "load_pipeline", lambda path: loaded)
    monkeypatch.setattr(
        operator,
        "run_pipeline",
        lambda *args, **kwargs: captured.append(kwargs),
    )

    args = SimpleNamespace(
        pipeline="clipipelines/_downstream",
        base_dir=str(tmp_path),
        env=None,
        dry_run=False,
        params=[("publish_only", "true")],
        skip_freshness=False,
        run_date=None,
        logical_run_id=None,
        freshness_days=0,
    )
    assert operator._run(args) == 0
    assert captured[-1]["upstreams"] == ("fresh",)
    assert captured[-1]["params"] == {"publish_only": "true"}

    args.skip_freshness = True
    assert operator._run(args) == 0
    assert captured[-1]["upstreams"] == ()
    assert captured[-1]["params"] == {"publish_only": "true"}


def test_run_validation_failure_reports_clear_error(tmp_path, monkeypatch, capsys):
    # A pipeline whose run(context) fails a data check raises ValidationError; the
    # operator should present the message and a non-zero exit, not a traceback.
    from types import SimpleNamespace

    from cli import operator
    from framework.core import ValidationError

    def boom(_context):
        raise ValidationError("row count 0 below required minimum 1")

    # Stand in for the resolved pipelines/<name>/pipeline.py, addressed by path.
    monkeypatch.setattr(
        operator,
        "load_pipeline",
        lambda path: SimpleNamespace(name="boom", run=boom, upstreams=()),
    )

    code = operator.main(["run", "pipelines/boom", "--base-dir", str(tmp_path)])

    assert code == 1
    assert "below required minimum" in capsys.readouterr().err


def test_reviewer_publish_only_malformed_gold_is_a_clean_cli_failure(
    tmp_path, monkeypatch, capsys
):
    import pandas as pd

    from cli import operator
    from framework.core import Dataset
    from framework.io import Refresh
    from pipelines.reviewer_activity.pipeline import run
    from tools.medallion import medallion
    from tools.store import StoreRegistry

    medallion(StoreRegistry(tmp_path), "reviewer_activity").gold.writer(
        "reviewer_activity_daily", Refresh()
    ).write(
        Dataset.from_pandas(
            pd.DataFrame(
                [
                    {
                        "reviewer_account": "a.khan",
                        "reportable_date": "2026-08-01",
                        "case_type": "claims",
                        "count": "not-an-int",
                        "as_of_utc": "2026-08-01T00:00:00+00:00",
                    }
                ]
            )
        )
    )
    monkeypatch.setattr(
        operator,
        "load_pipeline",
        lambda path: SimpleNamespace(name="reviewer_activity", run=run, upstreams=()),
    )

    code = operator.main(
        [
            "run",
            "pipelines/reviewer_activity",
            "--base-dir",
            str(tmp_path),
            "--skip-freshness",
            "--param",
            "publish_only=true",
        ]
    )

    error = capsys.readouterr().err
    assert code == 1
    assert "expected int" in error
    assert "Traceback" not in error


def test_run_resolves_base_dir_from_env(tmp_path):
    # No --base-dir: --env names the environment, whose configured root comes
    # from its OS variable (tools.environments). The registry lands there.
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            [str(FIXTURES), os.environ.get("PYTHONPATH", "")]
        ),
        "PIPELINE_DATA_DIR_DEV": str(tmp_path),
    }
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "cli",
            "run",
            "clipipelines/_source",
            "--env",
            "dev",
            "--run-date",
            "2026-05-29",
        ],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "_registry" / "runs.db").exists()


def test_explicit_base_dir_overrides_env(tmp_path):
    # An explicit --base-dir wins even when --env is also given.
    explicit = tmp_path / "explicit"
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            [str(FIXTURES), os.environ.get("PYTHONPATH", "")]
        ),
        "PIPELINE_DATA_DIR_DEV": str(tmp_path / "from_env"),
    }
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "cli",
            "run",
            "clipipelines/_source",
            "--base-dir",
            str(explicit),
            "--env",
            "dev",
            "--run-date",
            "2026-05-29",
        ],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert (explicit / "_registry" / "runs.db").exists()
    assert not (tmp_path / "from_env").exists()


def test_run_uses_prod_environment_override_without_traceback(tmp_path):
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            [str(FIXTURES), os.environ.get("PYTHONPATH", "")]
        ),
        "PIPELINE_DATA_DIR_PROD": str(tmp_path / "prod"),
    }
    result = subprocess.run(
        [sys.executable, "-m", "cli", "run", "clipipelines/_source", "--env", "prod"],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "prod" / "_runs" / "_source.log").exists()


def test_run_reports_unknown_env_without_traceback(monkeypatch, capsys):
    from types import SimpleNamespace

    from cli import operator

    monkeypatch.setattr(
        operator,
        "load_pipeline",
        lambda path: SimpleNamespace(
            name=path, run=lambda _context: None, upstreams=()
        ),
    )

    assert operator.main(["run", "pipelines/fixture", "--env", "staging"]) == 1
    stderr = capsys.readouterr().err
    assert "unknown environment 'staging'" in stderr
    assert "Traceback" not in stderr


def test_status_and_log_resolve_base_dir_from_env(tmp_path):
    # Populate a registry under the env-resolved root, then query it via --env.
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            [str(FIXTURES), os.environ.get("PYTHONPATH", "")]
        ),
        "PIPELINE_DATA_DIR_DEV": str(tmp_path),
    }

    def cli_env(*args):
        return subprocess.run(
            [sys.executable, "-m", "cli", *args],
            capture_output=True,
            text=True,
            cwd=ROOT,
            env=env,
        )

    assert (
        cli_env(
            "run", "clipipelines/_source", "--env", "dev", "--run-date", "2026-05-29"
        ).returncode
        == 0
    )
    status = cli_env("status", "--env", "dev")
    assert status.returncode == 0, status.stderr
    assert "_source" in status.stdout
    # log takes a trailing `subject` positional; base_dir comes from --env.
    log = cli_env("log", "_source", "--env", "dev")
    assert log.returncode == 0, log.stderr
    assert "_source" in log.stdout


def test_every_usage_example_in_the_module_docstring_parses():
    # The docstring is the first thing an author reads, so a stale example there
    # is worse than a stale one in the docs. Each `python -m cli ...` line it
    # shows is fed back through the real parser, so an option that is renamed or
    # turned into a flag cannot leave a broken example behind.
    import re
    import shlex

    import cli.operator as operator

    examples = re.findall(r"^    python -m cli (.+)$", operator.__doc__, re.MULTILINE)
    assert len(examples) == 7, examples
    parser = operator.build_parser()
    for example in examples:
        args = shlex.split(example.replace("<", "_").replace(">", "_"))
        parsed = parser.parse_args(args)  # SystemExit here means a stale example
        assert parsed.command == args[0]


# --- migrate ---------------------------------------------------------------
#
# The migrations tree these drive is a throwaway one under tmp_path, named by
# --migrations-root: the repository's own tree is the deployed subjects' and
# must not decide whether this plumbing works.

CREATE_CASES = "CREATE TABLE cases (case_id TEXT PRIMARY KEY);\n"
CREATE_EVENTS = "CREATE TABLE events (event_id TEXT PRIMARY KEY);\n"


def _migration(root, subject, database, name, sql):
    """Write one migration file into a throwaway migrations tree."""
    directory = root / subject / database
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(sql, encoding="utf-8")
    return directory / name


def _tables(db_path):
    import sqlite3

    con = sqlite3.connect(db_path)
    try:
        return {
            row[0]
            for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        con.close()


def test_migrate_applies_every_database_the_tree_names(tmp_path):
    # The tree is the registry of which databases exist: two subjects, three
    # databases between them, all brought up to date in one command.
    tree = tmp_path / "migrations"
    _migration(tree, "cases", "raw", "0001_create_cases.sql", CREATE_CASES)
    _migration(tree, "cases", "silver", "0001_create_cases.sql", CREATE_CASES)
    _migration(tree, "activity", "gold", "0001_create_events.sql", CREATE_EVENTS)
    base = tmp_path / "data"

    result = _cli("migrate", "--base-dir", str(base), "--migrations-root", str(tree))

    assert result.returncode == 0, result.stderr
    assert "cases" in _tables(base / "cases" / "raw.db")
    assert "cases" in _tables(base / "cases" / "silver.db")
    assert "events" in _tables(base / "activity" / "gold.db")
    assert "applied 1: 0001_create_cases.sql" in result.stdout
    assert "migrated 3 database(s): 3 applied, 0 up to date, 0 failed" in result.stdout


def test_migrate_reports_a_database_that_is_already_current(tmp_path):
    tree = tmp_path / "migrations"
    _migration(tree, "cases", "raw", "0001_create_cases.sql", CREATE_CASES)
    base = tmp_path / "data"
    _cli("migrate", "--base-dir", str(base), "--migrations-root", str(tree))

    result = _cli("migrate", "--base-dir", str(base), "--migrations-root", str(tree))

    assert result.returncode == 0, result.stderr
    assert "up to date" in result.stdout
    assert "migrated 1 database(s): 0 applied, 1 up to date, 0 failed" in result.stdout


def test_migrate_check_exits_non_zero_and_writes_nothing_when_pending(tmp_path):
    # The CI gate: it must report the outstanding file by name and leave the
    # database untouched — not even created.
    tree = tmp_path / "migrations"
    _migration(tree, "cases", "raw", "0001_create_cases.sql", CREATE_CASES)
    base = tmp_path / "data"

    result = _cli(
        "migrate", "--base-dir", str(base), "--migrations-root", str(tree), "--check"
    )

    assert result.returncode == 1
    assert "pending 1: 0001_create_cases.sql" in result.stdout
    assert "checked 1 database(s): 1 pending, 0 up to date, 0 failed" in result.stdout
    assert not (base / "cases" / "raw.db").exists()


def test_migrate_check_exits_zero_when_everything_is_applied(tmp_path):
    tree = tmp_path / "migrations"
    _migration(tree, "cases", "raw", "0001_create_cases.sql", CREATE_CASES)
    base = tmp_path / "data"
    _cli("migrate", "--base-dir", str(base), "--migrations-root", str(tree))

    result = _cli(
        "migrate", "--base-dir", str(base), "--migrations-root", str(tree), "--check"
    )

    assert result.returncode == 0, result.stderr
    assert "up to date" in result.stdout


def test_migrate_resolves_base_dir_from_the_dev_environment(tmp_path):
    # No --base-dir and no --env: the same default the run command takes.
    tree = tmp_path / "migrations"
    _migration(tree, "cases", "raw", "0001_create_cases.sql", CREATE_CASES)
    base = tmp_path / "from_env"
    env = {
        **os.environ,
        "PIPELINE_DATA_DIR_DEV": str(base),
    }
    result = subprocess.run(
        [sys.executable, "-m", "cli", "migrate", "--migrations-root", str(tree)],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert "cases" in _tables(base / "cases" / "raw.db")


def test_migrate_explicit_base_dir_overrides_the_environment(tmp_path):
    tree = tmp_path / "migrations"
    _migration(tree, "cases", "raw", "0001_create_cases.sql", CREATE_CASES)
    explicit = tmp_path / "explicit"
    env = {**os.environ, "PIPELINE_DATA_DIR_DEV": str(tmp_path / "from_env")}
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "cli",
            "migrate",
            "--base-dir",
            str(explicit),
            "--env",
            "dev",
            "--migrations-root",
            str(tree),
        ],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert (explicit / "cases" / "raw.db").exists()
    assert not (tmp_path / "from_env").exists()


def test_migrate_isolates_one_broken_subject_from_the_rest(tmp_path):
    # Each database is independent, with its own ledger, so a bad set in one
    # must not decide whether the others get migrated — but the command still
    # exits non-zero.
    tree = tmp_path / "migrations"
    _migration(tree, "broken", "raw", "0001_bad.sql", "CRATE TABLE oops (x INT);\n")
    _migration(tree, "cases", "raw", "0001_create_cases.sql", CREATE_CASES)
    base = tmp_path / "data"

    result = _cli("migrate", "--base-dir", str(base), "--migrations-root", str(tree))

    assert result.returncode == 1
    assert "FAILED" in result.stderr
    assert "0001_bad.sql" in result.stderr
    assert "cases" in _tables(base / "cases" / "raw.db")
    assert "migrated 2 database(s): 1 applied, 0 up to date, 1 failed" in result.stdout


def test_migrate_reports_an_empty_tree_without_failing(tmp_path):
    # Nothing has opted in yet — the state the repository is in today.
    result = _cli(
        "migrate",
        "--base-dir",
        str(tmp_path / "data"),
        "--migrations-root",
        str(tmp_path / "absent"),
    )

    assert result.returncode == 0, result.stderr
    assert "no migrations under" in result.stdout


def test_migrate_does_not_judge_what_a_database_is_called(tmp_path):
    # The tree names a subject and a database within it. raw/silver/gold is the
    # tools.medallion profile's reading of those names, not the migrate
    # command's, so a subject whose databases are named otherwise migrates the
    # same way.
    tree = tmp_path / "migrations"
    _migration(tree, "reference", "lookups", "0001_create_cases.sql", CREATE_CASES)
    base = tmp_path / "data"

    result = _cli("migrate", "--base-dir", str(base), "--migrations-root", str(tree))

    assert result.returncode == 0, result.stderr
    assert "cases" in _tables(base / "reference" / "lookups.db")
