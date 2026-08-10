// @ts-check

import { openAppealOf } from '../evaluators/appeal-state.js';
import { conversationSideOf } from './section-access.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').Appeal} Appeal */
/** @typedef {import('../sharepoint-client.js').Message} Message */
/** @typedef {import('./section-access.js').Role} Role */

/**
 * The Action Centre's state reason flags and their paired clocks.
 *
 * This is the one place the pairing is expressed: a flag written without its
 * clock ages or sorts a reason group wrongly rather than visibly breaking, so
 * every transition that changes one of these states calls a function here and
 * spreads the whole pair into its own field bag. **A new writer must call one
 * of these; nothing else enforces it.**
 *
 * Every clock is a time already recorded in what is being written, never a
 * fresh reading: the `SaveQueue` replays an identical field bag after an ETag
 * conflict, and a clock read at write time would restart an SLA age on each
 * retry.
 */

/**
 * The Awaiting Frontline pair after a Conversation post: the Reviewer asking
 * starts the clock, the frontline replying clears it, and anyone else posting
 * changes nothing — an empty patch, so the caller's spread is a no-op.
 *
 * Knowingly coarse: it reads the newest message's side, not whether a question
 * is outstanding, so a Reviewer posting "thanks, closing" re-arms the flag —
 * cheaper than asking a Reviewer to classify their own message, and any reply
 * or completion clears it.
 *
 * @param {Role[]} roles the poster's roles on this Case, from `resolveRoles`
 * @param {Message} message the message being posted
 * @returns {Partial<CaseRow>}
 */
export function awaitingFrontlineAfterPost(roles, message) {
  const side = conversationSideOf(roles);
  if (side === 'reviewer') {
    return {
      awaitingResponsibleParty: true,
      awaitingSince: message.timestamp,
    };
  }
  if (side === 'responsibleParty') return awaitingFrontlineCleared();
  return {};
}

/**
 * The Awaiting Frontline pair at Send Actions. Sending the Remediation Actions
 * *is* the hand-off to the Responsible Party, so the Case starts awaiting them
 * at that instant — without this it would sit outside the group until someone
 * happened to post a Message. The instant is an argument rather than a fresh
 * reading because this is one event: the hand-off and the reportable milestone
 * are the same moment, so reading the clock twice would give it two timestamps.
 *
 * @param {string} at the instant the hand-off was stamped
 * @returns {Partial<CaseRow>}
 */
export function awaitingFrontlineSent(at) {
  return { awaitingResponsibleParty: true, awaitingSince: at };
}

/**
 * The Awaiting Frontline pair for a Case that is waiting on nobody. A completed
 * Case is not awaiting a reply, and without this the last Reviewer message
 * would leave it ageing in that group for ever.
 *
 * @returns {Partial<CaseRow>}
 */
export function awaitingFrontlineCleared() {
  return { awaitingResponsibleParty: false, awaitingSince: null };
}

/**
 * The open-Appeal pair implied by a Case's Appeals list, dated from the open
 * Appeal itself.
 *
 * @param {Appeal[]} appeals
 * @returns {Partial<CaseRow>}
 */
export function openAppealFields(appeals) {
  const open = openAppealOf({ appeals });
  return { hasOpenAppeal: Boolean(open), appealRaisedAt: open?.at ?? null };
}
