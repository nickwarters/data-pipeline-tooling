// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import {
  AdminDetailsPlugin,
  ALLOWED_ADMIN_CORE_FIELDS,
  FORBIDDEN_ADMIN_LIFECYCLE_FIELDS,
} from '../src/sections/admin-details/admin-details-plugin.js';
import {
  getSectionPlugin,
  resetSectionRegistry,
  evaluateSectionsAccess,
} from '../src/sections/registry.js';
import { makePermissions } from './helpers/fixtures.js';
import complaintsConfig from '../case-types/complaints.js';
import exampleReviewConfig from './_example-review-case-type.js';

installDom();

const maintainerCapabilities = makePermissions({
  isReviewer: false,
  isMaintainer: true,
});

const standardReviewerCapabilities = makePermissions({
  isReviewer: true,
  isMaintainer: false,
  listAccessCaseTypes: ['complaints'],
});

test('AdminDetailsPlugin satisfies SectionPlugin contract and is registered', () => {
  resetSectionRegistry();
  assert.equal(getSectionPlugin('adminDetails'), AdminDetailsPlugin);
  assert.equal(AdminDetailsPlugin.id, 'adminDetails');
  assert.equal(AdminDetailsPlugin.tab, true);
  assert.equal(AdminDetailsPlugin.tabOrder, 10);
  assert.deepEqual(AdminDetailsPlugin.defaultLabels, {
    tab: 'Admin Edit',
    heading: 'Admin Case Details Override',
  });
});

test('AdminDetailsPlugin evaluateAccess respects enabled flag and isMaintainer capability', () => {
  // Disabled or missing config returns hidden even for maintainers
  assert.equal(
    AdminDetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({}),
      roles: ['assignedReviewer'],
      capabilities: maintainerCapabilities,
      sectionConfig: undefined,
    }),
    'hidden'
  );
  assert.equal(
    AdminDetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({}),
      roles: ['assignedReviewer'],
      capabilities: maintainerCapabilities,
      sectionConfig: { enabled: false },
    }),
    'hidden'
  );

  // Enabled config without maintainer capability returns hidden
  assert.equal(
    AdminDetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({}),
      roles: ['assignedReviewer'],
      capabilities: standardReviewerCapabilities,
      sectionConfig: { enabled: true },
    }),
    'hidden'
  );

  // Enabled config with maintainer capability returns edit
  assert.equal(
    AdminDetailsPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({}),
      roles: ['assignedReviewer'],
      capabilities: maintainerCapabilities,
      sectionConfig: { enabled: true },
    }),
    'edit'
  );
});

test('Acceptance criteria: Admins see Admin Edit on Complaints, not standard reviewers', () => {
  const caseRow = /** @type {any} */ ({ id: 'c1', title: 'Case 1' });

  // Admin viewer on Complaints
  const adminAccess = evaluateSectionsAccess({
    caseRow,
    roles: ['assignedReviewer'],
    capabilities: maintainerCapabilities,
    config: complaintsConfig,
  });
  assert.equal(adminAccess.adminDetails, 'edit');

  // Standard reviewer on Complaints
  const reviewerAccess = evaluateSectionsAccess({
    caseRow,
    roles: ['assignedReviewer'],
    capabilities: standardReviewerCapabilities,
    config: complaintsConfig,
  });
  assert.equal(reviewerAccess.adminDetails, 'hidden');
});

test('Acceptance criteria: Other Case Types omitting adminDetails do not show the tab even for Admins', () => {
  const caseRow = /** @type {any} */ ({ id: 'c1', title: 'Case 1' });

  const adminAccess = evaluateSectionsAccess({
    caseRow,
    roles: ['assignedReviewer'],
    capabilities: maintainerCapabilities,
    config: exampleReviewConfig,
  });
  assert.equal(adminAccess.adminDetails, 'hidden');
});

test('AdminDetailsPlugin view renders banner and editable fields, and routes core vs detail changes to appropriate action handlers', () => {
  const caseRow = {
    id: 'case-99',
    title: 'Original Title',
    dueDate: '2026-10-01',
    details: { complaintRef: 'REF-123', customerName: 'Original Customer' },
  };
  /** @type {{ field: string, value: string }[]} */
  const detailEdits = [];
  /** @type {{ field: string, value: string }[]} */
  const caseEdits = [];
  const actions = {
    editDetailField: (
      /** @type {string} */ field,
      /** @type {string} */ value
    ) => {
      detailEdits.push({ field, value });
    },
    editCaseField: (
      /** @type {string} */ field,
      /** @type {string} */ value
    ) => {
      caseEdits.push({ field, value });
    },
  };
  const sectionConfig = {
    enabled: true,
    editableFields: ['title', 'dueDate', 'complaintRef', 'customerName'],
  };
  const config = {
    detailFields: [
      { key: 'complaintRef', label: 'Complaint ref' },
      { key: 'customerName', label: 'Customer name' },
    ],
  };

  const node = /** @type {any} */ (
    AdminDetailsPlugin.view({
      caseRow: /** @type {any} */ (caseRow),
      actions: /** @type {any} */ (actions),
      sectionConfig,
      snapshot: /** @type {any} */ ({}),
      config: /** @type {any} */ (config),
      route: /** @type {any} */ ({}),
      dispatch: () => {},
    })
  );

  assert.equal(node.className, 'cora-admin-details');
  const banner = node.querySelector('.cora-banner.warning');
  assert.ok(banner);
  assert.equal(banner.textContent, 'Admin Mode: direct field patch');

  const inputs = node.querySelectorAll('input');
  assert.equal(inputs.length, 4);
  assert.equal(inputs[0].value, 'Original Title');
  assert.equal(inputs[1].value, '2026-10-01');
  assert.equal(inputs[2].value, 'REF-123');
  assert.equal(inputs[3].value, 'Original Customer');

  // Trigger change on top-level core field: calls editCaseField
  inputs[0].value = 'Updated Title';
  inputs[0].dispatchEvent({ type: 'change' });

  assert.deepEqual(caseEdits, [{ field: 'title', value: 'Updated Title' }]);
  assert.deepEqual(detailEdits, []);

  // Trigger change on declared detail field: calls editDetailField
  inputs[2].value = 'REF-456';
  inputs[2].dispatchEvent({ type: 'change' });

  assert.deepEqual(detailEdits, [{ field: 'complaintRef', value: 'REF-456' }]);
});

test('AdminDetailsPlugin view does not mutate its input caseRow', () => {
  const caseRow = {
    id: 'case-99',
    title: 'Original Title',
    dueDate: '2026-10-01',
    details: { complaintRef: 'REF-123' },
  };
  const before = structuredClone(caseRow);
  const actions = {
    editDetailField: () => {},
    editCaseField: () => {},
  };
  const sectionConfig = {
    enabled: true,
    editableFields: ['title', 'complaintRef'],
  };
  const config = {
    detailFields: [{ key: 'complaintRef', label: 'Complaint ref' }],
  };

  const node = /** @type {any} */ (
    AdminDetailsPlugin.view({
      caseRow: /** @type {any} */ (caseRow),
      actions: /** @type {any} */ (actions),
      sectionConfig,
      snapshot: /** @type {any} */ ({}),
      config: /** @type {any} */ (config),
      route: /** @type {any} */ ({}),
      dispatch: () => {},
    })
  );

  const inputs = node.querySelectorAll('input');
  inputs[0].value = 'Mutated Title';
  inputs[0].dispatchEvent({ type: 'change' });
  inputs[1].value = 'Mutated Ref';
  inputs[1].dispatchEvent({ type: 'change' });

  assert.deepEqual(caseRow, before, 'caseRow must remain completely unmutated');
});

test('AdminDetailsPlugin view handles declared detail fields when caseRow.details is initially undefined', () => {
  const caseRow = {
    id: 'case-100',
    title: 'No Details Case',
  };
  /** @type {{ field: string, value: string }[]} */
  const detailEdits = [];
  const actions = {
    editDetailField: (
      /** @type {string} */ field,
      /** @type {string} */ value
    ) => {
      detailEdits.push({ field, value });
    },
  };
  const sectionConfig = {
    enabled: true,
    editableFields: ['complaintRef'],
  };
  const config = {
    detailFields: [{ key: 'complaintRef', label: 'Complaint ref' }],
  };

  const node = /** @type {any} */ (
    AdminDetailsPlugin.view({
      caseRow: /** @type {any} */ (caseRow),
      actions: /** @type {any} */ (actions),
      sectionConfig,
      snapshot: /** @type {any} */ ({}),
      config: /** @type {any} */ (config),
      route: /** @type {any} */ ({}),
      dispatch: () => {},
    })
  );

  const input = node.querySelector('input');
  assert.equal(input.value, '');
  input.value = 'BRAND-NEW-REF';
  input.dispatchEvent({ type: 'change' });

  assert.deepEqual(detailEdits, [
    { field: 'complaintRef', value: 'BRAND-NEW-REF' },
  ]);
});

test('AdminDetailsPlugin view filters out lifecycle fields and unknown fields', () => {
  const caseRow = {
    id: 'case-99',
    title: 'Original Title',
    status: 'In-progress',
    assignedReviewer: 'reviewer@domain.com',
    details: { complaintRef: 'REF-123' },
  };
  const actions = {
    editDetailField: () => {},
    editCaseField: () => {},
  };
  const sectionConfig = {
    enabled: true,
    editableFields: [
      'title',
      'status',
      'assignedReviewer',
      'complaintRefx', // typo / unknown
      'complaintRef',
    ],
  };
  const config = {
    detailFields: [{ key: 'complaintRef', label: 'Complaint ref' }],
  };

  const node = /** @type {any} */ (
    AdminDetailsPlugin.view({
      caseRow: /** @type {any} */ (caseRow),
      actions: /** @type {any} */ (actions),
      sectionConfig,
      snapshot: /** @type {any} */ ({}),
      config: /** @type {any} */ (config),
      route: /** @type {any} */ ({}),
      dispatch: () => {},
    })
  );

  const inputs = node.querySelectorAll('input');
  // Only 'title' and 'complaintRef' should be rendered; lifecycle and unknown fields must be rejected
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].id, 'admin-field-title');
  assert.equal(inputs[1].id, 'admin-field-complaintRef');
});

test('AdminDetailsPlugin view handles default editable fields and missing actions gracefully', () => {
  const node = /** @type {any} */ (
    AdminDetailsPlugin.view({
      caseRow: /** @type {any} */ ({ id: 'case-1' }),
      actions: /** @type {any} */ ({}),
      sectionConfig: { enabled: true },
      snapshot: /** @type {any} */ ({}),
      config: /** @type {any} */ ({}),
      route: /** @type {any} */ ({}),
      dispatch: () => {},
    })
  );
  const inputs = node.querySelectorAll('input');
  assert.equal(inputs.length, 2); // title, dueDate
  // Trigger change with missing actions should not throw
  inputs[0].dispatchEvent({ type: 'change' });
});

test('ALLOWED_ADMIN_CORE_FIELDS and FORBIDDEN_ADMIN_LIFECYCLE_FIELDS are frozen disjunct sets', () => {
  assert.ok(Object.isFrozen(ALLOWED_ADMIN_CORE_FIELDS));
  assert.ok(Object.isFrozen(FORBIDDEN_ADMIN_LIFECYCLE_FIELDS));
  const coreSet = new Set(ALLOWED_ADMIN_CORE_FIELDS);
  for (const field of FORBIDDEN_ADMIN_LIFECYCLE_FIELDS) {
    assert.equal(coreSet.has(field), false, `Collision on ${field}`);
  }
});
