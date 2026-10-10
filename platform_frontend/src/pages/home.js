// @ts-check
/**
 * Home: what needs the person now, then a card for each area of the
 * application they can reach.
 *
 * The cards are not listed here. Each page declares its own card beside its
 * route in the composition root, and boot hands Home the ones this person may
 * see, so a new page is offered here by the same entry that adds it to the nav.
 *
 * The figures on the cards are the dashboards' own, read after the cards are
 * drawn: the Case dashboard's lanes and the Forms dashboard's. The page never
 * waits on them, and a read that fails leaves its cards without figures rather
 * than taking anything else away.
 */

import { h, svg } from '../lib/html.js';
import { patchRoute } from '../core/route-state.js';
import { toLocalDateKey } from '../lib/local-calendar.js';
import { withAbortSignal } from '../services/abortable-client.js';
import { loadKpiModel } from '../evaluators/kpi-strip-model.js';
import { formLanes, formRows } from './forms/forms-model.js';

/** @typedef {import('../core/chrome-state.js').ChromeState} ChromeState */
/** @typedef {import('../setup/register-routes.js').HomeCardItem} HomeCardItem */
/** @typedef {import('../setup/register-routes.js').HomeArea} HomeArea */
/** @typedef {import('../evaluators/kpi-strip-model.js').KpiLane} KpiLane */
/** @typedef {import('../evaluators/kpi-strip-model.js').KpiTile} KpiTile */

/**
 * @typedef {Object} HomeRoute
 * @property {readonly HomeCardItem[]} cards
 * @property {string} greeting
 * @property {string} date The day, written out.
 * @property {Record<string, KpiLane>} lanes Every lane read so far, by role.
 * @property {number} reading How many figure reads have not answered yet.
 * @property {boolean} failed Whether a figure read failed, so an empty
 *   attention row cannot be read as nothing being due.
 */

/**
 * @typedef {Object} HomeState
 * @property {ChromeState} chrome
 * @property {{ home: HomeRoute }} routes
 */

/** The lanes the Case dashboard reads, and the ones the Forms dashboard reads. */
const CASE_LANES = ['reviewer', 'controls', 'owner'];
const FORM_LANES = ['employee', 'manager'];

/** The areas, in the order Home lays them out, and what each is for. */
const AREAS = /** @type {const} */ ([
  {
    id: 'case-review',
    title: 'Case Review',
    hint: 'Checking and remediation work',
  },
  {
    id: 'people',
    title: 'People & development',
    hint: '1-to-1s, coaching and learning plans',
  },
  { id: 'admin', title: 'Admin', hint: 'Running the application' },
]);

/**
 * The figures that need the person, in the order the row shows them. Every
 * other figure is on its card and nowhere else.
 */
const ATTENTION = ['overdue', 'at-risk', 'due-this-week'];

/** The badge each tile tone is drawn as. */
/** @type {Readonly<Record<string, string>>} */
const TONE_BADGES = {
  overdue: 'cora-badge-overdue',
  'at-risk': 'cora-badge-overdue',
  progress: 'cora-badge-in-progress',
  awaiting: 'cora-badge-open',
  appeals: 'cora-badge-open',
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * @param {HomeState} state
 * @returns {HTMLElement}
 */
export function homeView(state) {
  const route = state.routes.home;
  const capabilities = state.chrome.permissions;
  const areas = AREAS.map((area) => ({
    ...area,
    cards: route.cards.filter((card) => card.area === area.id),
  })).filter((area) => area.cards.length > 0);

  return h(
    'div',
    { className: 'cora-home' },
    h(
      'header',
      { className: 'cora-home-header' },
      h(
        'div',
        {},
        h('h1', {}, route.greeting),
        areas.length > 0
          ? h(
              'p',
              { className: 'cora-home-lead' },
              'Here’s what needs you today, and where to find everything else.'
            )
          : null
      ),
      h('p', { className: 'cora-home-date' }, route.date)
    ),
    areas.length > 0 ? attentionView(route) : null,
    ...areas.map((area) => areaView(area, route)),
    capabilities.isVisitor ? visitorView() : null
  );
}

/**
 * What is overdue or due soon across every card's figures, once they are read.
 *
 * @param {HomeRoute} route
 */
function attentionView(route) {
  const items = route.cards.flatMap((card) => {
    const tiles = cardTiles(card, route.lanes);
    const noun = card.counts?.noun;
    return ATTENTION.flatMap((key) => {
      const tile = tiles.find((each) => each.key === key);
      if (!tile || !noun) return [];
      return [
        {
          key: `${card.id}-${key}`,
          tone: key === 'due-this-week' ? 'soon' : 'late',
          count: tile.count,
          text: `${tile.count === 1 ? noun[0] : noun[1]} ${tile.label.toLowerCase()}`,
          where: card.title,
          href: card.href,
        },
      ];
    });
  });
  if (items.length === 0) {
    // Only a page that reads figures can say none of them is due.
    const counts = route.cards.some((card) => card.counts);
    return !counts || route.reading > 0 || route.failed
      ? null
      : h(
          'p',
          { className: 'cora-home-clear' },
          'Nothing is overdue or due this week.'
        );
  }
  return h(
    'section',
    { className: 'cora-home-attention', 'aria-label': 'Needs your attention' },
    ...items
      .sort((a, b) => ATTENTION_RANK[a.tone] - ATTENTION_RANK[b.tone])
      .map((item) =>
        h(
          'a',
          {
            key: item.key,
            className: `cora-home-attention-item cora-home-attention-item--${item.tone}`,
            href: item.href,
          },
          h('span', { className: 'cora-home-attention-count' }, item.count),
          h(
            'span',
            { className: 'cora-home-attention-text' },
            h('strong', {}, item.text),
            h('span', { className: 'cora-home-attention-where' }, item.where)
          )
        )
      )
  );
}

/** Late before soon. */
/** @type {Readonly<Record<string, number>>} */
const ATTENTION_RANK = { late: 0, soon: 1 };

/**
 * @param {{ id: HomeArea, title: string, hint: string, cards: HomeCardItem[] }} area
 * @param {HomeRoute} route
 */
function areaView(area, route) {
  const headingId = `home-area-${area.id}`;
  return h(
    'section',
    {
      key: area.id,
      className: `cora-home-area cora-home-area--${area.id}`,
      'aria-labelledby': headingId,
    },
    h(
      'header',
      { className: 'cora-home-area-header' },
      h('h2', { id: headingId }, area.title),
      h('span', { className: 'cora-home-area-hint' }, area.hint)
    ),
    h(
      'div',
      { className: 'cora-home-cards' },
      ...area.cards.map((card) => cardView(card, route))
    )
  );
}

/**
 * @param {HomeCardItem} card
 * @param {HomeRoute} route
 */
function cardView(card, route) {
  const headingId = `home-card-${card.id}`;
  const tiles = cardTiles(card, route.lanes);
  return h(
    'article',
    { key: card.id, className: 'cora-home-card', 'aria-labelledby': headingId },
    h(
      'span',
      { className: 'cora-home-card-icon', 'aria-hidden': 'true' },
      iconView(card.icon)
    ),
    h('h3', { id: headingId }, card.title),
    h('p', { className: 'cora-home-card-text' }, card.description),
    tiles.length > 0
      ? h(
          'ul',
          {
            className: 'cora-home-card-counts',
            'aria-label': `${card.title} figures`,
          },
          ...tiles.map((tile) =>
            h(
              'li',
              {
                className: `cora-badge ${TONE_BADGES[tile.tone] ?? 'cora-badge-muted'}`,
              },
              `${tile.count} ${tile.label}`
            )
          )
        )
      : null,
    h(
      'a',
      { className: 'cora-home-card-link', href: card.href },
      card.action,
      h('span', { 'aria-hidden': 'true' }, ' →')
    )
  );
}

/**
 * The figures a card shows: the tiles of its lanes that have something in
 * them, a tile held by two lanes added together.
 *
 * @param {HomeCardItem} card
 * @param {Record<string, KpiLane>} lanes
 * @returns {KpiTile[]}
 */
function cardTiles(card, lanes) {
  /** @type {Map<string, KpiTile>} */
  const merged = new Map();
  for (const role of card.counts?.lanes ?? []) {
    for (const tile of lanes[role]?.tiles ?? []) {
      if (tile.count === 0) continue;
      const held = merged.get(tile.key);
      merged.set(
        tile.key,
        held ? { ...held, count: held.count + tile.count } : tile
      );
    }
  }
  return [...merged.values()];
}

/** @returns {Node} */
function visitorView() {
  return h(
    'section',
    { className: 'cora-home-visitor' },
    h('h2', {}, 'Visitor'),
    h(
      'p',
      {},
      "You're signed in, but your account isn't enrolled in any Case Review ",
      "role yet. Access is managed by your team — once you're enrolled, your ",
      'tools will appear here.'
    )
  );
}

/** The strokes of each icon a card may name, on a 24-unit grid. */
/** @type {Readonly<Record<string, string[]>>} */
const ICONS = {
  list: [
    'M9 6h11',
    'M9 12h11',
    'M9 18h11',
    'M4 6h.01',
    'M4 12h.01',
    'M4 18h.01',
  ],
  inbox: ['M3 13h5l2 3h4l2-3h5', 'M5 5h14l2 8v6H3v-6z'],
  team: [
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M2 21v-1a6 6 0 0 1 12 0v1',
    'M16 3.5a4 4 0 0 1 0 7',
    'M22 21v-1a6 6 0 0 0-4-5.6',
  ],
  route: [
    'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M6 15V9a4 4 0 0 1 4-4h6',
    'M18 9v6a4 4 0 0 1-4 4H8',
  ],
  book: [
    'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z',
    'M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  ],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-4.3-4.3'],
  form: ['M6 2h9l5 5v15H6z', 'M14 2v6h6', 'M9 13h8', 'M9 17h8'],
  plus: ['M12 5v14', 'M5 12h14'],
  tools: [
    'M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  ],
  key: [
    'M15 9a4 4 0 1 0-3.9 4.9L3 22v-3h3v-3h3l2.1-2.1A4 4 0 0 0 15 9z',
    'M15.5 8.5h.01',
  ],
};

/** @param {string} name */
function iconView(name) {
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: '20',
      height: '20',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      focusable: 'false',
    },
    ...(ICONS[name] ?? []).map((d) => svg('path', { d }))
  );
}

/**
 * "Good morning, Sam", by the viewer's own clock.
 *
 * @param {Date} at
 * @param {string} displayName
 */
function greetingAt(at, displayName) {
  const hour = at.getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const first = displayName.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

/**
 * The day, spelt out the same in every browser.
 *
 * @param {Date} at
 */
function longDate(at) {
  return `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

/**
 * @param {Record<string, string>} _params
 * @param {import('../setup/register-routes.js').AppContext} context
 * @param {{ now?: () => Date }} [dependencies]
 */
export function createRouteSlice(
  _params,
  context,
  { now = () => new Date() } = {}
) {
  const cards = context.homeCards ?? [];
  const wanted = new Set(cards.flatMap((card) => card.counts?.lanes ?? []));
  const readsCases = CASE_LANES.some((role) => wanted.has(role));
  const readsForms = FORM_LANES.some((role) => wanted.has(role));
  const at = now();
  const reads = context.client ? Number(readsCases) + Number(readsForms) : 0;

  /** @type {HomeState} */
  const initialState = {
    chrome: context.chrome,
    routes: {
      home: {
        cards,
        greeting: greetingAt(at, context.chrome.currentUser.displayName),
        date: longDate(at),
        lanes: {},
        reading: reads,
        failed: false,
      },
    },
  };

  return {
    initialState,
    reducer(/** @type {HomeState} */ state, /** @type {any} */ action) {
      if (action.type !== 'home/lanes-read') return state;
      const route = state.routes.home;
      return patchRoute(state, 'home', {
        lanes: {
          ...route.lanes,
          ...Object.fromEntries(
            /** @type {KpiLane[]} */ (action.lanes).map((lane) => [
              lane.role,
              lane,
            ])
          ),
        },
        reading: route.reading - 1,
        failed: route.failed || action.failed === true,
      });
    },
    view: homeView,
    start(/** @type {any} */ tools) {
      if (reads === 0) return;
      const client = withAbortSignal(tools.context.client, tools.signal);
      const { currentUser, permissions } = context.chrome;
      const today = /** @type {string} */ (toLocalDateKey(at));

      /** @param {Promise<KpiLane[]>} reading */
      const settle = (reading) =>
        reading.then(
          (lanes) => {
            if (tools.isActive()) {
              tools.dispatch({ type: 'home/lanes-read', lanes });
            }
          },
          () => {
            // A figure that cannot be read is left off its card; the card,
            // and the way in, stay. A read cut short by leaving lands here
            // too, once the page is no longer showing, and is dropped.
            if (tools.isActive()) {
              tools.dispatch({
                type: 'home/lanes-read',
                lanes: [],
                failed: true,
              });
            }
          }
        );

      if (readsCases) {
        void settle(
          loadKpiModel({
            client,
            currentUserId: currentUser.id,
            capabilities: permissions,
            caseSources: context.caseSources,
            allCaseSources: context.caseSources,
            now: at,
          })
        );
      }
      if (readsForms) {
        const formTypes = context.formTypes ?? [];
        void settle(
          Promise.all(
            formTypes.map((formType) =>
              client.listFormItems(formType, {
                filter: { involving: currentUser.id, closed: false },
              })
            )
          ).then((pages) =>
            formLanes(
              formRows(
                formTypes.map((formType, i) => ({
                  formType,
                  items: pages[i].items,
                })),
                currentUser.id,
                permissions,
                today
              ),
              today
            )
          )
        );
      }
    },
  };
}
