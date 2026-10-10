// @ts-check
/**
 * New form, at `#/forms/new`: choose the Form Type, the Employee, their two
 * managers and the due date, then create the Form and open it.
 *
 * Creating is the one explicit write a Form has. Auto-save needs an item to
 * write to, so everything else is filled in on the Form itself once it exists.
 *
 * The managers are filled in from the directory, the Employee's manager and
 * then that manager's, and can be changed before creating. Both are written
 * twice: once as the current managers, which decide access, and once as the
 * Form's own record, which its editors may change until it closes.
 */

import { h } from '../../lib/html.js';
import { navigateTo } from '../../lib/navigate.js';
import { isDateKey } from '../../lib/local-calendar.js';
import { EmptyState } from '../../lib/empty-state.js';
import { createDebouncedPeopleSearch } from '../../lib/people-search.js';
import { patchRoute } from '../../core/route-state.js';
import { getCaptureFieldType } from '../../capture-fields/registry.js';
import { canCreateForms } from '../../services/form-access.js';
import { INITIAL_FORM_STATUS } from '../../../form-types/contract.js';
import { formRouteFor } from './forms-model.js';
import { reducePeopleSearches } from './people-search-state.js';

/** @typedef {import('../../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../../core/chrome-state.js').ChromeState} ChromeState */
/** @typedef {import('./people-search-state.js').PeopleSearches} PeopleSearches */
/** @typedef {import('../../../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */

/** @typedef {{ loginName: string, displayName: string }} Person */

/**
 * The people New form asks for, by the key each picker's search is held under.
 *
 * @typedef {'employee' | 'firstLineManager' | 'secondLineManager'} NewFormPerson
 */

/**
 * @typedef {Object} NewFormRoute
 * @property {readonly FormTypeDefinition[]} formTypes
 * @property {string} formType The chosen Form Type's slug.
 * @property {Record<NewFormPerson, Person | null>} people
 * @property {Partial<Record<NewFormPerson, string>>} filledFrom Whose
 *   directory profile a prefilled manager came from.
 * @property {string} dueDate
 * @property {PeopleSearches} peopleSearch
 * @property {number} prefill The latest directory lookup; an older answer is
 *   dropped.
 * @property {boolean} creating
 * @property {string | null} error
 */

/** @typedef {{ chrome: ChromeState, routes: { newForm: NewFormRoute } }} NewFormState */

/** @type {ReadonlyArray<{ key: NewFormPerson, label: string }>} */
const PEOPLE = Object.freeze([
  { key: 'employee', label: 'Employee' },
  { key: 'firstLineManager', label: 'First line manager' },
  { key: 'secondLineManager', label: 'Second line manager' },
]);

/**
 * The columns a new Form is created with. The chosen managers go into both
 * pairs: the current managers, which grant access, and the Form's own record.
 *
 * @param {Record<NewFormPerson, Person | null>} people
 * @param {string} dueDate
 * @returns {Record<string, import('../../sharepoint-client.js').FormValue>}
 */
export function newFormFields(people, dueDate) {
  return {
    Employee: people.employee,
    CurrentFirstLineManager: people.firstLineManager,
    CurrentSecondLineManager: people.secondLineManager,
    FirstLineManager: people.firstLineManager,
    SecondLineManager: people.secondLineManager,
    Status: INITIAL_FORM_STATUS,
    DueDate: dueDate,
  };
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../../setup/register-routes.js').AppContext} context
 */
export function createNewFormSlice(_params, context) {
  const formTypes = context.formTypes ?? [];

  let isActive = () => false;
  /** @type {(action: any) => any} */
  let dispatch = () => {};
  let lastPrefill = 0;

  const peopleSearch = createDebouncedPeopleSearch({
    client: context.client,
    isActive: () => isActive(),
    onState: (key, search) =>
      dispatch({ type: 'forms/person-results', key, search }),
  });

  /** @type {NewFormState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      newForm: {
        formTypes,
        formType: formTypes[0]?.slug ?? '',
        people: {
          employee: null,
          firstLineManager: null,
          secondLineManager: null,
        },
        filledFrom: {},
        dueDate: '',
        peopleSearch: {},
        prefill: 0,
        creating: false,
        error: null,
      },
    },
  };

  /**
   * Look up the Employee's manager, then that manager's, and their names.
   *
   * @param {Person} employee
   */
  async function prefillManagers(employee) {
    // An Employee can only have been picked from the directory, so the client
    // that answered that search is here.
    const client = /** @type {SharePointClient} */ (context.client);
    const request = ++lastPrefill;
    dispatch({ type: 'new-form/employee-chosen', employee, request });
    /** @type {Record<string, Person | null>} */
    let found = { firstLineManager: null, secondLineManager: null };
    try {
      const first =
        (await client.resolveManagers([employee.loginName]))[
          employee.loginName
        ] ?? null;
      const second = first
        ? ((await client.resolveManagers([first]))[first] ?? null)
        : null;
      const accounts = [first, second].filter((account) => account !== null);
      const names = accounts.length ? await client.resolveUsers(accounts) : {};
      /** @param {string | null} account */
      const person = (account) =>
        account
          ? { loginName: account, displayName: names[account] ?? account }
          : null;
      found = {
        firstLineManager: person(first),
        secondLineManager: person(second),
      };
    } catch {
      // A directory that cannot answer leaves both managers for the creator
      // to choose, which they could always do anyway.
    }
    if (isActive()) {
      dispatch({ type: 'new-form/managers-found', request, ...found });
    }
  }

  /** @param {NewFormRoute} route */
  function create(route) {
    if (!isReady(route)) return;
    // A ready Form has a picked Employee, so the client is here, and the
    // chosen type is always one of those offered.
    const client = /** @type {SharePointClient} */ (context.client);
    const formType = /** @type {FormTypeDefinition} */ (
      route.formTypes.find((type) => type.slug === route.formType)
    );
    dispatch({ type: 'new-form/create-started' });
    client
      .createFormItem(formType, newFormFields(route.people, route.dueDate))
      .then(
        (item) => {
          if (isActive()) navigateTo(formRouteFor(formType, item.id));
        },
        () => {
          if (isActive()) dispatch({ type: 'new-form/create-failed' });
        }
      );
  }

  return {
    initialState,
    reducer(/** @type {NewFormState} */ state, /** @type {any} */ action) {
      const route = state.routes.newForm;
      const searches = reducePeopleSearches(route.peopleSearch, action);
      if (searches) {
        return patchRoute(state, 'newForm', { peopleSearch: searches });
      }
      switch (action.type) {
        case 'new-form/type-chosen':
          return patchRoute(state, 'newForm', { formType: action.slug });
        case 'new-form/employee-chosen':
          return patchRoute(state, 'newForm', {
            people: {
              employee: action.employee,
              firstLineManager: null,
              secondLineManager: null,
            },
            filledFrom: {},
            prefill: action.request,
          });
        case 'new-form/managers-found': {
          if (action.request !== route.prefill) return state;
          const { firstLineManager, secondLineManager } = action;
          // A manager the creator chose while the lookup ran is theirs to keep.
          const first = route.people.firstLineManager ?? firstLineManager;
          const second = route.people.secondLineManager ?? secondLineManager;
          return patchRoute(state, 'newForm', {
            people: {
              ...route.people,
              firstLineManager: first,
              secondLineManager: second,
            },
            filledFrom: {
              ...(first && first === firstLineManager
                ? { firstLineManager: route.people.employee?.displayName }
                : {}),
              ...(second && second === secondLineManager && first
                ? { secondLineManager: first.displayName }
                : {}),
            },
          });
        }
        case 'new-form/person-chosen': {
          /** @type {NewFormPerson} */
          const key = action.key;
          const { [key]: _replaced, ...filledFrom } = route.filledFrom;
          return patchRoute(state, 'newForm', {
            people: { ...route.people, [key]: action.person },
            filledFrom,
          });
        }
        case 'new-form/due-date-changed':
          return patchRoute(state, 'newForm', { dueDate: action.dueDate });
        case 'new-form/create-started':
          return patchRoute(state, 'newForm', { creating: true, error: null });
        case 'new-form/create-failed':
          return patchRoute(state, 'newForm', {
            creating: false,
            error: 'The form could not be created. Try again shortly.',
          });
        default:
          return state;
      }
    },
    view(/** @type {NewFormState} */ state, /** @type {any} */ tools) {
      const route = state.routes.newForm;
      return newFormView(state, {
        dispatch: tools.dispatch,
        onPersonQuery: (key, query) => {
          tools.dispatch({ type: 'forms/person-query', key, query });
          peopleSearch.request(key, query);
        },
        onPerson: (key, person) => {
          peopleSearch.clear(key);
          tools.dispatch({ type: 'forms/person-cleared', key });
          if (key === 'employee' && person) {
            void prefillManagers(person);
          } else {
            tools.dispatch({ type: 'new-form/person-chosen', key, person });
          }
        },
        onCreate: () => create(route),
      });
    },
    start(/** @type {any} */ tools) {
      isActive = tools.isActive;
      dispatch = tools.dispatch;
      return () => peopleSearch.dispose();
    },
  };
}

/** @param {NewFormRoute} route */
function isReady(route) {
  return (
    route.people.employee !== null &&
    route.people.firstLineManager !== null &&
    isDateKey(route.dueDate) &&
    !route.creating
  );
}

/**
 * @typedef {Object} NewFormTools
 * @property {(action: any) => any} dispatch
 * @property {(key: string, query: string) => void} onPersonQuery
 * @property {(key: NewFormPerson, person: Person | null) => void} onPerson
 * @property {() => void} onCreate
 */

/**
 * @param {NewFormState} state
 * @param {NewFormTools} tools
 * @returns {HTMLElement}
 */
export function newFormView(state, tools) {
  const route = state.routes.newForm;
  const chosen = route.formTypes.find((type) => type.slug === route.formType);
  const intro = [
    h(
      'nav',
      { className: 'cora-form-breadcrumbs', 'aria-label': 'Breadcrumb' },
      h('a', { href: '#/forms' }, 'Forms'),
      ' › New form'
    ),
    h('h1', {}, 'New form'),
  ];
  if (!canCreateForms(state.chrome.permissions) || !chosen) {
    return h(
      'div',
      { className: 'cora-form-page cora-form-page--narrow' },
      ...intro,
      EmptyState(
        chosen ? 'You can’t start a form.' : 'There are no forms to start yet.'
      )
    );
  }
  return h(
    'div',
    { className: 'cora-form-page cora-form-page--narrow' },
    ...intro,
    h(
      'p',
      { className: 'cora-form-description' },
      'Choose who it’s for. You can fill in the rest once it’s created.'
    ),
    h(
      'section',
      { className: 'cora-form-panel cora-form-new', 'aria-label': 'New form' },
      formTypeChoice(route, tools),
      ...PEOPLE.map(({ key, label }) => personField(route, key, label, tools)),
      h(
        'label',
        { className: 'cora-form-control-group' },
        h('span', { className: 'cora-form-label' }, 'Due date'),
        h('input', {
          className: 'cora-capture-input',
          type: 'date',
          value: route.dueDate,
          onchange: (/** @type {any} */ event) =>
            tools.dispatch({
              type: 'new-form/due-date-changed',
              dueDate: event.target.value,
            }),
        })
      ),
      h('p', { className: 'cora-form-audience' }, audience(route)),
      route.error
        ? h('p', { className: 'cora-forms-error', role: 'alert' }, route.error)
        : null,
      h(
        'div',
        { className: 'cora-form-footer-buttons' },
        h(
          'button',
          {
            type: 'button',
            disabled: !isReady(route),
            onclick: () => tools.onCreate(),
          },
          route.creating ? 'Creating…' : `Create ${chosen.formName}`
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'cora-btn-secondary',
            disabled: route.creating,
            onclick: () => navigateTo('#/forms'),
          },
          'Cancel'
        )
      )
    )
  );
}

/**
 * @param {NewFormRoute} route
 * @param {NewFormTools} tools
 */
function formTypeChoice(route, tools) {
  return h(
    'fieldset',
    { className: 'cora-form-control-group' },
    h('legend', { className: 'cora-form-label' }, 'Form type'),
    h(
      'div',
      { className: 'cora-capture-radio-group' },
      ...route.formTypes.map((formType) =>
        h(
          'label',
          { className: 'cora-capture-radio' },
          h('input', {
            type: 'radio',
            name: 'new-form-type',
            value: formType.slug,
            checked: formType.slug === route.formType,
            onchange: () =>
              tools.dispatch({
                type: 'new-form/type-chosen',
                slug: formType.slug,
              }),
          }),
          h('span', {}, formType.formName)
        )
      )
    )
  );
}

/**
 * A person, picked from the directory with the same control a Form's own
 * person fields use.
 *
 * @param {NewFormRoute} route
 * @param {NewFormPerson} key
 * @param {string} label
 * @param {NewFormTools} tools
 */
function personField(route, key, label, tools) {
  const control =
    /** @type {NonNullable<ReturnType<typeof getCaptureFieldType>>} */ (
      getCaptureFieldType('person')
    ).editControl({
      field: { key, label, type: 'person' },
      value: route.people[key],
      namePrefix: 'new-form-',
      onCapture: (_key, value) =>
        tools.onPerson(key, /** @type {Person | null} */ (value)),
      peopleSearch: route.peopleSearch,
      onPersonQuery: tools.onPersonQuery,
    });
  const from = route.filledFrom[key];
  return h(
    'div',
    { className: 'cora-form-control-group' },
    h('span', { className: 'cora-form-label' }, label),
    control,
    from
      ? h(
          'span',
          { className: 'cora-form-hint' },
          `Filled in from ${from}’s profile`
        )
      : null
  );
}

/**
 * Who will be able to see the Form, said before it exists.
 *
 * @param {NewFormRoute} route
 */
function audience(route) {
  const names = PEOPLE.map(({ key }) => route.people[key]?.displayName).filter(
    (name) => typeof name === 'string'
  );
  if (!route.people.employee) {
    return 'Only the employee, their current managers and the Forms control group will be able to see this form.';
  }
  return `Only ${names.join(', ')} and the Forms control group will be able to see this form.`;
}
