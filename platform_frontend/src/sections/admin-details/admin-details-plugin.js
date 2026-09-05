// src/sections/admin-details/admin-details-plugin.js
// @ts-check
import { h } from '../../lib/html.js';

/**
 * Core Case Row fields that are safe for administrative modification.
 * Lifecycle, allocation, and audit fields are strictly excluded.
 */
export const ALLOWED_ADMIN_CORE_FIELDS = Object.freeze([
  'title',
  'dueDate',
  'relatedDate',
  'notes',
  'caseJustification',
]);

/**
 * Fields that are lifecycle-, allocation-, or system-owned and must never
 * be directly patched via descriptor-configured admin edit forms.
 */
export const FORBIDDEN_ADMIN_LIFECYCLE_FIELDS = Object.freeze([
  'status',
  'assignedReviewer',
  'assignedAt',
  'assignedReviewerManager',
  'responsibleParty',
  'responsiblePartyDisplayName',
  'responsiblePartyManager',
  'completedAt',
  'reportableAt',
  'remediationDueDate',
  'voidReason',
  'voidReasonNote',
  'voidedAt',
  'voidedBy',
  'onHold',
  'placedOnHoldAt',
  'outcome',
  'outcomeAtCompletion',
  'effectiveOutcome',
  'hadRemediation',
  'effectiveHadRemediation',
  'outcomeOverridden',
  'amendedOutcome',
  'appeals',
  'hasOpenAppeal',
  'appealRaisedAt',
  'answers',
  'conversation',
  'id',
  'caseType',
  'etag',
  'created',
  'overdue',
  'awaitingResponsibleParty',
  'awaitingSince',
  'reviewRequired',
]);

/** @type {import('../registry.js').SectionPlugin} */
export const AdminDetailsPlugin = {
  id: 'adminDetails',
  tab: true,
  tabOrder: 10,
  summaryBlock: false,
  summaryOrder: 0,
  showInSummaryDefault: false,
  defaultLabels: { tab: 'Admin Edit', heading: 'Admin Case Details Override' },

  evaluateAccess: ({ capabilities, sectionConfig }) => {
    if (!sectionConfig?.enabled) return 'hidden';
    return capabilities?.isMaintainer ? 'edit' : 'hidden';
  },

  view: ({ caseRow, actions, sectionConfig, config }) => {
    const rawFields = sectionConfig?.editableFields ?? ['title', 'dueDate'];
    const declaredDetailKeys = new Set(
      (config?.detailFields ?? []).map((f) => f.key)
    );
    const forbidden = new Set(FORBIDDEN_ADMIN_LIFECYCLE_FIELDS);
    const allowedCore = new Set(ALLOWED_ADMIN_CORE_FIELDS);

    // Indexed by a name that is only known at runtime, so it cannot be checked
    // against `CaseRow`'s keys. Hoisted rather than cast inline because the
    // formatter moves an inline cast off the expression it applies to.
    const row = /** @type {any} */ (caseRow);

    const editableFields = rawFields.filter(
      (field) =>
        typeof field === 'string' &&
        !forbidden.has(field) &&
        (allowedCore.has(field) || declaredDetailKeys.has(field))
    );

    return h(
      'div',
      { className: 'cora-admin-details' },
      h(
        'div',
        { className: 'cora-banner warning' },
        'Admin Mode: direct field patch'
      ),
      h(
        'div',
        { className: 'cora-admin-details__fields' },
        editableFields.map((field) => {
          const isDetailField = declaredDetailKeys.has(field);
          const initialValue = isDetailField
            ? (caseRow?.details?.[field] ?? '')
            : (row?.[field] ?? '');

          return h(
            'div',
            { key: field, className: 'cora-admin-details__row' },
            h('label', { htmlFor: `admin-field-${field}` }, field),
            h('input', {
              id: `admin-field-${field}`,
              type: 'text',
              value: String(initialValue),
              onchange: (
                /** @type {Event & { target: HTMLInputElement }} */ e
              ) => {
                if (!editableFields.includes(field)) return;
                if (isDetailField) {
                  actions?.editDetailField?.(field, e.target.value);
                } else {
                  actions?.editCaseField?.(field, e.target.value);
                }
              },
            })
          );
        })
      )
    );
  },
};
