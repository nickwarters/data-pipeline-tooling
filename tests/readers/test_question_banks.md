```python
"""Tests for the Question Bank store: the review platform's published banks, as rows."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from framework.core import ValidationError
from readers.question_banks import (
    OUTCOME_COLUMNS,
    QUESTION_COLUMNS,
    QUESTION_JSON_COLUMNS,
    QuestionBankStore,
)
from tests.framework_testing import rows_of

#: The bundled artifacts this reader exists to read — the frontend's source
#: tree, which is also its deployed tree.
BANKS = (
    Path(__file__).resolve().parents[2] / "platform_frontend" / "case-types" / "banks"
)
CURRENT_VERSION = "49fee46ee894ffc9f98557f181d8575cadf07d3c58ca072c9b6a1ea38fe69ec4"
EARLIER_VERSION = "943c9dade830929aa91da20a91d34ddd4cf2ccec81b9b9c479a38a8e0ea98d4b"


def _bank(directory: Path, *, slug: str = "demo", version=None, **overrides) -> Path:
    """Write one artifact, filed under the name its envelope declares."""
    payload = {
        "slug": slug,
        "label": "Demo",
        "version": version or "v1",
        "defaultOutcomeId": "good",
        "outcomeOptions": [{"id": "good", "wording": "Good", "severity": 0}],
        "questions": [
            {
                "id": "q-1",
                "text": "Was it logged?",
                "questionGroup": "Intake",
                "responseType": "outcome",
                "options": ["Good", "Poor"],
                "optionOutcomes": {"Good": "good", "Poor": "poor"},
                "deprecated": False,
            }
        ],
    }
    payload.update(overrides)
    stem = slug if version is None else f"{slug}.{version}"
    path = directory / f"{stem}.txt"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_the_current_bank_is_the_one_with_no_version():
    rows = rows_of(QuestionBankStore(base_dir=None).qb_reader("complaints").read())

    assert len(rows) == 49
    assert {row["slug"] for row in rows} == {"complaints"}
    assert {row["version"] for row in rows} == {CURRENT_VERSION}


def test_a_version_reads_the_bank_a_completed_case_was_reviewed_against():
    store = QuestionBankStore()

    rows = rows_of(store.qb_reader("complaints", EARLIER_VERSION, current=False).read())

    assert [row["id"] for row in rows] == ["q-cmp-0001", "q-cmp-0016"]
    assert {row["version"] for row in rows} == {EARLIER_VERSION}
    assert {row["generated_at"] for row in rows} == {"2026-04-03T14:30:00.000Z"}


def test_every_row_carries_the_envelope_the_failure_test_needs():
    rows = rows_of(QuestionBankStore().qb_reader("complaints").read())

    row = rows[0]
    assert row["default_outcome_id"] == "good"
    mapping = json.loads(row["option_outcomes"])
    failing = {
        value
        for value, outcome in mapping.items()
        if value != "NA" and outcome != row["default_outcome_id"]
    }
    assert failing == {"Good with process enhancement", "Poor", "Poor with harm"}


def test_the_declared_order_of_the_questions_survives_as_a_column():
    rows = rows_of(QuestionBankStore().qb_reader("complaints").read())

    assert [row["position"] for row in rows] == list(range(len(rows)))
    declared = json.loads((BANKS / "complaints.txt").read_text(encoding="utf-8"))
    assert [row["id"] for row in rows] == [q["id"] for q in declared["questions"]]


def test_the_question_columns_are_exactly_the_declared_set(tmp_path):
    _bank(tmp_path)

    dataset = QuestionBankStore(banks_dir=tmp_path).qb_reader("demo").read()

    assert tuple(dataset.to_pandas().columns) == QUESTION_COLUMNS


def test_a_nested_field_lands_as_json_a_consumer_can_load(tmp_path):
    _bank(
        tmp_path,
        questions=[
            {
                "id": "q-1",
                "text": "Applicable only sometimes?",
                "responseType": "yes-no-na",
                "optionOutcomes": {"No": "poor"},
                "showWhen": {"q-0": {"equals": "Yes"}},
                "labelIds": ["lbl-sla"],
                "deprecated": False,
            }
        ],
    )

    row = rows_of(QuestionBankStore(banks_dir=tmp_path).qb_reader("demo").read())[0]

    assert json.loads(row["show_when"]) == {"q-0": {"equals": "Yes"}}
    assert json.loads(row["label_ids"]) == ["lbl-sla"]
    assert json.loads(row["outcome_options"]) == [
        {"id": "good", "wording": "Good", "severity": 0}
    ]


def test_an_absent_nested_field_is_a_gap_and_never_the_string_null(tmp_path):
    _bank(tmp_path)

    frame = QuestionBankStore(banks_dir=tmp_path).qb_reader("demo").read().to_pandas()

    for column in QUESTION_JSON_COLUMNS:
        assert not (frame[column] == "null").any()
    assert frame["show_when"].isna().all()
    assert frame["remediation_actions"].isna().all()
    assert frame["label_ids"].isna().all()


def test_a_bank_that_is_not_there_fails_as_a_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        QuestionBankStore(banks_dir=tmp_path).qb_reader("demo").read()


def test_nothing_is_opened_until_read(tmp_path):
    reader = QuestionBankStore(banks_dir=tmp_path).qb_reader("demo")

    assert reader.data_locations == []


def test_read_records_the_artifact_it_touched(tmp_path):
    path = _bank(tmp_path)
    reader = QuestionBankStore(banks_dir=tmp_path).qb_reader("demo")

    reader.read()

    assert reader.data_locations == [{"namespace": "file", "name": str(path)}]


def test_describe_names_the_bank_without_naming_the_file():
    reader = QuestionBankStore().qb_reader("complaints", EARLIER_VERSION, current=False)

    described = reader.describe()
    assert "complaints" in described and EARLIER_VERSION in described
    assert ".txt" not in described


@pytest.mark.parametrize("case_type", ["../complaints", "a/b", "a\\b", "", "  ", "."])
def test_a_case_type_that_is_not_a_filename_segment_is_refused(tmp_path, case_type):
    with pytest.raises(ValidationError, match="case type"):
        QuestionBankStore(banks_dir=tmp_path).qb_reader(case_type)


@pytest.mark.parametrize("version", ["../other", "a/b", "..", ""])
def test_a_version_that_is_not_a_filename_segment_is_refused(tmp_path, version):
    with pytest.raises(ValidationError, match="version"):
        QuestionBankStore(banks_dir=tmp_path).qb_reader("demo", version, current=False)


def test_a_bank_declaring_another_slug_than_it_is_filed_under_is_refused(tmp_path):
    path = _bank(tmp_path, slug="other")
    path.rename(tmp_path / "demo.txt")

    with pytest.raises(ValidationError, match="declares slug 'other'"):
        QuestionBankStore(banks_dir=tmp_path).qb_reader("demo").read()


def test_a_versioned_bank_declaring_another_version_is_refused(tmp_path):
    _bank(tmp_path, version="v1")
    (tmp_path / "demo.v2.txt").write_text(
        (tmp_path / "demo.v1.txt").read_text(encoding="utf-8"), encoding="utf-8"
    )

    with pytest.raises(ValidationError, match="declares version 'v1'"):
        QuestionBankStore(banks_dir=tmp_path).qb_reader(
            "demo", "v2", current=False
        ).read()


def test_the_current_bank_is_not_held_to_a_version_it_was_not_asked_for(tmp_path):
    _bank(tmp_path, version=None)

    rows = rows_of(QuestionBankStore(banks_dir=tmp_path).qb_reader("demo").read())

    assert [row["version"] for row in rows] == ["v1"]


def test_a_file_carrying_no_questions_is_not_a_question_bank(tmp_path):
    (tmp_path / "demo.txt").write_text(
        json.dumps({"slug": "demo", "version": "v1"}), encoding="utf-8"
    )

    with pytest.raises(ValidationError, match="no 'questions' array"):
        QuestionBankStore(banks_dir=tmp_path).qb_reader("demo").read()


def test_a_bank_with_no_questions_yet_reads_as_no_rows_with_the_columns(tmp_path):
    _bank(tmp_path, questions=[])

    dataset = QuestionBankStore(banks_dir=tmp_path).qb_reader("demo").read()

    assert rows_of(dataset) == []
    assert tuple(dataset.to_pandas().columns) == QUESTION_COLUMNS


# --- outcome options -------------------------------------------------------


def test_the_outcome_options_are_a_row_each_with_their_score():
    rows = rows_of(QuestionBankStore().outcomes_reader("complaints").read())

    assert [(row["id"], row["wording"], row["severity"]) for row in rows] == [
        ("good", "Good", 0),
        ("good-with-process-enhancement", "Good with process enhancement", 25),
        ("poor", "Poor", 50),
        ("poor-with-harm", "Poor with harm", 100),
    ]


def test_severity_is_a_number_to_rank_by_and_not_a_string_to_parse():
    frame = QuestionBankStore().outcomes_reader("complaints").read().to_pandas()

    assert frame["severity"].dtype.kind in "iu"
    worst = frame.loc[frame["severity"].idxmax()]
    assert worst["id"] == "poor-with-harm"


def test_the_outcome_columns_are_exactly_the_declared_set(tmp_path):
    _bank(tmp_path)

    dataset = QuestionBankStore(banks_dir=tmp_path).outcomes_reader("demo").read()

    assert tuple(dataset.to_pandas().columns) == OUTCOME_COLUMNS


def test_an_outcome_row_carries_the_envelope_that_names_the_default():
    rows = rows_of(QuestionBankStore().outcomes_reader("complaints").read())

    assert {row["slug"] for row in rows} == {"complaints"}
    assert {row["default_outcome_id"] for row in rows} == {"good"}
    assert [row["position"] for row in rows] == [0, 1, 2, 3]


def test_the_two_readers_join_on_what_a_question_maps_its_answers_to():
    store = QuestionBankStore()
    questions = rows_of(store.qb_reader("complaints").read())
    outcomes = rows_of(store.outcomes_reader("complaints").read())

    declared = {row["id"] for row in outcomes}
    wordings = {row["wording"] for row in outcomes}
    for question in questions:
        mapping = json.loads(question["option_outcomes"])
        assert set(mapping) <= wordings
        assert set(mapping.values()) <= declared


def test_the_outcomes_of_a_versioned_bank_are_that_versions():
    rows = rows_of(
        QuestionBankStore()
        .outcomes_reader("complaints", EARLIER_VERSION, current=False)
        .read()
    )

    assert {row["version"] for row in rows} == {EARLIER_VERSION}
    assert {row["generated_at"] for row in rows} == {"2026-04-03T14:30:00.000Z"}


def test_a_file_carrying_no_outcome_options_is_not_a_question_bank(tmp_path):
    _bank(tmp_path, outcomeOptions=None)

    with pytest.raises(ValidationError, match="no 'outcomeOptions' array"):
        QuestionBankStore(banks_dir=tmp_path).outcomes_reader("demo").read()


def test_the_outcomes_reader_refuses_a_case_type_that_is_not_a_segment(tmp_path):
    with pytest.raises(ValidationError, match="case type"):
        QuestionBankStore(banks_dir=tmp_path).outcomes_reader("../complaints")


# --- every current bank at once --------------------------------------------


def _two_banks(tmp_path: Path) -> None:
    _bank(tmp_path, slug="beta", version=None)
    _bank(tmp_path, slug="alpha", version=None)


def test_naming_no_case_type_stacks_every_case_types_questions(tmp_path):
    _two_banks(tmp_path)

    rows = rows_of(QuestionBankStore(banks_dir=tmp_path).qb_reader().read())

    assert [row["slug"] for row in rows] == ["alpha", "beta"]
    assert [row["id"] for row in rows] == ["q-1", "q-1"]


def test_naming_no_case_type_stacks_every_case_types_outcomes(tmp_path):
    _two_banks(tmp_path)

    rows = rows_of(QuestionBankStore(banks_dir=tmp_path).outcomes_reader().read())

    assert [(row["slug"], row["id"]) for row in rows] == [
        ("alpha", "good"),
        ("beta", "good"),
    ]


def test_the_stacked_rows_keep_the_shape_of_a_single_banks_rows(tmp_path):
    _two_banks(tmp_path)
    store = QuestionBankStore(banks_dir=tmp_path)

    assert tuple(store.qb_reader().read().to_pandas().columns) == QUESTION_COLUMNS
    assert tuple(store.outcomes_reader().read().to_pandas().columns) == OUTCOME_COLUMNS


def test_the_order_does_not_depend_on_the_filesystem(tmp_path):
    _two_banks(tmp_path)
    _bank(tmp_path, slug="gamma", version=None)
    store = QuestionBankStore(banks_dir=tmp_path)

    first = [row["slug"] for row in rows_of(store.qb_reader().read())]
    second = [row["slug"] for row in rows_of(store.qb_reader().read())]

    assert first == second == ["alpha", "beta", "gamma"]


def test_a_versioned_artifact_is_not_a_current_bank(tmp_path):
    _bank(tmp_path, slug="demo", version=None)
    _bank(tmp_path, slug="demo", version="v0")

    rows = rows_of(QuestionBankStore(banks_dir=tmp_path).qb_reader().read())

    assert [row["version"] for row in rows] == ["v1"]


def test_finding_no_current_bank_is_refused_rather_than_read_as_nothing(tmp_path):
    _bank(tmp_path, slug="demo", version="v0")  # versioned only — no current bank

    with pytest.raises(ValidationError, match="no current Question Bank artifacts"):
        QuestionBankStore(banks_dir=tmp_path).qb_reader().read()


def test_a_banks_directory_that_is_not_there_is_refused_the_same_way(tmp_path):
    store = QuestionBankStore(banks_dir=tmp_path / "missing")

    with pytest.raises(ValidationError, match="no current Question Bank artifacts"):
        store.outcomes_reader().read()


def test_the_stacked_read_records_every_artifact_it_touched(tmp_path):
    _two_banks(tmp_path)
    reader = QuestionBankStore(banks_dir=tmp_path).qb_reader()

    reader.read()

    assert reader.data_locations == [
        {"namespace": "file", "name": str(tmp_path / "alpha.txt")},
        {"namespace": "file", "name": str(tmp_path / "beta.txt")},
    ]


def test_a_failed_stacked_read_claims_no_locations_at_all(tmp_path):
    _bank(tmp_path, slug="alpha", version=None)
    _bank(tmp_path, slug="wrong", version=None).rename(tmp_path / "beta.txt")
    reader = QuestionBankStore(banks_dir=tmp_path).qb_reader()

    with pytest.raises(ValidationError):
        reader.read()

    assert reader.data_locations == []


def test_the_stacked_readers_describe_themselves_without_naming_a_file(tmp_path):
    store = QuestionBankStore(banks_dir=tmp_path)

    assert store.qb_reader().describe() == ("QuestionBankReader(banks='every current')")
    assert store.outcomes_reader().describe() == (
        "OutcomeOptionsReader(banks='every current')"
    )


def test_the_stacked_readers_open_nothing_until_read(tmp_path):
    store = QuestionBankStore(banks_dir=tmp_path)

    assert store.qb_reader().data_locations == []
    assert store.outcomes_reader().data_locations == []


# --- every published version -----------------------------------------------


def test_the_versions_sweep_stacks_every_published_snapshot():
    rows = rows_of(QuestionBankStore().qb_reader(current=False).read())

    per_version = {}
    for row in rows:
        per_version.setdefault(row["version"], []).append(row["id"])
    assert {version: len(ids) for version, ids in per_version.items()} == {
        CURRENT_VERSION: 49,
        "5b4be525cff4b0321856f70662112ee6bf57d4af8399d9d0a1ae8db8d8a024cd": 3,
        EARLIER_VERSION: 2,
    }


def test_the_versions_sweep_gives_the_severities_of_each_publication():
    rows = rows_of(QuestionBankStore().outcomes_reader(current=False).read())

    per_version = {}
    for row in rows:
        per_version.setdefault(row["version"], {})[row["id"]] = row["severity"]
    assert len(per_version) == 3
    assert all(scores["poor-with-harm"] == 100 for scores in per_version.values())


def test_the_current_head_is_not_read_twice_as_its_own_snapshot():
    """The double count the sweep exists to avoid.

    ``complaints.txt`` declares the same ``version`` as
    ``complaints.<that version>.txt`` and holds the same questions, so a sweep
    over *every* file would land each of them twice — two identical rows, each
    correct alone, and every figure grouped by version doubled.
    """
    reader = QuestionBankStore().qb_reader(current=False)
    rows = rows_of(reader.read())

    read = [location["name"] for location in reader.data_locations]
    assert not any(name.endswith("complaints.txt") for name in read)
    keyed = [(row["version"], row["id"]) for row in rows]
    assert len(keyed) == len(set(keyed))


def test_the_head_and_the_snapshot_sweeps_are_reconcilable_by_version():
    store = QuestionBankStore()

    heads = {row["version"] for row in rows_of(store.qb_reader().read())}
    published = {
        row["version"] for row in rows_of(store.qb_reader(current=False).read())
    }

    # Not an assertion that they must agree — a head not yet published as a
    # snapshot is a real state. It is the comparison that makes it visible.
    assert heads <= published


def test_the_versioned_rows_keep_the_shape_of_a_single_banks_rows(tmp_path):
    _bank(tmp_path, version="v1")
    store = QuestionBankStore(banks_dir=tmp_path)

    assert (
        tuple(store.qb_reader(current=False).read().to_pandas().columns)
        == QUESTION_COLUMNS
    )
    assert (
        tuple(store.outcomes_reader(current=False).read().to_pandas().columns)
        == OUTCOME_COLUMNS
    )


def test_the_versioned_order_does_not_depend_on_the_filesystem(tmp_path):
    for slug in ("beta", "alpha"):
        for version in ("v2", "v1"):
            _bank(tmp_path, slug=slug, version=version)
    store = QuestionBankStore(banks_dir=tmp_path)

    first = [
        (r["slug"], r["version"])
        for r in rows_of(store.qb_reader(current=False).read())
    ]
    second = [
        (r["slug"], r["version"])
        for r in rows_of(store.qb_reader(current=False).read())
    ]

    assert first == second
    assert first == [("alpha", "v1"), ("alpha", "v2"), ("beta", "v1"), ("beta", "v2")]


def test_a_chronological_order_is_the_consumers_and_every_snapshot_carries_it():
    rows = rows_of(QuestionBankStore().qb_reader(current=False).read())

    assert all(row["generated_at"] for row in rows)
    ordered = sorted({(row["generated_at"], row["version"]) for row in rows})
    assert [version for _, version in ordered] == [
        "5b4be525cff4b0321856f70662112ee6bf57d4af8399d9d0a1ae8db8d8a024cd",
        EARLIER_VERSION,
        CURRENT_VERSION,
    ]


def test_a_current_bank_is_not_a_published_version(tmp_path):
    _bank(tmp_path, slug="demo", version=None)

    with pytest.raises(ValidationError, match="no published Question Bank versions"):
        QuestionBankStore(banks_dir=tmp_path).qb_reader(current=False).read()


def test_a_banks_directory_that_is_not_there_has_no_versions_either(tmp_path):
    store = QuestionBankStore(banks_dir=tmp_path / "missing")

    with pytest.raises(ValidationError, match="no published Question Bank versions"):
        store.outcomes_reader(current=False).read()


def test_a_snapshot_filed_under_a_version_it_does_not_declare_is_refused(tmp_path):
    _bank(tmp_path, slug="demo", version="v1")
    (tmp_path / "demo.v1.txt").rename(tmp_path / "demo.v9.txt")

    with pytest.raises(ValidationError, match="declares version 'v1'"):
        QuestionBankStore(banks_dir=tmp_path).qb_reader(current=False).read()


def test_the_snapshot_reads_describe_themselves_without_naming_a_file(tmp_path):
    store = QuestionBankStore(banks_dir=tmp_path)

    assert store.qb_reader(current=False).describe() == (
        "QuestionBankReader(banks='every published version')"
    )
    assert store.outcomes_reader(current=False).describe() == (
        "OutcomeOptionsReader(banks='every published version')"
    )


def test_the_snapshot_reads_open_nothing_until_read(tmp_path):
    store = QuestionBankStore(banks_dir=tmp_path)

    assert store.qb_reader(current=False).data_locations == []
    assert store.outcomes_reader(current=False).data_locations == []


# --- current and version name the same thing, so they must agree ------------


def test_a_version_with_current_left_true_is_refused_rather_than_guessed():
    """The contradiction a Case row walks into.

    ``questionBankVersion`` is absent on an in-progress Case and present on a
    completed one, so a consumer passing it straight through would read a
    different *kind* of file depending on the row without saying so. Refusing
    puts that branch at the call site.
    """
    with pytest.raises(ValidationError, match="current=True reads a bank's head"):
        QuestionBankStore().qb_reader("complaints", EARLIER_VERSION)


def test_one_case_types_whole_history_is_current_false_with_a_case_type(tmp_path):
    """The cell that completes the grid.

    Narrowing by Case Type is *which artifacts to open* — the same selection
    ``qb_reader("complaints")`` already makes over the heads — not the
    row-level predicate pushdown left open in the guide.
    """
    _bank(tmp_path, slug="alpha", version="v1")
    _bank(tmp_path, slug="alpha", version="v2")
    _bank(tmp_path, slug="beta", version="v1")
    store = QuestionBankStore(banks_dir=tmp_path)

    rows = rows_of(store.qb_reader("alpha", current=False).read())

    assert [(row["slug"], row["version"]) for row in rows] == [
        ("alpha", "v1"),
        ("alpha", "v2"),
    ]


def test_a_case_type_with_no_published_version_is_refused_not_read_as_nothing(
    tmp_path,
):
    _bank(tmp_path, slug="alpha", version="v1")
    _bank(tmp_path, slug="beta", version=None)
    store = QuestionBankStore(banks_dir=tmp_path)

    with pytest.raises(ValidationError, match="for case type 'beta'"):
        store.qb_reader("beta", current=False).read()


def test_unpinned_current_false_is_the_only_thing_version_cannot_say(tmp_path):
    """What earns ``current`` its place in the signature.

    With ``current=True``-plus-version refused, a version already implies a
    snapshot — so pinning one never needs the flag. Asking for *every* snapshot
    is the one statement the flag alone can make, and it is what let this store
    drop from four methods to two.
    """
    _bank(tmp_path, slug="alpha", version="v1")
    _bank(tmp_path, slug="beta", version="v2")
    store = QuestionBankStore(banks_dir=tmp_path)

    rows = rows_of(store.qb_reader(current=False).read())

    assert [(row["slug"], row["version"]) for row in rows] == [
        ("alpha", "v1"),
        ("beta", "v2"),
    ]


def test_a_version_without_a_case_type_names_nothing_and_is_refused(tmp_path):
    store = QuestionBankStore(banks_dir=tmp_path)

    with pytest.raises(ValidationError, match="minted per Case Type"):
        store.qb_reader(None, "v1", current=False)


def test_both_grains_apply_the_same_two_rules(tmp_path):
    store = QuestionBankStore(banks_dir=tmp_path)

    for call in (
        lambda: store.outcomes_reader("demo", "v1"),
        lambda: store.outcomes_reader(None, "v1", current=False),
    ):
        with pytest.raises(ValidationError):
            call()


def test_current_is_keyword_only_so_a_bare_boolean_cannot_be_passed(tmp_path):
    store = QuestionBankStore(banks_dir=tmp_path)

    with pytest.raises(TypeError):
        store.qb_reader("demo", None, False)  # type: ignore[misc]

```
