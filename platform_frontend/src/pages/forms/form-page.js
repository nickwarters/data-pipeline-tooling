// @ts-check
/**
 * One Form, at `#/forms/<slug>/<id>`: read once, drawn by the Form Type's
 * definition in edit, view or locked mode, saved as it is edited, and closed by
 * its lifecycle buttons.
 *
 * The save queue exists only for a viewer who may edit the Form when it is
 * read. Someone who may only read it never has one, so nothing they do can
 * reach a write.
 */

import { h } from '../../lib/html.js';
import { navigateTo } from '../../lib/navigate.js';
import { formatDate } from '../../lib/format-datetime.js';
import { toLocalDateKey } from '../../lib/local-calendar.js';
import { EmptyState, LoadingState } from '../../lib/empty-state.js';
import { isAbortError } from '../../lib/abort.js';
import { createDebouncedPeopleSearch } from '../../lib/people-search.js';
import { patchRoute } from '../../core/route-state.js';
import { StatusBanner } from '../../components/base/cora-status-banner.js';
import { withAbortSignal } from '../../services/abortable-client.js';
import { SaveQueue } from '../../services/save-queue.js';
import { formSaveTarget } from '../../services/form-save-target.js';
import { formAccess } from '../../services/form-access.js';
import {
  FORM_FIELD_STORAGE,
  FORM_TITLE_FIELD,
  FORM_TITLE_MAX_LENGTH,
  OTHER_VOID_REASON,
  VOID_FORM_STATUS,
  formFields,
  voidReasonChoices,
} from '../../../form-types/contract.js';
import {
  closedVerb,
  formMode,
  formSectionsView,
} from './form-sections-view.js';
import { formStatusBadge } from './form-cells.js';
import { formTitle } from './forms-model.js';
import { reducePeopleSearches } from './people-search-state.js';

/** @typedef {import('../../sharepoint-client.js').FormItem} FormItem */
/** @typedef {import('../../sharepoint-client.js').FormValue} FormValue */
/** @typedef {import('../../sharepoint-client.js').FormAction} FormAction */
/** @typedef {import('../../services/save-queue.js').SaveStatus} SaveStatus */
/** @typedef {import('../../services/form-access.js').FormAccess} FormAccess */
/** @typedef {import('../../core/chrome-state.js').ChromeState} ChromeState */
/** @typedef {import('./people-search-state.js').PeopleSearches} PeopleSearches */
/** @typedef {import('../../../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */
/** @typedef {import('../../../form-types/contract.js').FormFieldType} FormFieldType */
/** @typedef {import('../../../form-types/contract.js').FormField} FormField */

/**
 * @typedef {Object} FormPageRoute
 * @property {FormTypeDefinition | null} formType `null` when no Form Type has the slug.
 * @property {string} id
 * @property {string} today `YYYY-MM-DD`, the viewer's calendar day.
 * @property {'loading' | 'loaded' | 'missing' | 'failed'} load
 * @property {FormItem | null} item
 * @property {SaveStatus} saveStatus
 * @property {string | null} lastSavedAt
 * @property {PeopleSearches} peopleSearch
 * @property {string | null} confirming The closing Status awaiting confirmation.
 * @property {VoidReasonDraft} voidReason What the voider has picked and typed
 *   so far, while a Void awaits confirmation.
 * @property {boolean} closing
 * @property {string | null} closeError
 * @property {number | null} removingAction The Form Action whose removal
 *   awaits a yes.
 */

/**
 * @typedef {Object} VoidReasonDraft
 * @property {string} reason The Void Reason picked, or empty.
 * @property {string} note The voider's own words, asked for when the reason is `Other`.
 */

/** @typedef {{ chrome: ChromeState, routes: { form: FormPageRoute } }} FormPageState */

/** @type {VoidReasonDraft} */
const NO_VOID_REASON = Object.freeze({ reason: '', note: '' });

/**
 * What each lifecycle button is called and what it asks before it closes the
 * Form, by the Status it closes the Form with. They sit in this order, the
 * one that finishes the Form last and most prominent.
 *
 * @type {Readonly<Record<string, { label: string, ask: (formName: string) => string, primary?: boolean }>>}
 */
const CLOSING_BUTTONS = Object.freeze({
  Void: {
    label: 'Void form',
    ask: (formName) => `Void this ${formName}?`,
  },
  Cancelled: {
    label: 'Cancel form',
    ask: (formName) => `Cancel this ${formName}?`,
  },
  Completed: {
    label: 'Mark complete',
    ask: (formName) => `Mark this ${formName} complete?`,
    primary: true,
  },
});

const CONFLICT_MESSAGE =
  'This form was changed by someone else while you had it open. Reload to see their changes.';

/**
 * The columns a lifecycle button writes: the closing Status, and the day and
 * the person that closed the Form, which the archive and the locked page read.
 * A Void also records its reason, and the voider's own words only when that
 * reason is `Other`.
 *
 * @param {string} status
 * @param {{ loginName: string, displayName: string }} me
 * @param {string} today
 * @param {VoidReasonDraft} [voidReason]
 * @returns {Record<string, FormValue>}
 */
export function closingFields(status, me, today, voidReason = NO_VOID_REASON) {
  const fields = { Status: status, ClosedDate: today, ClosedBy: me };
  if (status !== VOID_FORM_STATUS) return fields;
  const other = voidReason.reason === OTHER_VOID_REASON;
  return {
    ...fields,
    VoidReason: voidReason.reason,
    VoidReasonNote: other ? voidReason.note.trim() : null,
  };
}

/**
 * Whether the Void Reason picked so far is enough to void the Form: a reason
 * from the Form Type's list, and words to go with `Other`.
 *
 * @param {FormTypeDefinition} formType
 * @param {VoidReasonDraft} draft
 */
function isVoidReasonComplete(formType, draft) {
  if (!voidReasonChoices(formType).includes(draft.reason)) return false;
  return draft.reason !== OTHER_VOID_REASON || draft.note.trim() !== '';
}

/**
 * @param {Record<string, string>} params
 * @param {import('../../setup/register-routes.js').AppContext} context
 * @param {{ now?: () => Date }} [dependencies]
 */
export function createFormPageSlice(
  params,
  context,
  { now = () => new Date() } = {}
) {
  const formType =
    (context.formTypes ?? []).find((type) => type.slug === params.slug) ?? null;
  const id = params.id;
  const { currentUser } = context.chrome;

  let isActive = () => false;
  /** @type {(action: any) => any} */
  let dispatch = () => {};
  /** @type {SaveQueue | null} */
  let queue = null;

  const peopleSearch = createDebouncedPeopleSearch({
    client: context.client,
    isActive: () => isActive(),
    onState: (key, search) =>
      dispatch({ type: 'forms/person-results', key, search }),
  });

  /** @type {FormPageState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      form: {
        formType,
        id,
        today: /** @type {string} */ (toLocalDateKey(now())),
        load: 'loading',
        item: null,
        saveStatus: 'saved',
        lastSavedAt: null,
        peopleSearch: {},
        confirming: null,
        voidReason: NO_VOID_REASON,
        closing: false,
        closeError: null,
        removingAction: null,
      },
    },
  };

  /**
   * Save one field. An emptied plain column is stored as nothing rather than
   * as empty text, so a cleared date or choice reads back as cleared.
   *
   * @param {string} itemField
   * @param {FormValue} value
   * @param {FormFieldType} type
   */
  function editField(itemField, value, type) {
    // Only an editor is offered a control, and the queue is built for them.
    const writing = /** @type {SaveQueue} */ (queue);
    const stored =
      value === '' && FORM_FIELD_STORAGE[type] === 'plain' ? null : value;
    dispatch({ type: 'form/field-edited', itemField, value: stored });
    if (type === 'person') {
      peopleSearch.clear(itemField);
      dispatch({ type: 'forms/person-cleared', key: itemField });
    }
    writing.enqueue(id, itemField, stored);
  }

  /**
   * Save the Form Actions. They are one column, so every change writes the
   * whole list.
   *
   * @param {string} itemField
   * @param {FormAction[]} actions
   */
  function editActions(itemField, actions) {
    const writing = /** @type {SaveQueue} */ (queue);
    dispatch({ type: 'form/field-edited', itemField, value: actions });
    writing.enqueue(id, itemField, actions);
  }

  /**
   * Close the Form: write what is still waiting, then the closing columns, on
   * the button press rather than the debounce.
   *
   * @param {FormPageRoute} route
   * @param {string} status
   */
  async function close(route, status) {
    const writing = /** @type {SaveQueue} */ (queue);
    dispatch({ type: 'form/close-started' });
    const fields = closingFields(
      status,
      { loginName: currentUser.id, displayName: currentUser.displayName },
      route.today,
      route.voidReason
    );
    writing.enqueueFields(id, fields);
    const saved = await writing.flushCase(id);
    if (!isActive()) return;
    dispatch(
      saved ? { type: 'form/closed', fields } : { type: 'form/close-failed' }
    );
  }

  return {
    initialState,
    reducer(/** @type {FormPageState} */ state, /** @type {any} */ action) {
      const route = state.routes.form;
      const searches = reducePeopleSearches(route.peopleSearch, action);
      if (searches) {
        return patchRoute(state, 'form', { peopleSearch: searches });
      }
      switch (action.type) {
        case 'form/loaded':
          return patchRoute(state, 'form', {
            load: 'loaded',
            item: action.item,
          });
        case 'form/load-ended':
          return patchRoute(state, 'form', { load: action.load });
        case 'form/field-edited':
          return patchRoute(state, 'form', {
            item: withFields(/** @type {FormItem} */ (route.item), {
              [action.itemField]: action.value,
            }),
            // A removal asked about before the list changed would point at
            // whichever Action has since moved into its place.
            removingAction: null,
          });
        case 'form/action-remove-asked':
          return patchRoute(state, 'form', { removingAction: action.index });
        case 'form/action-remove-withdrawn':
          return patchRoute(state, 'form', { removingAction: null });
        case 'form/save-status-changed': {
          const lastSavedAt = action.lastSavedAt ?? route.lastSavedAt;
          if (
            action.status === route.saveStatus &&
            lastSavedAt === route.lastSavedAt
          ) {
            return state;
          }
          return patchRoute(state, 'form', {
            saveStatus: action.status,
            lastSavedAt,
          });
        }
        case 'form/close-requested':
          return patchRoute(state, 'form', {
            confirming: action.status,
            voidReason: NO_VOID_REASON,
            closeError: null,
          });
        case 'form/void-reason-edited':
          return patchRoute(state, 'form', {
            voidReason: { ...route.voidReason, ...action.draft },
          });
        case 'form/close-withdrawn':
          return patchRoute(state, 'form', {
            confirming: null,
            voidReason: NO_VOID_REASON,
          });
        case 'form/close-started':
          return patchRoute(state, 'form', { closing: true });
        case 'form/closed':
          return patchRoute(state, 'form', {
            item: withFields(
              /** @type {FormItem} */ (route.item),
              action.fields
            ),
            confirming: null,
            closing: false,
          });
        case 'form/close-failed':
          return patchRoute(state, 'form', {
            closing: false,
            closeError:
              'The form could not be closed. Reload it and try again.',
          });
        default:
          return state;
      }
    },
    view(/** @type {FormPageState} */ state, /** @type {any} */ tools) {
      const route = state.routes.form;
      return formPageView(state, {
        dispatch: tools.dispatch,
        onField: editField,
        onPersonQuery: (key, query) => {
          tools.dispatch({ type: 'forms/person-query', key, query });
          peopleSearch.request(key, query);
        },
        onActions: editActions,
        onClose: (status) => void close(route, status),
      });
    },
    start(/** @type {any} */ tools) {
      isActive = tools.isActive;
      dispatch = tools.dispatch;
      const client = tools.context.client;
      if (!formType || !client) {
        dispatch({ type: 'form/load-ended', load: 'missing' });
        return () => peopleSearch.dispose();
      }
      /** @type {() => void} */
      let stopObserving = () => {};
      withAbortSignal(client, tools.signal)
        .getFormItem(formType, id, { signal: tools.signal })
        .then((item) => {
          if (!isActive()) return;
          if (!item) {
            dispatch({ type: 'form/load-ended', load: 'missing' });
            return;
          }
          const access = formAccess(
            item,
            currentUser.id,
            context.chrome.permissions
          );
          // Built only for someone who may edit, and around the raw client:
          // a save must outlive the page that started it.
          if (formMode(access) === 'edit') {
            queue = new SaveQueue(client, {
              target: formSaveTarget(client, formType),
              now,
            });
            queue.loadCase(item);
            const writing = queue;
            stopObserving = writing.subscribeStatus((status) =>
              dispatch({
                type: 'form/save-status-changed',
                status,
                lastSavedAt: writing.lastSavedAt,
              })
            );
          }
          dispatch({ type: 'form/loaded', item });
        })
        .catch((error) => {
          if (!isAbortError(error) && isActive()) {
            dispatch({ type: 'form/load-ended', load: 'failed' });
          }
        });
      return () => {
        stopObserving();
        peopleSearch.dispose();
      };
    },
  };
}

/**
 * @param {FormItem} item
 * @param {Record<string, FormValue>} fields
 * @returns {FormItem}
 */
function withFields(item, fields) {
  return { ...item, fields: { ...item.fields, ...fields } };
}

/**
 * @typedef {Object} FormPageTools
 * @property {(action: any) => any} dispatch
 * @property {(itemField: string, value: FormValue, type: FormFieldType) => void} onField
 * @property {(key: string, query: string) => void} onPersonQuery
 * @property {(itemField: string, actions: FormAction[]) => void} onActions
 * @property {(status: string) => void} onClose
 */

/**
 * @param {FormPageState} state
 * @param {FormPageTools} tools
 * @returns {HTMLElement}
 */
export function formPageView(state, tools) {
  const route = state.routes.form;
  const { formType, item } = route;
  if (!formType) {
    return pageShell(null, [
      EmptyState('There is no form of this type.'),
      backToForms(),
    ]);
  }
  if (route.load === 'loading') {
    return pageShell(formType, [LoadingState('Loading form')]);
  }
  if (route.load === 'failed') {
    return pageShell(formType, [
      h(
        'p',
        { className: 'cora-form-error', role: 'alert' },
        'This form could not be loaded. Try again shortly.'
      ),
    ]);
  }
  if (route.load === 'missing' || !item) {
    return pageShell(formType, [
      EmptyState('This form could not be found.'),
      backToForms(),
    ]);
  }
  const { currentUser, permissions } = state.chrome;
  const access = formAccess(item, currentUser.id, permissions);
  if (!access.canRead) {
    return pageShell(formType, [
      EmptyState('You don’t have access to this form.'),
      backToForms(),
    ]);
  }
  const mode = formMode(access);
  const status = String(item.fields.Status ?? '');
  const title = formTitle(item);
  const formLabel = [formType.formName, personName(item.fields.Employee)]
    .filter(Boolean)
    .join(' · ');
  return h(
    'div',
    { className: 'cora-form-page' },
    breadcrumbs(formType, mode === 'locked'),
    h(
      'header',
      { className: 'cora-form-header' },
      h(
        'div',
        {},
        title ? h('p', { className: 'cora-form-kicker' }, formLabel) : null,
        h('h1', {}, title || formLabel),
        h('p', { className: 'cora-form-description' }, formType.description)
      ),
      h(
        'div',
        { className: 'cora-form-header-status' },
        status ? formStatusBadge(status) : null,
        mode === 'edit'
          ? StatusBanner({
              status: route.saveStatus,
              lastSavedAt: route.lastSavedAt,
              conflictMessage: CONFLICT_MESSAGE,
            })
          : null
      )
    ),
    mode === 'locked' ? lockedBanner(item) : null,
    mode === 'view' ? viewOnlyBanner(item, access) : null,
    access.canEditField({ itemField: FORM_TITLE_FIELD })
      ? titleField(item, tools)
      : null,
    ...formSectionsView(formType, item, {
      mode,
      access,
      me: currentUser.id,
      peopleSearch: route.peopleSearch,
      onField: (itemField, value) =>
        tools.onField(itemField, value, fieldType(formType, itemField)),
      onPersonQuery: tools.onPersonQuery,
      removingAction: route.removingAction,
      onActions: tools.onActions,
      onRemoveAction: (index) =>
        tools.dispatch({ type: 'form/action-remove-asked', index }),
      onRemoveWithdrawn: () =>
        tools.dispatch({ type: 'form/action-remove-withdrawn' }),
    }),
    mode === 'edit' ? footerView(route, formType, tools) : null
  );
}

/**
 * @param {FormTypeDefinition | null} formType
 * @param {Array<Node | null>} children
 */
function pageShell(formType, children) {
  return h(
    'div',
    { className: 'cora-form-page' },
    breadcrumbs(formType, false),
    h('h1', {}, formType ? formType.formName : 'Form'),
    ...children
  );
}

/**
 * @param {FormTypeDefinition | null} formType
 * @param {boolean} archived
 */
function breadcrumbs(formType, archived) {
  return h(
    'nav',
    { className: 'cora-form-breadcrumbs', 'aria-label': 'Breadcrumb' },
    h('a', { href: '#/forms' }, 'Forms'),
    archived ? ' › ' : null,
    archived ? h('a', { href: '#/forms?tab=archive' }, 'Archive') : null,
    formType ? ` › ${formType.formName}` : null
  );
}

function backToForms() {
  return h(
    'button',
    {
      type: 'button',
      className: 'cora-btn-secondary',
      onclick: () => navigateTo('#/forms'),
    },
    'Back to Forms'
  );
}

/** @param {FormItem} item */
function lockedBanner(item) {
  const status = String(item.fields.Status);
  const closed = item.fields.ClosedDate
    ? ` on ${formatDate(item.fields.ClosedDate)}`
    : '';
  return h(
    'div',
    { className: 'cora-form-banner cora-form-banner--locked', role: 'status' },
    h('strong', {}, `${closedVerb(status)}${closed}.`),
    ' This form is locked and can no longer be changed.',
    status === VOID_FORM_STATUS ? voidReasonLine(item) : null
  );
}

/**
 * Why a voided Form was voided: the reason picked, or the voider's own words
 * when they picked `Other`. A Form voided before reasons were asked for has
 * none, and says nothing.
 *
 * @param {FormItem} item
 */
function voidReasonLine(item) {
  const reason = String(item.fields.VoidReason ?? '');
  if (!reason) return null;
  const note = String(item.fields.VoidReasonNote ?? '').trim();
  const said = reason === OTHER_VOID_REASON && note ? note : reason;
  return h('p', { className: 'cora-form-banner-detail' }, `Reason: ${said}`);
}

/**
 * Why the viewer may read this Form but not change it.
 *
 * @param {FormItem} item
 * @param {FormAccess} access
 */
function viewOnlyBanner(item, access) {
  const why =
    access.role === 'secondLineManager'
      ? `You’re ${personName(item.fields.Employee)}’s second line manager`
      : 'You’re in the Forms control group';
  return h(
    'div',
    { className: 'cora-form-banner cora-form-banner--view', role: 'status' },
    `${why}, so you can read this form but not change it.`
  );
}

/**
 * The lifecycle buttons, or the question one of them is waiting on.
 *
 * @param {FormPageRoute} route
 * @param {FormTypeDefinition} formType
 * @param {FormPageTools} tools
 */
function footerView(route, formType, tools) {
  const pending = route.confirming
    ? { status: route.confirming, ...CLOSING_BUTTONS[route.confirming] }
    : null;
  return h(
    'footer',
    { className: 'cora-form-footer' },
    route.closeError
      ? h(
          'p',
          { className: 'cora-form-error', role: 'alert' },
          route.closeError
        )
      : null,
    pending
      ? h(
          'div',
          {
            className: 'cora-form-confirm',
            role: 'group',
            'aria-label': 'Confirm',
          },
          h(
            'p',
            {},
            h('strong', {}, pending.ask(formType.formName)),
            ' Nobody will be able to change it afterwards.'
          ),
          pending.status === VOID_FORM_STATUS
            ? voidReasonView(route, formType, tools)
            : null,
          h(
            'div',
            { className: 'cora-form-footer-buttons' },
            h(
              'button',
              {
                type: 'button',
                className: 'cora-btn-secondary',
                disabled: route.closing,
                onclick: () => tools.dispatch({ type: 'form/close-withdrawn' }),
              },
              'Keep editing'
            ),
            h(
              'button',
              {
                type: 'button',
                disabled:
                  route.closing ||
                  (pending.status === VOID_FORM_STATUS &&
                    !isVoidReasonComplete(formType, route.voidReason)),
                onclick: () => tools.onClose(pending.status),
              },
              route.closing ? 'Saving…' : `Yes, ${lowerFirst(pending.label)}`
            )
          )
        )
      : h(
          'div',
          { className: 'cora-form-footer-row' },
          h(
            'p',
            { className: 'cora-form-footer-note' },
            'Completing, voiding or cancelling locks the form for everyone.'
          ),
          h(
            'div',
            { className: 'cora-form-footer-buttons' },
            ...Object.entries(CLOSING_BUTTONS).map(([status, button]) =>
              h(
                'button',
                {
                  type: 'button',
                  className: button.primary ? '' : 'cora-btn-secondary',
                  onclick: () =>
                    tools.dispatch({ type: 'form/close-requested', status }),
                },
                button.label
              )
            )
          )
        )
  );
}

/**
 * The Form's title, for an editor while the Form is open. Everyone else reads
 * it as the page heading.
 *
 * @param {FormItem} item
 * @param {FormPageTools} tools
 */
function titleField(item, tools) {
  const stored = item.fields[FORM_TITLE_FIELD];
  return h(
    'label',
    { className: 'cora-form-control-group cora-form-title-field' },
    h('span', { className: 'cora-form-label' }, 'Title (optional)'),
    h('input', {
      className: 'cora-capture-input',
      type: 'text',
      value: typeof stored === 'string' ? stored : '',
      maxLength: FORM_TITLE_MAX_LENGTH,
      placeholder: 'e.g. Return to work after leave',
      onchange: (/** @type {Event} */ event) =>
        tools.onField(
          FORM_TITLE_FIELD,
          /** @type {HTMLInputElement} */ (event.target).value,
          'text'
        ),
    })
  );
}

/**
 * The Void Reason picker, and the box for the voider's own words once they
 * pick `Other`. Voiding waits until both say something.
 *
 * @param {FormPageRoute} route
 * @param {FormTypeDefinition} formType
 * @param {FormPageTools} tools
 */
function voidReasonView(route, formType, tools) {
  const { reason, note } = route.voidReason;
  /** @param {Partial<VoidReasonDraft>} draft */
  const edit = (draft) =>
    tools.dispatch({ type: 'form/void-reason-edited', draft });
  return h(
    'div',
    { className: 'cora-form-void-reason' },
    h(
      'label',
      { className: 'cora-form-control-group' },
      h('span', { className: 'cora-form-label' }, 'Reason for voiding'),
      h(
        'select',
        {
          className: 'cora-capture-input',
          required: true,
          value: reason,
          disabled: route.closing,
          onchange: (/** @type {Event} */ event) =>
            edit({
              reason: /** @type {HTMLSelectElement} */ (event.target).value,
            }),
        },
        h('option', { value: '' }, 'Choose a reason'),
        ...voidReasonChoices(formType).map((choice) =>
          h('option', { value: choice }, choice)
        )
      )
    ),
    reason === OTHER_VOID_REASON
      ? h(
          'label',
          { className: 'cora-form-control-group' },
          h('span', { className: 'cora-form-label' }, 'Describe the reason'),
          h('textarea', {
            className: 'cora-capture-input',
            required: true,
            rows: 3,
            value: note,
            disabled: route.closing,
            oninput: (/** @type {Event} */ event) =>
              edit({
                note: /** @type {HTMLTextAreaElement} */ (event.target).value,
              }),
          })
        )
      : null
  );
}

/**
 * @param {FormTypeDefinition} formType
 * @param {string} itemField
 * @returns {FormFieldType}
 */
function fieldType(formType, itemField) {
  // Only a field the definition declares is drawn with a control.
  return /** @type {FormField} */ (
    formFields(formType).find((field) => field.itemField === itemField)
  ).type;
}

/** @param {unknown} person */
function personName(person) {
  return (
    /** @type {{ displayName?: string } | null} */ (person)?.displayName ?? ''
  );
}

/** @param {string} text */
function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
