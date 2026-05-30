import pandas as pd
import pytest

from framework.data_handle import DataHandle
from framework.silver import raw_to_silver
from framework.store import Store
from framework.validators import ValidationError
from tests._schema_fixtures import LandedCase


def _land_raw(store: Store, table: str, frame: pd.DataFrame) -> None:
    # Land a snapshot into raw exactly as an upstream source->raw pipeline would
    # — schema-light, no enforcement at raw (ADR-0008).
    store.writer("raw", table).write(DataHandle.from_pandas(frame))


def test_raw_to_silver_validates_then_writes_silver_db(tmp_path):
    # The builder reads raw, enforces the schema as a post-validator, and writes
    # the conforming data into the subject's silver.db (ADR-0008).
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
    # silver post-validate step with a located message — and because the run is
    # fail-fast and atomic (ADR-0007), no silver.db is written.
    store = Store(tmp_path)
    _land_raw(
        store,
        "cases",
        pd.DataFrame({"case_ref": ["c1", "c2"], "score": ["oops", "nope"]}),
    )

    with pytest.raises(ValidationError, match="post-validate failed.*score"):
        raw_to_silver(store, "cases", LandedCase).run()

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
