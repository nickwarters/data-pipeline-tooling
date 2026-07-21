from __future__ import annotations

import json
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
        self.assertNotIn("listName:", module_source)
        self.assertNotIn("dashboardPanels", module_source)
        self.assertIn("caseTableColumns: [", module_source)
        self.assertIn("value: 'details.customerName'", module_source)

        manifest = (root / "case-types" / "manifest.js").read_text(encoding="utf-8")
        self.assertIn(
            "'widget-review': () => import('./widget-review.js')",
            manifest,
        )

        permissions = (root / "src/services/permissions.js").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "{ slug: 'widget-review', displayName: 'Widget Review' }",
            permissions,
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

    def test_generates_the_reusable_500_question_performance_bank(self) -> None:
        root = self.make_fixture_root()

        result = self.run_scaffold(root, "--performance-bank")

        self.assertIn("Generated 500-question performance bank", result.stdout)
        bank_path = root / "case-types" / "banks" / "performance-500.txt"
        self.assertTrue(bank_path.is_file())
        bank = json.loads(bank_path.read_text(encoding="utf-8"))

        self.assertEqual(bank["slug"], "performance-500")
        self.assertEqual(len(bank["questions"]), 500)

        groups: dict[str, list[dict[str, object]]] = {}
        for question in bank["questions"]:
            groups.setdefault(question["questionGroup"], []).append(question)
        self.assertEqual(len(groups), 20)
        self.assertTrue(all(20 <= len(group) <= 40 for group in groups.values()))

        text_questions = [
            question
            for question in bank["questions"]
            if question["responseType"] == "text"
        ]
        self.assertEqual(len(text_questions), 1)

        gate_id = bank["performanceProfile"]["fanOutGateQuestionId"]
        fan_out = [
            question
            for question in bank["questions"]
            if question.get("showWhen") == {gate_id: {"equals": "Yes"}}
        ]
        self.assertEqual(len(fan_out), 125)


if __name__ == "__main__":
    unittest.main()
