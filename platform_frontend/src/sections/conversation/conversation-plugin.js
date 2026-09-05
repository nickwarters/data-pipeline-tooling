// src/sections/conversation/conversation-plugin.js
// @ts-check
import {
  conversationView,
  postConversationMessage,
} from '../../pages/cora-case-review/conversation-view.js';
import { CASE_STATUS } from '../../lib/case-statuses.js';
import { conversationSideOf } from '../../services/section-access.js';

/** @type {import('../registry.js').SectionPlugin} */
export const ConversationPlugin = {
  id: 'conversation',
  tab: false,
  tabOrder: 0,
  summaryBlock: false,
  summaryOrder: 0,
  showInSummaryDefault: false,
  defaultLabels: {
    tab: 'Conversation',
    heading: 'Case Conversation',
  },

  evaluateAccess({ caseRow, roles, sectionConfig, config }) {
    if (
      !roles ||
      roles.length === 0 ||
      (roles.length === 1 && roles[0] === 'none')
    ) {
      return 'hidden';
    }
    const hasParticipantRole = roles.some((r) =>
      [
        'assignedReviewer',
        'responsibleParty',
        'responsiblePartyManager',
      ].includes(r)
    );
    if (!hasParticipantRole) {
      return 'read-only';
    }
    const status = caseRow?.status;
    if (status === CASE_STATUS.COMPLETED || status === CASE_STATUS.VOID) {
      return 'read-only';
    }
    const cfg = sectionConfig ?? config?.sections?.conversation;
    const allowed = cfg?.allowMessagesWhen;
    if (allowed && !allowed.includes(status)) {
      return 'read-only';
    }
    const initiatedBy = cfg?.initiatedBy;
    const side = conversationSideOf(roles);
    const messageCount = Array.isArray(caseRow?.conversation)
      ? caseRow.conversation.length
      : 0;
    if (initiatedBy && initiatedBy !== side && messageCount === 0) {
      return 'read-only';
    }
    return 'edit';
  },

  view({ caseRow, snapshot, dispatch, actions }) {
    return conversationView({
      messages: caseRow?.conversation ?? [],
      access: snapshot?.access?.conversation ?? 'hidden',
      heading: snapshot?.sectionLabels?.conversation?.heading ?? 'Conversation',
      onClose: () => {
        dispatch({ type: 'case/conversation-toggled' });
        actions?.onClose?.();
      },
      onSend: async (body) => {
        if (typeof actions?.onSend === 'function') {
          await actions.onSend(body);
        } else if (typeof actions?.postConversationMessage === 'function') {
          await actions.postConversationMessage(body);
        } else {
          await postConversationMessage({
            caseId: caseRow?.id,
            body,
            client: actions?.client,
            saveQueue: actions?.saveQueue,
            currentUser: actions?.currentUser,
            roles: snapshot?.machine?.roles ?? [],
            messages: caseRow?.conversation ?? [],
            caseListOptions: snapshot?.caseListOptions,
            onMessages: (messages) =>
              dispatch?.({
                type: 'case/conversation-changed',
                messages,
              }),
          });
        }
      },
    });
  },
};
