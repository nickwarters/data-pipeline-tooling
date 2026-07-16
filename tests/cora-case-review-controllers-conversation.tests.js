// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConversationPanelBinding,
  makeConversationContext,
} from './helpers/cora-case-review-controllers.js';

// Capability: conversation controller binding.

test('createConversationPanelBinding: preserves click and Alt+C conversation toggling', () => {
  const setup = makeConversationContext({
    conversationHidden: false,
    conversationAccess: 'override',
  });
  const { context, conversation, toggle, saveQueue, client, currentUser } =
    setup;
  const controller = createConversationPanelBinding();

  controller.bind(/** @type {any} */ (context));
  controller.update(/** @type {any} */ (context));
  toggle._listeners.click[0]();
  // The route shell wires handleKeydown through on(document, 'keydown', …);
  // here we drive the handler directly. Alt+C toggles; other keys are inert.
  controller.handleKeydown(/** @type {any} */ ({ altKey: true, code: 'KeyC' }));
  controller.handleKeydown(
    /** @type {any} */ ({ altKey: false, code: 'KeyC' })
  );
  // Alt+other-key does not toggle (the code guard, not just the modifier).
  controller.handleKeydown(/** @type {any} */ ({ altKey: true, code: 'KeyD' }));

  assert.equal(setup.toggleCalls, 2);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(
    toggle.getAttribute('aria-label'),
    'Toggle conversation panel (⌥C / Alt+C)'
  );
  assert.equal(toggle.textContent, 'Conversation');
  assert.equal(/** @type {any} */ (conversation).client, client);
  assert.equal(/** @type {any} */ (conversation).saveQueue, saveQueue);
  assert.equal(/** @type {any} */ (conversation).caseId, 'case-1');
  assert.deepEqual(/** @type {any} */ (conversation).caseListOptions, {
    listName: 'Cases-ExampleReview',
  });
  assert.equal(/** @type {any} */ (conversation).currentUser, currentUser);
  assert.equal(/** @type {any} */ (conversation).access, 'read-only');
  assert.equal(/** @type {any} */ (conversation).hidden, false);
  assert.deepEqual(/** @type {any} */ (conversation)._messages, [
    { body: 'Message one' },
  ]);
  assert.equal(
    /** @type {any} */ (conversation)._messages ===
      /** @type {any} */ (context).viewModel.caseRow.conversation,
    false
  );
});

test('createConversationPanelBinding: Alt+C is inert until bound and when toggling is disallowed', () => {
  // Before bind() captures the toggle callback, the handler is a no-op.
  const unbound = makeConversationContext();
  const controller = createConversationPanelBinding();
  controller.handleKeydown(/** @type {any} */ ({ altKey: true, code: 'KeyC' }));
  assert.equal(unbound.toggleCalls, 0, 'no toggle before bind');

  // A Case that disallows toggling never captures the callback, so Alt+C stays
  // inert even after bind().
  const disallowed = makeConversationContext({ canToggleConversation: false });
  controller.bind(/** @type {any} */ (disallowed.context));
  controller.handleKeydown(/** @type {any} */ ({ altKey: true, code: 'KeyC' }));
  assert.equal(disallowed.toggleCalls, 0, 'no toggle when disallowed');

  // Once bound to a toggle-capable Case, Alt+C toggles.
  const allowed = makeConversationContext();
  controller.bind(/** @type {any} */ (allowed.context));
  controller.handleKeydown(/** @type {any} */ ({ altKey: true, code: 'KeyC' }));
  assert.equal(allowed.toggleCalls, 1, 'Alt+C toggles once bound');
});

test('conversation panel update: threads the resolved Conversation heading and toggle label', () => {
  const setup = makeConversationContext();
  /** @type {any} */ (setup.context.viewModel).config = {
    sectionLabels: { conversation: 'Dialogue' },
  };
  const binding = createConversationPanelBinding();

  binding.update(/** @type {any} */ (setup.context));

  assert.equal(/** @type {any} */ (setup.conversation).heading, 'Dialogue');
  assert.equal(setup.toggle.textContent, 'Dialogue');
});
