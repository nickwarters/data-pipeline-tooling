"""``tools.environments``: resolving a medallion ``base_dir`` from a named env.

The mapping is an operational concern that lives outside the framework, so these
tests pin the precedence (explicit arg -> ``PIPELINE_ENV`` -> default), the
per-env OS variable override, the dev fallback that keeps a fresh clone runnable,
and the actionable errors for an unknown or unconfigured environment.
"""

from pathlib import Path

import pytest

from framework.io.writers import require_declared_tables_enabled
from tools.environments import (
    DEFAULT_ENV,
    activate_environment,
    base_dir_for,
    known_environments,
    require_declared_tables,
    resolve_base_dir,
)


def test_dev_falls_back_to_cwd_data(tmp_path, monkeypatch):
    monkeypatch.delenv("PIPELINE_DATA_DIR_DEV", raising=False)
    monkeypatch.chdir(tmp_path)
    assert resolve_base_dir("dev") == tmp_path / "data"


def test_default_env_is_used_when_nothing_is_passed(tmp_path, monkeypatch):
    monkeypatch.delenv("PIPELINE_ENV", raising=False)
    monkeypatch.delenv("PIPELINE_DATA_DIR_DEV", raising=False)
    monkeypatch.chdir(tmp_path)
    assert DEFAULT_ENV == "dev"
    assert resolve_base_dir() == tmp_path / "data"


def test_pipeline_env_variable_selects_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("PIPELINE_ENV", "prod")
    monkeypatch.setenv("PIPELINE_DATA_DIR_PROD", str(tmp_path / "share"))
    assert resolve_base_dir() == tmp_path / "share"


def test_explicit_arg_overrides_pipeline_env(tmp_path, monkeypatch):
    monkeypatch.setenv("PIPELINE_ENV", "prod")
    monkeypatch.delenv("PIPELINE_DATA_DIR_DEV", raising=False)
    monkeypatch.chdir(tmp_path)
    assert resolve_base_dir("dev") == tmp_path / "data"


def test_per_env_variable_overrides_the_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv("PIPELINE_DATA_DIR_DEV", str(tmp_path / "custom"))
    assert resolve_base_dir("dev") == tmp_path / "custom"


def test_env_name_is_case_insensitive_and_trimmed(tmp_path, monkeypatch):
    monkeypatch.setenv("PIPELINE_DATA_DIR_PROD", str(tmp_path / "share"))
    assert resolve_base_dir("  PROD ") == tmp_path / "share"


def test_unknown_environment_raises_with_the_known_names(monkeypatch):
    with pytest.raises(ValueError) as excinfo:
        resolve_base_dir("staging")
    message = str(excinfo.value)
    assert "staging" in message
    assert "dev" in message and "prod" in message


def test_known_env_without_a_configured_path_raises(monkeypatch):
    monkeypatch.delenv("PIPELINE_DATA_DIR_PROD", raising=False)
    with pytest.raises(ValueError) as excinfo:
        resolve_base_dir("prod")
    assert "PIPELINE_DATA_DIR_PROD" in str(excinfo.value)


def test_known_environments_lists_the_registered_names():
    assert set(known_environments()) == {"dev", "prod"}


def test_returns_a_path_object(tmp_path, monkeypatch):
    monkeypatch.setenv("PIPELINE_DATA_DIR_PROD", str(tmp_path))
    assert isinstance(resolve_base_dir("prod"), Path)


def test_resolving_dev_activates_its_require_declared_tables_guard(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("PIPELINE_DATA_DIR_DEV", str(tmp_path))
    from framework.io.writers import set_require_declared_tables

    set_require_declared_tables(False)
    resolve_base_dir("dev")
    assert require_declared_tables_enabled() is True


def test_resolving_prod_leaves_the_guard_off_during_the_rollout(tmp_path, monkeypatch):
    # prod flips only once an operator has run `schema diff --env prod` clean;
    # until then resolving it must actively turn the guard *off*, not merely
    # leave whatever the last resolved environment set.
    monkeypatch.setenv("PIPELINE_DATA_DIR_PROD", str(tmp_path))
    from framework.io.writers import set_require_declared_tables

    set_require_declared_tables(True)
    resolve_base_dir("prod")
    assert require_declared_tables_enabled() is False


def test_an_explicit_base_dir_override_still_activates_the_environment(tmp_path):
    # The hole a resolve-time-only side effect leaves: `--base-dir` supplies
    # the root directly, but the run is still *in* an environment, and whether
    # a Writer may create an undeclared table is that environment's decision.
    from framework.io.writers import set_require_declared_tables

    set_require_declared_tables(False)
    assert base_dir_for("dev", override=tmp_path / "elsewhere") == (
        tmp_path / "elsewhere"
    )
    assert require_declared_tables_enabled() is True


def test_an_override_resolves_no_root_so_an_unconfigured_env_still_works(monkeypatch):
    # prod has no fallback, so resolving its root would raise -- but an
    # explicit base_dir needs no root resolved, and must keep working.
    monkeypatch.delenv("PIPELINE_DATA_DIR_PROD", raising=False)
    assert base_dir_for("prod", override="/share/prod") == Path("/share/prod")
    assert require_declared_tables_enabled() is False


def test_activate_environment_applies_the_policy_without_resolving_a_root(monkeypatch):
    monkeypatch.delenv("PIPELINE_DATA_DIR_DEV", raising=False)
    from framework.io.writers import set_require_declared_tables

    set_require_declared_tables(False)
    activate_environment("dev")  # no chdir, no configured root: still fine
    assert require_declared_tables_enabled() is True


def test_require_declared_tables_is_a_pure_query_with_no_side_effect():
    from framework.io.writers import set_require_declared_tables

    set_require_declared_tables(False)
    assert require_declared_tables("dev") is True
    assert require_declared_tables("prod") is False
    assert require_declared_tables_enabled() is False  # reading changed nothing


def test_an_unknown_environment_is_refused_even_with_an_explicit_base_dir():
    with pytest.raises(ValueError) as excinfo:
        base_dir_for("staging", override="/tmp/anywhere")
    assert "staging" in str(excinfo.value)
