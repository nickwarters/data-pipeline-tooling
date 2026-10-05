# 57. The Access Log is one list shared by every environment

Date: 2026-10-05

## Status

Accepted. Settled with the owner on
[#1006](https://github.com/nickwarters/data-pipeline-tooling/issues/1006).

Makes one deliberate exception to the list-prefix rule of
[ADR-0033](./0033-uat-environment.md) and changes nothing else in it.

## Context

The **Access** page lets a **Maintainer** give or remove an internal CORA role
without opening SharePoint's group UI. Every change is recorded in an **Access
Log**, the same way **Case Support** records its actions in the **Support Log**.

ADR-0033 prefixes every list an environment reads, so each environment writes
to its own data. That rule is right for Cases, which are data an environment
owns. It is wrong for this log, because what an Access change edits is **not**
environment data. The CORA groups (`Reviewers`, `Controls`, `Reviewers -
<type>` and the rest) are site groups, so one membership is shared by prod,
UAT and training alike. A grant made from the UAT page changes access in
production at the same moment.

A log per environment would split the one history of that membership across
lists, and the question the log exists to answer, "who gave this person this
access and why", would depend on which environment's page they happened to use.

## Decision

**`CoraAccessLog` is a single site-wide list with no environment prefix.** The
Access page in every environment reads and appends to it.

- The exemption is one named constant in `HttpSharePointClient`, so the list
  prefix is still applied centrally and an unlisted list name is still
  prefixed. Nothing else is exempt.
- The page says so wherever it offers a change: roles are shared by every
  environment, and a change here alters access in production, UAT and training.
  The mock reads the same list name, so the dev loop behaves like a deploy.
- The log is write-ordered like the Support Log: the change is recorded first
  as `recorded`, then each group is changed, and a change that fails part way
  appends a second `not-applied` or `partly-applied` entry naming the first,
  because an entry is never edited. Maintainers can add to the list but not
  edit or delete.
- An entry names the person (by login and display name), the action, the role
  and Case Type in role language, the reason, and each group it changed from and
  to. The group names stay in the entry's changes, which is the one place they
  are read, because they are what SharePoint holds.

## Consequences

- Provisioning has one `CoraAccessLog` and no `<name>_CoraAccessLog`; the
  runbook and the environment guide say so, and a new environment needs no
  extra list for it.
- The data pipelines land it as the `cora_access_log` feed, a counterpart of
  `case_support_log`. It carries logins and free-text reasons, so its data
  dictionary says so.
- A second shared list would need its own named exemption and its own reason.
  A list that merely seems convenient to share does not qualify: the test is
  that the thing it records is itself shared by every environment.
- Which roles Access can give is deliberately narrow: a Reviewer, Reviewer
  Manager, Controls, Case Type Owner or Journey Owner. The Maintainer role is
  not grantable from the page, and the frontline privileges the notifications
  pipeline records are a separate list this page does not touch.
