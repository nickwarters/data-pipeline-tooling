```python
"""The demo Case Type ingest: source -> raw -> silver -> gold.

The gold reduction used to live in a shared ``case_review.gold`` builder every
Case Type called. It is now four lines inside this pipeline's ``run``, so these
tests drive the pipeline itself: what they pin is the *rule* -- silver keeps
every observation, gold keeps one current row per Case, and a Case's id is a
deterministic digest of its natural key under its namespace.
"""

import pandas as pd

from framework._internal.identity import sha256_json
from framework.run import RunContext, active_context
from pipelines.ingest.pipeline import run
from pipelines.ingest.schema import NAMESPACE
from tools.medallion import medallion
from tools.store import StoreRegistry


def _drive(tmp_path, logical_run_id: str) -> None:
    """Run the pipeline once, exactly as ``run_pipeline`` drives it.

    ``load_date`` is pinned to the logical run id because that is the column the
    gold reduction orders on; left to default it would be today's date for both
    drives and the "latest wins" rule would have nothing to choose between.
    """
    context = RunContext(
        base_dir=tmp_path, logical_run_id=logical_run_id, load_date=logical_run_id
    )
    with active_context(context):
        run(context)


def _gold(tmp_path) -> pd.DataFrame:
    med = medallion(StoreRegistry(tmp_path), NAMESPACE)
    return med.gold.reader(NAMESPACE).read().to_pandas()


def _silver(tmp_path) -> pd.DataFrame:
    med = medallion(StoreRegistry(tmp_path), NAMESPACE)
    return med.silver.reader(NAMESPACE).read().to_pandas()


def test_gold_holds_one_current_row_per_case(tmp_path):
    _drive(tmp_path, "2026-05-29")

    gold = _gold(tmp_path)
    assert len(gold) == len(set(gold["case_ref"]))
    assert "case_id" in gold.columns


def test_a_second_observation_accumulates_in_silver_but_not_in_gold(tmp_path):
    # The framework is the historian for a destructive source: silver keeps both
    # observations of a Case, gold keeps only the latest.
    _drive(tmp_path, "2026-05-29")
    _drive(tmp_path, "2026-05-30")

    silver, gold = _silver(tmp_path), _gold(tmp_path)
    assert len(silver) == 2 * len(gold)
    assert len(gold) == len(set(gold["case_ref"]))
    # Gold carries the later observation, not the first one it ever saw.
    assert set(gold["load_date"]) == {"2026-05-30"}


def test_a_re_drive_of_the_same_run_leaves_gold_unchanged(tmp_path):
    # Refresh truncates and reloads, and the reduction is deterministic, so the
    # same logical run twice is the same gold.
    _drive(tmp_path, "2026-05-29")
    first = _gold(tmp_path)
    _drive(tmp_path, "2026-05-29")
    second = _gold(tmp_path)

    assert len(second) == len(first)
    assert list(second["case_id"]) == list(first["case_id"])


def test_case_id_is_a_deterministic_digest_of_the_natural_key(tmp_path):
    # Same natural key, same namespace, same id across runs and machines -- which
    # is what lets a Detail Table derive a matching id without a join.
    _drive(tmp_path, "2026-05-29")

    gold = _gold(tmp_path).set_index("case_ref")
    assert gold.loc["c1", "case_id"] == sha256_json(
        {"namespace": NAMESPACE, "natural_key": {"case_ref": "c1"}}
    )

```
