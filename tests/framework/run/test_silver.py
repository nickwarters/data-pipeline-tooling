import pandas as pd
import pytest

from framework.io.dataset import Dataset
from framework.io.store import Store
from framework.io.strategy import AccumulateByRun, Refresh
from framework.run.silver import raw_to_silver
from framework.transform.processors import CoercionError
from framework.transform.validators import ValidationError
from tests._schema_fixtures import CoercedCase, LandedCase, RuledCase


def _land_raw(store: Store, table: str, frame: pd.DataFrame, strategy=None) -> None:
    # Land a snapshot into raw exactly as an upstream source->raw pipeline would
    # with schema-light, unenforced raw storage.
    store.writer("raw", table, strategy if strategy is not None else Refresh()).write(
        Dataset.from_pandas(frame)
    )


def test_raw_to_silver_validates_then_writes_silver_db(tmp_path):
    store = Store(tmp_path)
    _land_raw(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1", "c2"], "score": [10, 20]}),
    )

    raw_to_silver(store, "cases", LandedCase).run()

    assert (tmp_path / "silver.db").exists()
    landed = store.reader("silver", "cases").read()
    assert set(landed.columns) >= {"case_ref", "score"}
    assert len(landed) == 2


def test_raw_to_silver_aborts_at_the_silver_boundary_without_writing(tmp_path):
    # A schema breach in raw (here: score landed as text, not int) fails at the
    # silver post-validate step with a located message, and no silver.db is written.
    store = Store(tmp_path)
    _land_raw(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1", "c2"], "score": ["oops", "nope"]}),
    )

    with pytest.raises(ValidationError, match="post-validate failed.*score"):
        raw_to_silver(store, "cases", LandedCase).run()

    assert not (tmp_path / "silver.db").exists()


def test_raw_to_silver_aborts_on_a_value_rule_breach_without_writing(tmp_path):
    # Value-level rules ride the same SchemaValidator post-validator, so a
    # breach (here a case_ref that fails its 9-10 digit Pattern) aborts at the
    # silver boundary with a located message, and no silver.db is written. Both
    # fields are str, so coercion is not involved.
    store = Store(tmp_path)
    _land_raw(
        store,
        "cases",
        pd.DataFrame(
            {
                "case_ref": ["123456789", "NOPE"],
                "status": ["open", "closed"],
            }
        ),
    )

    with pytest.raises(ValidationError, match="post-validate failed.*violates pattern"):
        raw_to_silver(store, "cases", RuledCase).run()

    assert not (tmp_path / "silver.db").exists()


def test_raw_to_silver_coerces_round_trip_lossy_types_through_to_silver(tmp_path):
    # End to end: a schema with a date and a boolean — types that land in raw as
    # text / 1-0 — passes through raw_to_silver because the coercion processor
    # casts them ahead of the SchemaValidator. The run completing (the validator
    # runs on the coerced output before the write) is the proof, and silver lands.
    store = Store(tmp_path)
    _land_raw(
        store,
        "cases",
        pd.DataFrame(
            {
                "case_ref": ["c1", "c2"],
                "opened": ["2026-01-01", "2026-01-02"],  # dates as text
                "active": ["TRUE", "FALSE"],  # booleans as text
            }
        ),
    )

    raw_to_silver(store, "cases", CoercedCase).run()  # would fail without coercion

    assert (tmp_path / "silver.db").exists()
    assert len(store.reader("silver", "cases").read()) == 2


def test_raw_to_silver_aborts_when_a_value_cannot_be_coerced(tmp_path):
    # A value the coercer cannot parse aborts at the process step (fail-fast,
    # atomic) with a located message, and no silver.db is written.
    store = Store(tmp_path)
    _land_raw(
        store,
        "cases",
        pd.DataFrame(
            {
                "case_ref": ["c1"],
                "opened": ["not-a-date"],
                "active": ["TRUE"],
            }
        ),
    )

    with pytest.raises(CoercionError, match="opened"):
        raw_to_silver(store, "cases", CoercedCase).run()

    assert not (tmp_path / "silver.db").exists()


def test_raw_stays_schema_light(tmp_path):
    # Raw is a faithful mirror of the source snapshot: data that the silver
    # schema would reject (score as text) still lands in raw unenforced, so the
    # contract bites one layer before Selection, not at the landing zone.
    store = Store(tmp_path)
    nonconforming = pd.DataFrame({"case_ref": ["c1"], "score": ["not-an-int"]})

    _land_raw(store, "cases", nonconforming)

    landed = store.reader("raw", "cases").read()
    assert len(landed) == 1
    assert list(landed.to_pandas()["score"]) == ["not-an-int"]


def test_raw_to_silver_accumulates_when_strategy_is_accumulate_by_run(tmp_path):
    # With AccumulateByRun the builder stamps run_id / load_date and appends rows
    # rather than refreshing; silver is a historian for a destructive
    # current-state source.
    store = Store(tmp_path)
    _land_raw(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1", "c2"], "score": [10, 20]}),
        strategy=AccumulateByRun("2026-05-29", "2026-05-29"),
    )

    raw_to_silver(
        store, "cases", LandedCase, strategy=AccumulateByRun("2026-05-29", "2026-05-29")
    ).run()

    landed = store.reader("silver", "cases").read().to_pandas()
    assert len(landed) == 2
    assert set(landed["run_id"]) == {"2026-05-29"}
    assert set(landed["load_date"]) == {"2026-05-29"}


def test_raw_to_silver_accumulate_re_run_is_idempotent(tmp_path):
    # Re-driving the same run_id with AccumulateByRun is idempotent: delete-by-run
    # then insert, so re-running the same snapshot never duplicates silver rows.
    store = Store(tmp_path)
    _land_raw(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1"], "score": [10]}),
        strategy=AccumulateByRun("2026-05-29", "2026-05-29"),
    )

    raw_to_silver(
        store, "cases", LandedCase, strategy=AccumulateByRun("2026-05-29", "2026-05-29")
    ).run()
    raw_to_silver(
        store, "cases", LandedCase, strategy=AccumulateByRun("2026-05-29", "2026-05-29")
    ).run()

    assert len(store.reader("silver", "cases").read()) == 1


def test_raw_to_silver_accumulate_retains_history_across_distinct_runs(tmp_path):
    # Distinct run_ids accumulate; silver becomes the system of record for a
    # destructive source, so a later snapshot adds its rows and never wipes prior
    # runs' rows.
    store = Store(tmp_path)

    _land_raw(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1"], "score": [10]}),
        strategy=AccumulateByRun("2026-05-29", "2026-05-29"),
    )
    raw_to_silver(
        store, "cases", LandedCase, strategy=AccumulateByRun("2026-05-29", "2026-05-29")
    ).run()

    _land_raw(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1"], "score": [99]}),
        strategy=AccumulateByRun("2026-05-30", "2026-05-30"),
    )
    raw_to_silver(
        store, "cases", LandedCase, strategy=AccumulateByRun("2026-05-30", "2026-05-30")
    ).run()

    landed = store.reader("silver", "cases").read().to_pandas()
    assert len(landed) == 2
    assert set(landed["run_id"]) == {"2026-05-29", "2026-05-30"}
