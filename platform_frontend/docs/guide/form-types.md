# Authoring a Form Type

A **Form Type** (1-to-1, coaching form, learning plan) is one JavaScript data
module under `form-types/`, named once in `src/app-config.js`. One renderer draws
every Form Type, in its editable, view-only and locked forms, so adding one is a
new data file rather than a new page. The decision behind this is
[ADR-0059](../adr/0059-hr-forms-are-a-gated-area-with-javascript-enforced-access.md);
the terms are in [CONTEXT.md](../../CONTEXT.md#forms).

## Adding one

1. Write `form-types/<slug>.js`, exporting the definition with
   `@satisfies {FormTypeDefinition}` (from `form-types/contract.js`), so a
   misspelt key or an unknown layout fails `npm run check`.
2. Add it to `formTypes` in `src/app-config.js`.
3. Run `npm run verify`. The gate checks the definition (below) before a browser
   sees it.
4. Run `node scripts/form-type-columns.js <slug>` for the list's columns, types,
   Choice values and indexes, and create the list with them in each
   environment, with the settings and checks in the runbook's
   [HR Form Type lists](provisioning-runbook.md#8-hr-form-type-lists) section.

`form-types/one-to-one.js` is the worked example.

## The shape

```js
export const oneToOne = /** @satisfies {FormTypeDefinition} */ ({
  slug: 'one-to-one', // the route segment
  formName: '1-to-1',
  description: 'Capture meeting details, notes and actions.',
  listName: 'OneToOne', // the environment prefix is added centrally
  voidReasons: ['Created in error', 'Duplicate form', 'Meeting did not happen'],
  allowOtherVoidReason: true, // also offer Other, which asks for the reason
  sections: [
    { sectionType: 'panel', panelName: 'Meeting details', layout: 'strip', fields: [ … ] },
    { sectionType: 'panel', panelName: 'Discussion', layout: 'question-answer', fields: [ … ] },
    { sectionType: 'actions', itemField: 'Actions' },
    { sectionType: 'split-panel', panels: [ { panelName: …, fields: [ … ] }, { … } ] },
  ],
});
```

**Sections.**

| `sectionType` | What it draws                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `panel`       | One full-width panel. `layout` is `strip` (label and value pairs, no heading drawn), `question-answer` (label and hint left, answer right) or `stacked` (the default).                       |
| `split-panel` | Two panels side by side, stacking when the page is narrow.                                                                                                                                   |
| `actions`     | The shared Form Actions editor, stored as one column named by `itemField`. A Form holds at most three Form Actions whatever its type, so a definition cannot set a limit. One per Form Type. |

**Fields** carry `type`, `label` and `itemField` (the list column, exactly as the
list names it), plus optional `hint`, `placeholder`, `optional`, `hideLabel`,
`choices` (for `select` and `radio`) and `editableBy`.

| `type`     | Stored as | Column type                         |
| ---------- | --------- | ----------------------------------- |
| `text`     | encoded   | Multiple lines of text (plain text) |
| `textarea` | encoded   | Multiple lines of text (plain text) |
| `select`   | plain     | Choice                              |
| `radio`    | plain     | Choice                              |
| `person`   | plain     | Person or Group                     |
| `date`     | plain     | Date and Time (date only)           |
| `status`   | plain     | Choice                              |

Encoding follows the type and there is no flag to set. Free text is encoded so
it is not readable at a glance in the list. Encoding is not encryption: anyone
who can read the list can decode it. People, dates and choices stay plain
because the queries and the access rule read them. `formColumns(definition)` in
`form-types/contract.js` is the one derivation of which columns are which; the
provisioning script and both SharePoint clients read it, so a column cannot be
encoded on the way out and read plain on the way back. How a Form is read and
written is in [the client guide](./sharepoint-client.md#forms-listformitems-getformitem-createformitem-patchformitem).

**`voidReasons`** is what the person voiding a Form picks from to say why, and
it must name at least one. **`allowOtherVoidReason: true`** adds **Other** after
them, which asks for the reason in the voider's own words and holds the Void
until there are some. Other is only ever offered this way, so the gate refuses a
definition that lists it among its own reasons. The reasons are the Form Type's
own; they are not the Case Void Reasons.

**`editableBy`** marks a field only one editor may change: `'employee'` for the
Form's Employee, `'manager'` for its current first line manager. Every other field
is editable by both. Who may edit at all, the lock and the lifecycle buttons are
code shared by every Form Type, never definition entries.

## The application's own columns

`Employee`, `CurrentFirstLineManager`, `CurrentSecondLineManager`, `Status`,
`DueDate`, `ClosedDate`, `ClosedBy`, `VoidReason` and `VoidReasonNote` belong to
the application, because access, the lock, the archive and the locked page read
them. `ClosedDate` is the
day a lifecycle button closed the Form and `ClosedBy` the person who pressed it;
both are empty while it is open. The archive reads `ClosedDate` rather than
`Modified`, which moves whenever anything touches the item, and neither is read
from the version history, which a list may not keep and which names whoever
wrote last rather than who closed the Form. `VoidReason` is the reason picked
when the Form was voided, a Choice column offering the Form Type's
`voidReasons` (and Other), and `VoidReasonNote` the voider's own words under
Other; both are empty otherwise. Every Form's list has them, stored by their
type: all plain but `VoidReasonNote`, which is free text and encoded. All but
the two Void columns are indexed.

- A definition **must place** `Employee` and `DueDate`. The page draws the Status
  badge, the current managers and who closed the Form and when itself, so a
  definition need not place those.
- A definition may not give one of them another type, or mark one `editableBy`:
  nobody edits them after creation.

`FirstLineManager` and `SecondLineManager` are not the application's: they are
ordinary fields, the record of who the managers were at completion, and grant
no access.

## Who sees a Form

`src/services/form-access.js` is the one place the access rule lives, and every
Forms view asks it rather than re-deriving it. `formAccess(form, me, caps)`
answers for one viewer and one Form: the roles they hold on it, the most
permissive of them (`role`, for a "Your role" column), `canRead`, `locked`,
`canEdit` and `canEditField(field)`. `canCreateForms(caps)` says whether they
may start a Form at all.

| Who                     | Read      | Edit while open | Create |
| ----------------------- | --------- | --------------- | ------ |
| Employee                | yes       | yes             | yes    |
| Current first line mgr  | yes       | yes             | yes    |
| Current second line mgr | yes       | no              | yes    |
| Forms control group     | every one | no              | yes    |
| Manager at completion   | no        | no              |        |

Only `Employee`, `CurrentFirstLineManager` and `CurrentSecondLineManager` grant
anything, compared as bare accounts without regard to case. A Status of
Completed, Void or Cancelled locks the Form for everyone. Nobody edits the
application's own columns after creation, whatever their role. Membership of
the `EPF Users` group gives `canAccessForms`, and the `EPF Controls` group (the
Forms Control group) gives `isFormsControl` and implies it; both names are
declared in `src/services/permissions.js`.

This is a JavaScript gate, not a permission boundary: anyone in a Form list's
access group can read every row through REST (ADR-0059).

## The Forms dashboard

`#/forms` lists the open Forms the viewer is on, across every Form Type in
`APP_CONFIG.formTypes`, which reaches the page as `AppContext.formTypes`. It
reads each Form Type's list for open Forms involving the viewer and keeps only
the rows `formAccess` lets them read. Above the table, the "As employee" lane
counts their own Forms that are overdue or due within seven days and their
pending Form Actions; the "As manager" lane counts the same for the Forms they
are current first line manager on, plus all of them as Open. A tile with nothing
in it is not drawn. The Forms control group can switch the table to every open
Form, read a hundred per Form Type at a time, ordered by due date. The route and
its nav item are guarded by `canAccessForms`. Open and View go to
`#/forms/<slug>/<id>`, and New form to `#/forms/new`.

The **Archive** tab (`#/forms?tab=archive`) lists the closed Forms instead:
Completed, Void or Cancelled, all read-only, latest closed first. It reads only
the Forms the viewer is the Employee or a current manager on, or every closed
Form for the Forms control group, and every read carries a `ClosedDate` window,
the last year by default, because the control group's read would otherwise grow
without bound. Changing a date reads again; clearing one puts its default back
rather than widening the read. The Form type, Employee and Status filters narrow
the rows already read, and Load more reads the next fifty per Form Type. Its
"Managers at completion" column shows `FirstLineManager` and
`SecondLineManager`, which grant nothing.

## The Form page

`#/forms/<slug>/<id>` opens one Form, and `src/pages/forms/form-sections-view.js`
draws it from its definition: one renderer for every Form Type, walking
`sections` → `panels` → `fields`. Each field's control comes from the
capture-field registry, the same one a Case's Issue Capture Fields use. The
mode comes from the access rule:

- **edit**, for the Employee and the current first line manager while the Form
  is open. A field the viewer may change is a control; a field they may not
  (the other editor's comments, the application's own columns) is text in the
  same place, and a panel holding one owner's field says who may write in it.
  Edits save through a `SaveQueue` built for this Form with
  `src/services/form-save-target.js`, and the header shows "Last saved". The
  footer holds Void form, Cancel form and Mark complete, each confirmed first;
  Void also asks for a reason, and under Other for the words. A button writes
  what is still waiting, then `Status`, `ClosedDate` and `ClosedBy` (and for a
  Void, `VoidReason` and `VoidReasonNote`), on the press rather than the debounce.
- **view**, for the current second line manager and the Forms control group:
  every value is text, an empty one reads "Nothing recorded", a banner says why,
  and no save queue is ever built.
- **locked**, for everyone once the Status is Completed, Void or Cancelled: a
  banner gives the closing date, and for a Void its reason, the strip shows the current managers, and a
  "Recorded at completion" block shows the Form's own `FirstLineManager` and
  `SecondLineManager` and who closed it.

`MANAGER_RECORDS` in `form-types/contract.js` pairs each recorded manager with
the current manager column that grants access in its place. While the Form is
open, a recorded manager in a strip says what its current holder may do, or
names the current manager when the record says someone else.

## The Form Actions

One editor, `src/pages/forms/form-actions-view.js`, draws the `actions` section
of every Form Type. While the Form is open, both editors see a card per Form
Action with its Title, Due date, Status and Details, a Remove button, and
"+ Add action" with a count of how many are left. The cap is
`MAX_FORM_ACTIONS` in `form-types/contract.js`; at the cap the button is
disabled. A new Action starts as `INITIAL_FORM_ACTION_STATUS` (Pending), and a
Status is chosen from `FORM_ACTION_STATUSES`; one stored outside them is offered
too, so opening the Form never changes it. Removing an Action that has a title,
due date or details asks first; an empty one goes at once.

The Actions are one column, so every change hands the page the whole list and
the save queue writes it as one value. In view and locked modes each Action is a
card of text, and none reads "Nothing recorded".

A stored list that does not decode (not JSON, more than the cap, or the wrong
shape) comes back from the client as no Actions plus a reported problem. The
section says so in an alert and offers nothing that could write over the stored
value; every other field of the Form still works and saves.

## New form

`#/forms/new` asks for the Form Type, the Employee, both managers and the due
date. Choosing the Employee fills the first line manager from their directory
profile and the second from that manager's, and either can be changed. A line
says who will be able to see the Form. Creating writes the chosen managers to
both pairs (`CurrentFirstLineManager` and `FirstLineManager`,
`CurrentSecondLineManager` and `SecondLineManager`) with the Status Pending,
then opens the Form with auto-save on. The Employee, a first line manager and a
due date are required; a second line manager is not, since someone at the top
of the directory has none.

## Styles

Every Forms page, the dashboard and archive as well as New form and the Form
page, is styled by one `cora-form-*` set in the Forms block of
`src/styles/cora-styles.css`. No page carries a set of its own. The set takes
every colour from a design token, so dark mode follows the tokens, and each
two-column layout stacks below 40rem. `tests/page-styles.test.js` holds those
three rules and refuses a page-specific `cora-forms-*` class.

## What the gate checks

`npm run verify` refuses a definition with:

- an unknown section type, panel layout, field type or `editableBy` value;
- two fields writing the same column, the Actions column included;
- a `select` or `radio` offering no `choices`;
- more than one Actions section, or one naming no column;
- a missing `Employee` or `DueDate`, or one of the application's columns retyped
  or marked `editableBy`;
- no `slug`, `formName`, `listName` or sections, or a field naming no column;
- no `voidReasons`, one named twice or blank, `Other` listed by hand, or an
  `allowOtherVoidReason` that is not `true` or `false`;
- two Form Types sharing a slug or a list.
