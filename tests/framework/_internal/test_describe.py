"""The opt-in ``describe()`` protocol.

Components render their own safe plan summary; the builder never reflects over
their attributes. These tests pin the shared ``render``/``redact_url`` helpers
and the self-redaction the remote components are responsible for.
"""

from framework._internal.describe import component_summary, redact_url, render
from framework.io.readers import CsvReader, SharePointReader, SqliteReader
from framework.io.writers import SharePointWriter, SqliteTruncateReloadWriter
from framework.validate.validators import RowCountValidator


class Widget:
    pass


def test_component_summary_uses_describe_if_present():
    class Described:
        def describe(self) -> str:
            return "Described(x=1)"

    assert component_summary(Described()) == "Described(x=1)"


def test_component_summary_falls_back_to_class_name():
    assert component_summary(Widget()) == "Widget"


def test_component_summary_returns_none_string_for_none():
    assert component_summary(None) == "none"


def test_render_with_no_fields_is_the_bare_class_name():
    assert render(Widget()) == "Widget"


def test_render_reprs_fields_and_omits_none():
    # None-valued fields drop out so optional config does not clutter the plan.
    assert render(Widget(), a=1, b=None, c=["x"]) == "Widget(a=1, c=['x'])"


def test_redact_url_strips_embedded_credentials():
    assert (
        redact_url("https://user:hunter2@host.test/path")
        == "https://<redacted>@host.test/path"
    )


def test_redact_url_leaves_a_credential_free_url_untouched():
    assert redact_url("https://host.test/path") == "https://host.test/path"


def test_reader_describe_renders_its_own_target():
    assert CsvReader("data/cases.csv").describe() == "CsvReader(path='data/cases.csv')"


def test_reader_describe_includes_columns_when_set():
    described = SqliteReader("raw.db", "cases", columns=["id", "name"]).describe()
    assert (
        described
        == "SqliteReader(db_path='raw.db', table='cases', columns=['id', 'name'])"
    )


def test_writer_describe_renders_its_own_target():
    described = SqliteTruncateReloadWriter("silver.db", "cases").describe()
    assert described == "SqliteTruncateReloadWriter(db_path='silver.db', table='cases')"


def test_validator_describe_omits_open_bounds():
    assert RowCountValidator(minimum=10).describe() == "RowCountValidator(minimum=10)"


def test_sharepoint_components_self_redact_credentials():
    # The SharePoint reader and writer strip credentials embedded in the site
    # URL and never render the auth config — secrets cannot reach the plan.
    site = "https://user:hunter2@sp.test/sites/cases"
    auth = {"password": "hunter2", "token": "abc123"}

    reader = SharePointReader(site, "Cases", auth=auth).describe()
    writer = SharePointWriter(site, "Cases", auth=auth).describe()

    for described in (reader, writer):
        assert "site='https://<redacted>@sp.test/sites/cases'" in described
        assert "list_name='Cases'" in described
        assert "auth" not in described
        assert "hunter2" not in described
        assert "abc123" not in described
