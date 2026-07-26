from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "scaffold_case_type.py"


class ScaffoldCaseTypeTest(unittest.TestCase):
    def make_fixture_root(self) -> Path:
        root = Path(tempfile.mkdtemp(prefix="case-type-scaffold-"))
        for directory in [
            "case-types",
            "src/services",
            "dev/fixtures",
            "docs/adr",
        ]:
            (root / directory).mkdir(parents=True, exist_ok=True)
        for file_path in [
            "case-types/manifest.js",
            "src/services/permissions.js",
            "src/services/section-access.js",
            "dev/fixtures/personas.js",
            "dev/fixtures/cases.js",
            "CLAUDE.md",
        ]:
            shutil.copy2(REPO_ROOT / file_path, root / file_path)
        return root

    def run_scaffold(self, root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "python3",
                str(SCRIPT_PATH),
                "--root",
                str(root),
 *args,
            ],
            cwd=REPO_ROOT,
            check=True,
            text=True,
            capture_output=True,
        )

    def assert_js_parses(self, file_path: Path) -> None:
        subprocess.run(
            ["node", "--check", str(file_path)],
            check=True,
            text=True,
            capture_output=True,
        )

    def test_wires_a_new_case_type_end_to_end(self) -> None:
        root = self.make_fixture_root()

        result = self.run_scaffold(
            root,
            "--slug",
            "widget-review",
            "--display",
            "Widget Review",
        )

        self.assertIn("Scaffolded Case Type widget-review", result.stdout)
        self.assertIn("Cases on list Cases-WidgetReview", result.stdout)

        module_path = root / "case-types" / "widget-review.js"
        test_path = root / "tests" / "widget-review.test.js"
        self.assertTrue(module_path.is_file())
        self.assertTrue(test_path.is_file())
        self.assert_js_parses(module_path)
        self.assert_js_parses(test_path)

        module_source = module_path.read_text(encoding="utf-8")
        self.assertIn("The **Widget Review** Case Type", module_source)
        self.assertIn("TODO(case-type): Replace starter questions", module_source)
        self.assertIn("TODO(case-type): Confirm the SLA hours", module_source)
        self.assertNotIn("dashboardPanels", module_source)
        # #525: the generated Case Type must declare its Case list. The mock
        # store's partition is total (no default store, #249), so a fixture Case
        # whose Case Type declares no listName throws and takes ?mock=1 down for
        # every other Case Type.
        self.assertIn("listName: 'Cases-WidgetReview',", module_source)
        # #525/#527: no eligibleGroups at all. The org-wide 'Reviewers' would
        # open the type to every reviewer, and the derived
        # 'Reviewers - Widget Review' is already granted by the registry display
        # name — restating it makes a second grant that a later rename of the
        # registry entry does NOT move, silently keeping the decommissioned
        # group's access alive.
        self.assertNotIn("eligibleGroups:", module_source)
        # #527: the display name lives only on the CASE_TYPES registry entry.
        self.assertNotIn("displayName:", module_source)
        self.assertIn("caseTableColumns: [", module_source)
        self.assertIn("value: 'details.customerName'", module_source)

        # One registry edit (#508): the CASE_TYPES entry carries the slug, the
        # display name the SharePoint group names derive from, and the lazy
        # importer. permissions.caseTypes is derived from it.
        manifest_path = root / "case-types" / "manifest.js"
        manifest = manifest_path.read_text(encoding="utf-8")
        self.assert_js_parses(manifest_path)
        self.assertIn("slug: 'widget-review',", manifest)
        self.assertIn("displayName: 'Widget Review',", manifest)
        # #527: frozen like every other entry, so the one copy of the display
        # name that composes three SharePoint group names stays one copy.
        self.assertIn("Object.freeze({", manifest)
        self.assertIn("importer: () => import('./widget-review.js'),", manifest)
        # The scaffold writes no Question Bank artifact, so it declares no bank
        # thunk — `bank` is optional on a CASE_TYPES entry.
        self.assertNotIn("banks/widget-review.txt", manifest)

        self.assertEqual(
            (root / "src/services/permissions.js").read_text(encoding="utf-8"),
            (REPO_ROOT / "src/services/permissions.js").read_text(encoding="utf-8"),
            "permissions.caseTypes derives from CASE_TYPES; the scaffold must not edit permissions.js",
        )

        personas = (root / "dev/fixtures/personas.js").read_text(encoding="utf-8")
        self.assertIn("'reviewer-widget-review'", personas)
        self.assertIn("'CaseTypeOwner - Widget Review'", personas)
        self.assertIn("'JourneyOwner - Widget Review'", personas)

        cases = (root / "dev/fixtures/cases.js").read_text(encoding="utf-8")
        self.assertIn("widget-review-case-1", cases)
        self.assertIn("widget-review-case-2", cases)
        self.assertIn("caseType: 'widget-review'", cases)

        adr = (root / "docs/adr/0028-case-type-scaffolding.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("# Case Type scaffolding contract", adr)
        self.assertIn("refuses to overwrite an existing Case Type slug", adr)
        # #525: the ADR must describe what the code does. The old text claimed
        # the Case Type had no listName so its Cases were mock-openable; the
        # mock store has had no default bucket since #249.
        self.assertIn("listName: 'Cases-WidgetReview'", adr)
        self.assertNotIn("deliberately has no `listName`", adr)

    def test_generated_test_file_asserts_the_declared_list_name(self) -> None:
        root = self.make_fixture_root()
        self.run_scaffold(root, "--slug", "widget-review", "--display", "Widget Review")

        generated = (root / "tests/widget-review.test.js").read_text(encoding="utf-8")
        self.assertIn("assert.equal(config.listName, 'Cases-WidgetReview');", generated)
        self.assertNotIn("assert.equal(config.listName, undefined);", generated)

    def test_list_name_defaults_from_the_slug_and_is_overridable(self) -> None:
        root = self.make_fixture_root()
        self.run_scaffold(
            root,
            "--slug",
            "widget-review",
            "--display",
            "Widget Review",
            "--list-name",
            "Cases-LegacyWidgets",
        )

        module_source = (root / "case-types/widget-review.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("listName: 'Cases-LegacyWidgets',", module_source)
        self.assertNotIn("Cases-WidgetReview", module_source)

    def test_adds_the_module_to_the_claude_md_directory_layout(self) -> None:
        root = self.make_fixture_root()
        self.run_scaffold(root, "--slug", "widget-review", "--display", "Widget Review")

        claude_md = (root / "CLAUDE.md").read_text(encoding="utf-8")
        layout = claude_md.split("\n## Directory layout")[1].split("\n## ")[0]
        self.assertIn("widget-review.js", layout)
        # Inside the case-types/ block, above its banks/ sub-block — not
        # appended somewhere the layout contract merely happens to accept.
        self.assertLess(
            layout.index("  widget-review.js"),
            layout.index("  banks/ "),
        )

    def test_closing_message_enumerates_the_expected_red_tests(self) -> None:
        root = self.make_fixture_root()

        result = self.run_scaffold(
            root, "--slug", "widget-review", "--display", "Widget Review"
        )

        # The sign-off must be matchable test-by-test: a developer should be able
        # to map every remaining red test to a line here (#525).
        self.assertIn("tests/case-type-manifest.test.js", result.stdout)
        self.assertIn(
            "known Case Type slugs resolve to their static import functions",
            result.stdout,
        )
        self.assertIn(
            "unknown Case Type slugs reject with a developer-useful error",
            result.stdout,
        )
        self.assertIn(
            "unknown primary Case Type slug sets a clear user-facing error state",
            result.stdout,
        )
        self.assertIn("Any OTHER", result.stdout)
        self.assertIn("Cases-WidgetReview", result.stdout)

    def test_rejects_a_blank_list_name(self) -> None:
        root = self.make_fixture_root()

        with self.assertRaises(subprocess.CalledProcessError) as context:
            self.run_scaffold(
                root,
                "--slug",
                "widget-review",
                "--display",
                "Widget Review",
                "--list-name",
                "   ",
            )

        self.assertIn("--list-name must not be blank", context.exception.stderr)

    def test_rejects_a_display_name_that_could_break_out_of_generated_code(
        self,
    ) -> None:
        # --display and --list-name were interpolated UNESCAPED into generated
        # JS string literals, JSDoc comments and Markdown; only non-blank was
        # checked. A value carrying a quote, a comment terminator or a newline
        # could close the literal it lands in and inject code into a file the
        # maintainer is about to commit.
        root = self.make_fixture_root()

        for flag, value in [
            ("--display", "Widget */ evil"),
            ("--display", "Widget'; globalThis.pwned = 1; const x = '"),
            ("--display", "Widget\nReview"),
            ("--display", "Widget`Review"),
            ("--display", "Widget\\Review"),
            ("--list-name", "Cases-Widget'; drop"),
        ]:
            with self.subTest(flag=flag, value=value):
                with self.assertRaises(subprocess.CalledProcessError) as context:
                    args = ["--slug", "widget-review", "--display", "Widget Review"]
                    if flag == "--display":
                        args[3] = value
                    else:
                        args += [flag, value]
                    self.run_scaffold(root, *args)
                self.assertIn(f"Invalid {flag}", context.exception.stderr)

    def test_escapes_an_apostrophe_in_a_legitimate_display_name(self) -> None:
        # "O'Brien Review" is a perfectly ordinary Case Type name, and it used
        # to emit `eligibleGroups: ['Reviewers - O'Brien Review']` — a module
        # that does not parse. It must be escaped, not rejected.
        root = self.make_fixture_root()
        self.run_scaffold(
            root, "--slug", "obrien-review", "--display", "O'Brien Review"
        )

        module_path = root / "case-types" / "obrien-review.js"
        self.assert_js_parses(module_path)
        self.assert_js_parses(root / "tests" / "obrien-review.test.js")
        self.assert_js_parses(root / "case-types" / "manifest.js")
        self.assert_js_parses(root / "dev" / "fixtures" / "personas.js")
        self.assert_js_parses(root / "dev" / "fixtures" / "cases.js")

        manifest = (root / "case-types" / "manifest.js").read_text(encoding="utf-8")
        self.assertIn(r"displayName: 'O\'Brien Review',", manifest)
        personas = (root / "dev" / "fixtures" / "personas.js").read_text(
            encoding="utf-8"
        )
        self.assertIn(r"groups: ['Reviewers - O\'Brien Review'],", personas)

    def test_refuses_to_overwrite_an_existing_slug(self) -> None:
        root = self.make_fixture_root()
        shutil.copy2(
            REPO_ROOT / "case-types/complaints.js",
            root / "case-types/complaints.js",
        )

        with self.assertRaises(subprocess.CalledProcessError) as context:
            self.run_scaffold(
                root,
                "--slug",
                "complaints",
                "--display",
                "Complaints",
            )

        self.assertIn("already exists", context.exception.stderr)

if __name__ == "__main__":
    unittest.main()
