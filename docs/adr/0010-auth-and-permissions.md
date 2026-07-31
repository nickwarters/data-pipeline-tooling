# Authentication and permissions

## Status

Accepted. Still current; [ADR-0022](./0022-two-axis-role-model.md) extends the
capability model without changing SharePoint ACLs as the security boundary.

> **Amended by [ADR-0022] (Jul 2026).** The group→capability model is reworked onto two
> axes — **functional** groups (`Reviewers`, `Advisers`, `CaseTypeOwner - <type>`,
> `JourneyOwner - <type>`, `Controls`) and **list-access** groups (`Reviewers - <type>`,
> the ACL boundary). `Reviewers - <type>` implies the Reviewer capability. The
> `QA-Reviewers` group is retired ([ADR-0026]). The "UX-only checks, list ACLs are the
> real boundary" principle below is unchanged.
>
> [ADR-0022]: ./0022-two-axis-role-model.md
> [ADR-0026]: ./0026-amend-outcome-case-level-and-qa-retirement.md

The framework assumes **standard SharePoint SE browser authentication** — NTLM/Kerberos handled transparently by the browser, requests sent with `credentials: 'include'`. No custom login flow, no token management. SharePoint's `X-RequestDigest` is fetched lazily from `_api/contextinfo` on first write and refreshed on 403.

### Security boundary

**SharePoint permissions are the real security boundary.** Case rows and Answers are gated by permissions on each Case Type's Cases list. Question Bank JSON text and its versioned exports are files in the SharePoint Style Library, governed by SharePoint file/library permissions rather than a Question Definitions list. The framework's client-side group checks are **UX-only** — they decide which dashboard sections render and which buttons appear, but they're not authoritative. A user who bypasses the UI still hits SharePoint's 403 at the REST layer.

### Permissions config

Group-to-capability mapping lives in a versioned JS config module (alongside Case Type modules), not a SharePoint list:

```js
/** @type {PermissionsConfig} */
export const permissions = {
  reviewer: ['Case Reviewers'],
  caseTypeOwners: {
    'sales-call-review': ['Sales Call Review Owners'],
    'kyc-review': ['KYC Review Owners'],
  },
};
```

Group membership is read once at boot via `_api/web/currentUser/groups` and cached for the session. Persona switching for local dev via `?asUser=...` URL param against the mock client.

This is a **provisional choice**: if non-developers need to edit the mapping, we'll move it to a SharePoint list later. For now, friction (PR + deploy) is acceptable for what should be a rare structural change.
