import json
import logging
import os
import signal
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from forwarder.config import (
    COPY,
    COPY_FILE_TO_SHAREPOINT,
    CREATE_SHAREPOINT_ITEMS,
    MOVE,
    UPDATE_SHAREPOINT_ITEMS,
    Config,
    Task,
)
from forwarder.main import (
    CONFIG_FILE,
    DEFAULT_QUIET_SECONDS,
    DELIVERABLE_ACTIONS,
    QUEUE_DIR,
    FileHandlerClient,
    ListItemClient,
    StubbedFileHandlerClient,
    StubbedListItemClient,
    build_file_handler_client,
    build_list_item_client,
    cleanup_file,
    copy_file,
    create_items,
    deliver,
    deliver_one,
    discover_files,
    is_ready,
    next_deadline,
    read_items,
    request_shutdown_on_signals,
    retry_name,
    retry_pattern,
    run,
    task_patterns,
    update_items,
    write_retry_file,
)
from shared.constants import PROCESSED_DIR_NAME, QUEUE_DIR_NAME

COMPLAINTS = "Cases-complaints"
APPEALS = "Cases-appeals"


def create_config(list_name: str = COMPLAINTS, file_pattern: str = "*.json") -> Config:
    return Config(
        tasks=(
            Task(
                action=CREATE_SHAREPOINT_ITEMS,
                file_pattern=file_pattern,
                list_name=list_name,
            ),
        )
    )


def update_config(list_name: str = COMPLAINTS, file_pattern: str = "*.json") -> Config:
    return Config(
        tasks=(
            Task(
                action=UPDATE_SHAREPOINT_ITEMS,
                file_pattern=file_pattern,
                list_name=list_name,
            ),
        )
    )


def copy_config(file_pattern: str = "*.xlsx", method: str = COPY) -> Config:
    return Config(
        tasks=(
            Task(
                action=COPY_FILE_TO_SHAREPOINT,
                file_pattern=file_pattern,
                destination_dir="Shared Documents/Reports",
                method=method,
            ),
        )
    )


class RecordingListItemClient:
    """A :class:`ListItemClient` double that records what it was asked to write."""

    def __init__(self) -> None:
        self.created: list[tuple[str, dict[str, Any]]] = []
        self.updated: list[tuple[str, int, dict[str, Any]]] = []

    def create_list_item(
        self,
        list_name: str,
        fields: dict[str, Any],
        raise_on_error: bool = True,
    ) -> object:
        self.created.append((list_name, fields))
        return None

    def update_list_item(
        self,
        list_name: str,
        item_id: int,
        fields: dict[str, Any],
        raise_on_error: bool = True,
    ) -> object:
        self.updated.append((list_name, item_id, fields))
        return None


class FlakyListItemClient(RecordingListItemClient):
    """Records like its parent, but refuses the titles it was told to refuse."""

    def __init__(self, failing: set[str]) -> None:
        super().__init__()
        self.failing = failing

    def create_list_item(
        self,
        list_name: str,
        fields: dict[str, Any],
        raise_on_error: bool = True,
    ) -> object:
        if fields.get("Title") in self.failing:
            raise RuntimeError(f"SharePoint rejected {fields.get('Title')}")
        return super().create_list_item(list_name, fields, raise_on_error)

    def update_list_item(
        self,
        list_name: str,
        item_id: int,
        fields: dict[str, Any],
        raise_on_error: bool = True,
    ) -> object:
        if item_id in self.failing:
            raise RuntimeError(f"SharePoint rejected item {item_id}")
        return super().update_list_item(list_name, item_id, fields, raise_on_error)


class RecordingFileHandlerClient:
    """A :class:`FileHandlerClient` double that records what it was asked to put."""

    def __init__(self) -> None:
        self.copied: list[tuple[str, str, str, str]] = []

    def copy_or_move_items_to_sharepoint(
        self,
        src_dir: str,
        file_name: str,
        destination_dir: str,
        method: str,
    ) -> object:
        self.copied.append((src_dir, file_name, destination_dir, method))
        return None


def queue_and_processed(tmp_path) -> tuple[Any, Any]:
    """Lay out a base directory the way the Forwarder expects to find one."""
    queue_dir = tmp_path / QUEUE_DIR_NAME
    queue_dir.mkdir()
    return queue_dir, tmp_path / PROCESSED_DIR_NAME


# Comfortably past the quiet period, so a file written by a test looks finished.
SETTLED = DEFAULT_QUIET_SECONDS + 60


def settle(path, seconds: float = SETTLED) -> Any:
    """Backdate ``path``'s mtime so the readiness check takes it."""
    stat = path.stat()
    os.utime(path, (stat.st_atime - seconds, stat.st_mtime - seconds))
    return path


def write_items(
    queue_dir, items, name: str = "items.json", settled: bool = True
) -> Any:
    queued_file = queue_dir / name
    queued_file.write_text(json.dumps(items), encoding="utf-8")
    return settle(queued_file) if settled else queued_file


def write_bytes(queue_dir, name: str, data: bytes = b"workbook") -> Any:
    queued_file = queue_dir / name
    queued_file.write_bytes(data)
    return settle(queued_file)


def test_run_creates_one_list_item_per_entry(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [{"fields": {"Title": "CASE-0001"}}, {"fields": {"Title": "CASE-0002"}}],
    )
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [
        (COMPLAINTS, {"Title": "CASE-0001"}),
        (COMPLAINTS, {"Title": "CASE-0002"}),
    ]


def test_run_writes_to_the_list_the_task_declares(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "APPEAL-0007"}}])
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(list_name=APPEALS),
        queue_dir,
        processed_dir,
    )

    assert [list_name for list_name, _ in list_client.created] == [APPEALS]


def test_run_ignores_a_list_name_left_inside_a_queued_file(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"list_name": APPEALS, "fields": {"Title": "CASE-0001"}}])
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(list_name=COMPLAINTS),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "CASE-0001"})]


def test_run_sends_each_list_its_own_queued_files(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir, [{"fields": {"Title": "CASE-0001"}}], name="create-complaints-a.json"
    )
    write_items(
        queue_dir, [{"fields": {"Title": "APPEAL-0007"}}], name="create-appeals-a.json"
    )
    config = Config(
        tasks=(
            Task(
                action=CREATE_SHAREPOINT_ITEMS,
                file_pattern="create-complaints-*.json",
                list_name=COMPLAINTS,
            ),
            Task(
                action=CREATE_SHAREPOINT_ITEMS,
                file_pattern="create-appeals-*.json",
                list_name=APPEALS,
            ),
        )
    )
    list_client = RecordingListItemClient()

    run(list_client, RecordingFileHandlerClient(), config, queue_dir, processed_dir)

    assert list_client.created == [
        (COMPLAINTS, {"Title": "CASE-0001"}),
        (APPEALS, {"Title": "APPEAL-0007"}),
    ]


def test_run_delivers_every_queued_json_file(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "1"}}], name="a.json")
    write_items(queue_dir, [{"fields": {"Title": "2"}}], name="b.json")
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [
        (COMPLAINTS, {"Title": "1"}),
        (COMPLAINTS, {"Title": "2"}),
    ]
    assert sorted(path.name for path in processed_dir.iterdir()) == ["a.json", "b.json"]


def test_run_visits_queued_files_in_sorted_order(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    for name in ("c.json", "a.json", "b.json"):
        write_items(queue_dir, [{"fields": {"Title": name}}], name=name)
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert [fields["Title"] for _, fields in list_client.created] == [
        "a.json",
        "b.json",
        "c.json",
    ]


def test_run_leaves_a_non_json_file_alone(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    report = queue_dir / "report.csv"
    report.write_text("Title\nCASE-0001\n", encoding="utf-8")
    settle(report)
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == []
    assert report.exists()
    assert not processed_dir.exists()


def test_run_delivers_the_json_file_beside_a_non_json_one(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_bytes(queue_dir, "notes.txt", b"ignore me")
    write_items(queue_dir, [{"fields": {"Title": "CASE-0001"}}])
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "CASE-0001"})]
    assert (queue_dir / "notes.txt").exists()
    assert (processed_dir / "items.json").exists()


def test_run_honours_a_narrower_declared_pattern(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "Wanted"}}], name="cases-2026.json")
    write_items(queue_dir, [{"fields": {"Title": "Skipped"}}], name="other.json")
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(file_pattern="cases-*.json"),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "Wanted"})]
    assert (queue_dir / "other.json").exists()


def test_run_works_each_declared_task_in_order(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "Second"}}], name="b-late.json")
    write_items(queue_dir, [{"fields": {"Title": "First"}}], name="a-early.json")
    config = Config(
        tasks=(
            Task(
                action=CREATE_SHAREPOINT_ITEMS,
                file_pattern="b-*.json",
                list_name=COMPLAINTS,
            ),
            Task(
                action=CREATE_SHAREPOINT_ITEMS,
                file_pattern="a-*.json",
                list_name=COMPLAINTS,
            ),
        )
    )
    list_client = RecordingListItemClient()

    run(list_client, RecordingFileHandlerClient(), config, queue_dir, processed_dir)

    assert [fields["Title"] for _, fields in list_client.created] == ["Second", "First"]


def test_run_updates_one_list_item_per_entry(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [
            {"item_id": 1, "fields": {"Status": "Closed"}},
            {"item_id": 7, "fields": {"Owner": "a.reviewer"}},
        ],
    )
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        update_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.updated == [
        (COMPLAINTS, 1, {"Status": "Closed"}),
        (COMPLAINTS, 7, {"Owner": "a.reviewer"}),
    ]
    assert list_client.created == []


def test_run_updates_the_list_the_task_declares(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"item_id": 7, "fields": {"Status": "Upheld"}}])
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        update_config(list_name=APPEALS),
        queue_dir,
        processed_dir,
    )

    assert list_client.updated == [(APPEALS, 7, {"Status": "Upheld"})]


def test_run_sends_only_the_declared_fields_on_an_update(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"item_id": 3, "fields": {"Status": "Open"}}])
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        update_config(),
        queue_dir,
        processed_dir,
    )

    _, _, fields = list_client.updated[0]
    assert fields == {"Status": "Open"}


def test_run_sets_an_updated_file_aside(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"item_id": 1, "fields": {}}], name="update-cases.json")

    run(
        RecordingListItemClient(),
        RecordingFileHandlerClient(),
        update_config(),
        queue_dir,
        processed_dir,
    )

    assert not (queue_dir / "update-cases.json").exists()
    assert (processed_dir / "update-cases.json").exists()


def test_run_separates_creates_from_updates_by_pattern(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir, [{"fields": {"Title": "CASE-0003"}}], name="create-cases.json"
    )
    write_items(
        queue_dir,
        [{"item_id": 1, "fields": {"Status": "Closed"}}],
        name="update-cases.json",
    )
    config = Config(
        tasks=(
            create_config(file_pattern="create-*.json").tasks
            + update_config(file_pattern="update-*.json").tasks
        )
    )
    list_client = RecordingListItemClient()

    run(list_client, RecordingFileHandlerClient(), config, queue_dir, processed_dir)

    assert list_client.created == [(COMPLAINTS, {"Title": "CASE-0003"})]
    assert list_client.updated == [(COMPLAINTS, 1, {"Status": "Closed"})]


def test_create_items_writes_to_the_list_it_is_given(tmp_path):
    queue_dir, _ = queue_and_processed(tmp_path)
    queued_file = write_items(queue_dir, [{"fields": {"Title": "CASE-0001"}}])
    list_client = RecordingListItemClient()

    create_items(list_client, queued_file, APPEALS)

    assert list_client.created == [(APPEALS, {"Title": "CASE-0001"})]


def test_update_items_writes_to_the_list_it_is_given(tmp_path):
    queue_dir, _ = queue_and_processed(tmp_path)
    queued_file = write_items(
        queue_dir, [{"item_id": 42, "fields": {"Status": "Open"}}]
    )
    list_client = RecordingListItemClient()

    update_items(list_client, queued_file, APPEALS)

    assert list_client.updated == [(APPEALS, 42, {"Status": "Open"})]


def test_run_copies_a_matching_file_to_its_declared_destination(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_bytes(queue_dir, "volumes.xlsx", b"not really a workbook")
    list_client = RecordingListItemClient()
    file_handler = RecordingFileHandlerClient()

    run(list_client, file_handler, copy_config(), queue_dir, processed_dir)

    assert file_handler.copied == [
        (str(queue_dir), "volumes.xlsx", "Shared Documents/Reports", COPY)
    ]
    assert list_client.created == []


def test_run_sets_a_copied_file_aside(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_bytes(queue_dir, "volumes.xlsx", b"not really a workbook")

    run(
        RecordingListItemClient(),
        RecordingFileHandlerClient(),
        copy_config(),
        queue_dir,
        processed_dir,
    )

    assert not (queue_dir / "volumes.xlsx").exists()
    assert (processed_dir / "volumes.xlsx").exists()


def test_run_passes_the_declared_move_method_through(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_bytes(queue_dir, "volumes.xlsx", b"not really a workbook")
    file_handler = RecordingFileHandlerClient()

    run(
        RecordingListItemClient(),
        file_handler,
        copy_config(method=MOVE),
        queue_dir,
        processed_dir,
    )

    assert [method for *_, method in file_handler.copied] == [MOVE]


def test_run_copies_only_the_files_matching_the_copy_pattern(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_bytes(queue_dir, "volumes.xlsx")
    write_items(queue_dir, [{"fields": {"Title": "CASE-0001"}}])
    file_handler = RecordingFileHandlerClient()

    run(
        RecordingListItemClient(),
        file_handler,
        copy_config(),
        queue_dir,
        processed_dir,
    )

    assert [name for _, name, *_ in file_handler.copied] == ["volumes.xlsx"]
    assert (queue_dir / "items.json").exists()


def test_run_works_both_actions_declared_together(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_bytes(queue_dir, "volumes.xlsx")
    write_items(queue_dir, [{"fields": {"Title": "CASE-0001"}}])
    config = Config(tasks=create_config().tasks + copy_config().tasks)
    list_client = RecordingListItemClient()
    file_handler = RecordingFileHandlerClient()

    run(list_client, file_handler, config, queue_dir, processed_dir)

    assert list_client.created == [(COMPLAINTS, {"Title": "CASE-0001"})]
    assert [name for _, name, *_ in file_handler.copied] == ["volumes.xlsx"]
    assert sorted(path.name for path in processed_dir.iterdir()) == [
        "items.json",
        "volumes.xlsx",
    ]


def test_copy_file_names_the_queue_directory_as_the_source(tmp_path):
    queue_dir, _ = queue_and_processed(tmp_path)
    report = write_bytes(queue_dir, "volumes.xlsx")
    file_handler = RecordingFileHandlerClient()

    copy_file(file_handler, report, "Shared Documents/Reports", COPY)

    assert file_handler.copied == [
        (str(queue_dir), "volumes.xlsx", "Shared Documents/Reports", COPY)
    ]


def test_run_ignores_a_task_naming_another_action(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "CASE-0001"}}])
    config = Config(tasks=(Task(action="upload_document", file_pattern="*.json"),))
    list_client = RecordingListItemClient()

    run(list_client, RecordingFileHandlerClient(), config, queue_dir, processed_dir)

    assert list_client.created == []
    assert (queue_dir / "items.json").exists()


def test_run_does_nothing_when_no_tasks_are_declared(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "CASE-0001"}}])
    list_client = RecordingListItemClient()

    run(list_client, RecordingFileHandlerClient(), Config(), queue_dir, processed_dir)

    assert list_client.created == []
    assert (queue_dir / "items.json").exists()


def test_run_creates_nothing_when_the_queue_is_empty(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == []


def test_a_second_tick_creates_nothing_because_the_queue_was_drained(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "CASE-0001"}}])
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )
    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "CASE-0001"})]


def test_discover_files_returns_the_queued_files_sorted(tmp_path):
    queue_dir, _ = queue_and_processed(tmp_path)
    for name in ("b.json", "a.json"):
        write_items(queue_dir, [], name=name)

    assert [path.name for path in discover_files(queue_dir)] == ["a.json", "b.json"]


def test_discover_files_skips_directories(tmp_path):
    queue_dir, _ = queue_and_processed(tmp_path)
    (queue_dir / "a_subdirectory").mkdir()
    write_items(queue_dir, [])

    assert [path.name for path in discover_files(queue_dir)] == ["items.json"]


def test_discover_files_finds_nothing_when_the_queue_is_absent(tmp_path):
    assert discover_files(tmp_path / "never_created") == []


def test_discover_files_selects_by_pattern(tmp_path):
    queue_dir, _ = queue_and_processed(tmp_path)
    for name in ("items.json", "report.csv", "notes.txt"):
        write_items(queue_dir, [], name=name)

    assert [path.name for path in discover_files(queue_dir, "*.json")] == ["items.json"]


def test_cleanup_file_moves_the_file_into_the_processed_directory(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    queued_file = write_items(queue_dir, [])

    destination = cleanup_file(queued_file, processed_dir)

    assert not queued_file.exists()
    assert destination == processed_dir / "items.json"
    assert destination.read_text(encoding="utf-8") == "[]"


def test_cleanup_file_creates_the_processed_directory_when_absent(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    assert not processed_dir.exists()

    cleanup_file(write_items(queue_dir, []), processed_dir)

    assert processed_dir.is_dir()


def bundled_files_for(action: str) -> list[tuple[Task, Any]]:
    config = Config.from_file(CONFIG_FILE)
    return [
        (task, queued_file)
        for task in config.tasks_for(action)
        for queued_file in discover_files(QUEUE_DIR, task.file_pattern)
    ]


def test_the_bundled_config_declares_every_action_a_tick_can_perform():
    config = Config.from_file(CONFIG_FILE)

    assert {task.action for task in config.tasks} == set(DELIVERABLE_ACTIONS)


def test_the_bundled_config_declares_more_than_one_list_per_list_action():
    config = Config.from_file(CONFIG_FILE)

    for action in (CREATE_SHAREPOINT_ITEMS, UPDATE_SHAREPOINT_ITEMS):
        list_names = {task.list_name for task in config.tasks_for(action)}
        assert len(list_names) > 1, f"{action} declares only {list_names}"


def test_the_bundled_create_samples_carry_fields_and_no_list_name():
    matched = bundled_files_for(CREATE_SHAREPOINT_ITEMS)

    assert matched
    for _, queued_file in matched:
        for item in read_items(queued_file):
            assert isinstance(item["fields"], dict)
            assert "list_name" not in item


def test_the_bundled_update_samples_name_the_item_they_amend():
    matched = bundled_files_for(UPDATE_SHAREPOINT_ITEMS)

    assert matched
    for _, queued_file in matched:
        for item in read_items(queued_file):
            assert isinstance(item["item_id"], int)
            assert isinstance(item["fields"], dict)
            assert "list_name" not in item


def test_every_bundled_list_task_matches_at_least_one_queued_file():
    config = Config.from_file(CONFIG_FILE)

    for action in (CREATE_SHAREPOINT_ITEMS, UPDATE_SHAREPOINT_ITEMS):
        for task in config.tasks_for(action):
            assert discover_files(QUEUE_DIR, task.file_pattern), (
                f"no bundled file matches {task.file_pattern!r} for {task.list_name}"
            )


def test_the_bundled_patterns_do_not_claim_the_same_file():
    config = Config.from_file(CONFIG_FILE)

    claimed: dict[str, str] = {}
    for task in config.tasks:
        for queued_file in discover_files(QUEUE_DIR, task.file_pattern):
            first = claimed.get(queued_file.name)
            assert first is None, (
                f"{queued_file.name} is claimed by both {first} and "
                f"{task.action}; the second would find it already delivered"
            )
            claimed[queued_file.name] = task.action


def test_a_failed_file_stays_queued_for_the_next_tick(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "BAD"}}], name="a.json")
    list_client = FlakyListItemClient(failing={"BAD"})

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert (queue_dir / "a.json").exists()
    assert not processed_dir.exists()


def test_a_failed_file_does_not_stop_the_files_behind_it(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "BAD"}}], name="a.json")
    write_items(queue_dir, [{"fields": {"Title": "GOOD"}}], name="b.json")
    list_client = FlakyListItemClient(failing={"BAD"})

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "GOOD"})]
    assert (queue_dir / "a.json").exists()
    assert (processed_dir / "b.json").exists()


def test_a_failed_task_does_not_stop_the_tasks_behind_it(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "BAD"}}], name="create-a.json")
    write_items(
        queue_dir,
        [{"item_id": 5, "fields": {"Status": "Closed"}}],
        name="update-a.json",
    )
    config = Config(
        tasks=(
            create_config(file_pattern="create-*.json").tasks
            + update_config(file_pattern="update-*.json").tasks
        )
    )
    list_client = FlakyListItemClient(failing={"BAD"})

    run(list_client, RecordingFileHandlerClient(), config, queue_dir, processed_dir)

    assert list_client.created == []
    assert list_client.updated == [(COMPLAINTS, 5, {"Status": "Closed"})]


def test_a_malformed_queued_file_is_left_alone_and_does_not_raise(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    truncated = queue_dir / "a.json"
    truncated.write_text('[{"fields": {"Title": "CAS', encoding="utf-8")
    settle(truncated)
    write_items(queue_dir, [{"fields": {"Title": "GOOD"}}], name="b.json")
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "GOOD"})]
    assert truncated.exists()


def test_an_entry_missing_its_item_id_is_left_alone(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Status": "Closed"}}], name="a.json")
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        update_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.updated == []
    assert (queue_dir / "a.json").exists()


def test_a_failure_is_logged_with_the_file_it_was_for(tmp_path, caplog):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "BAD"}}], name="a.json")

    with caplog.at_level(logging.ERROR, logger="forwarder.main"):
        run(
            FlakyListItemClient(failing={"BAD"}),
            RecordingFileHandlerClient(),
            create_config(),
            queue_dir,
            processed_dir,
        )

    assert "a.json" in caplog.text
    assert CREATE_SHAREPOINT_ITEMS in caplog.text
    assert "SharePoint rejected BAD" in caplog.text


def test_a_failing_file_handler_leaves_its_file_queued(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_bytes(queue_dir, "volumes.xlsx")

    class ExplodingFileHandler:
        def copy_or_move_items_to_sharepoint(self, s, f, d, m):
            raise OSError("the share went away")

    run(
        RecordingListItemClient(),
        ExplodingFileHandler(),
        copy_config(),
        queue_dir,
        processed_dir,
    )

    assert (queue_dir / "volumes.xlsx").exists()


def test_deliver_one_says_whether_the_file_was_delivered(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    good = write_items(queue_dir, [{"fields": {"Title": "GOOD"}}], name="good.json")
    bad = write_items(queue_dir, [{"fields": {"Title": "BAD"}}], name="bad.json")
    task = create_config().tasks[0]
    list_client = FlakyListItemClient(failing={"BAD"})
    file_handler = RecordingFileHandlerClient()

    assert deliver_one(task, good, list_client, file_handler, processed_dir) is True
    assert deliver_one(task, bad, list_client, file_handler, processed_dir) is False


def test_a_file_that_cannot_be_archived_is_reported_as_undelivered(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    queued = write_items(queue_dir, [{"fields": {"Title": "GOOD"}}])
    task = create_config().tasks[0]
    # A file where the processed directory should be: mkdir cannot succeed.
    processed_dir.write_text("not a directory", encoding="utf-8")
    list_client = RecordingListItemClient()

    delivered = deliver_one(
        task, queued, list_client, RecordingFileHandlerClient(), processed_dir
    )

    assert delivered is False
    assert list_client.created == [(COMPLAINTS, {"Title": "GOOD"})]


def retry_create_config(file_pattern: str = "*.json") -> Config:
    return Config(
        tasks=(
            Task(
                action=CREATE_SHAREPOINT_ITEMS,
                file_pattern=file_pattern,
                list_name=COMPLAINTS,
                enable_per_item_retry_next_run=True,
            ),
        )
    )


STAMP = datetime(2026, 8, 17, 6, 19, 0, tzinfo=timezone.utc)
LATER = datetime(2026, 8, 17, 6, 24, 30, tzinfo=timezone.utc)


def sole_residue(queue_dir) -> Any:
    residues = sorted(queue_dir.glob("*.retry_*.json"))
    assert len(residues) == 1, [path.name for path in residues]
    return residues[0]


def test_retry_name_stamps_the_marker_before_the_suffix():
    assert retry_name(Path("create-complaints-2026-08.json"), STAMP) == (
        "create-complaints-2026-08.retry_20260817061900.json"
    )


def test_a_later_retry_replaces_the_stamp_rather_than_appending_one():
    once = retry_name(Path("create-a.json"), STAMP)
    twice = retry_name(Path(once), LATER)

    assert once == "create-a.retry_20260817061900.json"
    assert twice == "create-a.retry_20260817062430.json"
    assert retry_name(Path(twice), LATER) == twice


def test_the_stamp_keeps_each_attempt_distinct():
    assert retry_name(Path("create-a.json"), STAMP) != retry_name(
        Path("create-a.json"), LATER
    )


def test_stamps_sort_chronologically_by_name():
    names = [retry_name(Path("create-a.json"), when) for when in (LATER, STAMP)]

    assert sorted(names) == [
        "create-a.retry_20260817061900.json",
        "create-a.retry_20260817062430.json",
    ]


def test_a_marker_that_is_not_a_stamp_is_left_alone():
    assert retry_name(Path("notes.retry_draft.json"), STAMP) == (
        "notes.retry_draft.retry_20260817061900.json"
    )


def test_an_unstamped_residue_is_generated_from_the_clock():
    before = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")

    name = retry_name(Path("create-a.json"))

    assert name.startswith("create-a.retry_")
    assert name.endswith(".json")
    stamp = name[len("create-a.retry_") : -len(".json")]
    assert stamp.isdigit() and len(stamp) == 14
    assert stamp.startswith(before[:10])


def test_only_the_failed_items_are_written_back_for_the_next_tick(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [
            {"fields": {"Title": "GOOD-1"}},
            {"fields": {"Title": "BAD"}},
            {"fields": {"Title": "GOOD-2"}},
        ],
        name="create-a.json",
    )
    list_client = FlakyListItemClient(failing={"BAD"})

    run(
        list_client,
        RecordingFileHandlerClient(),
        retry_create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [
        (COMPLAINTS, {"Title": "GOOD-1"}),
        (COMPLAINTS, {"Title": "GOOD-2"}),
    ]
    assert json.loads(sole_residue(queue_dir).read_text(encoding="utf-8")) == [
        {"fields": {"Title": "BAD"}}
    ]


def test_the_original_is_archived_once_its_failures_are_written_back(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [{"fields": {"Title": "GOOD"}}, {"fields": {"Title": "BAD"}}],
        name="create-a.json",
    )

    run(
        FlakyListItemClient(failing={"BAD"}),
        RecordingFileHandlerClient(),
        retry_create_config(),
        queue_dir,
        processed_dir,
    )

    assert not (queue_dir / "create-a.json").exists()
    assert (processed_dir / "create-a.json").exists()


def test_a_retried_item_is_not_sent_twice_across_two_ticks(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [{"fields": {"Title": "GOOD"}}, {"fields": {"Title": "BAD"}}],
        name="create-a.json",
    )
    config = retry_create_config()

    failing = FlakyListItemClient(failing={"BAD"})
    run(failing, RecordingFileHandlerClient(), config, queue_dir, processed_dir)
    # The residue was written just now, so it is not yet still enough to take.
    settle(sole_residue(queue_dir))
    recovered = RecordingListItemClient()
    run(recovered, RecordingFileHandlerClient(), config, queue_dir, processed_dir)

    assert failing.created == [(COMPLAINTS, {"Title": "GOOD"})]
    assert recovered.created == [(COMPLAINTS, {"Title": "BAD"})]
    assert list(queue_dir.iterdir()) == []
    archived = sorted(path.name for path in processed_dir.iterdir())
    assert archived[0] == "create-a.json"
    assert len(archived) == 2
    assert archived[1].startswith("create-a.retry_")


def test_a_residue_that_fails_again_is_restamped_not_extended(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "BAD"}}], name="create-a.json")
    config = retry_create_config()

    for _ in range(3):
        run(
            FlakyListItemClient(failing={"BAD"}),
            RecordingFileHandlerClient(),
            config,
            queue_dir,
            processed_dir,
        )

    # One outstanding residue, still named from the original, with exactly one
    # stamp on it however many times it has been round the loop.
    residue = sole_residue(queue_dir)
    assert residue.name.count(".retry_") == 1
    assert residue.name.startswith("create-a.retry_")
    assert json.loads(residue.read_text(encoding="utf-8")) == [
        {"fields": {"Title": "BAD"}}
    ]


def test_each_failed_attempt_leaves_its_own_record_in_processed(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "BAD"}}], name="create-a.json")
    config = retry_create_config()

    for second in (1, 2, 3):
        # Stamps are per-second, so drive distinct attempts explicitly rather
        # than depending on three ticks straddling a second boundary.
        queued = sorted(queue_dir.iterdir())[0]
        failed = deliver(
            config.tasks[0], queued, FlakyListItemClient(failing={"BAD"}), None
        )
        write_retry_file(
            queued, failed, datetime(2026, 8, 17, 6, 19, second, tzinfo=timezone.utc)
        )
        cleanup_file(queued, processed_dir)

    assert len(list(processed_dir.iterdir())) == 3
    assert sorted(path.name for path in processed_dir.iterdir())[0] == "create-a.json"


def test_retry_pattern_matches_the_residues_a_pattern_produces():
    assert retry_pattern("create-complaints-*.json") == (
        "create-complaints-*.retry_*.json"
    )
    assert retry_pattern("create-complaints-2026-08.json") == (
        "create-complaints-2026-08.retry_*.json"
    )
    assert retry_pattern("*.json") == "*.retry_*.json"


def test_a_task_without_per_item_retry_looks_only_for_its_own_pattern():
    task = create_config(file_pattern="create-*.json").tasks[0]

    assert task_patterns(task) == ("create-*.json",)


def test_a_task_with_per_item_retry_also_looks_for_its_residues():
    task = retry_create_config(file_pattern="create-*.json").tasks[0]

    assert task_patterns(task) == ("create-*.json", "create-*.retry_*.json")


def test_an_exact_pattern_still_picks_up_its_own_residue(tmp_path):
    # The gap the second glob closes: this pattern names a file, not a shape,
    # so it can never match the stamped residue it produces.
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [{"fields": {"Title": "GOOD"}}, {"fields": {"Title": "BAD"}}],
        name="create-complaints-2026-08.json",
    )
    config = retry_create_config(file_pattern="create-complaints-2026-08.json")

    run(
        FlakyListItemClient(failing={"BAD"}),
        RecordingFileHandlerClient(),
        config,
        queue_dir,
        processed_dir,
    )
    residue = settle(sole_residue(queue_dir))
    recovered = RecordingListItemClient()
    run(recovered, RecordingFileHandlerClient(), config, queue_dir, processed_dir)

    assert (
        residue.name
        == "create-complaints-2026-08.retry_" + residue.name.split(".retry_")[1]
    )
    assert recovered.created == [(COMPLAINTS, {"Title": "BAD"})]
    assert list(queue_dir.iterdir()) == []


def test_a_file_matching_both_patterns_is_delivered_once(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    # "*.json" matches residues as well, so both globs return this file.
    write_items(
        queue_dir,
        [{"fields": {"Title": "GOOD"}}],
        name="create-a.retry_20260817061900.json",
    )
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        retry_create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "GOOD"})]


def test_discover_files_returns_a_file_matched_twice_only_once(tmp_path):
    queue_dir, _ = queue_and_processed(tmp_path)
    write_items(queue_dir, [], name="create-a.retry_20260817061900.json")

    found = discover_files(queue_dir, ("*.json", "*.retry_*.json"))

    assert [path.name for path in found] == ["create-a.retry_20260817061900.json"]


def test_a_residue_matches_the_pattern_that_produced_it(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir, [{"fields": {"Title": "BAD"}}], name="create-complaints-2026-08.json"
    )
    config = retry_create_config(file_pattern="create-complaints-*.json")

    run(
        FlakyListItemClient(failing={"BAD"}),
        RecordingFileHandlerClient(),
        config,
        queue_dir,
        processed_dir,
    )
    residue = sole_residue(queue_dir)

    assert residue.name.startswith("create-complaints-2026-08.retry_")
    assert discover_files(queue_dir, "create-complaints-*.json") == [residue]


def test_a_failed_update_is_written_back_with_its_item_id(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [
            {"item_id": 1, "fields": {"Status": "Closed"}},
            {"item_id": 9, "fields": {"Status": "Open"}},
        ],
        name="update-a.json",
    )
    config = Config(
        tasks=(
            Task(
                action=UPDATE_SHAREPOINT_ITEMS,
                file_pattern="update-*.json",
                list_name=COMPLAINTS,
                enable_per_item_retry_next_run=True,
            ),
        )
    )

    run(
        FlakyListItemClient(failing={9}),
        RecordingFileHandlerClient(),
        config,
        queue_dir,
        processed_dir,
    )

    residue = sole_residue(queue_dir)
    assert residue.name.startswith("update-a.retry_")
    assert json.loads(residue.read_text(encoding="utf-8")) == [
        {"item_id": 9, "fields": {"Status": "Open"}}
    ]


def test_without_per_item_retry_the_whole_file_stays_queued(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [{"fields": {"Title": "GOOD"}}, {"fields": {"Title": "BAD"}}],
        name="create-a.json",
    )

    run(
        FlakyListItemClient(failing={"BAD"}),
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert (queue_dir / "create-a.json").exists()
    assert list(queue_dir.glob("*.retry_*.json")) == []
    assert not processed_dir.exists()


def test_per_item_retry_leaves_no_partial_file_behind(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "BAD"}}], name="create-a.json")

    run(
        FlakyListItemClient(failing={"BAD"}),
        RecordingFileHandlerClient(),
        retry_create_config(),
        queue_dir,
        processed_dir,
    )

    assert [path.name for path in queue_dir.iterdir()] == [sole_residue(queue_dir).name]


def test_a_file_whose_items_all_succeed_writes_no_residue(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "GOOD"}}], name="create-a.json")

    run(
        FlakyListItemClient(failing={"BAD"}),
        RecordingFileHandlerClient(),
        retry_create_config(),
        queue_dir,
        processed_dir,
    )

    assert list(queue_dir.iterdir()) == []
    assert (processed_dir / "create-a.json").exists()


def test_create_items_returns_the_entries_that_failed(tmp_path):
    queue_dir, _ = queue_and_processed(tmp_path)
    queued_file = write_items(
        queue_dir, [{"fields": {"Title": "GOOD"}}, {"fields": {"Title": "BAD"}}]
    )

    failed = create_items(FlakyListItemClient(failing={"BAD"}), queued_file, COMPLAINTS)

    assert failed == [{"fields": {"Title": "BAD"}}]


def test_update_items_returns_the_entries_that_failed(tmp_path):
    queue_dir, _ = queue_and_processed(tmp_path)
    queued_file = write_items(
        queue_dir,
        [{"item_id": 1, "fields": {}}, {"item_id": 9, "fields": {"Status": "Open"}}],
    )

    failed = update_items(FlakyListItemClient(failing={9}), queued_file, COMPLAINTS)

    assert failed == [{"item_id": 9, "fields": {"Status": "Open"}}]


def test_a_file_still_being_written_is_left_until_it_settles(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    fresh = write_items(queue_dir, [{"fields": {"Title": "MID-WRITE"}}], settled=False)
    list_client = RecordingListItemClient()

    summary = run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == []
    assert fresh.exists()
    assert summary.not_ready == 1


def test_a_settled_file_is_taken_on_a_later_tick(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    fresh = write_items(queue_dir, [{"fields": {"Title": "GOOD"}}], settled=False)
    config = create_config()
    list_client = RecordingListItemClient()

    run(list_client, RecordingFileHandlerClient(), config, queue_dir, processed_dir)
    assert list_client.created == []

    settle(fresh)
    run(list_client, RecordingFileHandlerClient(), config, queue_dir, processed_dir)

    assert list_client.created == [(COMPLAINTS, {"Title": "GOOD"})]


def test_a_fresh_file_beside_a_settled_one_holds_up_only_itself(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "SETTLED"}}], name="a.json")
    write_items(
        queue_dir, [{"fields": {"Title": "FRESH"}}], name="b.json", settled=False
    )
    list_client = RecordingListItemClient()

    summary = run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "SETTLED"})]
    assert summary.delivered == 1
    assert summary.not_ready == 1


def test_a_quiet_period_of_zero_takes_a_file_immediately(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "GOOD"}}], settled=False)
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
        quiet_seconds=0,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "GOOD"})]


def test_a_freshly_written_workbook_is_not_copied(tmp_path):
    # The action that never opens its file, so readiness is all that stands
    # between a half-written workbook and SharePoint.
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    (queue_dir / "volumes.xlsx").write_bytes(b"half a workbook")
    file_handler = RecordingFileHandlerClient()

    run(
        RecordingListItemClient(),
        file_handler,
        copy_config(),
        queue_dir,
        processed_dir,
    )

    assert file_handler.copied == []
    assert (queue_dir / "volumes.xlsx").exists()


def test_is_ready_measures_the_age_of_the_last_write(tmp_path):
    queued = tmp_path / "a.json"
    queued.write_text("[]", encoding="utf-8")
    modified_at = queued.stat().st_mtime

    assert is_ready(queued, 120, now=modified_at + 120) is True
    assert is_ready(queued, 120, now=modified_at + 119) is False


def test_is_ready_refuses_a_file_that_has_gone(tmp_path):
    assert is_ready(tmp_path / "never_existed.json", 0, now=time.time()) is False


def test_the_summary_counts_what_the_tick_did(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "GOOD"}}], name="a.json")
    write_items(queue_dir, [{"fields": {"Title": "BAD"}}], name="b.json")
    write_items(
        queue_dir, [{"fields": {"Title": "FRESH"}}], name="c.json", settled=False
    )

    summary = run(
        FlakyListItemClient(failing={"BAD"}),
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert (summary.delivered, summary.failed, summary.not_ready) == (1, 1, 1)
    assert summary.pending == 2
    assert summary.stopped_early is False


def test_the_summary_reports_the_oldest_pending_file(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    settle(write_items(queue_dir, [], name="old.json", settled=False), seconds=3600)
    write_items(queue_dir, [], name="new.json", settled=False)

    summary = run(
        RecordingListItemClient(),
        RecordingFileHandlerClient(),
        Config(),
        queue_dir,
        processed_dir,
    )

    assert summary.pending == 2
    assert 3590 <= summary.oldest_pending_seconds <= 3610


def test_a_residue_written_this_tick_is_not_reported_as_older_than_now(tmp_path):
    # The residue is written after the tick's clock reading, so measuring
    # against that reading would report a negative age.
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [{"fields": {"Title": "GOOD"}}, {"fields": {"Title": "BAD"}}],
        name="create-a.json",
    )

    summary = run(
        FlakyListItemClient(failing={"BAD"}),
        RecordingFileHandlerClient(),
        retry_create_config(),
        queue_dir,
        processed_dir,
    )

    assert summary.pending == 1
    assert summary.oldest_pending_seconds >= 0
    assert "-0m" not in summary.describe()


def test_an_empty_queue_reports_no_oldest_file(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)

    summary = run(
        RecordingListItemClient(),
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
    )

    assert summary.pending == 0
    assert summary.oldest_pending_seconds is None


def test_the_summary_is_logged_once_a_tick(tmp_path, caplog):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "GOOD"}}])

    with caplog.at_level(logging.INFO, logger="forwarder.main"):
        run(
            RecordingListItemClient(),
            RecordingFileHandlerClient(),
            create_config(),
            queue_dir,
            processed_dir,
        )

    assert "tick: 1 delivered, 0 failed, 0 not ready, 0 pending" in caplog.text


def test_a_stop_request_ends_the_tick_between_files(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    for name in ("a.json", "b.json", "c.json"):
        write_items(queue_dir, [{"fields": {"Title": name}}], name=name)
    list_client = RecordingListItemClient()
    stop_after_one = lambda: len(list_client.created) >= 1  # noqa: E731

    summary = run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
        should_stop=stop_after_one,
    )

    assert list_client.created == [(COMPLAINTS, {"Title": "a.json"})]
    assert summary.stopped_early is True
    assert summary.delivered == 1


def test_a_stop_request_never_leaves_a_file_half_delivered(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(
        queue_dir,
        [{"fields": {"Title": "ONE"}}, {"fields": {"Title": "TWO"}}],
        name="a.json",
    )
    list_client = RecordingListItemClient()

    run(
        list_client,
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
        should_stop=lambda: True,
    )

    # Stopping is checked before a file is opened, never inside one, so the
    # file is untouched rather than partly sent.
    assert list_client.created == []
    assert (queue_dir / "a.json").exists()
    assert not processed_dir.exists()


def test_a_stop_request_before_any_work_delivers_nothing(tmp_path):
    queue_dir, processed_dir = queue_and_processed(tmp_path)
    write_items(queue_dir, [{"fields": {"Title": "GOOD"}}])

    summary = run(
        RecordingListItemClient(),
        RecordingFileHandlerClient(),
        create_config(),
        queue_dir,
        processed_dir,
        should_stop=lambda: True,
    )

    assert summary.stopped_early is True
    assert summary.delivered == 0


def test_the_shutdown_event_is_set_by_a_stop_signal():
    previous = {
        stop_signal: signal.getsignal(stop_signal)
        for stop_signal in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        stopping = request_shutdown_on_signals()
        assert not stopping.is_set()

        os.kill(os.getpid(), signal.SIGTERM)

        assert stopping.is_set()
        # Set, not just flagged: this is what ends the wait between ticks.
        assert stopping.wait(0) is True
    finally:
        for stop_signal, handler in previous.items():
            signal.signal(stop_signal, handler)


TICK = 300.0


def test_the_next_deadline_is_one_interval_from_the_last_one():
    assert next_deadline(1000.0, TICK, now=1000.5) == 1300.0


def test_a_tick_that_took_time_does_not_lengthen_the_period():
    # The tick started at 1000 and took 120s. The next one is still due at
    # 1300 — 300s after it started, not 300s after it finished.
    assert next_deadline(1000.0, TICK, now=1120.0) == 1300.0


def test_the_period_holds_across_ticks_of_differing_lengths():
    deadline, starts = 1000.0, []
    for work in (10.0, 200.0, 5.0, 90.0):
        starts.append(deadline)
        deadline = next_deadline(deadline, TICK, now=deadline + work)

    assert starts == [1000.0, 1300.0, 1600.0, 1900.0]


def test_a_tick_that_overran_its_interval_is_rerun_immediately():
    deadline = next_deadline(1000.0, TICK, now=1400.0)

    assert deadline == 1400.0
    assert max(0.0, deadline - 1400.0) == 0.0


def test_an_overrun_does_not_bank_a_burst_of_catch_up_passes():
    # A tick that took three intervals re-bases rather than owing three passes.
    deadline = next_deadline(1000.0, TICK, now=1900.0)

    assert deadline == 1900.0
    assert next_deadline(deadline, TICK, now=1900.0) == 2200.0


def test_a_deadline_reached_exactly_does_not_sleep():
    assert next_deadline(1000.0, TICK, now=1300.0) == 1300.0


def test_the_recording_double_satisfies_the_list_client_seam():
    assert isinstance(RecordingListItemClient(), ListItemClient)


def test_the_recording_file_handler_satisfies_the_client_seam():
    assert isinstance(RecordingFileHandlerClient(), FileHandlerClient)


def test_the_default_list_client_refuses_to_create_until_one_is_supplied():
    list_client = build_list_item_client("https://example.sharepoint.com/sites/any")

    assert isinstance(list_client, StubbedListItemClient)
    with pytest.raises(NotImplementedError):
        list_client.create_list_item(COMPLAINTS, {"Title": "CASE-0001"})


def test_the_default_list_client_refuses_to_update_until_one_is_supplied():
    list_client = build_list_item_client("https://example.sharepoint.com/sites/any")

    with pytest.raises(NotImplementedError):
        list_client.update_list_item(COMPLAINTS, 1, {"Status": "Closed"})


def test_the_default_file_handler_refuses_until_a_real_client_is_supplied():
    file_handler = build_file_handler_client("https://example.sharepoint.com/sites/any")

    assert isinstance(file_handler, StubbedFileHandlerClient)
    with pytest.raises(NotImplementedError):
        file_handler.copy_or_move_items_to_sharepoint(
            "src", "volumes.xlsx", "Shared Documents/Reports", COPY
        )
