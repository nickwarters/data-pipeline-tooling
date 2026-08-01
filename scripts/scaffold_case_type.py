#!/usr/bin/env python3
"""Scaffold a new Case Type end-to-end."""

from __future__ import annotations

import argparse
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
    list_name: str


def pascal_slug(slug: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in slug.split("-") if part)


def default_list_name(slug: str) -> str:
    """The `Cases-{PascalSlug}` convention every provisioned Case list follows."""
    return f"Cases-{pascal_slug(slug)}"


def parse_args(argv: list[str]) -> ScaffoldOptions:
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
        "--list-name",
        dest="list_name",
        help=(
            "SharePoint Case list name. Defaults to the Cases-{PascalSlug} "
            "convention, e.g. Cases-WidgetReview. Every Case Type must declare "
            "one: there is no default store (issue #249)."
        ),
    )
    args = parser.parse_args(argv)

    if not args.slug:
        parser.error("--slug is required")
    if not args.display_name:
        parser.error("--display is required")
    if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", args.slug):
        parser.error(
            f'Invalid --slug "{args.slug}". Use kebab-case starting with a lowercase letter.'
        )
    if not args.display_name.strip():
        parser.error("--display must not be blank")
    if not DISPLAY_NAME_ALLOWED.fullmatch(args.display_name):
        parser.error(
            f'Invalid --display "{args.display_name}". Use letters, digits, spaces '
            "and - & ' ( ) , . only — the value is written into generated JS "
            "string literals, JSDoc comments and Markdown."
        )
    if args.list_name is not None and not args.list_name.strip():
        parser.error("--list-name must not be blank")
    if args.list_name is not None and not LIST_NAME_ALLOWED.fullmatch(args.list_name):
        parser.error(
            f'Invalid --list-name "{args.list_name}". Use letters, digits, spaces, '
            "hyphens and underscores only."
        )

    return ScaffoldOptions(
        root=args.root.resolve(),
        slug=args.slug,
        display_name=args.display_name,
        list_name=args.list_name or default_list_name(args.slug),
    )


def escape_regexp(source: str) -> str:
    return re.escape(source)


# Operator-supplied text reaches generated JS string literals, JSDoc comments and
# Markdown. Unescaped, `--display "O'Brien Review"` emitted
# `label: 'O'Brien Review reference'` — a module that does not parse — and a
# crafted value could close the literal and inject arbitrary code into a file the
# maintainer is about to commit. Two defences, because escaping alone does not
# save a JSDoc block from a `*/`:
#
#   1. an allow-list of characters that are safe in all three contexts, and
#   2. proper escaping at every generated JS string literal.
DISPLAY_NAME_ALLOWED = re.compile(r"^[\w \-&'(),.]+$", re.UNICODE)
LIST_NAME_ALLOWED = re.compile(r"^[\w \-]+$", re.UNICODE)


def js_escape(value: str) -> str:
    """Escape `value` for embedding inside a single-quoted JS string literal."""
    return value.replace("\\", "\\\\").replace("'", "\\'")


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


def insert_before_match(content: str, pattern: str, insertion: str, file_path: Path) -> str:
    match = re.search(pattern, content, re.MULTILINE)
    if match is None:
        raise RuntimeError(f"Could not find insertion anchor in {file_path}: {pattern}")
    index = match.start()
    return f"{content[:index]}{insertion}{content[index:]}"


def layout_line(slug: str, display_name: str) -> str:
    """One `case-types/` entry for CLAUDE.md's Directory layout block.

    The block is a checked contract — `tests/claude-md-layout-contract.test.js`
    fails for any production module under `src/` or `case-types/` whose basename
    it does not mention — so the scaffold writes its own line rather than
    leaving the developer a red test to decode.
    """
    name = f"  {slug}.js"
    padding = " " * max(1, 32 - len(name))
    return f"{name}{padding}# {display_name} Case Type scaffold (ADR-0028)\n"


def insert_after_match(content: str, pattern: str, insertion: str, file_path: Path) -> str:
    match = re.search(pattern, content)
    if match is None:
        raise RuntimeError(f"Could not find insertion anchor in {file_path}: {pattern}")
    index = match.end()
    return f"{content[:index]}{insertion}{content[index:]}"


def case_type_module(opts: ScaffoldOptions) -> str:
    prefix = question_prefix(opts.slug)
    js_display = js_escape(opts.display_name)
    js_list = js_escape(opts.list_name)
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
 * Declares its own `listName` (`{opts.list_name}`) like every other Case Type.
 * It is load-bearing in both environments: the mock store partitions the fixture
 * Cases by it (there is no default store), so its sample Cases are
 * openable via `?mock=1`, and the HTTP client reads and writes that list. The
 * SharePoint list itself is provisioned separately — see the Case Type
 * onboarding checklist.
 *
 * @type {{CaseTypeConfig}}
 */
const config = {{
  // The display name lives ONLY on this slug's CASE_TYPES entry in
  // case-types/manifest.js — the three SharePoint group names derive
  // from that one copy.
  listName: '{js_list}',
  // No `eligibleGroups`. Access comes from the three group names DERIVED from
  // the registry display name — `Reviewers - {opts.display_name}` and its two
  // siblings — so restating the derived name here would make it a second,
  // independent grant that a later rename would not move. Add
  // `eligibleGroups` only for a genuinely EXTRA group, never the org-wide
  // `Reviewers`: a brand-new Case Type must not be visible to every Reviewer.
  attributeFailures: true,
  // TODO(case-type): Replace starter Case Details fields with this Case Type's source fields.
  detailFields: [
    {{ key: 'reference', label: '{js_display} reference' }},
    {{ key: 'customerName', label: 'Customer name' }},
    {{ key: 'reviewDate', label: 'Review date' }},
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
  // Optional: rename Case Review display copy for this Case Type. Each Section
  // carries a tab caption and a panel heading, so an entry is either a bare
  // string (renames both) or an object naming either axis. Omitted keys and
  // omitted axes keep the defaults in src/lib/section-labels.js.
  // Not the same as `labels`, which is the reporting Label catalogue.
  // sectionLabels: {{ questions: {{ tab: 'Assess', heading: 'Assessment' }} }},
  // TODO(case-type): Confirm who raises appeals for this Case Type.
  appeal: {{ raisedBy: 'responsiblePartyManager' }},
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
      remediationActions: [
        'Provide the missing evidence and record the source.',
      ],
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
    js_display = js_escape(opts.display_name)
    js_list = js_escape(opts.list_name)
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

test('{opts.slug}: declares its Case list explicitly — there is no default store', () => {{
  assert.equal(config.listName, '{js_list}');
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

test('{opts.slug} fixtures: an outstanding and a completed {js_display} Case exist', () => {{
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
    js_display = js_escape(opts.display_name)
    return f"""  // --- {opts.slug} fixture cases ({opts.display_name} scaffold) ---
  {{
    id: '{opts.slug}-case-1',
    caseType: '{opts.slug}',
    title: '{js_display} #1',
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
    title: '{js_display} #2',
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

Provisioning a new Case Type crosses the Case Type module, manifest, mock
personas, mock Cases, and tests. Hand-editing that spread is easy to do
inconsistently, especially before the SharePoint list and group provisioning has
caught up with the application configuration.

## Decision

Case Type provisioning starts with `python3 scripts/scaffold_case_type.py --slug <slug> --display "<Display Name>" [--list-name <Cases-List>]`.
The scaffold creates a plain-data Case Type module for `{opts.display_name}` and
registers it with a single entry in `CASE_TYPES` (`case-types/manifest.js`) — the
one registry, carrying the display name from which the three per-Case-Type
SharePoint group names derive. `permissions.caseTypes` is derived from it, so no
permissions edit is needed (issue #508). The scaffold also adds mock personas,
one outstanding and one Completed mock Case, and a focused test file for the
generated contract.

The generated Case Type declares `listName: '{opts.list_name}'` — defaulted from
the slug by the `Cases-{{PascalSlug}}` convention and overridable with
`--list-name`. It is not optional: the mock store partitions the fixture Cases by
each Case Type's declared list and has no default bucket (issue #249), so a Case
Type that writes mock Cases without a `listName` would break `?mock=1` for every
other Case Type. Declaring it is what makes the generated sample Cases openable
in the mock loop. The script refuses to overwrite an existing Case Type slug;
maintainers should edit an existing type directly once it has real business
configuration.

The scaffold also appends the generated module to the Directory layout block in
`CLAUDE.md`, which is a checked contract (`tests/claude-md-layout-contract.test.js`).

## Consequences

- Maintainers get a runnable first slice, openable in `?mock=1`, before the
  SharePoint list named by `listName` has been provisioned.
- The generated module includes TODO markers for the Question Bank, Outcome
  vocabulary, appeal raiser, Case Details fields, and SLA hours.
- Section access remains shared in `src/services/section-access.js`; the scaffold
  relies on the standard Section set rather than creating per-type matrix rows.
- Re-running with an existing slug is a hard error to avoid overwriting operator
  edits.
- The registry-contract tests in `tests/case-type-manifest.test.js` pin today's
  known slugs as a closed set and must be widened by hand; the scaffold does not
  edit contract tests, it names them in its closing message.
"""


# The tests that pin today's Case Type registry as a CLOSED set.
#
# Each names `complaints` (the only live Case Type) in a literal expectation, so
# a newly scaffolded slug moves them by design. The scaffold does not edit
# contract tests — a script silently rewriting the assertions that guard the
# registry would defeat the point of having them — so it names them instead,
# precisely enough that a developer can match every red test to a line here.
EXPECTED_FAILURES = [
    (
        "tests/case-type-manifest.test.js",
        "known Case Type slugs resolve to their static import functions",
        "its `knownSlugs` literal is the closed set of registered slugs",
    ),
    (
        "tests/case-type-manifest.test.js",
        "unknown Case Type slugs reject with a developer-useful error",
        "UnknownCaseTypeError lists every known slug in its user-facing message",
    ),
    (
        "tests/case-type-manifest.test.js",
        "CaseLoader.load(): unknown primary Case Type slug sets a clear "
        "user-facing error state",
        "it asserts that same knownSlugs list reaches the console",
    ),
]


def closing_message(opts: ScaffoldOptions) -> str:
    lines = [
        f"Scaffolded Case Type {opts.slug} ({opts.display_name}), "
        f"Cases on list {opts.list_name}.",
        "",
        "  npm run check   should be GREEN.",
        f"  node --test     should be GREEN except for {len(EXPECTED_FAILURES)} "
        "registry-contract tests, which",
        "                  a new Case Type is SUPPOSED to move:",
        "",
    ]
    for file_name, test_name, why in EXPECTED_FAILURES:
        lines.append(f"    - {file_name}")
        lines.append(f"        {test_name}")
        lines.append(f"        (expected: {why})")
    lines += [
        "",
        f"  Add '{opts.slug}' to the expected slug lists in that file. Any OTHER",
        "  failure is a real one — it is not caused by the scaffold.",
        "",
        "  Then work through the TODO(case-type) markers in "
        f"case-types/{opts.slug}.js,",
        f"  and provision the SharePoint list '{opts.list_name}' and the three",
        f"  '<role> - {opts.display_name}' groups per "
        "docs/case-type-onboarding.md.",
    ]
    return "\n".join(lines)


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

    # One registry entry, into the array `CASE_TYPES` is exported from. It
    # carries the slug, the ONE copy of the display name the three SharePoint
    # group names derive from (#527), and the lazy importer. `CASE_TYPE_IMPORTERS`, `QUESTION_BANK_IMPORTERS` and
    # `permissions.caseTypes` are all derived from it (issue #508), so there is
    # nothing to add in src/services/permissions.js. No `bank` thunk is emitted:
    # the scaffold writes no Question Bank artifact, and `bank` is optional.
    js_display = js_escape(opts.display_name)
    manifest_path = opts.root / "case-types" / "manifest.js"
    manifest = manifest_path.read_text(encoding="utf-8")
    if not re.search(rf"slug:\s*['\"]{escape_regexp(opts.slug)}['\"]", manifest):
        manifest = insert_after_match(
            manifest,
            r"const registry = \[\n",
            # Frozen like every other registry entry (#527): the display name it
            # carries composes three SharePoint group names, and both the
            # capability and eligibility sides read that one copy.
            f"  Object.freeze({{\n"
            f"    slug: '{opts.slug}',\n"
            f"    displayName: '{js_display}',\n"
            f"    importer: () => import('./{opts.slug}.js'),\n"
            f"  }}),\n",
            manifest_path,
        )
        manifest_path.write_text(manifest, encoding="utf-8")

    personas_path = opts.root / "dev" / "fixtures" / "personas.js"
    personas = personas_path.read_text(encoding="utf-8")
    if f"'reviewer-{opts.slug}'" not in personas:
        display_slug = title_case_words(opts.slug)
        insertion = f"""  'reviewer-{opts.slug}': {{
    userId: 'user-reviewer-{opts.slug}',
    displayName: 'Alex Reviewer {display_slug}',
    groups: ['Reviewers - {js_display}'],
  }},
  'case-type-owner-{opts.slug}': {{
    userId: 'user-case-type-owner-{opts.slug}',
    displayName: 'Cam Case Type Owner {display_slug}',
    groups: ['CaseTypeOwner - {js_display}'],
  }},
  'journey-owner-{opts.slug}': {{
    userId: 'user-journey-owner-{opts.slug}',
    displayName: 'Jules Journey Owner {display_slug}',
    groups: ['JourneyOwner - {js_display}'],
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

    # CLAUDE.md's Directory layout block is a checked contract: every `.js`
    # under src/ and case-types/ must be named in it
    # (tests/claude-md-layout-contract.test.js). The scaffold adds its own line
    # so the generated module does not land as an unexplained red test.
    claude_md_path = opts.root / "CLAUDE.md"
    claude_md = claude_md_path.read_text(encoding="utf-8")
    if f"  {opts.slug}.js" not in claude_md:
        claude_md = insert_before_match(
            claude_md,
            r"^  banks/ ",
            layout_line(opts.slug, opts.display_name),
            claude_md_path,
        )
        claude_md_path.write_text(claude_md, encoding="utf-8")

    print(closing_message(opts))


def main(argv: list[str]) -> int:
    try:
        options = parse_args(argv)
        scaffold(options)
    except Exception as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
