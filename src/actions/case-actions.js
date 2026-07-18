// @ts-check
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../services/save-queue.js').SaveQueue} SaveQueue */

/**
 * Example effect: persistence stays outside views and its result re-enters the
 * app only through dispatch. SaveQueue retains all debounce and ETag behaviour.
 *
 * @param {{
 *   client: SharePointClient,
 *   saveQueue: SaveQueue,
 *   dispatch: (action: { type: 'case/saved', case: import('../sharepoint-client.js').CaseRow }) => unknown,
 *   caseId: string,
 *   listName: string,
 *   notes: string,
 * }} input
 */
export async function saveCaseNotes({
  client,
  saveQueue,
  dispatch,
  caseId,
  listName,
  notes,
}) {
  const options = { listName };
  const current = await client.getCase(caseId, options);
  if (!current) throw new Error(`Case ${caseId} was not found`);

  saveQueue.loadCase(current, options);
  saveQueue.enqueue(caseId, 'notes', notes);
  await saveQueue.whenIdle();

  const saved = await client.getCase(caseId, options);
  if (!saved) throw new Error(`Case ${caseId} disappeared after save`);
  dispatch({ type: 'case/saved', case: saved });
}
