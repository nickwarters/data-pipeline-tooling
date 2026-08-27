# Provisioning a new environment on SharePoint

How to stand up another isolated deployment of the app — `training`, a second
UAT, a demo — beside prod on the same SharePoint site. Read this with the
[deploy runbook](../deploy-runbook.md) (how code gets to an environment) and the
[Maintainer provisioning runbook](provisioning-runbook.md) (what one Case Type
needs); this page is the layer above both: the things that exist **once per
environment**.

## What an environment is

An environment is three things on the same site, all named by one word (the
**environment name**, e.g. `uat`, `training`):

| Piece       | Prod                             | Any other environment `<name>`                 |
| ----------- | -------------------------------- | ---------------------------------------------- |
| Code folder | `Style Library/CODE/CORA`        | `Style Library/CODE/CORA-<NAME>`               |
| Host page   | `SitePages/app.aspx`             | `SitePages/<name>.app.aspx`                    |
| Lists       | `Cases-Complaints`, `Roadmap`, … | `<name>_Cases-Complaints`, `<name>_Roadmap`, … |

Prod is the unprefixed baseline. Every other environment follows the same
convention, so nothing about a new environment is a design decision: the deploy
script derives the folder from the name, the deployed host page declares the
name to the app, and the app derives the list prefix from it. The two places
that hold the list of names are held equal by a test.

Question Bank artifacts (`case-types/banks/*.txt`) are **not** prefixed: they
ship inside the code folder, so each environment already has its own copy and
reads it relative to where it was deployed.

Security groups are **shared across environments** — there is no
`training_Reviewers - X`. The app's role checks are UX only; the ACLs on each
environment's own lists are the real boundary. Decide who should be able to
reach the new environment's lists before you grant anything (see step 4).

## Choosing a name

- lowercase letters and digits, starting with a letter (`training`, `uat2`);
  it becomes a list prefix, a folder suffix and a page name, so keep it short;
- not `prod` — prod is the unprefixed environment and cannot be duplicated by
  name.

## Steps

### 1. Declare the name in code (one pull request)

Two lists, which a test holds equal:

- `src/config/environment.js` — append the name to `ENVIRONMENT_NAMES`;
- `scripts/deploy_to_sharepoint.py` — append it to `ENVIRONMENT_NAMES`.

Then `npm test` and `python -m pytest platform_frontend/tests`. That is the
whole code change: no page, service or Case Type module names an environment,
and a pull request that touches anything else for this is doing too much.
Merge and release it before any deploy that uses the name — a host page that
declares a name the deployed app does not know resolves to **prod**, and the
environment's code copy would run against production lists.

### 2. Create the lists

For every list the app reads, create the `<name>_`-prefixed copy with the
**same columns, types and indexes** as its prod counterpart:

- one `<name>_Cases-{CaseTypeSlug}` per enabled Case Type, from the
  [Case Type onboarding checklist](../case-type-onboarding.md) — indexed
  columns must be created **while the list is empty**;
- `<name>_Roadmap`, from the
  [provisioning runbook](provisioning-runbook.md#2-roadmap-list).

There is no script for this; copy the prod list as a template where your
SharePoint edition allows it, and check the column set against the checklist
rather than trusting the copy. Do **not** copy prod's rows into a non-prod
environment unless the data is fit to be seen by everyone in step 4.

### 3. Create the host page

Deploy the code first, so the folder exists:

```bash
python3 scripts/deploy_to_sharepoint.py --site-url <site> --env <name> --dry-run
python3 scripts/deploy_to_sharepoint.py --site-url <site> --env <name>
```

The deploy log names the host page it expects. Create `SitePages/<name>.app.aspx`
by hand — copy `SitePages/app.aspx` (or `uat.app.aspx`) — and point its Content
Editor Web Part at `Style Library/CODE/CORA-<NAME>/host/index.html`. The deploy
has already substituted `{{CORA_ENV}}` in that file with `<name>`; the page is
what tells the app which environment it is, so nothing is passed in the URL.

Open the page. A fixed **`<NAME> environment`** badge must be visible at the
top; if it is not, the page is serving prod's code or an unknown name — stop,
because every write would land in production lists.

### 4. Grant access

Grant the environment's lists to the groups that should reach it, following the
[persona matrix](testing.md#selective-security-assurance). Because groups are
shared with prod, a member of `Reviewers - Complaints` who is granted
`training_Cases-Complaints` keeps their prod access too; if an environment's
audience must _not_ see prod, that is a prod ACL question, not something the
app can enforce.

Run the ACL smoke check against the new environment — copy
`scripts/uat-acl-smoke.example.json`, set `requiredListPrefix` to `<name>_`,
and run `npm run test:security:uat -- <config>`. The script's name says UAT;
the prefix in the config is what it checks.

### 5. Record it

- add the environment to the table in the README's environments section;
- note where its data came from and who owns refreshing it. A training
  environment in particular accumulates junk; decide now whether it is reset
  per cohort and who does it.

## Ongoing cost

Every new Case Type, and every new list or column any release needs, is now
provisioned once **per environment** — the deploy runbook's "list columns this
release needs" applies to each. The prefixed-list model is deliberately the
cheap option (ADR-0033 in `../adr/` records the alternative, a separate
subsite); if the number of environments makes this per-environment chore the
dominant cost of a release, that is the signal to revisit it.

## Retiring an environment

Remove the name from both `ENVIRONMENT_NAMES` lists first (so a stray deploy
cannot recreate its folder), then delete the host page, the code folder and
the prefixed lists. Delete the lists last: until they are gone, the data still
exists and the ACLs still apply.
