# Testing External Systems

Some feeds read from, or write to, a system the framework host cannot reach in
a test: a SharePoint list on the on-prem Subscription Edition tenant, a remote
API. If the Reader imports the network library and wires up the call itself,
every test of that Reader — and of every pipeline that uses it — becomes an
exercise in mocking network side-effects.

To keep tests fast, in-memory and granular, we decouple the **intent** of the
remote call from the **mechanism** using **Dependency Injection** and a
**Boundary Protocol**. The worked example below is the SharePoint pair in
`tools/integrations/remote.py`, which has real consumers and a real test file;
every symbol named here can be grepped in the tree.

(SAS is deliberately *not* an example. Per
[ADR-0029](adr/0029-sas-runs-outside-the-framework.md) a SAS job runs outside
the framework and lands a file; the pipeline reads it with `CsvReader`, and is
tested against a fixture CSV like any other file feed. There is no seam to
fake.)

## 1. Define the boundary (the Protocol)

Declare an interface for what the external system *can do for us*, and nothing
about *how* it connects. The SharePoint download seam is one method:

```python
@runtime_checkable
class SharePointFetcher(Protocol):
    """The SharePoint download seam: fetch one list's rows as a Dataset."""

    def fetch(self, site: str, list_name: str, auth: object) -> Dataset:
        """Fetch ``list_name`` from ``site`` (authenticated with ``auth``)."""
        ...
```

`SharePointPusher` is the upload dual — `push(site, list_name, auth, dataset,
strategy)`. Neither names a transport, an auth mechanism or a paging scheme;
those are the client's problem, behind the seam.

## 2. Build the component that takes the seam as a dependency

The Reader takes a fetcher as a constructor argument rather than building the
connection itself. Its job is purely logistical: hand the configuration to the
seam, report what it touched, return the Dataset.

```python
class SharePointReader:
    """Read a SharePoint list into a Dataset through a swappable fetcher."""

    def __init__(
        self,
        site: str,
        list_name: str,
        auth: object = None,
        *,
        fetcher: SharePointFetcher | None = None,
    ) -> None:
        self._site = site
        self._list_name = list_name
        self._auth = auth
        self._fetcher = fetcher or StubbedSharePointFetcher()
        self.data_locations: list[dict[str, str]] = []

    def read(self) -> Dataset:
        self.data_locations = [sharepoint_location(self._site, self._list_name)]
        return self._fetcher.fetch(self._site, self._list_name, self._auth)
```

The default, `StubbedSharePointFetcher`, **raises `NotImplementedError`** — the
real on-prem client is deferred, so a Reader constructed without a fetcher
refuses rather than pretending to reach the network. A missing client is
diagnosed as a missing client, never as an empty list.

## 3. Write the fake

Instead of `unittest.mock.MagicMock` (brittle, and poor at verifying multi-step
behaviour), write a small object that implements the Protocol and behaves like
the real system, locally. Two ship or live in the tests:

**`LocalCsvFetcher`** — a fake that serves *real data from a fixture file*. It
ignores the SharePoint configuration and reads the CSV, so the whole read path
is exercised with no tenant, no auth and no network:

```python
class LocalCsvFetcher:
    """An offline :class:`SharePointFetcher` backed by a local CSV fixture."""

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self._path = Path(path)

    def fetch(self, site: str, list_name: str, auth: object) -> Dataset:
        return Dataset.from_pandas(pd.read_csv(self._path))
```

**`FakeListBackend`** — in `tests/tools/test_integrations/test_sharepoint_reader.py`,
an in-memory list that plays *both* fetcher and pusher, so a Dataset pushed out
through `SharePointWriter` comes straight back through `SharePointReader`. It
honours the load strategy it is handed: `Refresh` replaces the list,
`AccumulateByRun` appends.

## 4. The granular test

With a fake behind the seam, a test asserts on behaviour through the Dataset's
public surface and never touches a network:

```python
def test_reads_a_list_through_a_fixture_fetcher(fixture_csv):
    # The fetch is behind a swappable seam: an offline LocalCsvFetcher stands in
    # for the deferred SharePoint client so the read path is exercised.
    reader = SharePointReader(
        "https://contoso.sharepoint.com/sites/cases",
        "Advisers",
        fetcher=LocalCsvFetcher(fixture_csv),
    )

    dataset = reader.read()

    # Observed only through the Dataset's public surface.
    assert dataset.columns == ["adviser_id", "name"]
    assert len(dataset) == 3
```

The same file pins the other things worth pinning about a seam: that the
default refuses (`test_default_fetcher_defers_until_implemented`), that the
configuration reaches the seam verbatim
(`test_passes_the_configured_site_list_and_auth_to_the_fetcher`, via a
`RecordingFetcher`), and that both directions compose
(`test_write_then_read_round_trips_through_an_in_memory_list_backend`).

## Why this works so well

- **Resilient to platform change.** When the on-prem SE client lands
  (NTLM/Kerberos/REST), it is a new production implementation of
  `SharePointFetcher` / `SharePointPusher`. `SharePointReader`,
  `SharePointWriter`, every pipeline that uses them and every test above **do
  not change**. The same holds if the list moves to a different backend
  entirely: build a new implementation of the seam, nothing else moves.
- **Tests the integration, not the implementation.** The test verifies that if
  rows come back through the seam, the Reader hands them on as a Dataset that
  the rest of the pipeline can validate and land — not how the client paged
  through the list.
- **A missing client fails loudly.** Because the stub raises, a pipeline wired
  without a real client cannot quietly land nothing.
- **Fast.** It executes entirely locally, in milliseconds.

The incremental reader, `SharePointModifiedReader` in
`tools/integrations/sharepoint_rest.py`, follows the same shape behind its own
`SharePointListClient` seam; see
[adding-a-feed.md](adding-a-feed.md#sharepointmodifiedreadersite-list_name-columns-window).
