```python
from pathlib import Path

import pandas as pd
import pytest

from framework.core.dataset import Dataset
from framework.io.readers import CsvReader
from framework.io.strategy import AccumulateByRun, Refresh
from tools.store import DirectoryStoreBackend, Store, StoreRegistry

FIXTURE = Path(__file__).parent.parent / "fixtures" / "cases.csv"


def _namespace_store(tmp_path, namespace="cases"):
    """A namespace Store over ``<tmp_path>/<namespace>.db`` via the registry."""
    return StoreRegistry(tmp_path).store(namespace)


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


def test_store_registry_mints_namespace_stores_over_distinct_files(tmp_path):
    dataset = CsvReader(FIXTURE).read()
    registry = StoreRegistry(tmp_path)

    cases = registry.store("cases")
    advisers = registry.store("advisers")

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
    registry = StoreRegistry(tmp_path)
    customers = registry.store("customers")  # one logical database…
    reference = registry.store("reference")  # …a second, read-only to the first

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


def test_registry_registers_and_returns_a_named_reader_and_writer(tmp_path):
    # The registry holds named Readers/Writers so a pipeline refers to a component
    # by name. register() classifies by port (read()/write()) and returns the
    # component; reader()/writer() fetch the exact object back.
    registry = StoreRegistry(tmp_path)
    store = registry.store("cases")

    a_reader = store.reader("cases")
    a_writer = store.writer("cases", Refresh())
    registry.register("cases_in", a_reader)
    registry.register("cases_out", a_writer)

    assert registry.reader("cases_in") is a_reader
    assert registry.writer("cases_out") is a_writer


def test_register_returns_the_component_for_one_line_use(tmp_path):
    # register() hands the component straight back so a caller can register and
    # wire it in one expression.
    registry = StoreRegistry(tmp_path)
    writer = registry.store("cases").writer("cases", Refresh())

    assert registry.register("cases_out", writer) is writer


def test_registry_lookup_round_trips_through_the_named_components(tmp_path):
    # End-to-end: a write and a read addressed purely by registered name land and
    # read back the same rows, never touching the namespace Store directly.
    dataset = CsvReader(FIXTURE).read()
    registry = StoreRegistry(tmp_path)
    store = registry.store("cases")
    registry.register("cases_out", store.writer("cases", Refresh()))
    registry.register("cases_in", store.reader("cases"))

    registry.writer("cases_out").write(dataset)
    landed = registry.reader("cases_in").read()

    assert len(landed) == len(dataset)


def test_registered_components_wire_into_a_framework_pipeline(tmp_path):
    # The point of the registry: a Pipeline reads and writes through components
    # addressed purely by registered name. The framework Pipeline is unchanged —
    # it takes the concrete Reader / Writer that reader()/writer() hand back.
    from framework.run import Pipeline

    registry = StoreRegistry(tmp_path)
    store = registry.store("cases")
    registry.register("source", CsvReader(FIXTURE))
    registry.register("sink", store.writer("cases", Refresh()))

    p = Pipeline("cases")
    r = p.read(registry.reader("source"), name="read")
    p.write(registry.writer("sink"), r, name="write")
    p.run()

    assert len(store.reader("cases").read()) == 3


def test_registry_raises_a_helpful_error_for_an_unknown_name(tmp_path):
    registry = StoreRegistry(tmp_path)
    registry.register("known", registry.store("cases").reader("cases"))

    with pytest.raises(KeyError, match="no Reader registered as 'missing'"):
        registry.reader("missing")
    with pytest.raises(KeyError, match="no Writer registered as 'missing'"):
        registry.writer("missing")


def test_registry_rejects_a_component_that_is_neither_reader_nor_writer(tmp_path):
    registry = StoreRegistry(tmp_path)

    with pytest.raises(TypeError, match="neither a Reader"):
        registry.register("bad", object())

```
