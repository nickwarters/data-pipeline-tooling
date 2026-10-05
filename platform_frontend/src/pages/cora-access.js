// @ts-check
import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { isAbortError } from '../lib/abort.js';
import { navigateTo } from '../lib/navigate.js';
import { createDebouncedPeopleSearch } from '../lib/people-search.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { runAccessChange } from '../services/access-change.js';
import {
  allRoles,
  describeChange,
  holderGroup,
} from '../services/access-roles.js';
import { permissions } from '../services/permissions.js';
import {
  accessLogView,
  accessNoticeView,
  accessRouteFor,
  holderKey,
  holdersView,
  personPickerView,
  personRolesView,
} from './access/access-views.js';
import {
  EMPTY_CHANGE_FORM,
  changeFormView,
  formRole,
} from './access/change-form.js';

/** @typedef {import('../sharepoint-client.js').AccessLogEntry} AccessLogEntry */
/** @typedef {import('../lib/people-search.js').PeopleSearchState} PeopleSearchState */
/** @typedef {import('./access/access-views.js').HolderRead} HolderRead */
/** @typedef {import('./access/change-form.js').ChangeForm} ChangeForm */
/** @typedef {import('../services/access-roles.js').CaseTypeRef} CaseTypeRef */

/** The page has one people picker, so its debounce holds one entry. */
const PERSON_SEARCH_KEY = 'person';

/**
 * @typedef {Object} AccessRouteState
 * @property {PeopleSearchState} personSearch
 * @property {CaseTypeRef[]} caseTypes
 * @property {string | null} account The bare login the route names; null for the page with nobody chosen.
 * @property {string} personName Their display name, the account until it is read.
 * @property {string[] | undefined} groups
 * @property {string | null} groupsError
 * @property {AccessLogEntry[] | undefined} log
 * @property {string | null} logError
 * @property {Record<string, HolderRead>} holders
 * @property {ChangeForm} form
 * @property {string | null} notice
 */

/**
 * @typedef {Object} AccessState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ access: AccessRouteState }} routes
 */

/**
 * @typedef {{ submit: (form: ChangeForm, personName: string) => void }} AccessActions
 */

/**
 * @typedef {{
 *   dispatch: (action: any) => any,
 *   onPersonQuery?: (query: string) => void,
 *   onPersonSelected?: (person: { loginName: string, displayName: string }) => void,
 *   accessActions?: AccessActions,
 * }} ViewTools
 */

/**
 * @param {AccessState} state
 * @param {ViewTools} tools
 * @returns {HTMLElement}
 */
export function accessView(state, tools) {
  const route = state.routes.access;
  const { caseTypes, account, form } = route;
  /** @param {string} type @param {Record<string, unknown>} fields */
  const send = (type, fields = {}) => tools.dispatch({ type, ...fields });
  /** @param {'grant' | 'revoke'} action @param {import('../services/access-roles.js').RoleRef} role */
  const openForm = (action, role) =>
    send('access/form-opened', {
      action,
      role: role.id,
      caseType: role.caseType ?? '',
    });
  return h(
    'div',
    { className: 'cora-access' },
    h('h1', {}, 'Access'),
    accessNoticeView(),
    personPickerView(route.personSearch, {
      onQuery: (query) => {
        send('access/person-query', { query });
        tools.onPersonQuery?.(query);
      },
      onSelect: (person) => tools.onPersonSelected?.(person),
    }),
    account !== null &&
      personRolesView(
        {
          personName: route.personName,
          account,
          groups: route.groups,
          groupsError: route.groupsError,
        },
        {
          caseTypes,
          onComplete: (role) => openForm('grant', role),
          onRemove: (role) => openForm('revoke', role),
        }
      ),
    account !== null &&
      route.notice !== null &&
      h('p', { className: 'cora-access-notice', role: 'status' }, route.notice),
    account !== null &&
      route.groups !== undefined &&
      changeFormView(
        form,
        { personName: route.personName, groups: route.groups, caseTypes },
        {
          onRole: (role) => send('access/form-role', { role }),
          onCaseType: (caseType) => send('access/form-case-type', { caseType }),
          onReason: (reason) => send('access/form-reason', { reason }),
          onSubmit: () =>
            tools.accessActions?.submit(route.form, route.personName),
          onCancel: () => send('access/form-closed'),
        }
      ),
    account !== null && accessLogView(route, caseTypes),
    holdersView(route.holders, caseTypes)
  );
}

/**
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @returns {{
 *   initialState: AccessState,
 *   reducer: (state: AccessState, action: any) => AccessState,
 *   view: (state: AccessState, tools: any) => HTMLElement,
 *   start: (tools: any) => (() => void),
 * }}
 */
export function createRouteSlice(params, context) {
  const account = params.account ? params.account : null;
  // The registry is read live, so a Case Type registered after boot still has its roles.
  const caseTypes = permissions.caseTypes;

  // Both are the store's, which does not exist yet; start() swaps the real ones in.
  let isSliceActive = () => false;
  /** @type {(action: any) => any} */
  let dispatch = () => {};
  /** @type {AccessActions | null} */
  let accessActions = null;

  const peopleSearch = createDebouncedPeopleSearch({
    client: context.client,
    isActive: () => isSliceActive(),
    onState: (_key, search) =>
      dispatch({ type: 'access/person-results', search }),
  });

  /** @type {AccessState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      access: {
        personSearch: { query: '', people: [], status: 'idle' },
        caseTypes,
        account,
        personName: account ?? '',
        groups: undefined,
        groupsError: null,
        log: undefined,
        logError: null,
        holders: {},
        form: EMPTY_CHANGE_FORM,
        notice: null,
      },
    },
  };

  return {
    initialState,
    reducer(state, action) {
      const route = state.routes.access;
      switch (action.type) {
        case 'access/person-query':
          // Prior matches stay selectable until the next search starts, so the list does not flicker.
          return patchRoute(state, 'access', {
            personSearch: {
              query: action.query,
              people: action.query.trim() ? route.personSearch.people : [],
              status: 'idle',
            },
          });
        case 'access/person-results':
          // An outcome for a query the user has typed past would latch matches for a name no longer in the box.
          if (route.personSearch.query !== action.search.query) return state;
          return patchRoute(state, 'access', { personSearch: action.search });
        case 'access/name-loaded':
          return patchRoute(state, 'access', {
            personName: action.displayName,
          });
        case 'access/groups-loaded':
          return patchRoute(state, 'access', {
            groups: action.groups,
            groupsError: null,
          });
        case 'access/groups-failed':
          return patchRoute(state, 'access', { groupsError: action.message });
        case 'access/log-loaded':
          return patchRoute(state, 'access', {
            log: action.entries,
            logError: null,
          });
        case 'access/log-failed':
          return patchRoute(state, 'access', { logError: action.message });
        case 'access/holders-read':
          return patchRoute(state, 'access', {
            holders: { ...route.holders, [action.key]: action.read },
          });
        case 'access/form-opened':
          return patchRoute(state, 'access', {
            form: {
              ...EMPTY_CHANGE_FORM,
              action: action.action,
              role: action.role,
              caseType: action.caseType,
              fixed: true,
            },
            notice: null,
          });
        case 'access/form-closed':
          return patchRoute(state, 'access', { form: EMPTY_CHANGE_FORM });
        case 'access/form-role':
          return patchRoute(state, 'access', {
            form: { ...route.form, role: action.role, caseType: '' },
          });
        case 'access/form-case-type':
          return patchRoute(state, 'access', {
            form: { ...route.form, caseType: action.caseType },
          });
        case 'access/form-reason':
          return patchRoute(state, 'access', {
            form: { ...route.form, reason: action.reason },
          });
        case 'access/change-saving':
          return patchRoute(state, 'access', {
            form: { ...route.form, saving: true, error: null },
            notice: null,
          });
        case 'access/change-failed':
          return patchRoute(state, 'access', {
            form: { ...route.form, saving: false, error: action.message },
          });
        case 'access/changed':
          return patchRoute(state, 'access', {
            form: EMPTY_CHANGE_FORM,
            notice: action.notice,
          });
        default:
          return state;
      }
    },
    view: (state, tools) =>
      accessView(state, {
        ...tools,
        accessActions: accessActions ?? undefined,
        onPersonQuery: (query) =>
          peopleSearch.request(PERSON_SEARCH_KEY, query),
        onPersonSelected: (person) => {
          peopleSearch.clear(PERSON_SEARCH_KEY);
          navigateTo(accessRouteFor(person.loginName));
        },
      }),
    start(tools) {
      isSliceActive = tools.isActive;
      dispatch = tools.dispatch;
      const cleanup = () => peopleSearch.dispose();

      const client = tools.context.client;
      if (!client) return cleanup;
      const readClient = withAbortSignal(client, tools.signal);

      /**
       * @param {unknown} error
       * @param {string} type
       * @param {string} prefix
       */
      const fail = (error, type, prefix) => {
        if (isAbortError(error) || !tools.isActive()) return;
        tools.dispatch({ type, message: `${prefix} ${error}` });
      };

      const loadHolders = () => {
        for (const role of allRoles(caseTypes)) {
          const group = /** @type {string} */ (holderGroup(role, caseTypes));
          void readClient.listGroupMembers(group).then(
            (members) => {
              if (tools.isActive()) {
                tools.dispatch({
                  type: 'access/holders-read',
                  key: holderKey(role),
                  read: { members },
                });
              }
            },
            (error) => {
              if (isAbortError(error) || !tools.isActive()) return;
              tools.dispatch({
                type: 'access/holders-read',
                key: holderKey(role),
                read: { error: `could not be read. ${error}` },
              });
            }
          );
        }
      };
      loadHolders();
      // With nobody chosen there is nothing more to read, and nothing to change.
      if (account === null) return cleanup;
      const person = account;

      const loadGroups = () =>
        void readClient.listUserGroups(person).then(
          (groups) => {
            if (tools.isActive()) {
              tools.dispatch({ type: 'access/groups-loaded', groups });
            }
          },
          (error) =>
            fail(
              error,
              'access/groups-failed',
              'Their roles could not be read.'
            )
        );
      const loadLog = () =>
        void readClient.listAccessLog({ account: person }).then(
          (entries) => {
            if (tools.isActive()) {
              tools.dispatch({ type: 'access/log-loaded', entries });
            }
          },
          (error) =>
            fail(
              error,
              'access/log-failed',
              'The access log could not be loaded.'
            )
        );
      void readClient.resolveUsers([person]).then(
        (names) => {
          const displayName = names[person];
          if (displayName && tools.isActive()) {
            tools.dispatch({ type: 'access/name-loaded', displayName });
          }
        },
        // A name that cannot be read leaves the account standing in for it.
        () => {}
      );
      loadGroups();
      loadLog();

      accessActions = {
        submit(form, personName) {
          const role = formRole(form);
          if (!role) return;
          tools.dispatch({ type: 'access/change-saving' });
          const done = describeChange(
            form.action,
            role,
            personName,
            caseTypes
          ).past;
          // The raw client: a change already under way must finish, even if the page is left.
          runAccessChange(
            client,
            {
              action: form.action,
              role,
              account: person,
              targetName: personName,
              reason: form.reason.trim(),
            },
            caseTypes
          )
            .then((result) => {
              if (!tools.isActive()) return;
              tools.dispatch(
                result.ok
                  ? { type: 'access/changed', notice: `${done}.` }
                  : { type: 'access/change-failed', message: result.message }
              );
            })
            .catch((error) => {
              if (!tools.isActive()) return;
              tools.dispatch({
                type: 'access/change-failed',
                message: `Nothing more was done. ${error}`,
              });
            })
            .finally(() => {
              loadGroups();
              loadLog();
              loadHolders();
            });
        },
      };
      return cleanup;
    },
  };
}
