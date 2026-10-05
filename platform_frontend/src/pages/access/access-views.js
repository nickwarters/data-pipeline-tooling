// @ts-check
import { h } from '../../lib/html.js';
import { EmptyState, LoadingState } from '../../lib/empty-state.js';
import { formatTimestamp } from '../../lib/format-datetime.js';
import { PeoplePicker } from '../../components/base/cora-people-picker.js';
import {
  allRoles,
  describeChange,
  heldRoles,
  planRevoke,
  roleTitle,
} from '../../services/access-roles.js';

/** @typedef {import('../../sharepoint-client.js').AccessLogEntry} AccessLogEntry */
/** @typedef {import('../../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../../lib/people-search.js').PeopleSearchState} PeopleSearchState */
/** @typedef {import('../../services/access-roles.js').CaseTypeRef} CaseTypeRef */
/** @typedef {import('../../services/access-roles.js').HeldRole} HeldRole */
/** @typedef {import('../../services/access-roles.js').RoleRef} RoleRef */

/**
 * The members of one role's group, or why they could not be read; both absent while the read is out.
 *
 * @typedef {{ members?: PersonResult[], error?: string }} HolderRead
 */

/**
 * The route to this page for one person.
 *
 * @param {string} account
 * @returns {string}
 */
export function accessRouteFor(account) {
  return `#/access/${encodeURIComponent(account)}`;
}

/**
 * The key one role's holders are held under.
 *
 * @param {RoleRef} role
 * @returns {string}
 */
export function holderKey(role) {
  return `${role.id}:${role.caseType ?? ''}`;
}

/** @returns {HTMLElement} */
export function accessNoticeView() {
  return h(
    'section',
    { className: 'cora-access-warning', 'aria-label': 'Shared roles' },
    h(
      'p',
      {},
      'Roles are shared by every environment. Granting or removing a role here changes access in production, UAT and training alike.'
    ),
    h('p', {}, 'People given access through a nested AD group are not shown.')
  );
}

/**
 * @param {PeopleSearchState} search
 * @param {{ onQuery: (query: string) => void, onSelect: (person: { loginName: string, displayName: string }) => void }} handlers
 * @returns {HTMLElement}
 */
export function personPickerView(search, handlers) {
  return h(
    'div',
    { className: 'cora-access-search' },
    PeoplePicker({
      placeholder: 'Search for a person',
      ariaLabel: 'Person',
      people: search.people,
      status: search.status,
      inputValue: search.query,
      onQueryInput: handlers.onQuery,
      onSelect: handlers.onSelect,
    })
  );
}

/**
 * @param {HeldRole} role
 * @param {{ personName: string, groups: readonly string[], caseTypes: readonly CaseTypeRef[], onComplete: (role: HeldRole) => void, onRemove: (role: HeldRole) => void }} context
 * @returns {HTMLElement}
 */
function heldRoleView(role, context) {
  const { personName, groups, caseTypes } = context;
  const refusal = planRevoke(role, groups, caseTypes).refusal;
  const orphan = role.caseType === null && role.missing.length === 0;
  const incomplete = !role.complete;
  return h(
    'li',
    {
      className: incomplete
        ? 'cora-access-role cora-access-role--incomplete'
        : 'cora-access-role',
    },
    h(
      'p',
      { className: 'cora-access-role-heading' },
      h('strong', {}, roleTitle(role, caseTypes)),
      incomplete && h('span', { className: 'cora-access-badge' }, 'Incomplete')
    ),
    incomplete &&
      h(
        'p',
        { className: 'cora-access-note' },
        orphan
          ? 'This Reviewer access is not tied to a Case Type, so it opens no Cases.'
          : 'Part of this role is missing, so it may not work as intended.'
      ),
    refusal && h('p', { className: 'cora-access-blocked' }, refusal),
    h(
      'div',
      { className: 'cora-access-role-actions' },
      role.missing.length > 0 &&
        h(
          'button',
          {
            type: 'button',
            className: 'cora-access-submit',
            'aria-label': describeChange('grant', role, personName, caseTypes)
              .imperative,
            onclick: () => context.onComplete(role),
          },
          'Complete'
        ),
      h(
        'button',
        {
          type: 'button',
          className: 'cora-btn-secondary cora-access-remove',
          disabled: refusal !== null,
          'aria-label': describeChange('revoke', role, personName, caseTypes)
            .imperative,
          onclick: () => context.onRemove(role),
        },
        'Remove'
      )
    )
  );
}

/**
 * @param {{ personName: string, account: string, groups: string[] | undefined, groupsError: string | null }} person
 * @param {{ caseTypes: readonly CaseTypeRef[], onComplete: (role: HeldRole) => void, onRemove: (role: HeldRole) => void }} handlers
 * @returns {HTMLElement}
 */
export function personRolesView(person, handlers) {
  const { personName, groups } = person;
  /** @type {HTMLElement} */
  let body;
  if (person.groupsError) {
    body = h(
      'p',
      { className: 'cora-access-error', role: 'alert' },
      person.groupsError
    );
  } else if (!groups) {
    body = LoadingState('Loading roles');
  } else {
    const held = heldRoles(groups, handlers.caseTypes);
    body =
      held.length === 0
        ? EmptyState(`${personName} has no internal CORA roles.`)
        : h(
            'ul',
            { className: 'cora-access-role-list' },
            ...held.map((role) =>
              heldRoleView(role, {
                personName,
                groups,
                caseTypes: handlers.caseTypes,
                onComplete: handlers.onComplete,
                onRemove: handlers.onRemove,
              })
            )
          );
  }
  return h(
    'section',
    {
      className: 'cora-access-person',
      'aria-labelledby': 'cora-access-person-title',
    },
    h('h2', { id: 'cora-access-person-title' }, personName),
    h('p', { className: 'cora-access-note' }, person.account),
    body
  );
}

/**
 * @param {Record<string, HolderRead>} holders
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {HTMLElement}
 */
export function holdersView(holders, caseTypes) {
  return h(
    'section',
    {
      className: 'cora-access-holders',
      'aria-labelledby': 'cora-access-holders-title',
    },
    h('h2', { id: 'cora-access-holders-title' }, 'Who holds each role'),
    ...allRoles(caseTypes).map((role) => {
      const read = holders[holderKey(role)];
      const title = roleTitle(role, caseTypes);
      if (read?.error) {
        return h(
          'p',
          { className: 'cora-access-error', role: 'alert' },
          `${title}: ${read.error}`
        );
      }
      if (!read?.members) return LoadingState(`Loading ${title}`);
      const members = [...read.members].sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      );
      return h(
        'details',
        { className: 'cora-access-holder' },
        h('summary', {}, `${title} (${members.length})`),
        members.length === 0
          ? EmptyState('Nobody holds this role.')
          : h(
              'ul',
              { className: 'cora-access-holder-list' },
              ...members.map((member) =>
                h(
                  'li',
                  {},
                  h(
                    'a',
                    { href: accessRouteFor(member.loginName) },
                    member.displayName
                  )
                )
              )
            )
      );
    })
  );
}

/** What an entry's outcome is badged as; a plain recorded entry carries no badge. */
const OUTCOME_BADGES = {
  'not-applied': 'Not applied',
  'partly-applied': 'Partly applied',
};

/**
 * @param {AccessLogEntry} entry
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {HTMLElement}
 */
function logEntryView(entry, caseTypes) {
  const role = {
    id: /** @type {any} */ (entry.role),
    caseType: entry.caseType || null,
  };
  const heading = describeChange(
    entry.action,
    role,
    entry.targetName || entry.account,
    caseTypes
  ).past;
  const badge =
    OUTCOME_BADGES[/** @type {keyof typeof OUTCOME_BADGES} */ (entry.outcome)];
  return h(
    'li',
    {
      className: badge
        ? 'cora-access-log-entry cora-access-log-entry--failed'
        : 'cora-access-log-entry',
    },
    h(
      'p',
      { className: 'cora-access-log-heading' },
      h('strong', {}, heading),
      badge && h('span', { className: 'cora-access-badge' }, badge),
      h(
        'span',
        { className: 'cora-access-log-meta' },
        `${entry.createdBy || 'Unknown'}, ${formatTimestamp(entry.createdAt)}`
      )
    ),
    h('p', { className: 'cora-access-log-reason' }, entry.reason)
  );
}

/**
 * @param {{ log: AccessLogEntry[] | undefined, logError: string | null }} read
 * @param {readonly CaseTypeRef[]} caseTypes
 * @returns {HTMLElement}
 */
export function accessLogView({ log, logError }, caseTypes) {
  /** @type {HTMLElement} */
  let body;
  if (logError) {
    body = h('p', { className: 'cora-access-error', role: 'alert' }, logError);
  } else if (!log) {
    body = LoadingState('Loading the access log');
  } else if (log.length === 0) {
    body = EmptyState('No access changes have been recorded for this person.');
  } else {
    body = h(
      'ol',
      { className: 'cora-access-log-list' },
      ...log.map((entry) => logEntryView(entry, caseTypes))
    );
  }
  return h(
    'section',
    {
      className: 'cora-access-log',
      'aria-labelledby': 'cora-access-log-title',
    },
    h('h2', { id: 'cora-access-log-title' }, 'Access log'),
    body
  );
}
