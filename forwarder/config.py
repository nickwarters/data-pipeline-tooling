"""The Forwarder's declared configuration.

A config file is a mapping with one key::

    tasks:
      - action: create_sharepoint_items
        list_name: Cases-complaints
        file_pattern: "create-complaints-*.json"
      - action: update_sharepoint_items
        list_name: Cases-appeals
        file_pattern: "update-appeals-*.json"
      - action: copy_file_to_sharepoint
        file_pattern: "*.xlsx"
        destination_dir: "Shared Documents/Reports"
        method: copy

Each task names an ``action`` and the ``file_pattern`` selecting the queued
files that action applies to. An action may require further keys of its own —
the list actions name the ``list_name`` they write to, and
``copy_file_to_sharepoint`` needs a ``destination_dir`` and takes an optional
``method``. A queued file therefore carries data only: which list it lands in is
the operator's declaration, not the producer's. The declaration is the whole
world: the Forwarder does only what a task names, so an operator problem is
raised as a :class:`ValueError` naming the file rather than left to surface as a
parser exception or, worse, as silence.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

CREATE_SHAREPOINT_ITEMS = "create_sharepoint_items"

UPDATE_SHAREPOINT_ITEMS = "update_sharepoint_items"

COPY_FILE_TO_SHAREPOINT = "copy_file_to_sharepoint"

CopyMethod = Literal["copy", "move"]

# Copy is safer by default: a failed move can lose the source, while
# copy-then-archive leaves retries idempotent.
COPY = "copy"
MOVE = "move"
COPY_METHODS = (COPY, MOVE)

CONFIG_KEYS = ("tasks",)

BASE_TASK_KEYS = ("action", "file_pattern")

# The keys each known action adds to the base ones. An action absent here is
# parsed against the base keys alone and ignored at run time.
ACTION_REQUIRED_KEYS = {
    CREATE_SHAREPOINT_ITEMS: ("list_name",),
    UPDATE_SHAREPOINT_ITEMS: ("list_name",),
    COPY_FILE_TO_SHAREPOINT: ("destination_dir",),
}

PER_ITEM_RETRY_KEY = "enable_per_item_retry_next_run"

ACTION_OPTIONAL_KEYS = {
    CREATE_SHAREPOINT_ITEMS: (PER_ITEM_RETRY_KEY,),
    UPDATE_SHAREPOINT_ITEMS: (PER_ITEM_RETRY_KEY,),
    COPY_FILE_TO_SHAREPOINT: ("method",),
}


@dataclass(frozen=True)
class Task:
    """One declared unit of work: an action and the files it applies to."""

    action: str
    file_pattern: str
    list_name: str | None = None
    destination_dir: str | None = None
    method: CopyMethod = COPY
    # Off by default: a partially failed file is retried whole unless its task
    # explicitly opts into per-item retry.
    enable_per_item_retry_next_run: bool = False


@dataclass(frozen=True)
class Config:
    """The Forwarder's whole declaration."""

    tasks: tuple[Task, ...] = ()

    @classmethod
    def from_file(cls, path: str | os.PathLike[str]) -> Config:
        """Read and validate the config file at ``path``.

        ``yaml`` is imported lazily so importing this module costs only the
        stdlib.
        """
        import yaml

        config_file = Path(path)
        try:
            text = config_file.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise ValueError(f"no config file at '{config_file}'") from None
        except OSError as exc:
            raise ValueError(f"cannot read config file '{config_file}': {exc}") from exc
        try:
            loaded = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise ValueError(
                f"config file '{config_file}' is not valid YAML: {exc}"
            ) from exc
        if loaded is None:
            return cls()
        if not isinstance(loaded, dict):
            raise ValueError(
                f"config file '{config_file}' must contain a mapping with keys: "
                f"{', '.join(CONFIG_KEYS)}"
            )
        for key in loaded:
            if key not in CONFIG_KEYS:
                raise ValueError(
                    f"config file '{config_file}': unknown key {key!r}; "
                    f"expected: {', '.join(CONFIG_KEYS)}"
                )
        return cls(tasks=_parse_tasks(loaded.get("tasks"), config_file))

    def tasks_for(self, action: str) -> tuple[Task, ...]:
        """The declared tasks carrying ``action``, in declared order."""
        return tuple(task for task in self.tasks if task.action == action)


def _parse_tasks(declared: object, config_file: Path) -> tuple[Task, ...]:
    """Build the declared tasks, refusing anything a run could not act on."""
    if declared is None:
        return ()
    if not isinstance(declared, list):
        raise ValueError(f"config file '{config_file}': 'tasks' must be a list")
    return tuple(
        _parse_task(entry, position, config_file)
        for position, entry in enumerate(declared, start=1)
    )


def _parse_task(entry: object, position: int, config_file: Path) -> Task:
    where = f"config file '{config_file}': task {position}"
    if not isinstance(entry, dict):
        raise ValueError(
            f"{where} must be a mapping with keys: {_listed(BASE_TASK_KEYS)}"
        )
    # The action first: it decides which keys the rest of this task may carry,
    # so a misspelt key is reported as itself rather than as a missing one.
    _require_text(entry.get("action"), "action", where)
    action = entry["action"]
    required = ACTION_REQUIRED_KEYS.get(action, ())
    allowed = BASE_TASK_KEYS + required + ACTION_OPTIONAL_KEYS.get(action, ())
    for key in entry:
        if key not in allowed:
            raise ValueError(
                f"{where}: unknown key {key!r} for action {action!r}; "
                f"expected: {_listed(allowed)}"
            )
    for key in ("file_pattern", *required):
        _require_text(entry.get(key), key, where)

    method = entry.get("method", COPY)
    if method not in COPY_METHODS:
        raise ValueError(
            f"{where}: 'method' must be one of {_listed(COPY_METHODS)}; got {method!r}"
        )
    per_item_retry = entry.get(PER_ITEM_RETRY_KEY, False)
    if not isinstance(per_item_retry, bool):
        raise ValueError(
            f"{where}: {PER_ITEM_RETRY_KEY!r} must be true or false; "
            f"got {per_item_retry!r}"
        )
    return Task(
        action=action,
        file_pattern=entry["file_pattern"],
        list_name=entry.get("list_name"),
        destination_dir=entry.get("destination_dir"),
        method=method,
        enable_per_item_retry_next_run=per_item_retry,
    )


def _require_text(value: object, key: str, where: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{where}: {key!r} must be a non-empty string")


def _listed(keys: tuple[str, ...]) -> str:
    return ", ".join(keys)
