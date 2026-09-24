```python
"""The two-part locations a component reports for the run record."""

from pathlib import Path

from framework._internal.locations import file_location, table_location


def test_a_file_location_is_a_namespace_and_a_name():
    assert file_location("/data/orders.csv") == {
        "namespace": "file",
        "name": "/data/orders.csv",
    }


def test_a_table_location_is_a_namespace_and_a_name():
    assert table_location("/data/raw.db", "orders") == {
        "namespace": "sqlite:/data/raw.db",
        "name": "orders",
    }


def test_a_native_nested_db_path_renders_a_slash_separated_namespace(tmp_path):
    """A record written on Windows stays comparable with one written on macOS."""
    db_path = Path(tmp_path, "cases", "raw.db")

    namespace = table_location(db_path, "orders")["namespace"]

    assert "\\" not in namespace
    assert namespace.endswith("cases/raw.db")

```
