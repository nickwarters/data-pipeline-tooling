```python
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "import_bank_from_excel.py"

OUTCOMES = [
    {"id": "pass", "wording": "Pass", "severity": 0},
    {"id": "fail", "wording": "Fail", "severity": 100},
]


def existing_bank() -> dict:
    return {
        "slug": "widget",
        "label": "Widget Review",
        "questions": [
            {
                "id": "q-wr-0001",
                "text": "Was the spec followed?",
                "questionGroup": "Build",
                "responseType": "outcome",
                "showWhen": {"q-wr-0002": {"equals": "Pass"}},
                "deprecated": False,
            },
            {
                "id": "q-wr-0002",
                "text": "Was it tested?",
                "questionGroup": "Build",
                "responseType": "outcome",
                "deprecated": False,
            },
        ],
        "labels": [{"id": "lbl-reg", "name": "Regulatory", "color": "#b91c1c"}],
        "outcomeOptions": OUTCOMES,
        "defaultOutcomeId": "pass",
    }


class ImportBankFromExcelTest(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="bank-import-"))
        self.addCleanup(shutil.rmtree, self.root)
        (self.root / "case-types" / "banks").mkdir(parents=True)

    def banks(self) -> Path:
        return self.root / "case-types" / "banks"

    def write_bank(self, bank: dict) -> None:
        (self.banks() / f"{bank['slug']}.txt").write_text(json.dumps(bank, indent=2))

    def read_bank(self, slug: str = "widget") -> dict:
        return json.loads((self.banks() / f"{slug}.txt").read_text(encoding="utf-8"))

    def workbook(self, rows: list[list[object]], sheet: str = "Questions") -> Path:
        book = Workbook()
        book.active.title = "Notes"
        target = book.create_sheet(sheet)
        for row in rows:
            target.append(row)
        path = self.root / "questions.xlsx"
        book.save(path)
        return path

    def run_import(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--root", str(self.root), *args],
            capture_output=True,
            text=True,
        )

    def test_a_question_keeps_its_id_and_unlisted_fields_when_its_text_matches(self) -> None:
        self.write_bank(existing_bank())
        path = self.workbook(
            [["Question", "Question Group"], ["Was the spec followed?", "Assembly"]]
        )

        result = self.run_import("--file", str(path), "--sheet", "Questions", "--slug", "widget", "--no-publish")

        self.assertEqual(result.returncode, 0, result.stderr)
        first = self.read_bank()["questions"][0]
        self.assertEqual(first["id"], "q-wr-0001")
        self.assertEqual(first["questionGroup"], "Assembly")
        self.assertEqual(first["showWhen"], {"q-wr-0002": {"equals": "Pass"}})

    def test_a_question_the_sheet_no_longer_lists_is_retired_not_deleted(self) -> None:
        self.write_bank(existing_bank())
        path = self.workbook([["id", "text"], ["q-wr-0001", "Was the spec followed?"]])

        result = self.run_import("--file", str(path), "--sheet", "Questions", "--slug", "widget", "--no-publish")

        self.assertEqual(result.returncode, 0, result.stderr)
        by_id = {q["id"]: q for q in self.read_bank()["questions"]}
        self.assertTrue(by_id["q-wr-0002"]["deprecated"])
        self.assertFalse(by_id["q-wr-0001"]["deprecated"])

    def test_a_new_question_is_minted_the_next_id_in_the_banks_style(self) -> None:
        self.write_bank(existing_bank())
        path = self.workbook(
            [
                ["text", "responseType", "options", "labels"],
                ["How was it ordered?", "single-choice", "Online\nPhone", "Regulatory"],
            ]
        )

        result = self.run_import("--file", str(path), "--sheet", "Questions", "--slug", "widget", "--no-publish")

        self.assertEqual(result.returncode, 0, result.stderr)
        new = self.read_bank()["questions"][0]
        self.assertEqual(new["id"], "q-wr-0003")
        self.assertEqual(new["options"], ["Online", "Phone"])
        self.assertEqual(new["labelIds"], ["lbl-reg"])

    def test_an_outcome_question_answers_in_the_banks_outcomes(self) -> None:
        self.write_bank(existing_bank())
        path = self.workbook([["text"], ["Was the customer told?"]])

        result = self.run_import("--file", str(path), "--sheet", "Questions", "--slug", "widget", "--no-publish")

        self.assertEqual(result.returncode, 0, result.stderr)
        new = self.read_bank()["questions"][0]
        self.assertEqual(new["responseType"], "outcome")
        self.assertEqual(new["options"], [o["wording"] for o in OUTCOMES])
        self.assertEqual(new["optionOutcomes"], {o["wording"]: o["id"] for o in OUTCOMES})

    def test_a_minted_id_never_takes_one_a_later_row_spells_out(self) -> None:
        self.write_bank(existing_bank())
        path = self.workbook([["id", "text"], ["", "A new one?"], ["q-wr-0003", "Spelled out?"]])

        result = self.run_import("--file", str(path), "--sheet", "Questions", "--slug", "widget", "--no-publish")

        self.assertEqual(result.returncode, 0, result.stderr)
        ids = [q["id"] for q in self.read_bank()["questions"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids[:2], ["q-wr-0004", "q-wr-0003"])

    def test_a_question_moved_off_outcome_does_not_keep_the_outcome_wordings_as_options(self) -> None:
        bank = existing_bank()
        bank["questions"][1]["options"] = [o["wording"] for o in OUTCOMES]
        self.write_bank(bank)
        path = self.workbook([["id", "text", "responseType"], ["q-wr-0002", "Was it tested?", "yes-no-na"]])

        result = self.run_import("--file", str(path), "--sheet", "Questions", "--slug", "widget", "--no-publish")

        self.assertEqual(result.returncode, 0, result.stderr)
        moved = self.read_bank()["questions"][0]
        self.assertEqual(moved["responseType"], "yes-no-na")
        self.assertNotIn("options", moved)
        self.assertNotIn("optionOutcomes", moved)

    def test_a_workbook_problem_is_reported_and_the_bank_left_untouched(self) -> None:
        self.write_bank(existing_bank())
        before = (self.banks() / "widget.txt").read_text()
        cases = {
            "unknown column": [["text", "Colour"], ["Q?", "red"]],
            "unknown label": [["text", "labels"], ["Q?", "Nonexistent"]],
            "bad response type": [["text", "responseType"], ["Q?", "free-text"]],
            "choice without options": [["text", "responseType"], ["Q?", "single-choice"]],
        }
        for name, rows in cases.items():
            with self.subTest(name):
                path = self.workbook(rows)
                result = self.run_import("--file", str(path), "--sheet", "Questions", "--slug", "widget")
                self.assertEqual(result.returncode, 1)
                self.assertIn("error:", result.stderr)
                self.assertEqual((self.banks() / "widget.txt").read_text(), before)

    def test_a_missing_sheet_names_the_sheets_the_workbook_has(self) -> None:
        path = self.workbook([["text"], ["Q?"]])

        result = self.run_import("--file", str(path), "--sheet", "Nope", "--slug", "widget", "--label", "W")

        self.assertEqual(result.returncode, 1)
        self.assertIn("'Questions'", result.stderr)

    def test_a_new_bank_needs_a_label(self) -> None:
        path = self.workbook([["text"], ["Q?"]])

        result = self.run_import("--file", str(path), "--sheet", "Questions", "--slug", "widget", "--no-publish")

        self.assertEqual(result.returncode, 1)
        self.assertIn("--label", result.stderr)


@unittest.skipUnless(shutil.which("node"), "publishing runs the node publish script")
class PublishAfterImportTest(unittest.TestCase):
    """The import hands publishing to publish-bank.js, run over a copy of the tree."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="bank-publish-"))
        self.addCleanup(shutil.rmtree, self.root)
        for directory in ("src", "scripts", "case-types"):
            shutil.copytree(REPO_ROOT / directory, self.root / directory)
        shutil.copy2(REPO_ROOT / "package.json", self.root / "package.json")

    def import_sheet(self, rows: list[list[object]]) -> None:
        book = Workbook()
        for row in rows:
            book.active.append(row)
        path = self.root / "questions.xlsx"
        book.save(path)
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--root",
                str(self.root),
                "--file",
                str(path),
                "--sheet",
                book.active.title,
                "--slug",
                "widget",
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_each_import_that_changes_the_bank_publishes_a_version_and_advances_history(self) -> None:
        banks = self.root / "case-types" / "banks"
        bank = existing_bank()
        (banks / "widget.txt").write_text(json.dumps(bank))

        self.import_sheet([["text"], ["Was the spec followed?"], ["Was it tested?"]])
        first = json.loads((banks / "widget.txt").read_text())
        self.import_sheet([["text"], ["Was the spec followed?"], ["Was it tested?"], ["Was it shipped?"]])
        second = json.loads((banks / "widget.txt").read_text())

        self.assertEqual([h["version"] for h in second["history"]], [first["version"], second["version"]])
        self.assertNotEqual(first["version"], second["version"])
        for entry in second["history"]:
            published = json.loads((banks / f"widget.{entry['version']}.txt").read_text())
            self.assertEqual(published["version"], entry["version"])


if __name__ == "__main__":
    unittest.main()

```
