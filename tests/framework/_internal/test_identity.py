"""The canonical encoding every deterministic id in this repository is hashed
through. Its output is on disk in every id already published, so these tests pin
the format itself, not just its properties."""

from framework._internal.identity import sha256_json


def test_the_digest_is_the_sha256_of_a_canonical_rendering():
    # Spelled out rather than recomputed, so a change to the separators, the key
    # ordering or the digest fails here instead of agreeing with itself.
    assert sha256_json({"list_name": "Cases-Complaints", "item_id": "42"}) == (
        "19e9b92fe2d06e241d6d336d1ff9105c5d48d6a1237bbb966f4e383bdc6f672d"
    )


def test_the_digest_does_not_depend_on_the_order_the_mapping_was_built_in():
    assert sha256_json({"b": "2", "a": "1"}) == sha256_json({"a": "1", "b": "2"})


def test_a_value_cannot_forge_another_payload():
    # The reason this is JSON and not a joined string. Under `"|".join(values)`
    # both of these render "x|y|z"; the encoding must keep them apart.
    assert sha256_json({"a": "x", "b": "y|z"}) != sha256_json({"a": "x|y", "b": "z"})


def test_nesting_groups_values_without_letting_them_collide():
    # DeriveKey nests the natural key under its own field so a key column named
    # "namespace" cannot displace the namespace itself.
    nested = sha256_json({"namespace": "cases", "natural_key": {"namespace": "x"}})
    flat = sha256_json({"namespace": "cases", "natural_key": "x"})
    assert nested != flat
