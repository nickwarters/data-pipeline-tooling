// @ts-check
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */

export class MockSharePointClient {
  /**
   * @param {{
   *   cases: CaseRow[],
   *   questionDefinitions: QuestionDefinition[],
   *   personas: Record<string, { groups: string[], userId?: string, displayName?: string }>,
   *   persona?: string
   * }} opts
   */
  constructor({ cases, questionDefinitions, personas, persona = 'reviewer' }) {
    // Deep-clone cases so fixture arrays are not mutated across tests.
    this._cases = cases.map(c => ({ ...c, answers: { ...c.answers } }));
    this._questionDefinitions = questionDefinitions.slice();
    this._personas = personas;
    this._persona = persona;
    this._etagCounter = 1000;
    this._injectNext412 = false;
  }

  /** Make the next call to patchCase return 412 without writing. */
  inject412() {
    this._injectNext412 = true;
  }

  /**
   * @param {string} id
   * @returns {Promise<CaseRow|null>}
   */
  async getCase(id) {
    const c = this._cases.find(c => c.id === id);
    return c ? { ...c } : null;
  }

  /**
   * @param {string} id
   * @param {Partial<CaseRow>} fields
   * @param {string} etag
   * @returns {Promise<PatchResult>}
   */
  async patchCase(id, fields, etag) {
    if (this._injectNext412) {
      this._injectNext412 = false;
      return { ok: false, status: 412 };
    }

    const idx = this._cases.findIndex(c => c.id === id);
    if (idx === -1) return { ok: false, status: 404 };
    if (this._cases[idx].etag !== etag) return { ok: false, status: 412 };

    const newEtag = String(++this._etagCounter);
    this._cases[idx] = /** @type {CaseRow} */ ({ ...this._cases[idx], ...fields, etag: newEtag });
    return { ok: true, status: 200, data: { ...this._cases[idx] } };
  }

  /**
   * @param {string[]} ids
   * @returns {Promise<QuestionDefinition[]>}
   */
  async getQuestionDefinitions(ids) {
    return this._questionDefinitions.filter(q => ids.includes(q.id));
  }

  /**
   * @param {ListCasesFilter} filter
   * @returns {Promise<CaseRow[]>}
   */
  async listCases(filter) {
    return this._cases
      .filter(c => {
        if (filter.status !== undefined && c.status !== filter.status) return false;
        if (filter.assignedReviewer !== undefined && c.assignedReviewer !== filter.assignedReviewer) return false;
        if (filter.caseType !== undefined && c.caseType !== filter.caseType) return false;
        if (filter.responsibleParty !== undefined && c.responsibleParty !== filter.responsibleParty) return false;
        if (filter.assignedReviewerManager !== undefined && c.assignedReviewerManager !== filter.assignedReviewerManager) return false;
        if (filter.overdue === true) {
          if (c.status === 'Completed') return false;
          if (!c.dueDate) return false;
          if (new Date(c.dueDate) >= new Date()) return false;
        }
        return true;
      })
      .map(c => ({ ...c }));
  }

  /** @returns {Promise<string[]>} */
  async getCurrentUserGroups() {
    return this._personas[this._persona]?.groups ?? [];
  }

  /** @returns {Promise<import('../sharepoint-client.js').CurrentUser>} */
  async getCurrentUser() {
    const p = this._personas[this._persona];
    return {
      id: p?.userId ?? this._persona,
      displayName: p?.displayName ?? this._persona,
    };
  }
}
