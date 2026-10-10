// @ts-check
/**
 * How the save queue writes a Form, and when a rejected write is a real
 * conflict.
 *
 * A Form is a conflict when a column being saved changed under the editor
 * since they loaded it. Two people can hold the same Form open — its Employee
 * and their manager — and each writes their own fields, so a change to a
 * column this write does not touch is retried on the fresh ETag rather than
 * thrown at the editor as "edited elsewhere".
 */

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').FormItem} FormItem */
/** @typedef {import('../sharepoint-client.js').FormValue} FormValue */
/** @typedef {import('../../form-types/contract.js').FormTypeDefinition} FormTypeDefinition */
/** @typedef {import('./save-queue.js').SaveTarget} SaveTarget */

/**
 * @param {SharePointClient} client
 * @param {FormTypeDefinition} formType
 * @returns {SaveTarget}
 */
export function formSaveTarget(client, formType) {
  return {
    patch: (id, fields, etag) =>
      client.patchFormItem(
        formType,
        id,
        /** @type {Record<string, FormValue>} */ (fields),
        etag
      ),
    get: (id) => client.getFormItem(formType, id),
    baseline: (item) => structuredClone(/** @type {FormItem} */ (item).fields),
    // The page reads a Form before it can save one, and a read carries every
    // column the definition names, so both sides hold each field being saved.
    isConflict: (baseline, fresh, fields) => {
      const loaded = /** @type {Record<string, FormValue>} */ (baseline);
      const now = /** @type {FormItem} */ (fresh).fields;
      return Object.keys(fields).some(
        (column) =>
          JSON.stringify(loaded[column]) !== JSON.stringify(now[column])
      );
    },
  };
}
