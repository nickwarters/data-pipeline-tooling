// @ts-check
import { toBareAccount, toClaimsLogin } from './account-name.js';
import { CASE_STATUS } from '../lib/case-statuses.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').Message} Message */

/**
 * @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} FetchImpl
 */

/**
 * @typedef {{
 * webUrl?: string,
 * caseListName?: string,
 * questionDefinitionsListName?: string,
 * listPrefix?: string,
 * exportBasePath?: string,
 * fetchImpl?: FetchImpl,
 * sleep?: (ms: number) => Promise<void>
 * }} HttpSharePointClientOptions
 */

const ACCEPT_JSON = 'application/json;odata=nometadata';
const CONTENT_TYPE_JSON = 'application/json;odata=nometadata;charset=utf-8';
const DEFAULT_THROTTLE_MS = 1000;

export class HttpSharePointClient {
  /** @param {HttpSharePointClientOptions} [opts] */
  constructor(opts = {}) {
    this._webUrl = (opts.webUrl ?? '').replace(/\/+$/, '');
    // List names are placeholders until the SharePoint list schema is decided
    // Constructor opts let deployers override the default list and web URL.
    this._caseListName = opts.caseListName ?? 'Cases-ExampleReview';
    this._qDefListName =
      opts.questionDefinitionsListName ?? 'QuestionDefinitions';
    // Environment scoping (ADR-0033): the prefix is applied centrally in
    // _listItemUrl/_listItemsUrl so every list access — including per-Case-Type
    // `opts.listName` overrides — lands in the environment's lists. Empty for prod.
    this._listPrefix = opts.listPrefix ?? '';
    this._exportBasePath =
      opts.exportBasePath ?? '/Style%20Library/case-review/case-types';
    /** @type {FetchImpl} */
    this._fetch =
      opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this._sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    /** @type {string | null} */
    this._formDigest = null;
  }

  // --- SharePointClient interface ------------------------------------------

  /**
   * @param {string} id
   * @param {CaseListOptions} [opts]
   * @returns {Promise<CaseRow|null>}
   */
  async getCase(id, opts = {}) {
    const url = this._listItemUrl(opts.listName ?? this._caseListName, id);
    try {
      const body = await this._read(url);
      return rowFromItem(body, readEtag(body));
    } catch (err) {
      if (/** @type {any} */ (err).status === 404) return null;
      throw err;
    }
  }

  /**
   * @param {string} id
   * @param {Partial<CaseRow>} fields
   * @param {string} etag
   * @param {CaseListOptions} [opts]
   * @returns {Promise<PatchResult>}
   */
  async patchCase(id, fields, etag, opts = {}) {
    const url = this._listItemUrl(opts.listName ?? this._caseListName, id);
    const body = JSON.stringify(itemFromRow(fields));
    try {
      const data = await this._write(url, 'PATCH', { 'If-Match': etag }, body);
      if (data === null) {
        const row = await this.getCase(id, opts);
        if (!row) return { ok: false, status: 404 };
        return { ok: true, status: 204, data: row };
      }
      const newEtag = readEtag(data);
      const row = rowFromItem(data, newEtag);
      return {
        ok: true,
        status: 200,
        data: { ...row, etag: newEtag || row.etag },
      };
    } catch (err) {
      const status = /** @type {any} */ (err).status || 500;
      return { ok: false, status };
    }
  }

  /** @param {string[]} ids @returns {Promise<QuestionDefinition[]>} */
  async getQuestionDefinitions(ids) {
    if (ids.length === 0) return [];
    const filter = ids
      .map((id) => `QuestionId eq '${escapeOData(id)}'`)
      .join(' or ');
    const url =
      this._listItemsUrl(this._qDefListName) +
      `?$filter=${encodeURIComponent(filter)}`;
    const items = await this._getAllPages(url);
    return items.map(qDefFromItem);
  }

  /**
   * @param {ListCasesFilter} filter
   * @param {CaseListOptions} [opts]
   * @returns {Promise<CaseRow[]>}
   */
  async listCases(filter, opts = {}) {
    const listName = opts.listName ?? this._caseListName;
    /** @type {string[]} */
    const query = [];
    const expr = buildFilterExpr(filter);
    if (expr) query.push(`$filter=${encodeURIComponent(expr)}`);
    if (opts.orderBy) {
      const dir = opts.orderDir === 'desc' ? ' desc' : '';
      query.push(`$orderby=${encodeURIComponent(opts.orderBy + dir)}`);
    }
    if (opts.top !== undefined) query.push(`$top=${opts.top}`);
    if (opts.skip !== undefined) query.push(`$skip=${opts.skip}`);

    let url = this._listItemsUrl(listName);
    if (query.length) url += `?${query.join('&')}`;

    // A paged read (`$top`) fetches exactly the requested window — following
    // `odata.nextLink` would defeat paging and pull the whole backlog. An
    // unpaged read keeps the historical walk-every-page behaviour.
    const items =
      opts.top !== undefined
        ? await this._readPage(url)
        : await this._getAllPages(url);
    return items.map((raw) => {
      const item = /** @type {Record<string, unknown>} */ (raw);
      return rowFromItem(item, readEtag(item));
    });
  }

  /**
   * Count-only query: the OData `$count` companion to `listCases`.
   * The endpoint returns a bare integer, so a group-header or KPI count never
   * pulls a single Case row across the wire.
   *
   * @param {ListCasesFilter} filter
   * @param {CaseListOptions} [opts]
   * @returns {Promise<number>}
   */
  async countCases(filter, opts = {}) {
    const listName = opts.listName ?? this._caseListName;
    const expr = buildFilterExpr(filter);
    let url = this._listItemsUrl(listName) + '/$count';
    if (expr) url += `?$filter=${encodeURIComponent(expr)}`;
    const body = await this._read(url);
    const n = Number(body);
    return Number.isFinite(n) ? n : 0;
  }

  /** @returns {Promise<string[]>} */
  async getCurrentUserGroups() {
    const items = await this._getAllPages(
      this._absolute('/_api/web/currentUser/groups')
    );
    return items.map((g) => {
      const rec = /** @type {Record<string, unknown>} */ (g);
      return String(rec?.Title ?? rec?.LoginName ?? '');
    });
  }

  /** @returns {Promise<CurrentUser>} */
  async getCurrentUser() {
    const body = await this._read(this._absolute('/_api/web/currentUser'));
    return {
      id: toBareAccount(String(body?.LoginName ?? '')),
      displayName: String(body?.Title ?? body?.LoginName ?? ''),
    };
  }

  /**
   * Type-ahead directory search backing the people picker. Wraps the
   * people-picker REST endpoint with `PrincipalSource: 15` (all sources,
   * including the claims/directory provider) so users not yet added to this
   * site are still found. Each result's claims `Key` is reduced to a bare
   * account before returning.
   *
   * @param {string} query
   * @returns {Promise<PersonResult[]>}
   */
  async searchPeople(query) {
    const q = query.trim();
    if (q === '') return [];

    const url = this._absolute(
      '/_api/SP.UI.ApplicationPages.ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser'
    );
    const body = JSON.stringify({
      queryParams: {
        __metadata: {
          type: 'SP.UI.ApplicationPages.ClientPeoplePickerQueryParameters',
        },
        AllowEmailAddresses: true,
        AllowMultipleEntities: false,
        MaximumEntitySuggestions: 50,
        PrincipalSource: 15,
        PrincipalType: 1,
        QueryString: q,
      },
    });

    const json = await this._write(url, 'POST', {}, body);
    const raw =
      json?.value ?? /** @type {any} */ (json?.d)?.ClientPeoplePickerSearchUser;
    const entities = typeof raw === 'string' ? JSON.parse(raw) : [];
    return entities.map(personFromEntity);
  }

  /**
   * Resolve stored bare account names to authoritative display names at page
   * load. Each unique account is expanded back to a full claims login
   * (prefix + domain) and read via the User Profile Service `GetPropertiesFor`.
   * Reads are deduped and run in parallel. An account that cannot be resolved
   * (failed read, or no `DisplayName`) maps to `null` so callers fall back to the
   * cached `displayName`.
   *
   * @param {string[]} accountNames
   * @returns {Promise<Record<string, string | null>>}
   */
  async resolveUsers(accountNames) {
    const unique = [...new Set(accountNames)];
    const entries = await Promise.all(
      unique.map(async (account) => {
        const displayName = await this._resolveOneUser(account);
        return /** @type {[string, string | null]} */ ([account, displayName]);
      })
    );
    return Object.fromEntries(entries);
  }

  /**
   * @param {string} account
   * @returns {Promise<string | null>}
   */
  async _resolveOneUser(account) {
    const login = toClaimsLogin(account);
    const url = this._absolute(
      `/_api/SP.UserProfiles.PeopleManager/GetPropertiesFor(accountName=@v)?@v='${encodeURIComponent(login)}'`
    );
    try {
      const body = await this._read(url);
      const name = body?.DisplayName;
      return typeof name === 'string' && name !== '' ? name : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Reads the content-hash from the current `{slug}.json` export envelope
   *. Returns null when the file is absent or carries no `hash` field
   * — never hard-fails so a missing export does not block completion.
   *
   * @param {string} slug
   * @returns {Promise<string | null>}
   */
  async getExportHash(slug) {
    const url = this._absolute(
      `${this._exportBasePath}/${encodeURIComponent(slug)}.json`
    );
    try {
      const body = await this._read(url);
      const hash = body?.hash;
      return typeof hash === 'string' && hash !== '' ? hash : null;
    } catch {
      return null;
    }
  }

  /**
   * Fetches the immutable versioned export `{slug}.{hash}.json` (the architecture decision
   * Step 4). Returns the parsed object on success, null on any error
   * (404, network failure) — never hard-fails so a missing file triggers the
   * live-fallback path in the view model.
   *
   * @param {string} slug
   * @param {string} hash
   * @returns {Promise<import('../sharepoint-client.js').VersionedExport | null>}
   */
  async getVersionedExport(slug, hash) {
    const url = this._absolute(
      `${this._exportBasePath}/${encodeURIComponent(slug)}.${encodeURIComponent(hash)}.json`
    );
    try {
      const body = await this._read(url);
      if (!body || typeof body !== 'object') return null;
      return /** @type {import('../sharepoint-client.js').VersionedExport} */ (
        body
      );
    } catch {
      return null;
    }
  }

  // --- internals -----------------------------------------------------------

  /**
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<any>}
   */
  async _request(url, options) {
    const res = await this._fetchWithThrottle(url, options ?? {});
    if (!res.ok) {
      const err = new Error(`HTTP Error: ${res.status}`);
      // @ts-ignore
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    const data = await res.json();
    if (data && typeof data === 'object') {
      const etag = res.headers.get('ETag');
      if (etag && !data['odata.etag']) {
        data['odata.etag'] = etag;
      }
    }
    return data;
  }

  /** @param {string} url @returns {Promise<any>} */
  async _read(url) {
    return this._request(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: ACCEPT_JSON },
    });
  }

  /**
   * Reads a single response page's `value` array without following
   * `odata.nextLink` — the paged-read counterpart to `_getAllPages`.
   * @param {string} url
   * @returns {Promise<unknown[]>}
   */
  async _readPage(url) {
    const body = await this._read(url);
    return Array.isArray(body?.value)
      ? body.value
      : Array.isArray(/** @type {any} */ (body?.d)?.results)
        ? /** @type {any} */ (body.d).results
        : [];
  }

  /**
   * Walks `odata.nextLink` (or legacy `__next`) until exhausted.
   * @param {string} initialUrl
   * @returns {Promise<unknown[]>}
   */
  async _getAllPages(initialUrl) {
    /** @type {unknown[]} */
    const out = [];
    /** @type {string | null} */
    let url = initialUrl;
    while (url) {
      const body = await this._read(url);
      const items = Array.isArray(body?.value)
        ? body.value
        : Array.isArray(/** @type {any} */ (body?.d)?.results)
          ? /** @type {any} */ (body.d).results
          : [];
      out.push(...items);
      const next =
        /** @type {string|undefined} */ (body?.['odata.nextLink']) ??
        /** @type {string|undefined} */ (/** @type {any} */ (body?.d)?.__next);
      url = next ? this._absolute(next) : null;
    }
    return out;
  }

  /**
   * Write request — handles digest acquisition and 403-driven refresh.
   *
   * @param {string} url
   * @param {string} method
   * @param {Record<string, string>} extraHeaders
   * @param {string|null} body
   * @returns {Promise<any>}
   */
  async _write(url, method, extraHeaders, body) {
    const digest = await this._ensureDigest();
    try {
      return await this._request(
        url,
        buildWriteInit(method, digest, extraHeaders, body)
      );
    } catch (err) {
      if (/** @type {any} */ (err).status !== 403) throw err;
      const fresh = await this._refreshDigest();
      return this._request(
        url,
        buildWriteInit(method, fresh, extraHeaders, body)
      );
    }
  }

  /** @returns {Promise<string>} */
  async _ensureDigest() {
    if (this._formDigest) return this._formDigest;
    return this._refreshDigest();
  }

  /** @returns {Promise<string>} */
  async _refreshDigest() {
    const body = await this._request(this._absolute('/_api/contextinfo'), {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: ACCEPT_JSON },
    });
    const flat = /** @type {string|undefined} */ (body?.FormDigestValue);
    const verbose = /** @type {string|undefined} */ (
      /** @type {any} */ (body?.d)?.GetContextWebInformation?.FormDigestValue
    );
    const digest = flat ?? verbose;
    if (!digest)
      throw new Error('FormDigestValue missing from contextinfo response');
    this._formDigest = digest;
    return digest;
  }

  /**
   * Wraps fetch with 429 throttle handling. Honors `Retry-After` (seconds or HTTP-date).
   * @param {string} url
   * @param {RequestInit} init
   * @returns {Promise<Response>}
   */
  async _fetchWithThrottle(url, init) {
    while (true) {
      const res = await this._fetch(url, init);
      if (res.status !== 429) return res;
      const ra = res.headers.get('Retry-After');
      await this._sleep(parseRetryAfter(ra));
    }
  }

  /** @param {string} listName @param {string} id */
  _listItemUrl(listName, id) {
    return this._absolute(
      `/_api/web/lists/getbytitle('${encodeURIComponent(this._listPrefix + listName)}')/items('${encodeURIComponent(id)}')`
    );
  }

  /** @param {string} listName */
  _listItemsUrl(listName) {
    return this._absolute(
      `/_api/web/lists/getbytitle('${encodeURIComponent(this._listPrefix + listName)}')/items`
    );
  }

  /** @param {string} pathOrUrl */
  _absolute(pathOrUrl) {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return (
      this._webUrl + (pathOrUrl.startsWith('/') ? pathOrUrl : '/' + pathOrUrl)
    );
  }
}

// --- helpers ---------------------------------------------------------------

/**
 * @param {string} method
 * @param {string} digest
 * @param {Record<string, string>} extra
 * @param {string|null} body
 * @returns {RequestInit}
 */
function buildWriteInit(method, digest, extra, body) {
  return {
    method,
    credentials: 'include',
    headers: {
      Accept: ACCEPT_JSON,
      'Content-Type': CONTENT_TYPE_JSON,
      'X-RequestDigest': digest,
      ...extra,
    },
    body,
  };
}

/** @param {string|null} ra */
function parseRetryAfter(ra) {
  if (!ra) return DEFAULT_THROTTLE_MS;
  const seconds = Number(ra);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const epoch = Date.parse(ra);
  if (Number.isFinite(epoch)) return Math.max(0, epoch - Date.now());
  return DEFAULT_THROTTLE_MS;
}

/** @param {string} s */
function escapeOData(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * Build the OData `$filter` expression for a `ListCasesFilter`.
 * Shared by `listCases` and `countCases` so a paged read and its count are
 * always the same server-side query. Scalar fields AND together; `anyOf` ORs
 * each (parenthesised) sub-expression for the deduped headline count. Every
 * predicate targets an indexed column so the query stays cheap at scale.
 *
 * @param {ListCasesFilter} filter
 * @returns {string}
 */
function buildFilterExpr(filter) {
  /** @type {string[]} */
  const conds = [];
  // Windowed CompletedAt range leads so the indexed date column
  // does the narrowing before Status: `Status eq 'Completed'` alone matches the
  // whole cumulative backlog and is not selective past the List View Threshold.
  if (filter.completedAfter) {
    conds.push(`CompletedAt ge '${escapeOData(filter.completedAfter)}'`);
  }
  if (filter.completedBefore) {
    conds.push(`CompletedAt lt '${escapeOData(filter.completedBefore)}'`);
  }
  if (filter.status) conds.push(`Status eq '${escapeOData(filter.status)}'`);
  if (filter.assignedReviewer) {
    conds.push(
      `AssignedReviewerId eq '${escapeOData(filter.assignedReviewer)}'`
    );
  }
  if (filter.responsibleParty) {
    conds.push(
      `ResponsiblePartyId eq '${escapeOData(filter.responsibleParty)}'`
    );
  }
  if (filter.assignedReviewerManager) {
    conds.push(
      `AssignedReviewerManager eq '${escapeOData(filter.assignedReviewerManager)}'`
    );
  }
  if (filter.overdue === true) {
    conds.push(`DueDate lt '${new Date().toISOString()}'`);
    conds.push(`Status eq '${CASE_STATUS.IN_PROGRESS}'`);
  }
  // Action Centre reason flags — indexed boolean columns hoisted onto the Case
  // row so a reason count is a cheap `$count`, never a blob parse.
  if (filter.awaitingResponsibleParty !== undefined) {
    conds.push(
      `AwaitingResponsibleParty eq ${filter.awaitingResponsibleParty ? 1 : 0}`
    );
  }
  if (filter.reviewRequired !== undefined) {
    conds.push(`ReviewRequired eq ${filter.reviewRequired ? 1 : 0}`);
  }
  if (filter.hasOpenAppeal !== undefined) {
    conds.push(`HasOpenAppeal eq ${filter.hasOpenAppeal ? 1 : 0}`);
  }
  if (filter.reopened !== undefined) {
    conds.push(`Reopened eq ${filter.reopened ? 1 : 0}`);
  }
  // Bounded server-side report query by the corrected result. The
  // column is indexed, so the RP-team / true-result reports stay one $filter
  // per Case Type with no full-row fetch.
  if (filter.effectiveOutcome) {
    conds.push(`EffectiveOutcome eq '${escapeOData(filter.effectiveOutcome)}'`);
  }
  if (filter.outcomeOverridden !== undefined) {
    conds.push(`OutcomeOverridden eq ${filter.outcomeOverridden ? 1 : 0}`);
  }
  if (filter.anyOf !== undefined) {
    const ors = filter.anyOf
      .map(buildFilterExpr)
      .filter(Boolean)
      .map((e) => `(${e})`);
    if (ors.length) conds.push(`(${ors.join(' or ')})`);
  }
  return conds.join(' and ');
}

/**
 * Map a people-picker entity to a bare-account PersonResult.
 * @param {any} e
 * @returns {PersonResult}
 */
function personFromEntity(e) {
  const loginName = toBareAccount(String(e?.Key ?? ''));
  /** @type {PersonResult} */
  const out = { loginName, displayName: String(e?.DisplayText ?? loginName) };
  const email = e?.EntityData?.Email;
  if (email) out.email = String(email);
  return out;
}

/** @param {Record<string, unknown>} item */
function readEtag(item) {
  const v = item?.['odata.etag'];
  return typeof v === 'string' ? v : '';
}

/**
 * @param {Record<string, unknown>} item
 * @param {string} etag
 * @returns {CaseRow}
 */
function rowFromItem(item, etag) {
  return {
    id: String(item?.Id ?? ''),
    caseType: String(item?.CaseType ?? ''),
    title: String(item?.Title ?? ''),
    status: /** @type {import('../lib/case-statuses.js').CaseStatus} */ (
      item?.Status ?? CASE_STATUS.IN_PROGRESS
    ),
    assignedReviewer: String(item?.AssignedReviewerId ?? ''),
    responsibleParty: String(item?.ResponsiblePartyId ?? ''),
    assignedReviewerManager:
      item?.AssignedReviewerManager != null
        ? String(item.AssignedReviewerManager)
        : undefined,
    responsiblePartyManager:
      item?.ResponsiblePartyManager != null
        ? String(item.ResponsiblePartyManager)
        : undefined,
    answers: /** @type {Record<string, Answer>} */ (
      parseJsonField(item?.Answers, {})
    ),
    conversation: /** @type {Message[]} */ (
      parseJsonField(item?.Conversation, [])
    ),
    details: /** @type {Record<string, string>} */ (
      parseJsonField(item?.Details, undefined)
    ),
    notes: String(item?.Notes ?? ''),
    caseJustification:
      item?.CaseJustification != null
        ? String(item.CaseJustification)
        : undefined,
    reportableAt:
      typeof item?.ReportableAt === 'string' ? item.ReportableAt : null,
    remediationDueDate:
      typeof item?.RemediationDueDate === 'string'
        ? item.RemediationDueDate
        : null,
    completedAt:
      typeof item?.CompletedAt === 'string' ? item.CompletedAt : null,
    outcome: item?.Outcome != null ? String(item.Outcome) : undefined,
    outcomeAtCompletion:
      item?.OutcomeAtCompletion != null
        ? String(item.OutcomeAtCompletion)
        : undefined,
    questionBankVersion:
      item?.QuestionBankVersion != null
        ? String(item.QuestionBankVersion)
        : undefined,
    hadRemediation:
      item?.HadRemediation != null ? Boolean(item.HadRemediation) : undefined,
    effectiveOutcome:
      item?.EffectiveOutcome != null
        ? String(item.EffectiveOutcome)
        : undefined,
    effectiveHadRemediation:
      item?.EffectiveHadRemediation != null
        ? Boolean(item.EffectiveHadRemediation)
        : undefined,
    outcomeOverridden:
      item?.OutcomeOverridden != null
        ? Boolean(item.OutcomeOverridden)
        : undefined,
    amendedOutcome: /** @type {CaseRow['amendedOutcome']} */ (
      parseJsonField(item?.AmendedOutcome, null)
    ),
    appeals: /** @type {CaseRow['appeals']} */ (
      parseJsonField(item?.Appeals, undefined)
    ),
    dueDate: typeof item?.DueDate === 'string' ? item.DueDate : null,
    relatedDate:
      typeof item?.RelatedDate === 'string' ? item.RelatedDate : null,
    created: item?.Created != null ? String(item.Created) : undefined,
    // Derived, never read from a stored/calculated column: a Case is
    // overdue when it is still In-progress and its DueDate has passed — the same
    // rule as the overdue `$filter` above, so the group filter and the "also
    // overdue" chip can never disagree.
    overdue:
      item?.Status === CASE_STATUS.IN_PROGRESS &&
      typeof item?.DueDate === 'string' &&
      new Date(item.DueDate).getTime() < Date.now(),
    awaitingResponsibleParty:
      item?.AwaitingResponsibleParty != null
        ? Boolean(item.AwaitingResponsibleParty)
        : undefined,
    awaitingSince:
      typeof item?.AwaitingSince === 'string' ? item.AwaitingSince : null,
    reviewRequired:
      item?.ReviewRequired != null ? Boolean(item.ReviewRequired) : undefined,
    hasOpenAppeal:
      item?.HasOpenAppeal != null ? Boolean(item.HasOpenAppeal) : undefined,
    appealRaisedAt:
      typeof item?.AppealRaisedAt === 'string' ? item.AppealRaisedAt : null,
    reopened: item?.Reopened != null ? Boolean(item.Reopened) : undefined,
    reopenedAt: typeof item?.ReopenedAt === 'string' ? item.ReopenedAt : null,
    etag,
  };
}

/**
 * @param {Partial<CaseRow>} fields
 * @returns {Record<string, unknown>}
 */
function itemFromRow(fields) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (fields.title !== undefined) out.Title = fields.title;
  if (fields.status !== undefined) out.Status = fields.status;
  if (fields.notes !== undefined) out.Notes = fields.notes;
  if (fields.caseJustification !== undefined)
    out.CaseJustification = fields.caseJustification;
  if (fields.reportableAt !== undefined) out.ReportableAt = fields.reportableAt;
  if (fields.remediationDueDate !== undefined)
    out.RemediationDueDate = fields.remediationDueDate;
  if (fields.completedAt !== undefined) out.CompletedAt = fields.completedAt;
  if (fields.outcome !== undefined) out.Outcome = fields.outcome;
  if (fields.outcomeAtCompletion !== undefined)
    out.OutcomeAtCompletion = fields.outcomeAtCompletion;
  if (fields.questionBankVersion !== undefined)
    out.QuestionBankVersion = fields.questionBankVersion;
  if (fields.hadRemediation !== undefined)
    out.HadRemediation = fields.hadRemediation;
  if (fields.effectiveOutcome !== undefined)
    out.EffectiveOutcome = fields.effectiveOutcome;
  if (fields.effectiveHadRemediation !== undefined)
    out.EffectiveHadRemediation = fields.effectiveHadRemediation;
  if (fields.outcomeOverridden !== undefined)
    out.OutcomeOverridden = fields.outcomeOverridden;
  if (fields.amendedOutcome !== undefined)
    out.AmendedOutcome = JSON.stringify(fields.amendedOutcome);
  if (fields.appeals !== undefined)
    out.Appeals = JSON.stringify(fields.appeals);
  if (fields.dueDate !== undefined) out.DueDate = fields.dueDate;
  if (fields.relatedDate !== undefined) out.RelatedDate = fields.relatedDate;
  if (fields.assignedReviewer !== undefined)
    out.AssignedReviewerId = fields.assignedReviewer;
  if (fields.responsibleParty !== undefined)
    out.ResponsiblePartyId = fields.responsibleParty;
  if (fields.assignedReviewerManager !== undefined)
    out.AssignedReviewerManager = fields.assignedReviewerManager;
  if (fields.responsiblePartyManager !== undefined)
    out.ResponsiblePartyManager = fields.responsiblePartyManager;
  // Action Centre state reason flags + paired clocks.
  // Plain app-written columns — the write counterpart to their reads in
  // `rowFromItem`. Without these an app-set flag would be silently dropped on
  // PATCH, leaving the reason group empty/stale against the real backend.
  if (fields.awaitingResponsibleParty !== undefined)
    out.AwaitingResponsibleParty = fields.awaitingResponsibleParty;
  if (fields.awaitingSince !== undefined)
    out.AwaitingSince = fields.awaitingSince;
  if (fields.reviewRequired !== undefined)
    out.ReviewRequired = fields.reviewRequired;
  if (fields.hasOpenAppeal !== undefined)
    out.HasOpenAppeal = fields.hasOpenAppeal;
  if (fields.appealRaisedAt !== undefined)
    out.AppealRaisedAt = fields.appealRaisedAt;
  if (fields.reopened !== undefined) out.Reopened = fields.reopened;
  if (fields.reopenedAt !== undefined) out.ReopenedAt = fields.reopenedAt;
  if (fields.answers !== undefined)
    out.Answers = JSON.stringify(fields.answers);
  if (fields.conversation !== undefined)
    out.Conversation = JSON.stringify(fields.conversation);
  if (fields.details !== undefined)
    out.Details = JSON.stringify(fields.details);
  return out;
}

/**
 * @param {unknown} raw
 * @param {unknown} fallback
 */
function parseJsonField(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {unknown} raw
 * @returns {QuestionDefinition}
 */
function qDefFromItem(raw) {
  const item = /** @type {Record<string, unknown>} */ (raw);
  const responseType =
    item?.ResponseType === 'single-choice' ||
    item?.ResponseType === 'multi-choice' ||
    item?.ResponseType === 'outcome'
      ? item.ResponseType
      : 'yes-no-na';
  const opts = parseJsonField(item?.Options, undefined);
  const showWhen = parseJsonField(item?.ShowWhen, undefined);
  const remediation = parseJsonField(item?.RemediationActions, undefined);
  const optionOutcomes = parseJsonField(item?.OptionOutcomes, undefined);
  return {
    id: String(item?.QuestionId ?? item?.Id ?? ''),
    text: String(item?.QuestionText ?? item?.Title ?? ''),
    responseType:
      /** @type {'yes-no-na'|'single-choice'|'multi-choice'|'outcome'} */ (
        responseType
      ),
    options: Array.isArray(opts) ? /** @type {string[]} */ (opts) : undefined,
    optionOutcomes:
      optionOutcomes && typeof optionOutcomes === 'object'
        ? /** @type {Record<string, string>} */ (optionOutcomes)
        : undefined,
    showWhen:
      showWhen && typeof showWhen === 'object'
        ? /** @type {Record<string, unknown>} */ (showWhen)
        : undefined,
    failureCriteria:
      typeof item?.FailureCriteria === 'string'
        ? item.FailureCriteria
        : undefined,
    remediationActions: Array.isArray(remediation)
      ? /** @type {import('../sharepoint-client.js').QuestionDefinition['remediationActions']} */ (
          remediation
        )
      : undefined,
    deprecated: Boolean(item?.Deprecated ?? false),
  };
}
