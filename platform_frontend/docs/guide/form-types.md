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
   environment.

`form-types/one-to-one.js` is the worked example.

## The shape

```js
export const oneToOne = /** @satisfies {FormTypeDefinition} */ ({
  slug: 'one-to-one', // the route segment
  formName: '1-to-1',
  description: 'Capture meeting details, notes and actions.',
  listName: 'OneToOne', // the environment prefix is added centrally
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

**`editableBy`** marks a field only one editor may change: `'employee'` for the
Form's Employee, `'manager'` for its current first line manager. Every other field
is editable by both. Who may edit at all, the lock and the lifecycle buttons are
code shared by every Form Type, never definition entries.

## The application's own columns

`Employee`, `CurrentFirstLineManager`, `CurrentSecondLineManager`, `Status`,
`DueDate` and `ClosedDate` belong to the application, because access, the lock
and the archive read them. `ClosedDate` is the day a lifecycle button closed the
Form and is empty while it is open; the archive reads it rather than `Modified`,
which moves whenever anything touches the item. Every
Form's list has them, and they are always read and written plain.

- A definition **must place** `Employee` and `DueDate`. The page draws the Status
  badge, the current managers and the closed date itself, so a definition need
  not place those.
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
the `Forms` group gives `canAccessForms`, and the `Forms Control` group gives
`isFormsControl` and implies it; both names in `src/services/permissions.js` are
placeholders until provisioning settles them.

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

## What the gate checks

`npm run verify` refuses a definition with:

- an unknown section type, panel layout, field type or `editableBy` value;
- two fields writing the same column, the Actions column included;
- a `select` or `radio` offering no `choices`;
- more than one Actions section, or one naming no column;
- a missing `Employee` or `DueDate`, or one of the application's columns retyped
  or marked `editableBy`;
- no `slug`, `formName`, `listName` or sections, or a field naming no column;
- two Form Types sharing a slug or a list.
