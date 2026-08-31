# 52. Case Types select the Conversation initiator

Date: 2026-08-30

## Status

Accepted

## Context

The Conversation already has a per-Case-Type status gate, but once that gate
opens both the Assigned Reviewer and Responsible Party side can send the first
Message. Different Case Types begin the exchange differently. Complaints needs
the Responsible Party side to report progress after Remediation Actions have
been sent; another Case Type may need the Reviewer to ask a question while the
Case is In-progress.

## Decision

The Conversation Section descriptor gains `initiatedBy`, selecting the closed
vocabulary `reviewer | responsibleParty`. The existing `allowMessagesWhen`
descriptor continues to choose the live statuses in which posting is possible.

Before the Conversation contains a Message, only the selected side receives
`edit` access. The other side receives `read-only` access. Once the first
Message exists, both participating sides receive `edit` access and may reply.
Completed and Void Cases remain read-only regardless of either descriptor.
When `initiatedBy` is omitted, either side may start, preserving existing Case
Type behaviour.

The descriptor selects stable Case Type variation only. The branching access
policy remains in `services/section-access.js`, consistent with
[ADR-0035](./0035-case-type-descriptors-express-variation-behaviour-stays-in-code.md).
Configuration verification rejects unknown initiating-side values.

Complaints declares:

```js
conversation: {
  allowMessagesWhen: ['Actions In Progress'],
  initiatedBy: 'responsibleParty',
}
```

## Consequences

- The Complaints Responsible Party side sends the first Message at Actions In
  Progress; the Assigned Reviewer can only reply after receiving it.
- A Reviewer-led Case Type can use `initiatedBy: 'reviewer'`, including with an
  In-progress status gate, and the Responsible Party side can only reply after
  the Reviewer starts the Conversation.
- The Conversation's existing JSON storage and PATCH path do not change.
- This is a client-side UX rule; SharePoint list permissions remain the security
  boundary.
