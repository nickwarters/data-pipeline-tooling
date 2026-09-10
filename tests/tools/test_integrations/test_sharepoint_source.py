"""Test how a SharePoint list identifies itself to the checkpoint store."""

from uuid import UUID

import pytest

from tools.integrations.sharepoint_rest import SharePointSource
from tools.source_checkpoint import _LEGACY_KIND, SourceIdentity

SITE = "https://contoso.sharepoint.com/sites/case-review"
LIST_ID = UUID("1b6f2a3c-0000-4a1f-9c7e-5f2d8a4b1e01")
SOURCE = SharePointSource(SITE, LIST_ID)


def test_a_list_is_keyed_on_its_site_and_guid_and_satisfies_the_store_identity():
    assert SOURCE.key == f"{SITE}|{LIST_ID}"
    assert SOURCE.kind == "sharepoint-list"
    assert isinstance(SOURCE, SourceIdentity)


def test_the_kind_is_the_one_the_carry_over_reads_the_old_file_under():
    # The generic store reads a pre-generic sharepoint.db row back under this
    # kind, so the two spellings must agree or an upgraded base directory reads
    # every list as unseen.
    assert SharePointSource.kind == _LEGACY_KIND


@pytest.mark.parametrize(
    "site",
    [
        "https://user:secret@contoso.sharepoint.com/sites/case-review",
        "https://user@contoso.sharepoint.com/sites/case-review",
    ],
    ids=["user_and_password", "user_only"],
)
def test_credentials_in_the_site_url_never_reach_the_key(site):
    # Credentials must not survive in persisted control state — and the same
    # list addressed with and without them is one source, not two.
    credentialled = SharePointSource(site, LIST_ID)

    assert "@" not in credentialled.key
    assert credentialled.key == SOURCE.key


def test_a_trailing_slash_addresses_the_same_source():
    assert SharePointSource(SITE + "/", LIST_ID).key == SOURCE.key


def test_the_host_folds_to_lower_case_but_the_path_does_not():
    # DNS does not distinguish hosts by case; a site path may.
    upper_host = "https://CONTOSO.SharePoint.com/sites/case-review"

    assert SharePointSource(upper_host, LIST_ID).key == SOURCE.key
    assert SharePointSource(SITE.upper(), LIST_ID).key != SOURCE.key


def test_two_lists_under_one_site_are_two_sources():
    other = SharePointSource(SITE, UUID("2c7e3b4d-0000-4b2a-8d6f-6a3e9b5c2f12"))

    assert other.key != SOURCE.key
