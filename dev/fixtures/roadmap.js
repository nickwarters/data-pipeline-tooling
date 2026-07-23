// @ts-check
/** @typedef {import('../../src/sharepoint-client.js').RoadmapItem} RoadmapItem */

/** @type {RoadmapItem[]} */
export const roadmapItems = [
  {
    id: '1',
    title: 'Case review foundations',
    description:
      'The core review journey, assignment model, and outcome calculation are live for the first Case Type.',
    theme: 'Core platform',
    labels: ['LIVE', '2026'],
    status: 'LIVE',
  },
  {
    id: '2',
    title: 'Operational dashboards',
    description:
      'Bring reviewer, Controls, Responsible Party, and Journey Owner work into role-specific dashboards with clear action queues.',
    theme: 'Work management',
    labels: ['P1', '2026'],
    status: 'IN PROGRESS',
  },
  {
    id: '3',
    title: 'Portfolio insight',
    description:
      'Build cross-Case-Type trends and outcome insight once the operational data contracts have settled. This longer description deliberately exercises the roadmap card expansion behaviour in the mock development loop without relying on unsafe HTML rendering.',
    theme: 'Insight',
    labels: ['2027', 'P2'],
    status: 'UPCOMING',
  },
];
