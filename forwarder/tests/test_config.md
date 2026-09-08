```python
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


def write_config(tmp_path, text: str):
    config_file = tmp_path / "config.yaml"
    config_file.write_text(text, encoding="utf-8")
    return config_file


def test_a_declared_task_is_parsed(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "*.json"
        """,
    )

    config = Config.from_file(config_file)

    assert config.tasks == (
        Task(
            action=CREATE_SHAREPOINT_ITEMS,
            file_pattern="*.json",
            list_name="Cases-complaints",
        ),
    )


def test_each_list_is_declared_with_its_own_pattern(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "create-complaints-*.json"
          - action: create_sharepoint_items
            list_name: Cases-appeals
            file_pattern: "create-appeals-*.json"
          - action: update_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "update-complaints-*.json"
          - action: update_sharepoint_items
            list_name: Cases-appeals
            file_pattern: "update-appeals-*.json"
        """,
    )

    config = Config.from_file(config_file)

    assert [(task.list_name, task.file_pattern) for task in config.tasks] == [
        ("Cases-complaints", "create-complaints-*.json"),
        ("Cases-appeals", "create-appeals-*.json"),
        ("Cases-complaints", "update-complaints-*.json"),
        ("Cases-appeals", "update-appeals-*.json"),
    ]


def test_a_list_task_without_a_list_name_is_refused(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            file_pattern: "*.json"
        """,
    )

    with pytest.raises(ValueError, match="'list_name' must be a non-empty string"):
        Config.from_file(config_file)


def test_a_list_name_on_a_copy_task_is_refused(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: copy_file_to_sharepoint
            file_pattern: "*.xlsx"
            destination_dir: "Shared Documents/Reports"
            list_name: Cases-complaints
        """,
    )

    with pytest.raises(
        ValueError,
        match="unknown key 'list_name' for action 'copy_file_to_sharepoint'",
    ):
        Config.from_file(config_file)


def test_tasks_keep_their_declared_order(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "b-*.json"
          - action: create_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "a-*.json"
        """,
    )

    assert [task.file_pattern for task in Config.from_file(config_file).tasks] == [
        "b-*.json",
        "a-*.json",
    ]


def test_tasks_for_selects_by_action(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "*.json"
          - action: upload_document
            file_pattern: "*.pdf"
        """,
    )

    config = Config.from_file(config_file)

    assert [
        task.file_pattern for task in config.tasks_for(CREATE_SHAREPOINT_ITEMS)
    ] == ["*.json"]


def test_an_update_task_is_parsed(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: update_sharepoint_items
            list_name: Cases-appeals
            file_pattern: "update-*.json"
        """,
    )

    assert Config.from_file(config_file).tasks == (
        Task(
            action=UPDATE_SHAREPOINT_ITEMS,
            file_pattern="update-*.json",
            list_name="Cases-appeals",
        ),
    )


def test_a_destination_on_an_update_task_is_refused(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: update_sharepoint_items
            list_name: Cases-appeals
            file_pattern: "update-*.json"
            destination_dir: "Shared Documents/Reports"
        """,
    )

    with pytest.raises(
        ValueError,
        match="unknown key 'destination_dir' for action 'update_sharepoint_items'",
    ):
        Config.from_file(config_file)


def test_per_item_retry_is_off_unless_declared(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "*.json"
        """,
    )

    task = Config.from_file(config_file).tasks[0]

    assert task.enable_per_item_retry_next_run is False


def test_per_item_retry_is_parsed_when_declared(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "*.json"
            enable_per_item_retry_next_run: true
          - action: update_sharepoint_items
            list_name: Cases-appeals
            file_pattern: "update-*.json"
            enable_per_item_retry_next_run: false
        """,
    )

    assert [
        task.enable_per_item_retry_next_run
        for task in Config.from_file(config_file).tasks
    ] == [True, False]


def test_a_non_boolean_per_item_retry_is_refused(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "*.json"
            enable_per_item_retry_next_run: sometimes
        """,
    )

    with pytest.raises(
        ValueError, match="'enable_per_item_retry_next_run' must be true or false"
    ):
        Config.from_file(config_file)


def test_per_item_retry_on_a_copy_task_is_refused(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: copy_file_to_sharepoint
            file_pattern: "*.xlsx"
            destination_dir: "Shared Documents/Reports"
            enable_per_item_retry_next_run: true
        """,
    )

    with pytest.raises(
        ValueError,
        match=(
            "unknown key 'enable_per_item_retry_next_run' "
            "for action 'copy_file_to_sharepoint'"
        ),
    ):
        Config.from_file(config_file)


def test_a_copy_task_is_parsed_with_its_destination_and_method(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: copy_file_to_sharepoint
            file_pattern: "*.xlsx"
            destination_dir: "Shared Documents/Reports"
            method: move
        """,
    )

    assert Config.from_file(config_file).tasks == (
        Task(
            action=COPY_FILE_TO_SHAREPOINT,
            file_pattern="*.xlsx",
            destination_dir="Shared Documents/Reports",
            method=MOVE,
        ),
    )


def test_a_copy_task_defaults_to_copying_rather_than_moving(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: copy_file_to_sharepoint
            file_pattern: "*.xlsx"
            destination_dir: "Shared Documents/Reports"
        """,
    )

    assert Config.from_file(config_file).tasks[0].method == COPY


def test_a_copy_task_without_a_destination_is_refused(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: copy_file_to_sharepoint
            file_pattern: "*.xlsx"
        """,
    )

    with pytest.raises(
        ValueError, match="'destination_dir' must be a non-empty string"
    ):
        Config.from_file(config_file)


def test_an_unrecognised_method_is_refused(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: copy_file_to_sharepoint
            file_pattern: "*.xlsx"
            destination_dir: "Shared Documents/Reports"
            method: teleport
        """,
    )

    with pytest.raises(ValueError, match="'method' must be one of copy, move"):
        Config.from_file(config_file)


def test_a_destination_on_a_create_task_is_refused(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            file_pattern: "*.json"
            destination_dir: "Shared Documents/Reports"
        """,
    )

    with pytest.raises(
        ValueError,
        match="unknown key 'destination_dir' for action 'create_sharepoint_items'",
    ):
        Config.from_file(config_file)


def test_an_empty_file_declares_no_tasks(tmp_path):
    assert Config.from_file(write_config(tmp_path, "")).tasks == ()


def test_an_empty_tasks_key_declares_no_tasks(tmp_path):
    assert Config.from_file(write_config(tmp_path, "tasks:\n")).tasks == ()


def test_a_missing_file_is_refused_by_path(tmp_path):
    missing = tmp_path / "absent.yaml"

    with pytest.raises(ValueError, match=f"no config file at '{missing}'"):
        Config.from_file(missing)


def test_invalid_yaml_is_refused(tmp_path):
    config_file = write_config(tmp_path, "tasks: [unclosed\n")

    with pytest.raises(ValueError, match="is not valid YAML"):
        Config.from_file(config_file)


def test_a_non_mapping_document_is_refused(tmp_path):
    config_file = write_config(tmp_path, "- just\n- a\n- list\n")

    with pytest.raises(ValueError, match="must contain a mapping"):
        Config.from_file(config_file)


def test_an_unknown_top_level_key_is_refused(tmp_path):
    config_file = write_config(tmp_path, "jobs: []\n")

    with pytest.raises(ValueError, match="unknown key 'jobs'"):
        Config.from_file(config_file)


def test_tasks_that_are_not_a_list_are_refused(tmp_path):
    config_file = write_config(tmp_path, "tasks:\n  action: create_sharepoint_items\n")

    with pytest.raises(ValueError, match="'tasks' must be a list"):
        Config.from_file(config_file)


def test_a_task_that_is_not_a_mapping_is_refused(tmp_path):
    config_file = write_config(tmp_path, "tasks:\n  - create_sharepoint_items\n")

    with pytest.raises(ValueError, match="task 1 must be a mapping"):
        Config.from_file(config_file)


def test_an_unknown_task_key_is_refused_naming_its_position(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: create_sharepoint_items
            list_name: Cases-complaints
            file_pattern: "*.json"
          - action: create_sharepoint_items
            list_name: Cases-appeals
            file_glob: "*.json"
        """,
    )

    with pytest.raises(ValueError, match="task 2: unknown key 'file_glob'"):
        Config.from_file(config_file)


def test_a_task_missing_its_pattern_is_refused(tmp_path):
    config_file = write_config(
        tmp_path, "tasks:\n  - action: create_sharepoint_items\n"
    )

    with pytest.raises(ValueError, match="'file_pattern' must be a non-empty string"):
        Config.from_file(config_file)


def test_a_task_with_an_empty_action_is_refused(tmp_path):
    config_file = write_config(
        tmp_path,
        """
        tasks:
          - action: ""
            file_pattern: "*.json"
        """,
    )

    with pytest.raises(ValueError, match="'action' must be a non-empty string"):
        Config.from_file(config_file)

```
