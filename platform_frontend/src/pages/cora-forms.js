// @ts-check
/**
 * The Forms area (`#/forms`): HR Forms across every Form Type, on two tabs.
 * Outstanding (the default) lists the open Forms a person is on, with an "As
 * employee" and an "As manager" lane above the table; the Forms control group
 * can switch it to every open Form. Archive (`#/forms?tab=archive`) lists the
 * closed ones inside a closed-date window.
 *
 * The page reads each Form Type's list and merges the results. What a row may
 * show, and whether its button opens or only views the Form, is decided by
 * `form-access.js` for each Form; the reads narrow on the server only to keep
 * them small.
 */

import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { isAbortError } from '../lib/abort.js';
import { navigateTo } from '../lib/navigate.js';
import { toLocalDateKey } from '../lib/local-calendar.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { canCreateForms } from '../services/form-access.js';
import { reduceTableSort } from '../views/data-table.js';
import { archiveWindow } from './forms/forms-model.js';
import {
  OUTSTANDING_TABLE,
  outstandingView,
} from './forms/outstanding-view.js';
import { ARCHIVE_TABLE, archiveView } from './forms/archive-view.js';

/** @typedef {import('../../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').ListFormItemsOptions} ListFormItemsOptions */
/** @typedef {import('./forms/forms-model.js').LoadedForms} LoadedForms */
/** @typedef {import('./forms/forms-model.js').ArchiveWindow} ArchiveWindow */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */

/**
 * How many Forms of each type one page of "All open forms" reads. Every open
 * Form is far more than one person needs at once, and a read without a limit
 * would walk the whole list.
 */
const ALL_FORMS_PAGE = 100;

/** How many closed Forms of each type one page of the archive reads. */
const ARCHIVE_PAGE = 50;

/** Where the new-form flow starts. */
const NEW_FORM_HREF = '#/forms/new';

/** The two tabs, in order, and the hash each lives at. */
const TABS = /** @type {const} */ ([
  { id: 'outstanding', label: 'Outstanding', href: '#/forms' },
  { id: 'archive', label: 'Archive', href: '#/forms?tab=archive' },
]);

/**
 * The Forms one kind of read has returned so far. `request` names the read in
 * flight, so a reply to one the viewer has since replaced, by changing the
 * archive's dates say, is dropped rather than shown.
 *
 * @typedef {{
 *   status: 'idle' | 'loading' | 'loaded' | 'failed',
 *   loaded: LoadedForms[],
 *   next: Record<string, string | null>,
 *   request: number
 * }} FormsRead
 *
 * @typedef {'mine' | 'all' | 'archive'} FormsReadName
 *
 * @typedef {{
 *   tab: 'outstanding' | 'archive',
 *   formTypes: readonly FormTypeDefinition[],
 *   today: string,
 *   mine: FormsRead,
 *   all: FormsRead,
 *   archive: FormsRead & { window: ArchiveWindow },
 *   scope: 'mine' | 'all',
 *   filters: { text: string, formType: string, role: string },
 *   archiveFilters: { text: string, formType: string, status: string },
 *   sort: TableSort | null,
 *   archiveSort: TableSort | null,
 *   openLanes: Set<string>,
 * }} FormsRoute
 *
 * @typedef {Object} FormsState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ forms: FormsRoute }} routes
 *
 * @typedef {{
 *   dispatch: (action: any) => any,
 *   onScopeChanged: (scope: 'mine' | 'all') => void,
 *   onLoadMore: (read: 'all' | 'archive') => void,
 *   onWindowChanged: (end: 'from' | 'to', value: string) => void,
 * }} FormsViewTools
 */

/** @returns {FormsRead} */
const unread = () => ({ status: 'idle', loaded: [], next: {}, request: 0 });

/**
 * @param {FormsState} state
 * @param {FormsViewTools} tools
 */
export function formsView(state, tools) {
  const route = state.routes.forms;
  const selected = TABS.find((tab) => tab.id === route.tab) ?? TABS[0];
  return h(
    'div',
    { className: 'cora-forms' },
    h('h1', {}, 'Forms'),
    h(
      'div',
      { className: 'cora-forms-tabbar' },
      h(
        'div',
        { className: 'cora-tabs-list', role: 'tablist', 'aria-label': 'Forms' },
        ...TABS.map((tab) =>
          h(
            'button',
            {
              type: 'button',
              className: 'cora-tabs-tab',
              role: 'tab',
              id: `forms-tab-${tab.id}`,
              'aria-controls': 'forms-tab-panel',
              'aria-selected': String(tab === selected),
              onclick: () => {
                if (tab !== selected) navigateTo(tab.href);
              },
            },
            tab.label
          )
        )
      ),
      canCreateForms(state.chrome.permissions)
        ? h(
            'button',
            { type: 'button', onclick: () => navigateTo(NEW_FORM_HREF) },
            'New form'
          )
        : null
    ),
    h(
      'div',
      {
        id: 'forms-tab-panel',
        role: 'tabpanel',
        'aria-labelledby': `forms-tab-${selected.id}`,
      },
      ...(selected.id === 'archive'
        ? archiveView(state, tools)
        : outstandingView(state, tools))
    )
  );
}

/**
 * Read one page of Forms from every Form Type the caller names, together.
 *
 * @param {SharePointClient} client
 * @param {readonly FormTypeDefinition[]} formTypes
 * @param {(formType: FormTypeDefinition) => ListFormItemsOptions} options
 * @returns {Promise<{ loaded: LoadedForms[], next: Record<string, string | null> }>}
 */
async function readForms(client, formTypes, options) {
  const pages = await Promise.all(
    formTypes.map((formType) =>
      client.listFormItems(formType, options(formType))
    )
  );
  return {
    loaded: formTypes.map((formType, i) => ({
      formType,
      items: pages[i].items,
    })),
    next: Object.fromEntries(
      formTypes.map((formType, i) => [formType.slug, pages[i].next])
    ),
  };
}

/**
 * @param {LoadedForms[]} current
 * @param {LoadedForms[]} more
 * @returns {LoadedForms[]}
 */
function appendLoaded(current, more) {
  return current.map((entry) => ({
    formType: entry.formType,
    items: [
      ...entry.items,
      ...(more.find((page) => page.formType === entry.formType)?.items ?? []),
    ],
  }));
}

/**
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ now?: () => Date }} [dependencies]
 */
export function createRouteSlice(
  params,
  context,
  { now = () => new Date() } = {}
) {
  const formTypes = context.formTypes ?? [];
  const tab =
    new URLSearchParams(params.queryString ?? '').get('tab') === 'archive'
      ? 'archive'
      : 'outstanding';
  const today = toLocalDateKey(now()) ?? '';
  const me = context.chrome.currentUser.id;
  const seesEveryForm = context.chrome.permissions.isFormsControl;

  // The store's, which does not exist yet; start() swaps the real ones in.
  let isActive = () => false;
  /** @type {(action: any) => any} */
  let dispatch = () => {};
  /** @type {SharePointClient | null} */
  let readClient = null;
  let lastRequest = 0;

  /**
   * What each read asks the server for, before paging.
   *
   * @type {Record<FormsReadName, (route: FormsRoute) => ListFormItemsOptions>}
   */
  const queries = {
    mine: () => ({ filter: { involving: me, closed: false } }),
    all: () => ({
      filter: { closed: false },
      orderBy: { column: 'DueDate' },
      top: ALL_FORMS_PAGE,
    }),
    archive: (route) => ({
      filter: {
        closed: true,
        // Always carried, whatever the viewer has cleared: it is what keeps
        // a read of a list that only grows under the list view threshold.
        window: { column: 'ClosedDate', ...route.archive.window },
        ...(seesEveryForm ? {} : { involving: me }),
      },
      orderBy: { column: 'ClosedDate', dir: 'desc' },
      top: ARCHIVE_PAGE,
    }),
  };

  /**
   * Read the first page of `name`, or with `append` the next page of every
   * Form Type that has one.
   *
   * @param {FormsReadName} name
   * @param {FormsRoute} route
   * @param {boolean} append
   */
  function read(name, route, append) {
    const client = readClient;
    if (!client) return;
    const { next } = route[name];
    const pending = append
      ? formTypes.filter((formType) => next[formType.slug] != null)
      : formTypes;
    if (pending.length === 0) return;
    const request = ++lastRequest;
    dispatch({ type: 'forms/read-started', name, append, request });
    readForms(client, pending, (formType) => ({
      ...queries[name](route),
      ...(append ? { next: next[formType.slug] } : {}),
    })).then(
      (page) => {
        if (isActive()) {
          dispatch({
            type: 'forms/read-loaded',
            name,
            append,
            request,
            ...page,
          });
        }
      },
      (error) => {
        if (!isAbortError(error) && isActive()) {
          dispatch({ type: 'forms/read-failed', name, request });
        }
      }
    );
  }

  /** @type {FormsState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      forms: {
        tab,
        formTypes,
        today,
        mine: unread(),
        all: unread(),
        archive: { ...unread(), window: archiveWindow({}, today) },
        scope: 'mine',
        filters: { text: '', formType: '', role: '' },
        archiveFilters: { text: '', formType: '', status: '' },
        sort: null,
        archiveSort: null,
        openLanes: new Set(['employee', 'manager']),
      },
    },
  };

  return {
    initialState,
    reducer(/** @type {FormsState} */ state, /** @type {any} */ action) {
      const route = state.routes.forms;
      if (action.type === 'forms/read-started') {
        /** @type {FormsReadName} */
        const name = action.name;
        // Loading more keeps the rows already shown; only a first read shows
        // the loading state.
        return patchRoute(state, 'forms', {
          [name]: {
            ...route[name],
            status: action.append ? route[name].status : 'loading',
            request: action.request,
          },
        });
      }
      if (action.type === 'forms/read-loaded') {
        /** @type {FormsReadName} */
        const name = action.name;
        const current = route[name];
        if (action.request !== current.request) return state;
        return patchRoute(state, 'forms', {
          [name]: {
            ...current,
            status: 'loaded',
            loaded: action.append
              ? appendLoaded(current.loaded, action.loaded)
              : action.loaded,
            next: action.append
              ? { ...current.next, ...action.next }
              : action.next,
          },
        });
      }
      if (action.type === 'forms/read-failed') {
        /** @type {FormsReadName} */
        const name = action.name;
        if (action.request !== route[name].request) return state;
        return patchRoute(state, 'forms', {
          [name]: { ...route[name], status: 'failed' },
        });
      }
      if (action.type === 'forms/archive-window-changed') {
        return patchRoute(state, 'forms', {
          archive: { ...route.archive, window: action.window },
        });
      }
      if (action.type === 'forms/scope-changed') {
        return patchRoute(state, 'forms', { scope: action.scope });
      }
      if (action.type === 'forms/filter-changed') {
        const key = action.table === 'archive' ? 'archiveFilters' : 'filters';
        return patchRoute(state, 'forms', {
          [key]: { ...route[key], [action.key]: action.value },
        });
      }
      if (action.type === 'kpi/lane-toggled') {
        const open = new Set(route.openLanes);
        if (open.has(action.role)) open.delete(action.role);
        else open.add(action.role);
        return patchRoute(state, 'forms', { openLanes: open });
      }
      const sort = reduceTableSort(route.sort, action, OUTSTANDING_TABLE);
      if (sort) return patchRoute(state, 'forms', { sort });
      const archiveSort = reduceTableSort(
        route.archiveSort,
        action,
        ARCHIVE_TABLE
      );
      if (archiveSort) return patchRoute(state, 'forms', { archiveSort });
      return state;
    },
    view: (/** @type {FormsState} */ state, /** @type {any} */ tools) => {
      const route = state.routes.forms;
      return formsView(state, {
        dispatch: tools.dispatch,
        onScopeChanged: (scope) => {
          tools.dispatch({ type: 'forms/scope-changed', scope });
          // A failed first read is retried by choosing "All open forms" again.
          const { status } = route.all;
          if (scope === 'all' && (status === 'idle' || status === 'failed')) {
            read('all', route, false);
          }
        },
        onLoadMore: (name) => read(name, route, true),
        onWindowChanged: (end, value) => {
          const closed = archiveWindow(
            { ...route.archive.window, [end]: value },
            today
          );
          tools.dispatch({
            type: 'forms/archive-window-changed',
            window: closed,
          });
          read(
            'archive',
            { ...route, archive: { ...route.archive, window: closed } },
            false
          );
        },
      });
    },
    start(/** @type {any} */ tools) {
      isActive = tools.isActive;
      dispatch = tools.dispatch;
      const client = tools.context.client;
      if (!client) return;
      readClient = withAbortSignal(client, tools.signal);
      const route = initialState.routes.forms;
      read(tab === 'archive' ? 'archive' : 'mine', route, false);
    },
  };
}
