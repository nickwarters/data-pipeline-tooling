// @ts-check
// TODO(simplify-ui): Keep service access as explicit plain dependencies
// passed into route shells/function components. The simplified UI should not
// require component authors to understand service classes, global singletons,
// or lifecycle wiring to perform ordinary reads and writes.

import { toBareAccount, toClaimsLogin } from './account-name.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').Message} Message */

/**
 * @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} FetchImpl
 */

/**
 * @typedef {{
 *   webUrl?: string,
 *   caseListName?: string,
 *   questionDefinitionsListName?: string,
 *   fetchImpl?: FetchImpl,
 *   sleep?: (ms: number) => Promise<void>
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
    // (deferred per docs/PLAN.md slice 2). Constructor opts let deployers override.
    this._caseListName = opts.caseListName ?? 'Cases-ExampleReview';
    this._qDefListName =
      opts.questionDefinitionsListName ?? 'QuestionDefinitions';
    /** @type {FetchImpl} */
    this._fetch =
      opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this._sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    /** @type {string | null} */
    this._formDigest = null;
  }

  // --- SharePointClient interface ------------------------------------------

  /** @param {string} id @returns {Promise<CaseRow|null>} */
  async getCase(id) {
    const url = this._listItemUrl(this._caseListName, id);
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
   * @returns {Promise<PatchResult>}
   */
  async patchCase(id, fields, etag) {
    const url = this._listItemUrl(this._caseListName, id);
    const body = JSON.stringify(itemFromRow(fields));
    try {
      const data = await this._write(url, 'PATCH', { 'If-Match': etag }, body);
      if (data === null) {
        const row = await this.getCase(id);
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

  /** @param {ListCasesFilter} filter @returns {Promise<CaseRow[]>} */
  async listCases(filter) {
    /** @type {string[]} */
    const conds = [];
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
      conds.push(`Status eq 'In-progress'`);
    }
    // Bounded server-side report query by the corrected result (ADR-0019). The
    // column is indexed, so the RP-team / true-result reports stay one $filter
    // per Case Type with no full-row fetch.
    if (filter.effectiveOutcome) {
      conds.push(
        `EffectiveOutcome eq '${escapeOData(filter.effectiveOutcome)}'`
      );
    }
    if (filter.outcomeOverridden !== undefined) {
      conds.push(`OutcomeOverridden eq ${filter.outcomeOverridden ? 1 : 0}`);
    }
    let url = this._listItemsUrl(this._caseListName);
    if (conds.length)
      url += `?$filter=${encodeURIComponent(conds.join(' and '))}`;
    const items = await this._getAllPages(url);
    return items.map((raw) => {
      const item = /** @type {Record<string, unknown>} */ (raw);
      return rowFromItem(item, readEtag(item));
    });
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
   * account before returning (ADR-0013).
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
   * load (ADR-0013). Each unique account is expanded back to a full claims login
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
   * (ADR-0021). Returns null when the file is absent or carries no `hash` field
   * — never hard-fails so a missing export does not block completion.
   *
   * @param {string} slug
   * @returns {Promise<string | null>}
   */
  async getExportHash(slug) {
    const url = this._absolute(
      `/Style%20Library/case-review/case-types/${encodeURIComponent(slug)}.json`
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
   * Fetches the immutable versioned export `{slug}.{hash}.json` (ADR-0021
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
      `/Style%20Library/case-review/case-types/${encodeURIComponent(slug)}.${encodeURIComponent(hash)}.json`
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
      `/_api/web/lists/getbytitle('${encodeURIComponent(listName)}')/items('${encodeURIComponent(id)}')`
    );
  }

  /** @param {string} listName */
  _listItemsUrl(listName) {
    return this._absolute(
      `/_api/web/lists/getbytitle('${encodeURIComponent(listName)}')/items`
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
    status: /** @type {'In-progress' | 'Completed'} */ (
      item?.Status ?? 'In-progress'
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
    overrides: /** @type {CaseRow['overrides']} */ (
      parseJsonField(item?.Overrides, undefined)
    ),
    appeals: /** @type {CaseRow['appeals']} */ (
      parseJsonField(item?.Appeals, undefined)
    ),
    sourceCaseId:
      item?.SourceCaseId != null ? String(item.SourceCaseId) : undefined,
    dueDate: typeof item?.DueDate === 'string' ? item.DueDate : null,
    relatedDate:
      typeof item?.RelatedDate === 'string' ? item.RelatedDate : null,
    created: item?.Created != null ? String(item.Created) : undefined,
    overdue: item?.Overdue != null ? Boolean(item.Overdue) : undefined,
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
  if (fields.overrides !== undefined)
    out.Overrides = JSON.stringify(fields.overrides);
  if (fields.appeals !== undefined)
    out.Appeals = JSON.stringify(fields.appeals);
  if (fields.sourceCaseId !== undefined) out.SourceCaseId = fields.sourceCaseId;
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
    item?.ResponseType === 'multi-choice'
      ? item.ResponseType
      : 'yes-no-na';
  const opts = parseJsonField(item?.Options, undefined);
  const showWhen = parseJsonField(item?.ShowWhen, undefined);
  const remediation = parseJsonField(item?.RemediationActions, undefined);
  const outcome = parseJsonField(item?.Outcome, undefined);
  return {
    id: String(item?.QuestionId ?? item?.Id ?? ''),
    text: String(item?.QuestionText ?? item?.Title ?? ''),
    responseType: /** @type {'yes-no-na'|'single-choice'|'multi-choice'} */ (
      responseType
    ),
    options: Array.isArray(opts) ? /** @type {string[]} */ (opts) : undefined,
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
    outcome:
      outcome && typeof outcome === 'object'
        ? /** @type {import('../sharepoint-client.js').QuestionDefinition['outcome']} */ (
            outcome
          )
        : undefined,
    deprecated: Boolean(item?.Deprecated ?? false),
  };
}
