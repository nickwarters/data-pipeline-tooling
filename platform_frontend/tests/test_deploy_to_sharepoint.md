```python
"""Tests for deploy_to_sharepoint: environment support, file collection, the
pre-flight verify gate, graph-ordered upload, and post-upload hash verification.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import deploy_to_sharepoint  # noqa: E402
from deploy_to_sharepoint import (  # noqa: E402
    ENVIRONMENT_NAMES,
    SCRIPT_ROOT,
    host_page_for,
    target_folder_for,
    BANKS_DIR,
    BANK_ARTIFACT_SUFFIX,
    DEFAULT_INCLUDE_ROOTS,
    DEFAULT_INCLUDE_SUFFIXES,
    ENV_TOKEN,
    GRAPH_ARTIFACT,
    GRAPH_VERSION,
    HOST_BASE_TOKEN,
    DeployAborted,
    DeployOptions,
    LocalFile,
    PreflightFailed,
    RemoteFile,
    assert_graph_covers,
    collect_local_files,
    parse_args,
    render_templated_files,
    run,
    run_preflight,
    upload_order,
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

    def test_training_env_follows_the_same_folder_convention(self) -> None:
        opts = parse_args(SITE + ["--env", "training"])
        self.assertEqual(opts.env, "training")
        self.assertEqual(opts.target_folder, "CODE/CORA-TRAINING")

    def test_every_environment_derives_its_folder_and_host_page_by_convention(
        self,
    ) -> None:
        self.assertEqual(ENVIRONMENT_NAMES[0], "prod")
        self.assertEqual(target_folder_for("prod"), "CODE/CORA")
        self.assertEqual(host_page_for("prod"), "SitePages/app.aspx")
        for env in ENVIRONMENT_NAMES[1:]:
            self.assertEqual(target_folder_for(env), f"CODE/CORA-{env.upper()}")
            self.assertEqual(host_page_for(env), f"SitePages/{env}.app.aspx")
            self.assertEqual(parse_args(SITE + ["--env", env]).target_folder,
                             target_folder_for(env))

    def test_environment_names_match_the_app_resolver(self) -> None:
        # The app (src/config/environment.js) and this script each declare the
        # environment list; a deploy of a name the app does not know would land
        # in its own folder yet silently run against prod's lists.
        source = (SCRIPT_ROOT / "src" / "config" / "environment.js").read_text()
        match = re.search(
            r"ENVIRONMENT_NAMES = Object\.freeze\(\[(.*?)\]\)", source, re.S
        )
        assert match is not None
        names = re.findall(r"'([a-z0-9]+)'", match.group(1))
        self.assertEqual(
            ("prod", *names), ENVIRONMENT_NAMES,
            "src/config/environment.js and scripts/deploy_to_sharepoint.py "
            "disagree on the environment list",
        )

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


class CollectLocalFilesBankArtifactTest(unittest.TestCase):
    """Question Bank .txt artifacts are scoped to case-types/banks/."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def _write(self, rel: str, content: str = "content") -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def test_bank_txt_artifact_is_collected(self) -> None:
        self._write("case-types/banks/complaints.txt", '{"ok": true}')
        self._write("case-types/manifest.js", "export default {};")
        files = collect_local_files(self.root)
        self.assertIn("case-types/banks/complaints.txt", files)

    def test_txt_outside_banks_dir_is_still_excluded(self) -> None:
        self._write("src/notes.txt", "stray tool artefact")
        self._write("case-types/banks/complaints.txt", '{"ok": true}')
        files = collect_local_files(self.root)
        self.assertNotIn("src/notes.txt", files)
        self.assertIn("case-types/banks/complaints.txt", files)


class FakeClient:
    """A dict-backed target folder, with hooks for the ways an upload can go bad."""

    def __init__(self, files: dict[str, bytes] | None = None) -> None:
        self.files: dict[str, bytes] = dict(files or {})
        self.uploaded: list[str] = []
        self.sources: list[tuple[str, Path]] = []
        self.deleted: list[str] = []
        self.folders: list[str] = []
        # Hooks: paths the target silently loses, serves back altered, refuses to
        # read, or refuses to delete.
        self.drop: set[str] = set()
        self.corrupt: dict[str, bytes] = {}
        self.unreadable: set[str] = set()
        self.undeletable: set[str] = set()
        self.advertise: dict[str, str] = {}

    def ensure_folder(self, folder: str) -> None:
        self.folders.append(folder)

    def list_files(self):
        return [
            RemoteFile(
                path, self.advertise.get(path, hashlib.sha256(content).hexdigest())
            )
            for path, content in sorted(self.files.items())
        ]

    def download_file(self, path: str) -> bytes:
        if path in self.unreadable:
            raise OSError("checked out by another user")
        return self.files[path]

    def upload_file(self, source_path: Path, path: str) -> None:
        # Read what we were handed rather than trusting it: a deploy that stages
        # the wrong bytes, or no file at all, must fail here.
        content = source_path.read_bytes()
        self.uploaded.append(path)
        self.sources.append((path, source_path))
        if path in self.drop:
            self.files.pop(path, None)
            return
        self.files[path] = self.corrupt.get(path, content)

    def delete_file(self, path: str) -> None:
        self.deleted.append(path)
        if path not in self.undeletable:
            self.files.pop(path, None)


class DeployHarness(unittest.TestCase):
    """A temporary source tree, graph artifact, fake gate and fake target folder."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.preflight_calls: list[str] = []
        # The deploy requires --root to match the gate's source tree, so the
        # harness makes the temporary tree that root.
        patched = mock.patch.object(deploy_to_sharepoint, "SCRIPT_ROOT", self.root)
        patched.start()
        self.addCleanup(patched.stop)
        self.lines: list[str] = []

    def write(self, rel: str, content: str = "x") -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def write_graph(self, nodes: dict[str, list[str]], **overrides) -> Path:
        artifact = self.root / GRAPH_ARTIFACT
        artifact.parent.mkdir(parents=True, exist_ok=True)
        graph = {
            "version": GRAPH_VERSION,
            "deployable": {
                "includeRoots": list(DEFAULT_INCLUDE_ROOTS),
                "includeSuffixes": list(DEFAULT_INCLUDE_SUFFIXES),
                "bankDir": BANKS_DIR,
                "bankSuffix": BANK_ARTIFACT_SUFFIX,
            },
            "nodes": {
                rel: {
                    "imports": [
                        {"specifier": dep, "resolved": dep, "kind": "static"}
                        for dep in deps
                    ]
                }
                for rel, deps in nodes.items()
            },
            "external": ["node:fs/promises"],
        }
        graph.update(overrides)
        artifact.write_text(json.dumps(graph))
        return artifact

    def log(self, *parts) -> None:
        self.lines.append(" ".join(str(part) for part in parts))

    @property
    def logged(self) -> str:
        return "\n".join(self.lines)

    def deploy(self, client: FakeClient, *, fail_gate=False, dry_run=False) -> int:
        artifact = self.root / GRAPH_ARTIFACT

        def preflight(log=print):
            self.preflight_calls.append("ran")
            if fail_gate:
                raise PreflightFailed("2 failure(s) — graph not written")
            return artifact

        opts = DeployOptions(
            root=self.root,
            site_url="https://sp.example.com/sites/cora",
            library="Style Library",
            target_folder="CODE/CORA",
            dry_run=dry_run,
            env="prod",
        )
        return run(
            opts,
            client_factory=lambda _opts: client,
            preflight=preflight,
            log=self.log,
        )


class PreflightGateTest(DeployHarness):
    def test_a_failing_gate_stops_the_deploy_before_any_call(self) -> None:
        self.write("src/app.js")
        self.write_graph({"src/app.js": []})
        client = FakeClient()

        exit_code = self.deploy(client, fail_gate=True)

        self.assertEqual(exit_code, 1)
        self.assertEqual(self.preflight_calls, ["ran"])
        self.assertEqual(client.uploaded, [])
        self.assertEqual(client.deleted, [])
        self.assertEqual(client.folders, [])
        self.assertIn("graph not written", self.logged)

    def test_deploying_a_root_other_than_the_verified_source_tree_aborts(self) -> None:
        self.write("src/app.js")
        self.write_graph({"src/app.js": []})
        client = FakeClient()

        opts = DeployOptions(
            root=self.root / "alternate-root",
            site_url="https://sp.example.com/sites/cora",
            library="Style Library",
            target_folder="CODE/CORA",
            dry_run=False,
            env="prod",
        )
        exit_code = run(
            opts,
            client_factory=lambda _opts: client,
            preflight=lambda log=print: self.root / GRAPH_ARTIFACT,
            log=self.log,
        )

        self.assertEqual(exit_code, 1)
        self.assertEqual(client.uploaded, [])
        self.assertIn("alternate-root", self.logged)

    def test_run_preflight_returns_the_freshly_written_artifact(self) -> None:
        def runner(command, **kwargs):
            self.assertEqual(kwargs["cwd"], self.root)
            self.write_graph({"src/app.js": []})
            return SimpleNamespace(returncode=0)

        artifact = run_preflight(root=self.root, runner=runner, log=self.log)

        self.assertEqual(artifact, self.root / GRAPH_ARTIFACT)

    def test_run_preflight_raises_on_a_non_zero_exit(self) -> None:
        with self.assertRaises(PreflightFailed):
            run_preflight(
                root=self.root,
                runner=lambda command, **kwargs: SimpleNamespace(returncode=1),
                log=self.log,
            )

    def test_run_preflight_raises_when_the_gate_cannot_be_run(self) -> None:
        def runner(command, **kwargs):
            raise FileNotFoundError("npm")

        with self.assertRaises(PreflightFailed):
            run_preflight(root=self.root, runner=runner, log=self.log)

    def test_run_preflight_raises_when_the_artifact_is_absent(self) -> None:
        with self.assertRaises(PreflightFailed):
            run_preflight(
                root=self.root,
                runner=lambda command, **kwargs: SimpleNamespace(returncode=0),
                log=self.log,
            )


class UploadOrderTest(unittest.TestCase):
    def test_dependencies_come_before_their_dependents(self) -> None:
        graph = {"a.js": ["b.js"], "b.js": ["c.css"], "c.css": []}

        order = upload_order(["a.js", "b.js", "c.css"], graph, set(graph))

        self.assertEqual(order, ["c.css", "b.js", "a.js"])

    def test_an_unchanged_dependency_is_traversed_but_not_uploaded(self) -> None:
        graph = {"a.js": ["b.js"], "b.js": ["c.css"], "c.css": []}

        order = upload_order(["a.js", "c.css"], graph, set(graph))

        self.assertEqual(order, ["c.css", "a.js"])

    def test_a_dependency_outside_the_deployed_set_is_dropped(self) -> None:
        graph = {"a.js": ["dev/fixtures/cases.js"]}

        order = upload_order(["a.js"], graph, {"a.js"})

        self.assertEqual(order, ["a.js"])

    def test_a_cycle_orders_its_members_deterministically(self) -> None:
        graph = {"a.js": ["b.js"], "b.js": ["a.js"]}

        order = upload_order(["a.js", "b.js"], graph, set(graph))

        self.assertEqual(order, ["b.js", "a.js"])

    def test_a_deployable_file_the_gate_never_saw_aborts(self) -> None:
        with self.assertRaises(DeployAborted) as caught:
            assert_graph_covers({"src/orphan.js": LocalFile("src/orphan.js", b"")}, {})

        self.assertIn("src/orphan.js", str(caught.exception))


class OrderedUploadTest(DeployHarness):
    def test_the_upload_runs_leaf_first(self) -> None:
        self.write("src/a.js")
        self.write("src/b.js")
        self.write("src/c.css")
        self.write_graph(
            {"src/a.js": ["src/b.js"], "src/b.js": ["src/c.css"], "src/c.css": []}
        )
        client = FakeClient()

        exit_code = self.deploy(client)

        self.assertEqual(exit_code, 0)
        self.assertEqual(client.uploaded, ["src/c.css", "src/b.js", "src/a.js"])

    def test_a_question_bank_artifact_uploads_before_its_case_type_module(
        self,
    ) -> None:
        self.write("case-types/complaints.js")
        self.write("case-types/banks/complaints.txt", "{}")
        self.write_graph(
            {
                "case-types/complaints.js": ["case-types/banks/complaints.txt"],
                "case-types/banks/complaints.txt": [],
            }
        )
        client = FakeClient()

        self.assertEqual(self.deploy(client), 0)
        self.assertEqual(
            client.uploaded,
            ["case-types/banks/complaints.txt", "case-types/complaints.js"],
        )

    def test_the_templated_host_page_uploads_last(self) -> None:
        self.write("host/index.html", "<script src=\"{{CORA_BASE}}/src/app.js\">")
        self.write("src/app.js")
        self.write_graph({"host/index.html": [], "src/app.js": []})
        client = FakeClient()

        self.assertEqual(self.deploy(client), 0)
        self.assertEqual(client.uploaded[-1], "host/index.html")

    def test_a_file_the_gate_never_saw_aborts_the_deploy(self) -> None:
        self.write("src/app.js")
        self.write("src/stray.css")
        self.write_graph({"src/app.js": []})
        client = FakeClient()

        self.assertEqual(self.deploy(client), 1)
        self.assertEqual(client.uploaded, [])
        self.assertIn("src/stray.css", self.logged)

    def test_a_graph_from_a_different_version_aborts(self) -> None:
        self.write("src/app.js")
        self.write_graph({"src/app.js": []}, version=GRAPH_VERSION + 1)

        self.assertEqual(self.deploy(FakeClient()), 1)

    def test_include_rules_that_disagree_with_this_script_abort(self) -> None:
        self.write("src/app.js")
        self.write_graph(
            {"src/app.js": []},
            deployable={
                "includeRoots": ["src"],
                "includeSuffixes": list(DEFAULT_INCLUDE_SUFFIXES),
                "bankDir": BANKS_DIR,
                "bankSuffix": BANK_ARTIFACT_SUFFIX,
            },
        )

        self.assertEqual(self.deploy(FakeClient()), 1)

    def test_a_dry_run_shows_the_upload_order_and_writes_nothing(self) -> None:
        self.write("src/a.js")
        self.write("src/b.js")
        self.write_graph({"src/a.js": ["src/b.js"], "src/b.js": []})
        client = FakeClient()

        self.assertEqual(self.deploy(client, dry_run=True), 0)
        self.assertEqual(client.uploaded, [])
        self.assertLess(
            self.logged.index("src/b.js"),
            self.logged.rindex("src/a.js"),
            "the dry run prints the order it would upload in",
        )


class UploadStagingTest(DeployHarness):
    def test_same_named_files_in_different_folders_stage_separately(self) -> None:
        self.write("src/a/x.js", "from a;")
        self.write("src/b/x.js", "from b;")
        self.write_graph({"src/a/x.js": [], "src/b/x.js": []})
        client = FakeClient()

        self.assertEqual(self.deploy(client), 0)

        staged = dict(client.sources)
        self.assertNotEqual(staged["src/a/x.js"], staged["src/b/x.js"])
        self.assertEqual(client.files["src/a/x.js"], b"from a;")
        self.assertEqual(client.files["src/b/x.js"], b"from b;")
        for rel, source in client.sources:
            self.assertEqual(source.name, rel.rsplit("/", 1)[-1])
            self.assertFalse(source.exists())


class PostUploadVerificationTest(DeployHarness):
    def setUp(self) -> None:
        super().setUp()
        self.write("src/app.js", "boot();")
        self.write("src/lib.js", "helper();")
        self.write_graph({"src/app.js": ["src/lib.js"], "src/lib.js": []})

    def test_a_clean_deploy_reports_every_file_re_fetched(self) -> None:
        client = FakeClient()

        self.assertEqual(self.deploy(client), 0)
        self.assertIn("Verified: 2 files re-fetched", self.logged)

    def test_a_file_absent_after_upload_is_reported_as_missing(self) -> None:
        client = FakeClient()
        client.drop = {"src/lib.js"}

        self.assertEqual(self.deploy(client), 1)
        self.assertIn("missing", self.logged)
        self.assertIn("src/lib.js", self.logged)

    def test_served_bytes_that_differ_are_reported_as_mismatched(self) -> None:
        client = FakeClient()
        client.corrupt = {"src/app.js": b"not what we uploaded"}

        self.assertEqual(self.deploy(client), 1)
        self.assertIn("mismatch", self.logged)
        self.assertIn("src/app.js", self.logged)

    def test_a_remote_file_with_no_local_counterpart_is_reported(self) -> None:
        client = FakeClient({"src/old.js": b"left behind"})
        client.undeletable = {"src/old.js"}

        self.assertEqual(self.deploy(client), 1)
        self.assertIn("unexpected", self.logged)
        self.assertIn("src/old.js", self.logged)

    def test_a_file_that_cannot_be_re_fetched_is_named_not_raised(self) -> None:
        client = FakeClient()
        client.unreadable = {"src/app.js"}

        self.assertEqual(self.deploy(client), 1)
        self.assertIn("src/app.js", self.logged)

    def test_verification_runs_even_when_there_is_nothing_to_apply(self) -> None:
        # The plan says "in sync" because the target advertises the local hash;
        # only re-fetching the bytes shows what it actually serves.
        client = FakeClient(
            {
                "src/app.js": b"boot();",
                "src/lib.js": b"stale bytes a hand-edit left behind",
            }
        )
        client.advertise = {
            "src/lib.js": hashlib.sha256(b"helper();").hexdigest()
        }

        self.assertEqual(self.deploy(client), 1)
        self.assertEqual(client.uploaded, [])
        self.assertIn("mismatch", self.logged)
        self.assertIn("src/lib.js", self.logged)


class TemplateRenderedComparisonTest(DeployHarness):
    def test_the_host_page_is_compared_after_token_substitution(self) -> None:
        self.write("host/index.html", "<b>{{CORA_ENV}}</b>")
        self.write_graph({"host/index.html": []})
        client = FakeClient()

        self.assertEqual(self.deploy(client), 0)
        self.assertEqual(client.files["host/index.html"], b"<b>prod</b>")


if __name__ == "__main__":
    unittest.main()

```
