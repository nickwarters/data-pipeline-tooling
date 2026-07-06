# In-Memory Flow Runner

The in-memory flow runner is a browser-free workflow harness for pipeline and
sync tests. It reads SharePoint-like list state from a JSON fixture, loads a Case
Review page through `CaseReviewViewModel`, executes domain-level page actions,
flushes the normal `SaveQueue`, and writes the resulting list state back out.

This is not a replacement for browser tests. It does not validate layout,
keyboard behavior, focus, CSS, or DOM event wiring. It is intended to prove that
file-shaped list data can still flow through the client, page state model,
lifecycle transitions, and save path.

## CLI

```sh
node scripts/run_in_memory_flow.js --input flow.json --output state-out.json
```

The input file is a full flow fixture:

```json
{
  "state": {
    "cases": [
      {
        "id": "case-1",
        "caseType": "example-review",
        "title": "Pipeline fixture case",
        "status": "In-progress",
        "assignedReviewer": "user-reviewer",
        "responsibleParty": "user-agent-a",
        "answers": {},
        "conversation": [],
        "notes": "",
        "completedAt": null,
        "etag": "etag-1"
      }
    ],
    "lists": {
      "complaints": []
    }
  },
  "scenario": {
    "persona": "reviewer",
    "actions": [
      { "type": "loadCasePage", "caseId": "case-1" },
      { "type": "answer", "questionId": "q-welcome", "value": "Yes" },
      { "type": "answer", "questionId": "q-needs", "value": "Yes" },
      { "type": "answer", "questionId": "q-resolve", "value": "Yes" },
      { "type": "answer", "questionId": "q-channel", "value": "Phone" },
      { "type": "answer", "questionId": "q-products", "value": ["Account"] },
      { "type": "clickCompleteCase" }
    ]
  }
}
```

The output file contains:

```json
{
  "cases": [],
  "lists": {}
}
```

with the mutated `CaseRow` records in the same default/list-scoped stores used
by the input.

## State Shape

`state.cases` is the default SharePoint list. `state.lists` is keyed by list
name for Case Types that route to a non-default list, such as
`product-sale-review` using the `complaints` list.

Optional state fields:

- `personas`: map of persona key to `{ "userId", "displayName", "groups" }`
- `people`: directory rows used by person search and account resolution
- `exportHashes`: current question-bank export hash per Case Type slug
- `versionedExports`: frozen question-bank exports keyed by hash

If `personas` is omitted, the runner provides a minimal `reviewer` persona with
`userId: "user-reviewer"` and group `Reviewers`.

## Actions

- `loadCasePage`: loads the Case Review page model for `caseId`; pass
  `caseType` when the route should carry source/list context.
- `answer`: calls `CaseReviewViewModel.handleAnswer`.
- `captureIssue`: calls `CaseReviewViewModel.handleCapture`.
- `selectRemediationAction`: calls
  `CaseReviewViewModel.handleRemediationAction`.
- `freeFormRemediation`: calls
  `CaseReviewViewModel.handleRemediationFreeForm`.
- `setActionStatus`: calls `CaseReviewViewModel.handleActionStatus`.
- `clickCompleteCase`: runs the same completion transition used by the page's
  bottom button.
- `flush`: explicitly drains pending saves for the currently loaded case.

Every mutating action flushes the `SaveQueue` before the next action, so the
snapshot represents persisted list state rather than only local view-model
state.
