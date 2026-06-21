```python
from framework.core import GOLD, SILVER
from framework.io import StoreCatalog
from pipelines.comprehensive_examples import (
    bronze_to_silver,
    high_risk_or_vulnerable,
    silver_to_gold,
)
from tests.framework_testing import read_rows


def test_complex_bronze_to_silver_example_combines_sources_and_validates(tmp_path):
    bronze_to_silver(tmp_path, run_id="2026-05-29")

    catalog = StoreCatalog(tmp_path)
    cases = read_rows(catalog.store("complex_cases"), SILVER, "case_snapshot")
    assert [row["case_ref"] for row in cases] == ["C-100", "C-101", "C-102"]
    assert (
        cases[0]
        | {
            "case_ref": "C-100",
            "customer_id": "CU-001",
            "adviser_id": "ADV-01",
            "region": "North",
            "team": "Advice A",
            "account_status": "open",
            "risk_band": "high",
            "open_contact_count": 2,
            "exposure_amount": 12800,
        }
        == cases[0]
    )

    # The example is intentionally not a one-table toy: silver also carries a
    # filtered detail table for downstream joins.
    contacts = read_rows(catalog.store("complex_cases"), SILVER, "open_contacts")
    assert [(row["case_ref"], row["contact_type"]) for row in contacts] == [
        ("C-100", "call"),
        ("C-100", "email"),
        ("C-101", "letter"),
    ]

    # Reference data is landed and validated as a separate subject, then joined
    # read-only by the case pipeline.
    advisers = read_rows(catalog.store("adviser_reference"), SILVER, "advisers")
    assert {row["adviser_id"] for row in advisers} == {"ADV-01", "ADV-02"}


def test_complex_silver_to_gold_example_assembles_reporting_outputs(tmp_path):
    bronze_to_silver(tmp_path, run_id="2026-05-29")
    silver_to_gold(tmp_path, run_id="2026-05-29")

    catalog = StoreCatalog(tmp_path)
    review_queue = read_rows(catalog.store("complex_reporting"), GOLD, "review_queue")
    assert [row["case_ref"] for row in review_queue] == ["C-100", "C-102"]
    assert [row["review_priority"] for row in review_queue] == [1430, 775]
    assert {row["run_id"] for row in review_queue} == {"2026-05-29"}

    adviser_summary = read_rows(
        catalog.store("complex_reporting"), GOLD, "adviser_summary"
    )
    assert adviser_summary == [
        {
            "adviser_id": "ADV-01",
            "region": "North",
            "selected_cases": 1,
            "total_exposure": 12800,
            "total_open_contacts": 2,
            "run_id": "2026-05-29",
            "logical_run_id": "2026-05-29",
            "load_date": "2026-05-29",
        },
        {
            "adviser_id": "ADV-02",
            "region": "South",
            "selected_cases": 1,
            "total_exposure": 7300,
            "total_open_contacts": 0,
            "run_id": "2026-05-29",
            "logical_run_id": "2026-05-29",
            "load_date": "2026-05-29",
        },
    ]


def test_complex_example_rules_are_plain_python():
    assert high_risk_or_vulnerable({"risk_band": "high", "vulnerable_flag": False})
    assert high_risk_or_vulnerable({"risk_band": "low", "vulnerable_flag": True})
    assert not high_risk_or_vulnerable(
        {"risk_band": "medium", "vulnerable_flag": False}
    )

```
