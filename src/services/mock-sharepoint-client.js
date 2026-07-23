// @ts-check
import { CASE_STATUS } from '../lib/case-statuses.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../sharepoint-client.js').RoadmapItem} RoadmapItem */

/** @typedef {import('../sharepoint-client.js').VersionedExport} VersionedExport */

export class MockSharePointClient {
  /**
   * @param {{
   * personas: Record<string, { groups: string[], userId?: string, displayName?: string }>,
   * persona?: string,
   * people?: PersonResult[],
   * exportHashes?: Record<string, string>,
   * versionedExports?: Record<string, VersionedExport>,
   * lists?: Record<string, CaseRow[]>,
   * roadmapItems?: RoadmapItem[]
   * }} opts
   */
  constructor({
    personas,
    persona = 'reviewer',
    people = [],
    exportHashes = /** @type {Record<string, string>} */ ({}),
    versionedExports = /** @type {Record<string, VersionedExport>} */ ({}),
    lists = /** @type {Record<string, CaseRow[]>} */ ({}),
    roadmapItems = [],
  }) {
    this._personas = personas;
    this._persona = persona;
    this._people = people.slice();
    this._exportHashes = exportHashes;
    this._versionedExports = versionedExports;
    this._roadmapItems = roadmapItems.map((item) => ({
      ...item,
      labels: item.labels.slice(),
    }));
    // Every Case lives in a named per-Case-Type list store — there is no
    // default store. Deep-clone so fixture arrays are not mutated across tests.
    this._lists = Object.fromEntries(
      Object.entries(lists).map(([listName, rows]) => [
        listName,
        rows.map((c) => ({ ...c, answers: { ...c.answers } })),
      ])
    );
    this._etagCounter = 1000;
    this._injectNext412 = false;
  }

  /**
   * Return a deep-cloned snapshot of the mutable per-list Case stores. Intended
   * for file-backed workflow tests that need to persist the resulting state.
   *
   * @returns {{ lists: Record<string, CaseRow[]> }}
   */
  snapshot() {
    return {
      lists: Object.fromEntries(
        Object.entries(this._lists).map(([listName, rows]) => [
          listName,
          rows.map(cloneCase),
        ])
      ),
    };
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

  /**
   * The named list's store. `listName` is mandatory — there is no default
   * store, so a caller that omits it fails loudly.
   *
   * @param {CaseListOptions} [opts]
   * @returns {CaseRow[]}
   */
  _caseStore(opts = {}) {
    if (!opts.listName) {
      throw new Error(
        'MockSharePointClient: opts.listName is required — every Case ' +
          'read/write must name its list (there is no default Case store).'
      );
    }
    return this._lists[opts.listName] ?? [];
  }

  /**
   * A predicate for one `ListCasesFilter`. Scalar fields are ANDed equalities;
   * `overdue` is the In-progress + past-due derivation; `anyOf` ORs sub-filters
   *. Shared by `listCases` and `countCases` so a filtered count and
   * its paged rows can never drift apart within a single point-in-time read.
   *
   * @param {ListCasesFilter} filter
   * @returns {(c: CaseRow) => boolean}
   */
  _predicate(filter) {
    return (c) => {
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
      if (
        filter.awaitingResponsibleParty !== undefined &&
        Boolean(c.awaitingResponsibleParty) !== filter.awaitingResponsibleParty
      )
        return false;
      if (
        filter.reviewRequired !== undefined &&
        Boolean(c.reviewRequired) !== filter.reviewRequired
      )
        return false;
      if (filter.onHold !== undefined && Boolean(c.onHold) !== filter.onHold)
        return false;
      if (
        filter.hasOpenAppeal !== undefined &&
        Boolean(c.hasOpenAppeal) !== filter.hasOpenAppeal
      )
        return false;
      if (
        filter.reopened !== undefined &&
        Boolean(c.reopened) !== filter.reopened
      )
        return false;
      if (filter.overdue === true) {
        if (c.status === CASE_STATUS.COMPLETED) return false;
        if (!c.dueDate) return false;
        if (new Date(c.dueDate) >= new Date()) return false;
      }
      // CompletedAt window: inclusive lower, exclusive upper, so
      // adjacent per-day slices sum without double-counting a boundary Case.
      if (filter.completedAfter !== undefined) {
        if (!c.completedAt || c.completedAt < filter.completedAfter)
          return false;
      }
      if (filter.completedBefore !== undefined) {
        if (!c.completedAt || c.completedAt >= filter.completedBefore)
          return false;
      }
      if (filter.anyOf !== undefined) {
        if (!filter.anyOf.some((sub) => this._predicate(sub)(c))) return false;
      }
      return true;
    };
  }

  /**
   * @param {ListCasesFilter} filter
   * @param {CaseListOptions} [opts]
   * @returns {Promise<CaseRow[]>}
   */
  async listCases(filter, opts = {}) {
    let rows = this._caseStore(opts).filter(this._predicate(filter));

    if (opts.orderBy) {
      const key = /** @type {keyof CaseRow} */ (opts.orderBy);
      const dir = opts.orderDir === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        const av = a[key] ?? '';
        const bv = b[key] ?? '';
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }

    const skip = opts.skip ?? 0;
    const end = opts.top !== undefined ? skip + opts.top : undefined;
    return rows.slice(skip, end).map((c) => ({ ...c }));
  }

  /**
   * Count-only query: the cheap `$count` companion to `listCases`.
   * Drives every Action Centre group-header count and the deduped headline
   * without ever holding the matched rows in memory.
   *
   * @param {ListCasesFilter} filter
   * @param {CaseListOptions} [opts]
   * @returns {Promise<number>}
   */
  async countCases(filter, opts = {}) {
    return this._caseStore(opts).filter(this._predicate(filter)).length;
  }

  /** @returns {Promise<RoadmapItem[]>} */
  async listRoadmapItems() {
    return this._roadmapItems.map((item) => ({
      ...item,
      labels: item.labels.slice(),
    }));
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
   * directory. Dedupes input; an account with no directory match
   * resolves to `null` so callers fall back to the cached displayName.
   *
   * @param {string[]} accountNames
   * @returns {Promise<Record<string, string | null>>}
   */
  async resolveUsers(accountNames) {
    /** @type {Record<string, string | null>} */
    const out = {};
    for (const account of accountNames) {
      // Own-key check, not `in`: an account name that collides with an
      // Object.prototype member (e.g. "toString") must still be assigned,
      // matching HttpSharePointClient's Set-based dedupe.
      if (Object.prototype.hasOwnProperty.call(out, account)) continue;
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
   * null when no hash is configured for this slug.
   *
   * @param {string} slug
   * @returns {Promise<string | null>}
   */
  async getExportHash(slug) {
    return this._exportHashes[slug] ?? null;
  }

  /**
   * Returns the versioned export for the given slug+hash, or null when no
   * matching export is configured.
   *
   * @param {string} _slug
   * @param {string} hash
   * @returns {Promise<VersionedExport | null>}
   */
  async getVersionedExport(_slug, hash) {
    return this._versionedExports[hash] ?? null;
  }
}

/** @param {CaseRow} row */
function cloneCase(row) {
  return structuredClone(row);
}
