from pathlib import Path

import pandas as pd

from framework.core.dataset import Dataset
from framework.io.readers import CsvReader
from framework.io.store import DirectoryStoreBackend, Store, StoreCatalog
from framework.io.strategy import AccumulateByRun, Refresh

FIXTURE = Path(__file__).parent.parent.parent / "fixtures" / "cases.csv"


def _namespace_store(tmp_path, namespace="cases"):
    """A namespace Store over ``<tmp_path>/<namespace>.db`` via the catalog."""
    return StoreCatalog(tmp_path).store(namespace)


def test_store_writer_with_refresh_strategy_round_trips_a_dataset(tmp_path):
    # Store.writer accepts a table + an explicit Refresh strategy; the minted
    # Writer truncates + reloads (full-refresh) on each run — strategy is the
    # caller's declaration, not an implicit rule.
    dataset = CsvReader(FIXTURE).read()
    store = _namespace_store(tmp_path)

    store.writer("cases", Refresh()).write(dataset)
    landed = store.reader("cases").read()

    assert landed.columns == dataset.columns
    assert len(landed) == len(dataset)


def test_refresh_strategy_full_refreshes_rather_than_accumulates(tmp_path):
    # A Refresh strategy truncates + reloads: a second write replaces the
    # first rather than appending.
    dataset = CsvReader(FIXTURE).read()
    store = _namespace_store(tmp_path)

    store.writer("cases", Refresh()).write(dataset)
    store.writer("cases", Refresh()).write(dataset)

    landed = store.reader("cases").read()
    assert len(landed) == len(dataset)


def test_store_writer_with_accumulate_by_run_strategy_accumulates(tmp_path):
    # Store.writer accepts an explicit AccumulateByRun strategy; the minted
    # Writer stamps rows by run and accumulates across runs.
    dataset = CsvReader(FIXTURE).read()
    store = _namespace_store(tmp_path)

    store.writer("casepool", AccumulateByRun("r1", "2026-05-29")).write(dataset)
    store.writer("casepool", AccumulateByRun("r2", "2026-05-30")).write(dataset)

    landed = store.reader("casepool").read()
    assert len(landed) == 2 * len(dataset)
    assert "run_id" in landed.columns
    assert "load_date" in landed.columns


def test_store_columns_of_reads_the_prior_landing_and_labels_the_table(tmp_path):
    # The PriorColumns seam the raw drift check reads: after a landing,
    # columns_of reports that table's columns (order preserved) and a label that
    # names the namespace + table for the warning message.
    dataset = CsvReader(FIXTURE).read()
    store = _namespace_store(tmp_path)
    store.writer("cases", Refresh()).write(dataset)

    prior = store.columns_of("cases")

    assert prior.columns() == tuple(dataset.columns)
    assert prior.label == "cases.cases"


def test_store_columns_of_returns_none_when_the_table_does_not_exist(tmp_path):
    # First-ever run: nothing has landed, so there is no prior column set — the
    # seam returns None (a clean no-op for the drift check), not an error.
    store = _namespace_store(tmp_path)

    assert store.columns_of("cases").columns() is None


def test_store_catalog_mints_namespace_stores_over_distinct_files(tmp_path):
    dataset = CsvReader(FIXTURE).read()
    catalog = StoreCatalog(tmp_path)

    cases = catalog.store("cases")
    advisers = catalog.store("advisers")

    cases.writer("shared_table", Refresh()).write(dataset)
    advisers.writer("shared_table", Refresh()).write(dataset)

    # One file per namespace; a same-named table in two namespaces never collides.
    assert (tmp_path / "cases.db").exists()
    assert (tmp_path / "advisers.db").exists()
    assert len(cases.reader("shared_table").read()) == len(dataset)
    assert len(advisers.reader("shared_table").read()) == len(dataset)


def test_directory_backend_maps_a_nested_namespace_to_a_nested_file(tmp_path):
    # A namespace may nest with '/', e.g. the medallion's ``<subject>/<layer>``,
    # which maps to ``<root>/<subject>/<layer>.db`` — keeping a subject's files
    # together and isolated.
    backend = DirectoryStoreBackend()

    assert backend.db_file(tmp_path, "customers") == tmp_path / "customers.db"
    assert backend.db_file(tmp_path, "cases/silver") == tmp_path / "cases" / "silver.db"


def test_normalised_schema_across_logical_databases(tmp_path):
    # A namespace is a logical database holding many related tables; a normalised
    # schema spans several of them, addressed through the catalog. Cross-database
    # joins happen in Python (ADR-0002), so splitting files costs nothing.
    catalog = StoreCatalog(tmp_path)
    customers = catalog.store("customers")  # one logical database…
    reference = catalog.store("reference")  # …a second, read-only to the first

    # The "customers" database carries several related tables.
    customers.writer("customer", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame({"customer_id": [1, 2], "region_code": ["N", "S"]})
        )
    )
    customers.writer("account", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame({"account_id": [10, 11], "customer_id": [1, 2]})
        )
    )

    # The "reference" database carries its own related tables.
    reference.writer("region", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame({"region_code": ["N", "S"], "region_name": ["North", "South"]})
        )
    )
    reference.writer("product", Refresh()).write(
        Dataset.from_pandas(
            pd.DataFrame({"product_id": [100], "product_name": ["Widget"]})
        )
    )

    # One file per logical database, several tables each.
    assert (tmp_path / "customers.db").exists()
    assert (tmp_path / "reference.db").exists()

    # A cross-database join: customers + their region names, joined in Python.
    customer = customers.reader("customer").read().to_pandas()
    account = customers.reader("account").read().to_pandas()
    region = reference.reader("region").read().to_pandas()

    enriched = customer.merge(account, on="customer_id").merge(region, on="region_code")
    assert set(enriched["region_name"]) == {"North", "South"}
    assert len(enriched) == 2


def test_store_can_be_constructed_directly_over_one_file(tmp_path):
    # Store is namespace-scoped: handed one db file, it mints components over the
    # tables in it (the escape-hatch / direct construction path).
    dataset = CsvReader(FIXTURE).read()
    store = Store(tmp_path / "scratch.db", namespace="scratch")

    store.writer("cases", Refresh()).write(dataset)

    assert (tmp_path / "scratch.db").exists()
    assert len(store.reader("cases").read()) == len(dataset)
