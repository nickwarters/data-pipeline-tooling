// @ts-check
import { h } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { isAbortError } from '../lib/abort.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { navigateTo } from '../lib/navigate.js';
import { caseRouteFor } from '../lib/case-route-links.js';
import { EmptyState, LoadingState } from '../lib/empty-state.js';
import { createDebouncedPeopleSearch } from '../lib/people-search.js';
import { PeoplePicker } from '../components/base/cora-people-picker.js';
import {
  SEARCH_PAGE_SIZE,
  searchCases as searchCasesService,
} from '../services/case-search.js';
import {
  overdueCaseRowClass,
  standardCaseColumns,
} from '../views/case-columns.js';
import {
  dataTableView,
  reduceTableSort,
  sortRequested,
} from '../views/data-table.js';

/** Shared by the view and the reducer. */
const TABLE = 'search';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../views/data-table.js').TableSort} TableSort */

/**
 * The filters the search understands, every one held as a string so the form
 * can be authored straight from state. Empty means "not filtered on".
 *
 * @typedef {{
 *   titlePrefix: string,
 *   caseType: string,
 *   assignedReviewer: string,
 *   reportableAfter: string,
 *   reportableBefore: string,
 * }} SearchFilters
 */

/** @type {Array<keyof SearchFilters>} */
const FILTER_KEYS = [
  'titlePrefix',
  'caseType',
  'assignedReviewer',
  'reportableAfter',
  'reportableBefore',
];

/**
 * @typedef {Object} CaseSearchRouteState
 * @property {SearchFilters} filters
 * @property {string} reviewerQuery
 * @property {PersonResult[]} reviewerPeople
 * @property {CaseRow[] | null} rows
 * @property {boolean} capped
 * @property {string | null} error
 * @property {TableSort | null} sort
 * @property {Array<{ slug: string, displayName: string }>} caseTypes
 */

/**
 * @typedef {Object} CaseSearchState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ caseSearch: CaseSearchRouteState }} routes
 */

/**
 * The filters a hash query string carries.
 *
 * @param {string} queryString
 * @returns {SearchFilters}
 */
function parseFilters(queryString) {
  const params = new URLSearchParams(queryString);
  const filters = /** @type {SearchFilters} */ ({});
  for (const key of FILTER_KEYS) filters[key] = params.get(key) ?? '';
  return filters;
}

/**
 * The route hash for a set of filters. An empty field contributes no key, so a
 * shared link carries only what was actually searched for.
 *
 * @param {SearchFilters} filters
 * @returns {string}
 */
function searchHash(filters) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS)
    if (filters[key]) params.set(key, filters[key]);
  const query = params.toString();
  return query ? `#/search?${query}` : '#/search';
}

/**
 * The filters as a Case query — the filled ones only. Written out field by
 * field rather than looped, because this is the seam where the page's own
 * vocabulary meets the client's: a renamed `ListCasesFilter` key has to fail
 * here, under `tsc`, and a loop over string keys would not.
 *
 * @param {SearchFilters} filters
 * @returns {ListCasesFilter}
 */
function toClientFilter(filters) {
  /** @type {ListCasesFilter} */
  const query = {};
  if (filters.titlePrefix) query.titlePrefix = filters.titlePrefix;
  if (filters.caseType) query.caseType = filters.caseType;
  if (filters.assignedReviewer)
    query.assignedReviewer = filters.assignedReviewer;
  if (filters.reportableAfter) query.reportableAfter = filters.reportableAfter;
  if (filters.reportableBefore)
    query.reportableBefore = filters.reportableBefore;
  return query;
}

/**
 * @param {SearchFilters} filters
 * @returns {boolean}
 */
function hasAnyFilter(filters) {
  return FILTER_KEYS.some((key) => Boolean(filters[key]));
}

/**
 * @param {keyof SearchFilters} key
 * @param {string} value
 */
const filterChanged = (key, value) => ({
  type: 'search/filter-changed',
  key,
  value,
});

/**
 * @param {CaseSearchRouteState} route
 * @param {{ dispatch: (action: any) => any, onReviewerQuery?: (query: string) => void }} tools
 * @returns {HTMLElement}
 */
function reviewerPickerView(route, tools) {
  return PeoplePicker({
    placeholder: 'Search for a Reviewer',
    ariaLabel: 'Assigned Reviewer',
    people: route.reviewerPeople,
    query: route.reviewerQuery,
    inputValue: route.reviewerQuery,
    // An account this directory cannot resolve makes the whole query reject, so
    // the raw-account escape hatch the other pickers offer would only ever
    // produce a search that cannot run.
    allowRawAccount: false,
    onQueryInput: (query) => {
      tools.dispatch({ type: 'search/reviewer-query', query });
      tools.onReviewerQuery?.(query);
    },
    onSelect: (person) =>
      tools.dispatch({ type: 'search/reviewer-selected', person }),
  });
}

/**
 * @param {string} label
 * @param {HTMLElement} control
 * @returns {HTMLElement}
 */
function labelled(label, control) {
  return h(
    'label',
    { className: 'cora-case-search-field' },
    h('span', {}, label),
    control
  );
}

/**
 * @param {CaseSearchRouteState} route
 * @param {{ dispatch: (action: any) => any }} tools
 * @param {keyof SearchFilters} key
 * @param {string} type
 * @returns {HTMLElement}
 */
function filterInputView(route, tools, key, type) {
  return h('input', {
    className: 'cora-case-search-input',
    type,
    value: route.filters[key],
    oninput: (/** @type {any} */ ev) =>
      tools.dispatch(filterChanged(key, ev.target?.value ?? '')),
  });
}

/**
 * @param {CaseSearchRouteState} route
 * @param {{ dispatch: (action: any) => any }} tools
 * @returns {HTMLElement}
 */
function caseTypeSelectView(route, tools) {
  return h(
    'select',
    {
      className: 'cora-case-search-select',
      value: route.filters.caseType,
      onchange: (/** @type {any} */ ev) =>
        tools.dispatch(filterChanged('caseType', ev.target?.value ?? '')),
    },
    h('option', { value: '' }, 'Any Case Type'),
    ...route.caseTypes.map((caseType) =>
      h('option', { value: caseType.slug }, caseType.displayName)
    )
  );
}

/**
 * @param {CaseSearchRouteState} route
 * @param {{ dispatch: (action: any) => any, onReviewerQuery?: (query: string) => void, onSubmit?: () => void }} tools
 * @returns {HTMLElement}
 */
function filtersView(route, tools) {
  return h(
    'div',
    {
      className: 'cora-case-search-filters',
      role: 'search',
      // Deliberately not a <form>. The host page wraps the whole app in one, and
      // a nested form posts the outer one back rather than submitting itself.
      // Enter is wired by hand instead, so the affordance survives without the
      // element that breaks the host.
      //
      // Searching is explicit — button or Enter — because it writes the route
      // hash, and a hash per keystroke would be a history entry per keystroke.
      onkeydown: (/** @type {any} */ ev) => {
        if (ev.key !== 'Enter' || ev.defaultPrevented) return;
        // The people picker owns Enter while it is offering a match to choose.
        if (ev.target?.getAttribute?.('role') === 'combobox') return;
        ev.preventDefault();
        tools.onSubmit?.();
      },
    },
    labelled(
      'Case Reference',
      filterInputView(route, tools, 'titlePrefix', 'text')
    ),
    labelled('Case Type', caseTypeSelectView(route, tools)),
    labelled('Assigned Reviewer', reviewerPickerView(route, tools)),
    // The labels say what the bounds are — an inclusive lower and an exclusive
    // upper, exactly what the client applies — so nothing anywhere has to
    // quietly add a day to what the user typed.
    labelled(
      'Reportable from',
      filterInputView(route, tools, 'reportableAfter', 'date')
    ),
    labelled(
      'Reportable before',
      filterInputView(route, tools, 'reportableBefore', 'date')
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'cora-case-search-submit',
        onclick: () => tools.onSubmit?.(),
      },
      'Search'
    )
  );
}

/**
 * @param {CaseSearchRouteState} route
 * @param {{ dispatch: (action: any) => any }} tools
 * @returns {HTMLElement}
 */
function resultsView(route, tools) {
  if (route.error) {
    return h(
      'p',
      { className: 'cora-case-search-error', role: 'alert' },
      route.error
    );
  }
  if (!hasAnyFilter(route.filters)) {
    // Not "no cases match" — nothing has been asked yet, and saying otherwise
    // would report an answer the page never went and got.
    return h(
      'p',
      { className: 'cora-case-search-prompt' },
      'Enter at least one filter to search.'
    );
  }
  if (!route.rows) return LoadingState('Searching Cases');
  if (route.rows.length === 0)
    return EmptyState('No Cases match these filters.');

  return h(
    'div',
    {},
    route.capped &&
      h(
        'p',
        { className: 'cora-case-search-cap' },
        `Showing the first ${SEARCH_PAGE_SIZE} matches — narrow your filters.`
      ),
    dataTableView({
      rows: route.rows,
      columns: standardCaseColumns({
        onOpen: (row) => navigateTo(caseRouteFor(row)),
      }),
      sort: route.sort,
      onSort: (key) => tools.dispatch(sortRequested(TABLE, key)),
      emptyMessage: 'No Cases match these filters.',
      rowKey: (row) => `${row.caseType}:${row.id}`,
      rowHref: caseRouteFor,
      rowClass: overdueCaseRowClass,
    })
  );
}

/**
 * @param {CaseSearchState} state
 * @param {{ dispatch: (action: any) => any, onReviewerQuery?: (query: string) => void, onSubmit?: () => void }} tools
 * @returns {HTMLElement}
 */
export function caseSearchView(state, tools) {
  const route = state.routes.caseSearch;
  return h(
    'div',
    { className: 'cora-case-search' },
    h('h1', {}, 'Search Cases'),
    filtersView(route, tools),
    resultsView(route, tools)
  );
}

/**
 * @param {Record<string, string>} params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ searchCases?: typeof searchCasesService }} [dependencies]
 * @returns {{
 *   initialState: CaseSearchState,
 *   reducer: (state: CaseSearchState, action: any) => CaseSearchState,
 *   view: (state: CaseSearchState, tools: any) => HTMLElement,
 *   start: (tools: any) => (() => void),
 * }}
 */
export function createRouteSlice(
  params,
  context,
  { searchCases = searchCasesService } = {}
) {
  const filters = parseFilters(params.queryString ?? '');

  // Both are the store's, which does not exist yet; the debounced search below
  // closes over these and start() swaps the real ones in.
  let isSliceActive = () => false;
  /** @type {(action: any) => any} */
  let dispatch = () => {};

  const peopleSearch = createDebouncedPeopleSearch({
    client: context.client,
    isActive: () => isSliceActive(),
    onResults: (_key, query, people) =>
      dispatch({ type: 'search/reviewer-results', query, people }),
  });

  /** @type {CaseSearchState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      caseSearch: {
        filters,
        reviewerQuery: filters.assignedReviewer,
        reviewerPeople: [],
        rows: null,
        capped: false,
        error: null,
        sort: null,
        caseTypes: context.caseSources.map(({ slug, displayName }) => ({
          slug,
          displayName,
        })),
      },
    },
  };

  return {
    initialState,
    reducer(state, action) {
      const route = state.routes.caseSearch;
      if (action.type === 'search/filter-changed') {
        return patchRoute(state, 'caseSearch', {
          filters: { ...route.filters, [action.key]: action.value },
        });
      }
      if (action.type === 'search/reviewer-query') {
        // Typing past a chosen person unresolves the filter: only a directory
        // match may fill it.
        return patchRoute(state, 'caseSearch', {
          reviewerQuery: action.query,
          filters: { ...route.filters, assignedReviewer: '' },
        });
      }
      if (action.type === 'search/reviewer-results') {
        return patchRoute(state, 'caseSearch', {
          reviewerPeople: action.people,
        });
      }
      if (action.type === 'search/reviewer-selected') {
        return patchRoute(state, 'caseSearch', {
          reviewerQuery: action.person.loginName,
          reviewerPeople: [],
          filters: {
            ...route.filters,
            assignedReviewer: action.person.loginName,
          },
        });
      }
      if (action.type === 'search/loaded') {
        return patchRoute(state, 'caseSearch', {
          rows: action.rows,
          capped: action.capped,
          error: null,
        });
      }
      if (action.type === 'search/failed') {
        return patchRoute(state, 'caseSearch', { error: action.message });
      }
      const sort = reduceTableSort(route.sort, action, TABLE);
      if (sort) return patchRoute(state, 'caseSearch', { sort });
      return state;
    },
    view: (state, tools) =>
      caseSearchView(state, {
        ...tools,
        onReviewerQuery: (query) =>
          peopleSearch.request('assignedReviewer', query),
        onSubmit: () => navigateTo(searchHash(state.routes.caseSearch.filters)),
      }),
    start(tools) {
      isSliceActive = tools.isActive;
      dispatch = tools.dispatch;
      const cleanup = () => peopleSearch.dispose();

      const client = tools.context.client;
      if (!client) return cleanup;
      const readClient = withAbortSignal(client, tools.signal);

      if (!hasAnyFilter(filters)) return cleanup;

      const sources = tools.context.caseSources;
      if (
        filters.caseType &&
        !sources.some(
          (/** @type {{ slug: string }} */ source) =>
            source.slug === filters.caseType
        )
      ) {
        tools.dispatch({
          type: 'search/failed',
          message: `No Case Type "${filters.caseType}" is available to you.`,
        });
        return cleanup;
      }

      void (async () => {
        try {
          const { rows, capped } = await searchCases(
            readClient,
            toClientFilter(filters),
            sources
          );
          if (tools.isActive()) {
            tools.dispatch({ type: 'search/loaded', rows, capped });
          }
        } catch (error) {
          // Louder than the neighbouring pages' fire-and-forget catch: an
          // unhandled rejection would leave the page loading for ever, and
          // every realistic failure here is correctable in the form above it.
          if (isAbortError(error)) return;
          if (!tools.isActive()) return;
          tools.dispatch({
            type: 'search/failed',
            message: `The search could not be completed. ${error}`,
          });
        }
      })();

      return cleanup;
    },
  };
}
