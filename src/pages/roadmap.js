// @ts-check
import { h } from '../lib/html.js';
import { createRouteErrorPanel } from '../lib/route-error-panel.js';

/** @typedef {import('../sharepoint-client.js').RoadmapItem} RoadmapItem */
/** @typedef {import('../sharepoint-client.js').RoadmapStatus} RoadmapStatus */

export const ROADMAP_DESCRIPTION_LIMIT = 180;
/** @type {readonly RoadmapStatus[]} */
export const ROADMAP_STATUSES = ['LIVE', 'IN PROGRESS', 'UPCOMING'];

/**
 * @typedef {Object} RoadmapRouteState
 * @property {RoadmapItem[] | null} items
 * @property {Set<string>} expandedItemIds
 * @property {string | null} error
 */

/**
 * @typedef {Object} RoadmapState
 * @property {import('../core/chrome-state.js').ChromeState} chrome
 * @property {{ roadmap: RoadmapRouteState }} routes
 */

/**
 * @typedef {
 *   | { type: 'roadmap/loaded', items: RoadmapItem[] }
 *   | { type: 'roadmap/load-failed', message: string }
 *   | { type: 'roadmap/description-toggled', itemId: string }
 * } RoadmapAction
 */

/**
 * Keep all three lanes stable even when a status has no items. Unknown list
 * values are ignored rather than inventing a fourth lane.
 *
 * @param {RoadmapItem[]} items
 * @returns {Record<RoadmapStatus, RoadmapItem[]>}
 */
export function bucketRoadmapItems(items) {
  /** @type {Record<RoadmapStatus, RoadmapItem[]>} */
  const columns = { LIVE: [], 'IN PROGRESS': [], UPCOMING: [] };
  for (const item of items) {
    if (ROADMAP_STATUSES.includes(item.status)) columns[item.status].push(item);
  }
  return columns;
}

/**
 * @param {RoadmapState} state
 * @param {RoadmapAction} action
 * @returns {RoadmapState}
 */
export function roadmapReducer(state, action) {
  const route = state.routes.roadmap;
  if (action.type === 'roadmap/loaded') {
    return {
      ...state,
      routes: {
        roadmap: { ...route, items: action.items, error: null },
      },
    };
  }
  if (action.type === 'roadmap/load-failed') {
    return {
      ...state,
      routes: {
        roadmap: { ...route, error: action.message },
      },
    };
  }
  if (action.type === 'roadmap/description-toggled') {
    const expandedItemIds = new Set(route.expandedItemIds);
    if (expandedItemIds.has(action.itemId)) {
      expandedItemIds.delete(action.itemId);
    } else {
      expandedItemIds.add(action.itemId);
    }
    return {
      ...state,
      routes: {
        roadmap: { ...route, expandedItemIds },
      },
    };
  }
  return state;
}

/**
 * @param {RoadmapItem} item
 * @param {boolean} expanded
 * @param {(action: RoadmapAction) => void} dispatch
 * @returns {HTMLElement}
 */
function roadmapCardView(item, expanded, dispatch) {
  const isLong = item.description.length > ROADMAP_DESCRIPTION_LIMIT;
  const description =
    isLong && !expanded
      ? `${item.description.slice(0, ROADMAP_DESCRIPTION_LIMIT).trimEnd()}…`
      : item.description;
  const descriptionId = `cora-roadmap-description-${item.id}`;

  return h(
    'article',
    { className: 'cora-roadmap-card', 'data-roadmap-id': item.id },
    h('h3', { className: 'cora-roadmap-card-title' }, item.title),
    h(
      'p',
      { className: 'cora-roadmap-card-description', id: descriptionId },
      description
    ),
    isLong
      ? h(
          'button',
          {
            type: 'button',
            className: 'cora-roadmap-more',
            'aria-expanded': String(expanded),
            'aria-controls': descriptionId,
            onclick: () =>
              dispatch({
                type: 'roadmap/description-toggled',
                itemId: item.id,
              }),
          },
          expanded ? 'less...' : 'more...'
        )
      : null,
    h(
      'dl',
      { className: 'cora-roadmap-card-meta' },
      h('dt', {}, 'Theme'),
      h('dd', {}, item.theme)
    ),
    item.labels.length
      ? h(
          'div',
          { className: 'cora-roadmap-labels', 'aria-label': 'Labels' },
          ...item.labels.map((label) =>
            h('span', { className: 'cora-roadmap-label' }, label)
          )
        )
      : null
  );
}

/**
 * @param {RoadmapState} state
 * @param {{ dispatch: (action: RoadmapAction) => void }} tools
 * @returns {HTMLElement}
 */
export function roadmapView(state, { dispatch }) {
  const route = state.routes.roadmap;
  if (route.error) return createRouteErrorPanel();

  const items = route.items ?? [];
  const columns = bucketRoadmapItems(items);
  return h(
    'main',
    { className: 'cora-roadmap', 'aria-busy': String(route.items === null) },
    h(
      'header',
      { className: 'cora-roadmap-header' },
      h('h1', {}, 'Roadmap'),
      h(
        'p',
        {},
        route.items === null
          ? 'Loading roadmap…'
          : 'What is live, in progress, and coming next.'
      )
    ),
    h(
      'div',
      { className: 'cora-roadmap-columns' },
      ...ROADMAP_STATUSES.map((status) => {
        const headingId = `cora-roadmap-${status
          .replaceAll(' ', '-')
          .toLowerCase()}`;
        return h(
          'section',
          {
            className: 'cora-roadmap-column',
            'aria-labelledby': headingId,
          },
          h(
            'h2',
            { className: 'cora-roadmap-column-heading', id: headingId },
            status
          ),
          h(
            'div',
            { className: 'cora-roadmap-column-cards' },
            ...columns[status].map((item) =>
              roadmapCardView(
                item,
                route.expandedItemIds.has(item.id),
                dispatch
              )
            ),
            route.items !== null && columns[status].length === 0
              ? h('p', { className: 'cora-roadmap-empty' }, 'Nothing here yet.')
              : null
          )
        );
      })
    )
  );
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 */
export function createRouteSlice(_params, context) {
  return {
    initialState: {
      chrome: context.chrome,
      routes: {
        roadmap: {
          items: null,
          expandedItemIds: new Set(),
          error: null,
        },
      },
    },
    reducer: roadmapReducer,
    view: roadmapView,
    start(/** @type {any} */ tools) {
      let active = true;
      context.appEl.classList.add('cora-fullbleed');
      void context.client.listRoadmapItems().then(
        (items) => {
          if (active) tools.dispatch({ type: 'roadmap/loaded', items });
        },
        (error) => {
          if (active) {
            tools.dispatch({
              type: 'roadmap/load-failed',
              message:
                error instanceof Error
                  ? error.message
                  : 'Unable to load the roadmap.',
            });
          }
        }
      );
      return () => {
        active = false;
        context.appEl.classList.remove('cora-fullbleed');
      };
    },
  };
}
