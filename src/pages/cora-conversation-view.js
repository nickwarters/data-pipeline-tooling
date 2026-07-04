// @ts-check
import { signal } from '../lib/signal.js';
import { reactive } from '../lib/view.js';
import { h } from '../lib/html.js';
import {
  UnknownCaseTypeError,
  loadCaseTypeConfig,
} from '../../case-types/manifest.js';
import '../components/cora-conversation.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * Lightweight conversation-only view for the Responsible Party.
 * Shows only the Conversation thread — no Q&A, Notes, or Reviewer identity.
 *
 * @param {{
 *   client: SharePointClient | null,
 *   saveQueue: SaveQueue | null,
 *   caseId: string,
 *   caseType: string | null,
 *   currentUser: CurrentUser | null,
 * }} props
 * @returns {HTMLElement}
 */
export function ConversationView({
  client,
  saveQueue,
  caseId,
  caseType,
  currentUser,
}) {
  /** @type {import('../lib/signal.js').Signal<CaseRow | null>} */
  const caseRow = signal(/** @type {CaseRow | null} */ (null));

  async function fetchData() {
    if (!client || !caseId) return;
    /** @type {import('../sharepoint-client.js').CaseListOptions} */
    let opts = {};
    if (caseType) {
      try {
        const config = await loadCaseTypeConfig(caseType);
        opts = config.listName ? { listName: config.listName } : {};
      } catch (error) {
        if (error instanceof UnknownCaseTypeError) return;
        throw error;
      }
    }
    const row = await client.getCase(caseId, opts);
    if (!row) return;
    if (typeof saveQueue?.loadCase === 'function') {
      saveQueue.loadCase(row, opts);
    }
    caseRow.set(row);
  }

  const host = reactive(() =>
    renderConversationView({
      client,
      saveQueue,
      caseId,
      currentUser,
      caseRow: caseRow.get(),
    })
  );
  fetchData();
  return host;
}

/**
 * @param {{
 *   client: SharePointClient | null,
 *   saveQueue: SaveQueue | null,
 *   caseId: string,
 *   currentUser: CurrentUser | null,
 *   caseRow: CaseRow | null,
 * }} args
 * @returns {Node[]}
 */
function renderConversationView({
  client,
  saveQueue,
  caseId,
  currentUser,
  caseRow,
}) {
  if (!caseRow) return [];

  return [
    h(
      'header',
      { className: 'cora-conversation-view-header' },
      h(
        'button',
        {
          type: 'button',
          className: 'cora-back-btn',
          onclick: () => {
            location.hash = '#/my-reviews';
          },
        },
        '← My Reviews'
      ),
      h('h1', {}, caseRow.title || caseRow.id)
    ),
    h('cora-conversation', {
      client,
      saveQueue,
      caseId,
      currentUser,
      messages: caseRow.conversation,
    }),
  ];
}
