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
4. Run `node scripts/form-type-columns.js <slug>` for the list's columns, types
   and indexes, and create the list with them in each environment.

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
provisioning script reads it, and so will the list client.

**`editableBy`** marks a field only one editor may change: `'employee'` for the
Form's Employee, `'manager'` for its current first line manager. Every other field
is editable by both. Who may edit at all, the lock and the lifecycle buttons are
code shared by every Form Type, never definition entries.

## The application's own columns

`Employee`, `CurrentFirstLineManager`, `CurrentSecondLineManager`, `Status` and
`DueDate` belong to the application, because access and the lock read them. Every
Form's list has them, and they are always read and written plain.

- A definition **must place** `Employee` and `DueDate`. The page draws the Status
  badge and the current managers itself, so a definition need not place those.
- A definition may not give one of them another type, or mark one `editableBy`:
  nobody edits them after creation.

`FirstLineManager` and `SecondLineManager` are not the application's: they are
ordinary fields, the record of who the managers were at completion, and grant
no access.

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
