```python
"""``tools.environments``: resolving a medallion ``base_dir`` from a named env.

The mapping is an operational concern that lives outside the framework, so these
tests pin the precedence (explicit arg -> ``PIPELINE_ENV`` -> default), the
per-env OS variable override, the dev fallback that keeps a fresh clone runnable,
and the actionable errors for an unknown or unconfigured environment.
"""

from pathlib import Path

import pytest

from tools.environments import (
    DEFAULT_ENV,
    known_environments,
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

```
