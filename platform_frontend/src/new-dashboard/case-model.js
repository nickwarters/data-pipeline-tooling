// @ts-check
import { CASE_STATUS } from '../sharepoint-client.js';

/** @param {any} answer */
export function hasAnswer(answer) {
  return Boolean(
    answer &&
    (Array.isArray(answer.value)
      ? answer.value.length
      : String(answer.value ?? ''))
  );
}

/** @param {any[]} catalogue @param {Record<string, any>} answers */
export function applicableQuestions(catalogue, answers) {
  return catalogue.filter(
    (question) =>
      !question.deprecated && matchesShowWhen(question.showWhen, answers)
  );
}

/** @param {any} node @param {Record<string, any>} answers */
export function matchesShowWhen(node, answers) {
  if (!node) return true;
  if (Array.isArray(node.$and)) {
    return node.$and.every((/** @type {any} */ child) =>
      matchesShowWhen(child, answers)
    );
  }
  if (Array.isArray(node.$or)) {
    return node.$or.some((/** @type {any} */ child) =>
      matchesShowWhen(child, answers)
    );
  }
  return Object.entries(node).every(([questionId, operation]) => {
    const value = answers[questionId]?.value;
    const rule = /** @type {any} */ (operation);
    if ('answered' in rule)
      return rule.answered === true && hasAnswer({ value });
    if ('in' in rule) {
      const values = Array.isArray(value) ? value : [value];
      return values.some((entry) => rule.in.includes(entry));
    }
    return value === rule.equals;
  });
}

/** @param {any} caseRow @param {any} config */
export function failedQuestions(caseRow, config) {
  return applicableQuestions(config.questions ?? [], caseRow.answers).filter(
    (question) => {
      const value = caseRow.answers[question.id]?.value;
      const values = Array.isArray(value) ? value : [value];
      return values.some((entry) => {
        const outcome = question.optionOutcomes?.[entry];
        return outcome && outcome !== config.defaultOutcomeId;
      });
    }
  );
}

/** @param {any} caseRow @param {any} config */
export function configuredOutcome(caseRow, config) {
  const optionById = new Map(
    (config.outcomeOptions ?? []).map((/** @type {any} */ option) => [
      option.id,
      option,
    ])
  );
  let outcome = optionById.get(config.defaultOutcomeId);
  for (const question of applicableQuestions(
    config.questions ?? [],
    caseRow.answers
  )) {
    const value = caseRow.answers[question.id]?.value;
    for (const entry of Array.isArray(value) ? value : [value]) {
      const id = question.optionOutcomes?.[entry];
      const candidate = id ? optionById.get(id) : undefined;
      if (candidate && (!outcome || candidate.severity > outcome.severity)) {
        outcome = candidate;
      }
    }
  }
  return outcome?.id ?? config.defaultOutcomeId;
}

/** @param {any} caseRow @param {string[]} roles @param {any} config */
export function visibleTabs(caseRow, roles, config) {
  const reviewerSide = roles.some((role) =>
    [
      'assignedReviewer',
      'otherReviewer',
      'reviewerManager',
      'caseTypeOwner',
      'journeyOwner',
      'controls',
    ].includes(role)
  );
  /** @type {Array<[string,string]>} */
  const tabs = [];
  if (reviewerSide) {
    tabs.push(
      ['details', 'DETAILS'],
      ['questions', 'REVIEW'],
      ['issues', 'ISSUES']
    );
  }
  const canSeeSummary =
    reviewerSide ||
    (roles.includes('responsibleParty') &&
      caseRow.status !== CASE_STATUS.IN_PROGRESS) ||
    (roles.includes('responsiblePartyManager') &&
      caseRow.status === CASE_STATUS.COMPLETED);
  if (canSeeSummary) tabs.push(['summary', 'SUMMARY']);
  if (
    caseRow.status !== CASE_STATUS.IN_PROGRESS &&
    failedQuestions(caseRow, config).some(
      (question) => caseRow.answers[question.id]?.remediationRequired === 'yes'
    )
  ) {
    tabs.push(['remediation', 'REMEDIATION']);
  }
  if (
    roles.some((role) =>
      [
        'assignedReviewer',
        'otherReviewer',
        'reviewerManager',
        'caseTypeOwner',
      ].includes(role)
    )
  ) {
    tabs.push(['notes', 'NOTES']);
  }
  if (
    caseRow.status === CASE_STATUS.COMPLETED &&
    roles.includes(config.appeal?.raisedBy ?? '')
  ) {
    tabs.push(['appealRequest', 'APPEAL']);
  }
  if (
    caseRow.status !== CASE_STATUS.VOID &&
    caseRow.reportableAt &&
    roles.includes('controls')
  ) {
    tabs.push(['amendOutcome', 'AMEND OUTCOME']);
  }
  if (
    caseRow.status === CASE_STATUS.COMPLETED &&
    (caseRow.appeals ?? []).some(
      (/** @type {any} */ appeal) => appeal.state !== 'resolved'
    ) &&
    roles.includes('controls')
  ) {
    tabs.push(['appealReview', 'APPEAL REVIEW']);
  }
  return tabs.filter(([id]) => !config.sections || id in config.sections);
}

/** @param {any} caseRow @param {string} userId @param {string[]} groups @param {any} config */
export function resolveRoles(caseRow, userId, groups, config) {
  const roles = [];
  const displayName =
    config.displayName ??
    String(config.slug ?? '')
      .split('-')
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' ');
  if (caseRow.assignedReviewer === userId) roles.push('assignedReviewer');
  else if (groups.includes(`Reviewers - ${displayName}`)) {
    roles.push('otherReviewer');
  }
  if (caseRow.assignedReviewerManager === userId) roles.push('reviewerManager');
  if (caseRow.responsibleParty === userId) roles.push('responsibleParty');
  if (caseRow.responsiblePartyManager === userId)
    roles.push('responsiblePartyManager');
  if (groups.includes(`CaseTypeOwner - ${displayName}`))
    roles.push('caseTypeOwner');
  if (groups.includes(`JourneyOwner - ${displayName}`))
    roles.push('journeyOwner');
  if (groups.includes('Controls')) roles.push('controls');
  return roles.length ? roles : ['none'];
}
