// @ts-check

import { resolveReviewerManager } from './reviewer-manager.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */

/**
 * Pairs the Responsible Party with their manager: naming a Responsible Party
 * records the manager the directory gives for them, clearing the Responsible
 * Party clears the manager, and a write that says nothing about the
 * Responsible Party is returned untouched.
 *
 * The manager is written in the same save as the Responsible Party rather than
 * by the page afterwards. A second save could land on its own, leaving the new
 * Responsible Party beside the previous one's manager, and a lookup still
 * running when the Reviewer picks someone else could write the wrong manager
 * last. A lookup that fails records nobody rather than failing the save:
 * choosing who the Remediation Actions go to must not depend on the profile
 * service, and an empty manager is never someone else's.
 *
 * A write that names the manager itself is left as it is. Both clients apply
 * this, for the reason given beside `withAssignmentStamp`. The input is never
 * mutated.
 *
 * @param {Partial<CaseRow>} fields
 * @param {import('../sharepoint-client.js').SharePointClient} client
 * @returns {Promise<Partial<CaseRow>>}
 */
export async function withResponsiblePartyManager(fields, client) {
  if (fields.responsibleParty === undefined) return fields;
  if (fields.responsiblePartyManager !== undefined) return fields;
  const party = fields.responsibleParty;
  return {
    ...fields,
    responsiblePartyManager: party
      ? await resolveReviewerManager(client, party)
      : null,
  };
}
