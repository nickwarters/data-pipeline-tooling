// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './_dom-stub.js';
import { fireEvent, getByRole } from './helpers/semantic-dom.js';
import { ConversationPlugin } from '../src/sections/conversation/conversation-plugin.js';
import {
  getSectionPlugin,
  resetSectionRegistry,
} from '../src/sections/registry.js';

installDom();

test('ConversationPlugin has correct contract properties and is registered', () => {
  resetSectionRegistry();
  assert.equal(getSectionPlugin('conversation'), ConversationPlugin);
  assert.equal(ConversationPlugin.id, 'conversation');
  assert.equal(ConversationPlugin.tab, false);
  assert.equal(ConversationPlugin.tabOrder, 0);
  assert.equal(ConversationPlugin.summaryBlock, false);
  assert.equal(ConversationPlugin.summaryOrder, 0);
  assert.equal(ConversationPlugin.showInSummaryDefault, false);
  assert.deepEqual(ConversationPlugin.defaultLabels, {
    tab: 'Conversation',
    heading: 'Case Conversation',
  });
});

test('ConversationPlugin evaluateAccess handles frozen, active, and hidden states', () => {
  // None role is hidden
  assert.equal(
    ConversationPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['none'],
    }),
    'hidden'
  );

  // Active status gets edit
  assert.equal(
    ConversationPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Allocated' }),
      roles: ['assignedReviewer'],
    }),
    'edit'
  );

  // Frozen cases get read-only
  assert.equal(
    ConversationPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Completed' }),
      roles: ['assignedReviewer'],
    }),
    'read-only'
  );
  assert.equal(
    ConversationPlugin.evaluateAccess({
      caseRow: /** @type {any} */ ({ status: 'Void' }),
      roles: ['assignedReviewer'],
    }),
    'read-only'
  );
});

test('ConversationPlugin view handles close and send actions', async () => {
  /** @type {any[]} */
  const dispatched = [];
  /** @type {string[]} */
  const sent = [];

  const panelContext = /** @type {any} */ ({
    snapshot: {
      access: { conversation: 'edit' },
      sectionLabels: { conversation: { heading: 'Case Conversation' } },
    },
    caseRow: {
      id: 'case-1',
      conversation: [
        {
          author: { loginName: 'user1', displayName: 'User One' },
          timestamp: '2026-01-01T00:00:00.000Z',
          body: 'Hello team',
        },
      ],
    },
    dispatch: (/** @type {any} */ action) => dispatched.push(action),
    actions: {
      onSend: async (/** @type {string} */ body) => {
        sent.push(body);
      },
    },
  });

  const node = /** @type {HTMLElement} */ (
    ConversationPlugin.view(panelContext)
  );
  assert.ok(node);

  // Close button triggers toggle action
  const closeBtn = node.querySelector('.cora-conversation-close');
  assert.ok(closeBtn);
  fireEvent(closeBtn, 'click');
  assert.deepEqual(dispatched, [{ type: 'case/conversation-toggled' }]);

  // Sending message triggers onSend
  const textarea = node.querySelector('textarea');
  assert.ok(textarea);
  textarea.value = 'New reply';
  fireEvent(textarea, 'input');

  const sendBtn = getByRole(node, 'button', { name: 'Send message' });
  assert.ok(sendBtn);
  fireEvent(sendBtn, 'click');

  assert.deepEqual(sent, ['New reply']);
});

test('ConversationPlugin view renders read-only conversation correctly', () => {
  const panelContext = /** @type {any} */ ({
    snapshot: {
      access: { conversation: 'read-only' },
      sectionLabels: { conversation: { heading: 'Case Conversation' } },
    },
    caseRow: {
      id: 'case-1',
      conversation: [],
    },
    dispatch: () => {},
    actions: {},
  });

  const node = /** @type {HTMLElement} */ (
    ConversationPlugin.view(panelContext)
  );
  assert.ok(node);
  assert.equal(node.querySelector('textarea'), null);
});
