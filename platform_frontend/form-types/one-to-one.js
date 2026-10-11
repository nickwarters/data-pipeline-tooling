// @ts-check
/** @typedef {import('./contract.js').FormTypeDefinition} FormTypeDefinition */

/**
 * The **1-to-1** Form Type: a meeting between an employee and their line
 * manager, with its details, the discussion, up to three Form Actions and each
 * side's own comments.
 *
 * Status is not a field here. It is the badge in the page header, and only the
 * lifecycle buttons change it.
 */
export const oneToOne = /** @satisfies {FormTypeDefinition} */ ({
  slug: 'one-to-one',
  formName: '1-to-1',
  description: 'Capture meeting details, notes and actions.',
  listName: 'OneToOne',
  voidReasons: ['Created in error', 'Duplicate form', 'Meeting did not happen'],
  allowOtherVoidReason: true,
  sections: [
    {
      sectionType: 'panel',
      // Not drawn as a heading in a strip; it names the region for a screen reader.
      panelName: 'Meeting details',
      layout: 'strip',
      fields: [
        { type: 'person', label: 'Employee', itemField: 'Employee' },
        {
          type: 'person',
          label: 'First line manager',
          itemField: 'FirstLineManager',
        },
        {
          type: 'person',
          label: 'Second line manager',
          itemField: 'SecondLineManager',
        },
        { type: 'date', label: 'Due date', itemField: 'DueDate' },
        { type: 'date', label: 'Date of meeting', itemField: 'MeetingDate' },
        {
          type: 'select',
          label: 'Competency stage',
          itemField: 'CompetencyStage',
          choices: ['Stage 1', 'Stage 2', 'Stage 3'],
        },
        {
          type: 'select',
          label: 'Location',
          itemField: 'Location',
          choices: ['In person', 'Zoom'],
        },
        {
          type: 'text',
          label: 'Tags',
          itemField: 'Tags',
          optional: true,
          placeholder: 'e.g. goals, wellbeing, performance',
        },
      ],
    },
    {
      sectionType: 'panel',
      panelName: 'Discussion',
      hint: 'Capture context, not just outcomes.',
      layout: 'question-answer',
      fields: [
        { type: 'textarea', label: 'Agenda', itemField: 'Agenda' },
        {
          type: 'textarea',
          label: 'Wellbeing',
          itemField: 'Wellbeing',
          hint: 'Take time to reflect on your wellbeing.',
          placeholder:
            'How are you feeling? Is there any type of support you need?',
        },
        {
          type: 'textarea',
          label: 'Performance',
          itemField: 'Performance',
          hint: "Your thoughts on what you've been involved with and how you're evidencing that you're meeting your goals.",
          placeholder:
            'Consider: what has gone really well? How are you adding value? What are you taking ownership of? Do you have any challenges?',
        },
        {
          type: 'textarea',
          label: 'Development & growth',
          itemField: 'DevelopmentGrowth',
        },
        {
          type: 'textarea',
          label: 'Any other notes',
          itemField: 'OtherNotes',
        },
      ],
    },
    {
      sectionType: 'actions',
      itemField: 'Actions',
      hint: 'Add up to 3 actions. Update their status as they progress.',
    },
    {
      sectionType: 'split-panel',
      panels: [
        {
          panelName: 'Individual comments',
          fields: [
            {
              type: 'textarea',
              label: 'Individual comments',
              itemField: 'IndividualComments',
              hideLabel: true,
              editableBy: 'employee',
            },
          ],
        },
        {
          panelName: 'Line manager comments',
          fields: [
            {
              type: 'textarea',
              label: 'Line manager comments',
              itemField: 'LineManagerComments',
              hideLabel: true,
              editableBy: 'manager',
            },
          ],
        },
      ],
    },
  ],
});
