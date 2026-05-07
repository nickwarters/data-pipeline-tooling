// @ts-check
// Stub — full implementation in issue #10 (HttpSharePointClient — real REST).

export class HttpSharePointClient {
  /** @param {string} _id @returns {Promise<import('./sharepoint-client.js').CaseRow|null>} */
  async getCase(_id) { throw new Error('HttpSharePointClient not yet implemented — see issue #10'); }

  /**
   * @param {string} _id
   * @param {Partial<import('./sharepoint-client.js').CaseRow>} _fields
   * @param {string} _etag
   * @returns {Promise<import('./sharepoint-client.js').PatchResult>}
   */
  async patchCase(_id, _fields, _etag) { throw new Error('HttpSharePointClient not yet implemented — see issue #10'); }

  /** @param {string[]} _ids @returns {Promise<import('./sharepoint-client.js').QuestionDefinition[]>} */
  async getQuestionDefinitions(_ids) { throw new Error('HttpSharePointClient not yet implemented — see issue #10'); }

  /** @param {import('./sharepoint-client.js').ListCasesFilter} _filter @returns {Promise<import('./sharepoint-client.js').CaseRow[]>} */
  async listCases(_filter) { throw new Error('HttpSharePointClient not yet implemented — see issue #10'); }

  /** @returns {Promise<string[]>} */
  async getCurrentUserGroups() { throw new Error('HttpSharePointClient not yet implemented — see issue #10'); }

  /** @returns {Promise<import('./sharepoint-client.js').CurrentUser>} */
  async getCurrentUser() { throw new Error('HttpSharePointClient not yet implemented — see issue #10'); }
}
