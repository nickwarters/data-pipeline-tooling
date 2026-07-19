#!/usr/bin/env python3
"""Scaffold a new Case Type end-to-end."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ScaffoldOptions:
    root: Path
    slug: str
    display_name: str


@dataclass(frozen=True)
class PerformanceBankOptions:
    root: Path


def parse_args(argv: list[str]) -> ScaffoldOptions | PerformanceBankOptions:
    parser = argparse.ArgumentParser(
        description="Scaffold a new Case Type module, wiring, fixtures, tests, and ADR."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=SCRIPT_ROOT,
        help="Repository root. Defaults to the current checkout.",
    )
    parser.add_argument(
        "--slug",
        help="Kebab-case Case Type slug, e.g. widget-review.",
    )
    parser.add_argument(
        "--display",
        dest="display_name",
        help='Human-readable display name, e.g. "Widget Review".',
    )
    parser.add_argument(
        "--performance-bank",
        action="store_true",
        help="Generate the permanent synthetic 500-question performance bank.",
    )
    args = parser.parse_args(argv)

    if args.performance_bank:
        if args.slug or args.display_name:
            parser.error("--performance-bank cannot be combined with --slug or --display")
        return PerformanceBankOptions(root=args.root.resolve())

    if not args.slug:
        parser.error("--slug is required unless --performance-bank is used")
    if not args.display_name:
        parser.error("--display is required unless --performance-bank is used")
    if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", args.slug):
        parser.error(
            f'Invalid --slug "{args.slug}". Use kebab-case starting with a lowercase letter.'
        )
    if not args.display_name.strip():
        parser.error("--display must not be blank")

    return ScaffoldOptions(
        root=args.root.resolve(),
        slug=args.slug,
        display_name=args.display_name,
    )


def performance_bank() -> dict[str, object]:
    """Build the deterministic bank used by the Palimpsest performance gate."""
    question_count = 500
    group_size = 25
    fan_out_count = 125
    gate_id = "q-perf-fan-out-gate"
    text_answer_id = "q-perf-steady-state-text"
    questions: list[dict[str, object]] = []

    for index in range(question_count):
        number = index + 1
        group_number = index // group_size + 1
        question_id = f"q-perf-{number:03d}"
        question: dict[str, object] = {
            "id": question_id,
            "text": f"Synthetic review check {number:03d}",
            "category": f"Review area {(group_number - 1) // 4 + 1}",
            "questionGroup": f"Question Group {group_number:02d}",
            "responseType": "yes-no-na",
            "deprecated": False,
        }

        if index == 0:
            question.update(
                {
                    "id": gate_id,
                    "text": "Enable the worst-case downstream review checks?",
                }
            )
        elif index == 1:
            question.update(
                {
                    "id": text_answer_id,
                    "text": "Record the steady-state performance Answer",
                    "responseType": "text",
                }
            )
        elif index % 5 == 0:
            question.update(
                {
                    "responseType": "single-choice",
                    "options": ["Clear", "Needs review", "Not observed"],
                }
            )

        if index >= question_count - fan_out_count:
            question["showWhen"] = {gate_id: {"equals": "Yes"}}

        questions.append(question)

    return {
        "slug": "performance-500",
        "label": "Palimpsest 500-question performance bank",
        "questions": questions,
        "labels": [],
        "outcomeOptions": [],
        "performanceProfile": {
            "questionCount": question_count,
            "questionGroupCount": question_count // group_size,
            "questionsPerGroup": group_size,
            "textAnswerQuestionId": text_answer_id,
            "fanOutGateQuestionId": gate_id,
            "fanOutQuestionCount": fan_out_count,
        },
    }


def generate_performance_bank(opts: PerformanceBankOptions) -> Path:
    output = opts.root / "case-types" / "banks" / "performance-500.txt"
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(performance_bank(), indent=2)
    serialized = serialized.replace(
        '      "options": [\n'
        '        "Clear",\n'
        '        "Needs review",\n'
        '        "Not observed"\n'
        "      ]",
        '      "options": ["Clear", "Needs review", "Not observed"]',
    )
    output.write_text(
        serialized + "\n",
        encoding="utf-8",
    )
    print(f"Generated 500-question performance bank at {output.relative_to(opts.root)}")
    return output


def escape_regexp(source: str) -> str:
    return re.escape(source)


def title_case_words(source: str) -> str:
    return " ".join(
        word[:1].upper() + word[1:] for word in re.split(r"[-\s]+", source) if word
    )


def question_prefix(slug: str) -> str:
    return "".join(part[0] for part in slug.split("-"))


def insert_before(content: str, needle: str, insertion: str, file_path: Path) -> str:
    index = content.find(needle)
    if index == -1:
        raise RuntimeError(f"Could not find insertion anchor in {file_path}: {needle}")
    return f"{content[:index]}{insertion}{content[index:]}"


def insert_after_match(content: str, pattern: str, insertion: str, file_path: Path) -> str:
    match = re.search(pattern, content)
    if match is None:
        raise RuntimeError(f"Could not find insertion anchor in {file_path}: {pattern}")
    index = match.end()
    return f"{content[:index]}{insertion}{content[index:]}"


def case_type_module(opts: ScaffoldOptions) -> str:
    prefix = question_prefix(opts.slug)
    return f"""// @ts-check
/** @typedef {{import('../src/sharepoint-client.js').CaseTypeConfig}} CaseTypeConfig */
/** @typedef {{import('../src/sharepoint-client.js').Answer}} Answer */

import {{ computeConfiguredOutcome }} from '../src/evaluators/configured-outcome.js';

/**
 * The **{opts.display_name}** Case Type scaffold. Its per-Case-Type groups derive
 * from the `{opts.display_name}` display name:
 * `Reviewers - {opts.display_name}`, `CaseTypeOwner - {opts.display_name}`,
 * `JourneyOwner - {opts.display_name}`.
 *
 * NOTE (dev/mock): deliberately declares **no `listName`**, so its Cases live in
 * the default mock store and are openable via `?mock=1` until list-backing is wired.
 *
 * @type {{CaseTypeConfig}}
 */
const config = {{
  eligibleGroups: ['Reviewers'],
 // TODO(case-type): Confirm the SLA hours before production use.
  slaHours: 72,
  attributeFailures: true,
 // TODO(case-type): Replace starter Case Details fields with this Case Type's source fields.
  detailFields: [
    {{ key: 'reference', label: '{opts.display_name} reference' }},
    {{ key: 'customerName', label: 'Customer name' }},
    {{ key: 'reviewDate', label: 'Review date' }},
  ],
  // Page descriptors express Case Type variation only. Permission checks,
  // navigation, formatting, and other branching behaviour stay in framework code.
  dashboardPanels: [
    'kpis',
    'actionCentre',
    'ownerSummary',
    'reviewerCases',
    'allocation',
    'responsibleParty',
    'appeals',
  ],
  caseTableColumns: [
    {{
      key: 'customerName',
      label: 'Customer name',
      value: 'details.customerName',
      sortable: true,
    }},
  ],
  sections: {{
    details: {{ showInSummary: true }},
    questions: {{ showInSummary: true }},
    conversation: {{ allowMessagesWhen: ['Actions In Progress'] }},
    notes: {{ showInSummary: false }},
    issues: {{ showInSummary: true }},
    remediation: {{ showInSummary: true }},
    summary: {{}},
    appealRequest: {{}},
    appealReview: {{}},
    amendOutcome: {{}},
  }},
 // Optional (MAINT-11): rename Case Review tab labels / section headings for
 // this Case Type. Omitted keys keep the defaults from
 // src/lib/section-labels.js (DEFAULT_SECTION_LABELS / DEFAULT_SECTION_HEADINGS).
 // Not the same as `labels`, which is the reporting Label catalogue.
 // sectionLabels: {{ questions: 'Assessment' }},
 // TODO(case-type): Confirm who raises appeals for this Case Type.
  appeal: {{ raisedBy: 'responsiblePartyManager', resolvedBy: 'controls' }},
 // TODO(case-type): Replace the starter Outcome vocabulary with business wording.
 // `severity` orders the Outcomes (higher = worse); it drives the scoring.
  outcomeOptions: [
    {{ id: 'pass', wording: 'Pass', severity: 0 }},
    {{ id: 'refer', wording: 'Refer', severity: 50 }},
    {{ id: 'fail', wording: 'Fail', severity: 100 }},
  ],
  defaultOutcomeId: 'pass',
 // TODO(case-type): Replace starter questions with the first real Question Bank export.
 // Each response option maps to a configured Outcome via `optionOutcomes`; the
 // highest-scoring applicable Outcome wins (the response drives the Outcome).
  questions: [
    {{
      id: 'q-{prefix}-evidence',
      text: 'Was the required evidence present?',
      questionGroup: 'Evidence',
      responseType: 'yes-no-na',
      optionOutcomes: {{ No: 'fail' }},
      remediationActions: ['Provide the missing evidence and record the source.'],
      deprecated: false,
    }},
    {{
      id: 'q-{prefix}-rationale',
      text: 'Was the case rationale clearly documented?',
      questionGroup: 'Decisioning',
      responseType: 'yes-no-na',
      optionOutcomes: {{ No: 'refer' }},
      remediationActions: ['Document the rationale for the case decision.'],
      deprecated: false,
    }},
    {{
      id: 'q-{prefix}-method',
      text: 'Which review method was used?',
      questionGroup: 'Decisioning',
      responseType: 'single-choice',
      options: ['Desktop review', 'Customer contact', 'Manager escalation'],
      deprecated: false,
    }},
  ],

 /** @param {{Record<string, Answer>}} answers */
  computeOutcome(answers) {{
    return computeConfiguredOutcome(
      config.questions,
      answers,
      config.outcomeOptions,
      config.defaultOutcomeId
    );
  }},
}};

export default config;
"""


def case_type_test(opts: ScaffoldOptions) -> str:
    prefix = question_prefix(opts.slug)
    return f"""// @ts-check

import {{ test }} from 'node:test';
import assert from 'node:assert/strict';
import config from '../case-types/{opts.slug}.js';
import {{ detectCycles }} from '../src/evaluators/applicability-evaluator.js';
import {{ deriveFailureValues }} from '../src/evaluators/failure-evaluator.js';
import {{ cases }} from '../dev/fixtures/cases.js';

/** @typedef {{import('../src/sharepoint-client.js').Answer}} Answer */

/** @param {{string}} value @returns {{Answer}} */
function ans(value) {{
  return {{ value }};
}}

test('{opts.slug}: catalogue has starter questions', () => {{
  assert.ok(config.questions.length >= 3, `got ${{config.questions.length}}`);
}});

test('{opts.slug}: every choice question carries a non-empty options[]', () => {{
  for (const q of config.questions) {{
    if (q.responseType === 'single-choice' || q.responseType === 'multi-choice') {{
      assert.ok(Array.isArray(q.options) && q.options.length > 0, `${{q.id}} should have options[]`);
    }}
  }}
}});

test('{opts.slug}: at least one question maps a failing response and has remediationActions', () => {{
  assert.ok(config.questions.some((q) => deriveFailureValues(q, config.defaultOutcomeId).length > 0 && q.remediationActions?.length));
}});

test('{opts.slug}: no cycles in showWhen graph', () => {{
  assert.strictEqual(detectCycles(config.questions), false);
}});

test('{opts.slug}: declares no listName so its Cases are openable in the mock store', () => {{
  assert.equal(config.listName, undefined);
}});

test('{opts.slug}: declares the standard Section set', () => {{
  assert.deepEqual(Object.keys(config.sections ?? {{}}).sort(), [
    'amendOutcome',
    'appealRequest',
    'appealReview',
    'conversation',
    'details',
    'issues',
    'notes',
    'questions',
    'remediation',
    'summary',
  ]);
}});

test('{opts.slug}: declares Case Details fields with stable keys and labels', () => {{
  for (const field of config.detailFields ?? []) {{
    assert.ok(field.key.length > 0);
    assert.ok(field.label.length > 0);
  }}
}});

test('{opts.slug}: declares data-only page descriptors', () => {{
  assert.ok((config.dashboardPanels ?? []).length > 0);
  for (const column of config.caseTableColumns ?? []) {{
    assert.equal(typeof column.value, 'string');
  }}
}});

test('{opts.slug} computeOutcome: empty answers -> pass', () => {{
  assert.equal(config.computeOutcome({{}}).outcome, 'pass');
}});

test('{opts.slug} computeOutcome: a mapped response scores its outcome', () => {{
  assert.equal(
    config.computeOutcome({{ 'q-{prefix}-rationale': ans('No') }}).outcome,
    'refer'
  );
  assert.equal(
    config.computeOutcome({{ 'q-{prefix}-evidence': ans('No') }}).outcome,
    'fail'
  );
}});

test('{opts.slug} computeOutcome: the highest-scoring applicable outcome wins', () => {{
  assert.equal(
    config.computeOutcome({{
      'q-{prefix}-evidence': ans('No'),
      'q-{prefix}-rationale': ans('No'),
    }}).outcome,
    'fail'
  );
}});

test('{opts.slug} fixtures: an outstanding and a completed {opts.display_name} Case exist', () => {{
  const fixtures = cases.filter((c) => c.caseType === '{opts.slug}');
  assert.ok(fixtures.some((c) => c.status === 'In-progress'));
  assert.ok(fixtures.some((c) => c.status === 'Completed'));
}});

test('{opts.slug} fixtures: the Completed Case reference answers compute to its frozen outcomeAtCompletion', () => {{
  const completed = cases.find((c) => c.caseType === '{opts.slug}' && c.status === 'Completed');
  assert.ok(completed);
  assert.equal(config.computeOutcome(completed.answers).outcome, completed.outcomeAtCompletion);
}});
"""


def fixture_cases(opts: ScaffoldOptions) -> str:
    prefix = question_prefix(opts.slug)
    return f"""  // --- {opts.slug} fixture cases ({opts.display_name} scaffold) ---
  {{
    id: '{opts.slug}-case-1',
    caseType: '{opts.slug}',
    title: '{opts.display_name} #1',
    status: 'In-progress',
    assignedReviewer: 'user-reviewer-{opts.slug}',
    responsibleParty: 'user-agent-a',
    answers: {{
      'q-{prefix}-evidence': {{ value: 'Yes' }},
    }},
    conversation: [],
    details: {{
      reference: '{opts.slug.upper()}-2026-0001',
      customerName: 'Taylor Morgan',
      reviewDate: '2026-06-20',
    }},
    notes: '',
    completedAt: null,
    dueDate: _nextWeek.toISOString(),
    created: '2026-06-20T08:00:00Z',
    etag: 'etag-{opts.slug}-1-v1',
  }},
  {{
    id: '{opts.slug}-case-2',
    caseType: '{opts.slug}',
    title: '{opts.display_name} #2',
    status: 'Completed',
    assignedReviewer: 'user-reviewer-{opts.slug}',
    responsibleParty: 'user-agent-b',
    answers: {{
      'q-{prefix}-evidence': {{ value: 'Yes' }},
      'q-{prefix}-rationale': {{
        value: 'No',
        justification: 'Starter fixture demonstrates a single failed Answer.',
      }},
      'q-{prefix}-method': {{ value: 'Desktop review' }},
    }},
    conversation: [],
    details: {{
      reference: '{opts.slug.upper()}-2026-0002',
      customerName: 'Morgan Taylor',
      reviewDate: '2026-06-21',
    }},
    notes: '',
    completedAt: _threeDaysAgo.toISOString(),
    outcomeAtCompletion: 'refer',
    created: '2026-06-21T08:00:00Z',
    etag: 'etag-{opts.slug}-2-v1',
  }},
"""


def adr(opts: ScaffoldOptions) -> str:
    return f"""# Case Type scaffolding contract

## Status

Accepted

## Context

Provisioning a new Case Type crosses the Case Type module, manifest, permissions,
mock personas, mock Cases, and tests. Hand-editing that spread is easy to do
inconsistently, especially before the SharePoint list and group provisioning has
caught up with the application configuration.

## Decision

Case Type provisioning starts with `python3 scripts/scaffold_case_type.py --slug <slug> --display "<Display Name>"`.
The scaffold creates a plain-data Case Type module for `{opts.display_name}`, registers it in the
manifest, appends the single permissions entry from which the per-Case-Type group
names derive, adds mock personas, adds one outstanding and one Completed mock
Case, and creates a focused test file for the generated contract.

The generated Case Type deliberately has no `listName` so its sample Cases are
openable in the mock store via `?mock=1` until list-backed Case Types are wired
into the mock client. The script refuses to overwrite an existing Case Type slug;
maintainers should edit an existing type directly once it has real business
configuration.

## Consequences

- Maintainers get a runnable first slice before SharePoint list-backing exists.
- The generated module includes TODO markers for the Question Bank, Outcome
  vocabulary, appeal raiser, Case Details fields, and SLA hours.
- Section access remains shared in `src/services/section-access.js`; the scaffold
  relies on the standard Section set rather than creating per-type matrix rows.
- Re-running with an existing slug is a hard error to avoid overwriting operator
  edits.
"""


def scaffold(opts: ScaffoldOptions) -> None:
    module_path = opts.root / "case-types" / f"{opts.slug}.js"
    test_path = opts.root / "tests" / f"{opts.slug}.test.js"
    adr_path = opts.root / "docs" / "adr" / "0028-case-type-scaffolding.md"

    for file_path in [module_path, test_path]:
        if file_path.exists():
            relative_path = file_path.relative_to(opts.root)
            raise RuntimeError(
                f'Case Type slug "{opts.slug}" already exists at {relative_path}. Refusing to overwrite.'
            )

    module_path.parent.mkdir(parents=True, exist_ok=True)
    test_path.parent.mkdir(parents=True, exist_ok=True)
    adr_path.parent.mkdir(parents=True, exist_ok=True)

    module_path.write_text(case_type_module(opts), encoding="utf-8")
    test_path.write_text(case_type_test(opts), encoding="utf-8")
    adr_path.write_text(adr(opts), encoding="utf-8")

    manifest_path = opts.root / "case-types" / "manifest.js"
    manifest = manifest_path.read_text(encoding="utf-8")
    if not re.search(rf"['\"]{escape_regexp(opts.slug)}['\"]\s*:", manifest):
        manifest = insert_after_match(
            manifest,
            r"export const CASE_TYPE_IMPORTERS = \{\n",
            f"  '{opts.slug}': () => import('./{opts.slug}.js'),\n",
            manifest_path,
        )
        manifest_path.write_text(manifest, encoding="utf-8")

    permissions_path = opts.root / "src" / "services" / "permissions.js"
    permissions = permissions_path.read_text(encoding="utf-8")
    if f"slug: '{opts.slug}'" not in permissions:
        array_anchor = "  caseTypes: ["
        array_start = permissions.find(array_anchor)
        if array_start == -1:
            raise RuntimeError(
                f"Could not find insertion anchor in {permissions_path}: {array_anchor}"
            )
        entries_start = array_start + len(array_anchor)
        entries_end = permissions.find("],", entries_start)
        if entries_end == -1:
            raise RuntimeError(
                f"Could not find caseTypes array end in {permissions_path}"
            )
        existing_entries = permissions[entries_start:entries_end].strip()
        entry = f"{{ slug: '{opts.slug}', displayName: '{opts.display_name}' }}"
        entries = f"{existing_entries},\n    {entry}" if existing_entries else entry
        permissions = (
            f"{permissions[:entries_start]}\n    {entries},\n  "
            f"{permissions[entries_end:]}"
        )
        permissions_path.write_text(permissions, encoding="utf-8")

    personas_path = opts.root / "dev" / "fixtures" / "personas.js"
    personas = personas_path.read_text(encoding="utf-8")
    if f"'reviewer-{opts.slug}'" not in personas:
        display_slug = title_case_words(opts.slug)
        insertion = f"""  'reviewer-{opts.slug}': {{
    userId: 'user-reviewer-{opts.slug}',
    displayName: 'Alex Reviewer {display_slug}',
    groups: ['Reviewers - {opts.display_name}'],
  }},
  'case-type-owner-{opts.slug}': {{
    userId: 'user-case-type-owner-{opts.slug}',
    displayName: 'Cam Case Type Owner {display_slug}',
    groups: ['CaseTypeOwner - {opts.display_name}'],
  }},
  'journey-owner-{opts.slug}': {{
    userId: 'user-journey-owner-{opts.slug}',
    displayName: 'Jules Journey Owner {display_slug}',
    groups: ['JourneyOwner - {opts.display_name}'],
  }},
"""
        personas = insert_before(personas, "};\n", insertion, personas_path)
        personas_path.write_text(personas, encoding="utf-8")

    cases_path = opts.root / "dev" / "fixtures" / "cases.js"
    cases = cases_path.read_text(encoding="utf-8")
    if f"caseType: '{opts.slug}'" not in cases:
        cases = insert_after_match(
            cases,
            r" \*   complaints-case-2 — Completed, one failure → outcomeAtCompletion=refer\n",
            f" *   {opts.slug}-case-1 — In-progress scaffold sample (assigned)\n"
            f" *   {opts.slug}-case-2 — Completed scaffold sample, one failure → outcomeAtCompletion=refer\n",
            cases_path,
        )
        cases = insert_before(
            cases,
            "  // ── Action Centre demo cases (issue #287) ────────────────────────────────",
            fixture_cases(opts),
            cases_path,
        )
        cases_path.write_text(cases, encoding="utf-8")

    print(
        f"Scaffolded Case Type {opts.slug}. Run npm run check && node --test before committing."
    )


def main(argv: list[str]) -> int:
    try:
        options = parse_args(argv)
        if isinstance(options, PerformanceBankOptions):
            generate_performance_bank(options)
        else:
            scaffold(options)
    except Exception as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
