"""Tests for the --env environment support in deploy_to_sharepoint (ADR-0033)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from deploy_to_sharepoint import (  # noqa: E402
    ENV_TOKEN,
    HOST_BASE_TOKEN,
    LocalFile,
    parse_args,
    render_templated_files,
)


SITE = ["--site-url", "https://sp.example.com/sites/cora"]


class ParseArgsEnvTest(unittest.TestCase):
    def test_default_env_is_prod_targeting_the_prod_folder(self) -> None:
        opts = parse_args(SITE)
        self.assertEqual(opts.env, "prod")
        self.assertEqual(opts.target_folder, "CODE/CORA")

    def test_uat_env_switches_the_default_target_folder(self) -> None:
        opts = parse_args(SITE + ["--env", "uat"])
        self.assertEqual(opts.env, "uat")
        self.assertEqual(opts.target_folder, "CODE/CORA-UAT")

    def test_explicit_target_folder_overrides_the_env_default(self) -> None:
        opts = parse_args(SITE + ["--env", "uat", "--target-folder", "CODE/X"])
        self.assertEqual(opts.target_folder, "CODE/X")

    def test_unknown_env_is_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            parse_args(SITE + ["--env", "staging"])


class RenderTemplatedFilesTest(unittest.TestCase):
    def render_one(self, rel: str, content: bytes) -> bytes:
        rendered = render_templated_files(
            {rel: LocalFile(rel, content)},
            {HOST_BASE_TOKEN: "/sites/cora/Style Library/CODE/CORA-UAT",
             ENV_TOKEN: "uat"},
        )
        return rendered[rel].content

    def test_substitutes_both_tokens_in_host_html(self) -> None:
        content = self.render_one(
            "host/index.html",
            b"<script>window.CORA_ENV='{{CORA_ENV}}';</script>"
            b'<script src="{{CORA_BASE}}/src/app.js"></script>',
        )
        self.assertIn(b"window.CORA_ENV='uat'", content)
        self.assertIn(b'src="/sites/cora/Style Library/CODE/CORA-UAT/src/app.js"', content)
        self.assertNotIn(b"{{", content)

    def test_non_templated_suffixes_pass_through_unchanged(self) -> None:
        js = b"const x = '{{CORA_ENV}}';"
        self.assertEqual(self.render_one("src/app.js", js), js)

    def test_files_without_tokens_are_returned_as_is(self) -> None:
        original = LocalFile("host/plain.html", b"<p>hello</p>")
        rendered = render_templated_files(
            {original.path: original}, {ENV_TOKEN: "uat"}
        )
        self.assertIs(rendered[original.path], original)


if __name__ == "__main__":
    unittest.main()
