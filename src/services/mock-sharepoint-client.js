// @ts-check
// TODO(simplify-ui): Keep service access as explicit plain dependencies
// passed into route shells/function components. The simplified UI should not
// require component authors to understand service classes, global singletons,
// or lifecycle wiring to perform ordinary reads and writes.

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */

/** @typedef {import('../sharepoint-client.js').VersionedExport} VersionedExport */

export class MockSharePointClient {
  /**
   * @param {{
   *   cases: CaseRow[],
   *   questionDefinitions: QuestionDefinition[],
   *   personas: Record<string, { groups: string[], userId?: string, displayName?: string }>,
   *   persona?: string,
   *   people?: PersonResult[],
   *   exportHashes?: Record<string, string>,
   *   versionedExports?: Record<string, VersionedExport>,
   *   lists?: Record<string, CaseRow[]>
   * }} opts
   */
  constructor({
    cases,
    questionDefinitions,
    personas,
    persona = 'reviewer',
    people = [],
    exportHashes = /** @type {Record<string, string>} */ ({}),
    versionedExports = /** @type {Record<string, VersionedExport>} */ ({}),
    lists = /** @type {Record<string, CaseRow[]>} */ ({}),
  }) {
    // Deep-clone cases so fixture arrays are not mutated across tests.
    this._cases = cases.map((c) => ({ ...c, answers: { ...c.answers } }));
    this._questionDefinitions = questionDefinitions.slice();
    this._personas = personas;
    this._persona = persona;
    this._people = people.slice();
    this._exportHashes = exportHashes;
    this._versionedExports = versionedExports;
    this._lists = Object.fromEntries(
      Object.entries(lists).map(([listName, rows]) => [
        listName,
        rows.map((c) => ({ ...c, answers: { ...c.answers } })),
      ])
    );
    this._etagCounter = 1000;
    this._injectNext412 = false;
  }

  /** Make the next call to patchCase return 412 without writing. */
  inject412() {
    this._injectNext412 = true;
  }

  /**
   * @param {string} id
   * @param {CaseListOptions} [opts]
   * @returns {Promise<CaseRow|null>}
   */
  async getCase(id, opts = {}) {
    const c = this._caseStore(opts).find((c) => c.id === id);
    return c ? { ...c } : null;
  }

  /**
   * @param {string} id
   * @param {Partial<CaseRow>} fields
   * @param {string} etag
   * @param {CaseListOptions} [opts]
   * @returns {Promise<PatchResult>}
   */
  async patchCase(id, fields, etag, opts = {}) {
    console.log('MockSharePointClient.patchCase payload', {
      id,
      etag,
      fields,
    });

    if (this._injectNext412) {
      this._injectNext412 = false;
      return { ok: false, status: 412 };
    }

    const cases = this._caseStore(opts);
    const idx = cases.findIndex((c) => c.id === id);
    if (idx === -1) return { ok: false, status: 404 };
    if (cases[idx].etag !== etag) return { ok: false, status: 412 };

    const newEtag = String(++this._etagCounter);
    cases[idx] = /** @type {CaseRow} */ ({
      ...cases[idx],
      ...fields,
      etag: newEtag,
    });
    return { ok: true, status: 200, data: { ...cases[idx] } };
  }

  /** @param {CaseListOptions} [opts] */
  _caseStore(opts = {}) {
    return opts.listName ? (this._lists[opts.listName] ?? []) : this._cases;
  }

  /**
   * @param {string[]} ids
   * @returns {Promise<QuestionDefinition[]>}
   */
  async getQuestionDefinitions(ids) {
    return this._questionDefinitions.filter((q) => ids.includes(q.id));
  }

  /**
   * @param {ListCasesFilter} filter
   * @param {CaseListOptions} [_opts]
   * @returns {Promise<CaseRow[]>}
   */
  async listCases(filter, _opts = {}) {
    return this._cases
      .filter((c) => {
        if (filter.status !== undefined && c.status !== filter.status)
          return false;
        if (
          filter.assignedReviewer !== undefined &&
          c.assignedReviewer !== filter.assignedReviewer
        )
          return false;
        if (filter.caseType !== undefined && c.caseType !== filter.caseType)
          return false;
        if (
          filter.responsibleParty !== undefined &&
          c.responsibleParty !== filter.responsibleParty
        )
          return false;
        if (
          filter.assignedReviewerManager !== undefined &&
          c.assignedReviewerManager !== filter.assignedReviewerManager
        )
          return false;
        if (
          filter.effectiveOutcome !== undefined &&
          c.effectiveOutcome !== filter.effectiveOutcome
        )
          return false;
        if (
          filter.outcomeOverridden !== undefined &&
          c.outcomeOverridden !== filter.outcomeOverridden
        )
          return false;
        if (filter.overdue === true) {
          if (c.status === 'Completed') return false;
          if (!c.dueDate) return false;
          if (new Date(c.dueDate) >= new Date()) return false;
        }
        return true;
      })
      .map((c) => ({ ...c }));
  }

  /** @returns {Promise<string[]>} */
  async getCurrentUserGroups() {
    return this._personas[this._persona]?.groups ?? [];
  }

  /**
   * @param {string} query
   * @returns {Promise<PersonResult[]>}
   */
  async searchPeople(query) {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return this._people
      .filter(
        (p) =>
          p.displayName.toLowerCase().includes(q) ||
          p.loginName.toLowerCase().includes(q)
      )
      .map((p) => ({ ...p }));
  }

  /**
   * Resolve bare account names to authoritative display names from the fixture
   * directory (ADR-0013). Dedupes input; an account with no directory match
   * resolves to `null` so callers fall back to the cached displayName.
   *
   * @param {string[]} accountNames
   * @returns {Promise<Record<string, string | null>>}
   */
  async resolveUsers(accountNames) {
    /** @type {Record<string, string | null>} */
    const out = {};
    for (const account of accountNames) {
      if (account in out) continue;
      const person = this._people.find((p) => p.loginName === account);
      out[account] = person ? person.displayName : null;
    }
    return out;
  }

  /** @returns {Promise<import('../sharepoint-client.js').CurrentUser>} */
  async getCurrentUser() {
    const p = this._personas[this._persona];
    return {
      id: p?.userId ?? this._persona,
      displayName: p?.displayName ?? this._persona,
    };
  }

  /**
   * Returns the content hash for the current {slug}.json export envelope, or
   * null when no hash is configured for this slug (ADR-0021).
   *
   * @param {string} slug
   * @returns {Promise<string | null>}
   */
  async getExportHash(slug) {
    return this._exportHashes[slug] ?? null;
  }

  /**
   * Returns the versioned export for the given slug+hash, or null when no
   * matching export is configured (ADR-0021 Step 4).
   *
   * @param {string} _slug
   * @param {string} hash
   * @returns {Promise<VersionedExport | null>}
   */
  async getVersionedExport(_slug, hash) {
    return this._versionedExports[hash] ?? null;
  }
}
