// @ts-check
import { toBareAccount, toClaimsLogin } from './account-name.js';
import { withAssignmentStamp } from './assignment-stamp.js';
import { CASE_STATUS } from '../lib/case-statuses.js';
import {
  isOverdue,
  OVERDUE_STATUSES,
} from '../evaluators/overdue-evaluator.js';
import {
  BANKS_DIR,
  bankArtifactName,
  versionedExportName,
} from '../lib/bank-artifacts.js';
import { bankVersionHash } from '../lib/bank-version.js';

/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').PersonResult} PersonResult */
/** @typedef {import('../sharepoint-client.js').ListCasesFilter} ListCasesFilter */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('../sharepoint-client.js').CaseReadOptions} CaseReadOptions */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */
/** @typedef {import('../sharepoint-client.js').CurrentUser} CurrentUser */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').Message} Message */
/** @typedef {import('../sharepoint-client.js').RoadmapItem} RoadmapItem */

/**
 * @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} FetchImpl
 */

/**
 * @typedef {{
 * webUrl?: string,
 * listPrefix?: string,
 * fetchImpl?: FetchImpl,
 * sleep?: (ms: number) => Promise<void>,
 * now?: () => Date
 * }} HttpSharePointClientOptions
 */

const ACCEPT_JSON = 'application/json;odata=nometadata';
const CONTENT_TYPE_JSON = 'application/json;odata=nometadata;charset=utf-8';
const DEFAULT_THROTTLE_MS = 1000;
const ROADMAP_LIST_NAME = 'Roadmap';
const ROADMAP_STATUSES = new Set(['LIVE', 'IN PROGRESS', 'UPCOMING']);

// Page size for `countCases`' Id-only read. 5,000 is SharePoint's List View
// Threshold and the largest page it will serve; anything beyond it comes back
// through `odata.nextLink`.
const COUNT_PAGE_SIZE = 5000;

/**
 * `CaseListOptions.orderBy` is a `CaseRow` key — the vocabulary every caller and
 * `MockSharePointClient` already speak. OData `$orderby`, by contrast, takes the
 * SharePoint **internal column name**, which is PascalCase and case-sensitive
 * (see the column schema in `docs/case-type-onboarding.md`). Sorting is the one
 * place a raw key would otherwise reach the wire untranslated, so the sortable
 * keys are mapped here, alongside `buildFilterExpr`/`itemFromRow` doing the same
 * for filters and writes.
 *
 * @type {Record<string, string>}
 */
const ORDER_BY_COLUMNS = {
  id: 'Id',
  title: 'Title',
  status: 'Status',
  created: 'Created',
  assignedAt: 'AssignedAt',
  dueDate: 'DueDate',
  relatedDate: 'RelatedDate',
  completedAt: 'CompletedAt',
  reportableAt: 'ReportableAt',
  remediationDueDate: 'RemediationDueDate',
  awaitingSince: 'AwaitingSince',
  appealRaisedAt: 'AppealRaisedAt',
  placedOnHoldAt: 'PlacedOnHoldAt',
};

/**
 * The projection every Case row read carries.
 *
 * All five people on a row — `AssignedReviewer`, `ResponsibleParty`, their two
 * manager columns, and `VoidedBy` — are Person columns, and SharePoint answers
 * one with the numeric User Information List id (the `…Id` twin) unless the
 * lookup is expanded. That number is a transport detail of a single site
 * collection — it is allocated on first use, re-allocated if the entry or the
 * AD account is removed, and means nothing anywhere else — while the whole
 * application keys identity on the bare account name, right down to which
 * Sections a viewer may open. So the read expands every person and takes the
 * claims login off each.
 *
 * Only the Responsible Party's `Title` is asked for: it is the one of the five
 * a view names a person by. The others are matched, never displayed from the
 * row, so widening the projection for them would buy nothing.
 *
 * The `*` is load-bearing: naming the people's sub-fields turns the read into a
 * projection, and without it every other column would silently stop coming back.
 */
const CASE_SELECT =
  '$select=*,AssignedReviewer/Name,ResponsibleParty/Name,ResponsibleParty/Title,' +
  'AssignedReviewerManager/Name,ResponsiblePartyManager/Name,VoidedBy/Name';
const CASE_EXPAND =
  '$expand=AssignedReviewer,ResponsibleParty,AssignedReviewerManager,ResponsiblePartyManager,VoidedBy';

/** @typedef {{ Key?: unknown, Value?: unknown }} UserProfileProperty */

/**
 * @param {unknown} body
 * @returns {{ displayName: string | null, manager: string | null }}
 */
function profileFromProperties(body) {
  const profile = /** @type {any} */ (body);
  const displayName = profile?.DisplayName;
  const rawProperties = profile?.UserProfileProperties;
  /** @type {UserProfileProperty[]} */
  const properties = Array.isArray(rawProperties)
    ? rawProperties
    : Array.isArray(rawProperties?.results)
      ? rawProperties.results
      : [];
  const managerProperty = properties.find(
    (property) => property?.Key === 'Manager'
  );
  const rawManager = managerProperty?.Value;
  const manager =
    typeof rawManager === 'string' && rawManager !== ''
      ? toBareAccount(rawManager).toLowerCase()
      : '';
  return {
    displayName:
      typeof displayName === 'string' && displayName !== ''
        ? displayName
        : null,
    manager: manager === '' ? null : manager,
  };
}

export class HttpSharePointClient {
  /** @param {HttpSharePointClientOptions} [opts] */
  constructor(opts = {}) {
    this._webUrl = (opts.webUrl ?? '').replace(/\/+$/, '');
    // There is no default Case list: every Case read/write must name its list
    // explicitly via `opts.listName` (a Case Type's declared `listName`), so a
    // caller that forgets fails loudly rather than silently hitting one list.
    // Environment scoping: the prefix is applied centrally in
    // _listItemUrl/_listItemsUrl so every list access — including per-Case-Type
    // `opts.listName` overrides — lands in the environment's lists. Empty for prod.
    this._listPrefix = opts.listPrefix ?? '';
    /** @type {FetchImpl} */
    this._fetch =
      opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this._sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    // The clock the write path stamps assignment times from, injected so a test
    // can freeze it rather than assert around "roughly now".
    this._now = opts.now ?? (() => new Date());
    /** @type {string | null} */
    this._formDigest = null;
    /**
     * Bare account name to the numeric id a Person column is written by, for
     * this client's lifetime. The id is stable per user within a site
     * collection, so the lookup is worth doing once rather than on every
     * debounced save.
     *
     * @type {Map<string, number>}
     */
    this._userIds = new Map();
    /**
     * @type {Map<string, Promise<{ displayName: string | null, manager: string | null }>>}
     */
    this._profileReads = new Map();
  }

  // --- SharePointClient interface ------------------------------------------

  /**
   * The SharePoint list a Case read/write targets. There is no default list —
   * `opts.listName` is mandatory, so a caller that omits it fails loudly.
   *
   * @param {CaseListOptions} opts
   * @returns {string}
   */
  _requireListName(opts) {
    if (!opts.listName) {
      throw new Error(
        'HttpSharePointClient: opts.listName is required — every Case ' +
          'read/write must name its list (there is no default Case list).'
      );
    }
    return opts.listName;
  }

  /**
   * @param {string} id
   * @param {CaseReadOptions} [opts]
   * @returns {Promise<CaseRow|null>}
   */
  async getCase(id, opts = {}) {
    const url =
      this._listItemUrl(this._requireListName(opts), id) +
      `?${CASE_SELECT}&${CASE_EXPAND}`;
    try {
      const body = await this._read(url, opts.signal);
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
    const url = this._listItemUrl(this._requireListName(opts), id);
    try {
      // The Assigned Reviewer's clock is paired with the Reviewer before the
      // row is serialised, so a caller that hands over a Case cannot forget it.
      const stamped = withAssignmentStamp(fields, this._now);
      const item = itemFromRow(stamped);
      // The Person columns are the fields whose value cannot be derived from
      // the row alone: SharePoint writes them by id, so the account name has to
      // be resolved first. Inside the try on purpose — a directory lookup that
      // fails is a failed save, reported like any other, never a Case quietly
      // left with nobody responsible or nobody reviewing it. The `?? ''`
      // normalises the managers' explicit-null spelling of "nobody" to the
      // empty string the resolver clears a column with.
      if (fields.assignedReviewer !== undefined) {
        item.AssignedReviewerId = await this._ensureUserId(
          fields.assignedReviewer
        );
      }
      if (fields.responsibleParty !== undefined) {
        item.ResponsiblePartyId = await this._ensureUserId(
          fields.responsibleParty
        );
      }
      if (fields.assignedReviewerManager !== undefined) {
        item.AssignedReviewerManagerId = await this._ensureUserId(
          fields.assignedReviewerManager ?? ''
        );
      }
      if (fields.responsiblePartyManager !== undefined) {
        item.ResponsiblePartyManagerId = await this._ensureUserId(
          fields.responsiblePartyManager ?? ''
        );
      }
      if (fields.voidedBy !== undefined) {
        item.VoidedById = await this._ensureUserId(fields.voidedBy ?? '');
      }
      const body = JSON.stringify(item);
      const data = await this._write(url, 'PATCH', { 'If-Match': etag }, body);
      if (data === null) {
        // The confirmation re-read belongs to the write, not to whoever asked
        // for it: it is deliberately re-scoped to the list name alone so no
        // caller-supplied signal can cancel half of a PATCH.
        const row = await this.getCase(id, {
          listName: this._requireListName(opts),
        });
        if (!row) return { ok: false, status: 404 };
        return { ok: true, status: 204, data: row };
      }
      const newEtag = readEtag(data);
      // The only Case row built from something other than a Case read, and a
      // PATCH response carries no expanded people — so both `assignedReviewer`
      // and `responsibleParty` come back empty here however full the row looks.
      // Consume it for the ETag and the Answers baseline only; anything else
      // about the Case must come from the re-read above.
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

  /**
   * @param {ListCasesFilter} filter
   * @param {CaseReadOptions} [opts]
   * @returns {Promise<CaseRow[]>}
   */
  async listCases(filter, opts = {}) {
    const listName = this._requireListName(opts);
    /** @type {string[]} */
    const query = [CASE_SELECT, CASE_EXPAND];
    const expr = buildFilterExpr(await this._resolvePeopleInFilter(filter));
    if (expr) query.push(`$filter=${encodeURIComponent(expr)}`);
    if (opts.orderBy) {
      const column = orderByColumn(opts.orderBy);
      const dir = opts.orderDir === 'desc' ? ' desc' : '';
      query.push(`$orderby=${encodeURIComponent(column + dir)}`);
    }
    if (opts.top !== undefined) query.push(`$top=${opts.top}`);
    if (opts.skip !== undefined) query.push(`$skip=${opts.skip}`);

    const url = `${this._listItemsUrl(listName)}?${query.join('&')}`;

    // A paged read (`$top`) fetches exactly the requested window — following
    // `odata.nextLink` would defeat paging and pull the whole backlog. An
    // unpaged read keeps the historical walk-every-page behaviour.
    const items =
      opts.top !== undefined
        ? await this._readPage(url, opts.signal)
        : await this._getAllPages(url, opts.signal);
    return items.map((raw) => {
      const item = /** @type {Record<string, unknown>} */ (raw);
      return rowFromItem(item, readEtag(item));
    });
  }

  /**
   * Count-only query: the counting companion to `listCases`.
   *
   * SharePoint Subscription Edition's REST service is OData **v3** and has no
   * `$count` segment — `…/items/$count` answers "Cannot find a resource for the
   * request $count". The supported way to count a *filtered* set is
   * to read the matching rows and count them, so this reads `$select=Id` only:
   * the same indexed `$filter` as before, one 4-byte column per row, and no
   * Answers/Conversation/Details blob crosses the wire.
   *
   * The read pages at the List View Threshold and follows `odata.nextLink`, so
   * the cost scales with the size of the *matched* set, not the list. Every
   * caller counts an already-bounded slice (an Action Centre reason group, a
   * completed day-window, one Reviewer's in-progress Cases) for exactly that
   * reason — an unbounded count over a large list would walk every page.
   *
   * @param {ListCasesFilter} filter
   * @param {CaseReadOptions} [opts]
   * @returns {Promise<number>}
   */
  async countCases(filter, opts = {}) {
    const listName = this._requireListName(opts);
    const expr = buildFilterExpr(await this._resolvePeopleInFilter(filter));
    const query = [`$select=Id`, `$top=${COUNT_PAGE_SIZE}`];
    if (expr) query.unshift(`$filter=${encodeURIComponent(expr)}`);
    const items = await this._getAllPages(
      `${this._listItemsUrl(listName)}?${query.join('&')}`,
      opts.signal
    );
    return items.length;
  }

  /**
   * Read the shared Roadmap list. `_listItemsUrl` applies the environment
   * prefix, so UAT reads `uat_Roadmap` without branching here.
   *
   * @returns {Promise<RoadmapItem[]>}
   */
  async listRoadmapItems() {
    const url =
      this._listItemsUrl(ROADMAP_LIST_NAME) +
      '?$select=Id,Title,Description,Theme,Labels,Status&$orderby=Id';
    const items = await this._getAllPages(url);
    return items.map((item) =>
      roadmapItemFromItem(
        /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (item))
      )
    );
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
    const account = toBareAccount(String(body?.LoginName ?? ''));
    // This read already answers the one person id every query needs — every
    // person filter in the app names the signed-in user, and the app reads them
    // before any route mounts. Taking it here is a correctness point rather
    // than a saved round trip: the fallback, EnsureUser, is a POST that ADDS a
    // directory user to this site, so seeding the cache keeps that write off
    // the read path in the case that is always taken. A filter naming anyone
    // else still falls back to it, deliberately. The `id > 0` mirrors the
    // resolver's own guard: `Number(null)` is a finite 0, and a cached falsy
    // id would later drop a person condition from a filter instead of
    // rejecting — a malformed response here must cost a round trip, not widen
    // a query.
    const id = Number(body?.Id);
    if (account && Number.isFinite(id) && id > 0) {
      this._userIds.set(account, id);
    }
    return {
      id: account,
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
   * A payload this method cannot read is reported, never swallowed as "no
   * matches": the two are indistinguishable on screen, and the second one hides
   * a broken request behind an empty directory.
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
    // No `__metadata` type annotation on `queryParams`: that is an odata=verbose
    // construct, and this client sends and accepts odata=nometadata throughout.
    // SharePoint rejects the mismatch outright rather than ignoring it.
    const body = JSON.stringify({
      queryParams: {
        AllowEmailAddresses: true,
        AllowMultipleEntities: false,
        MaximumEntitySuggestions: 50,
        PrincipalSource: 15,
        PrincipalType: 1,
        QueryString: q,
      },
    });

    const json = await this._write(url, 'POST', {}, body);
    return peoplePickerEntities(json, url).map(personFromEntity);
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
        const profile = await this._resolveUserProfile(account);
        return /** @type {[string, string | null]} */ ([
          account,
          profile.displayName,
        ]);
      })
    );
    return Object.fromEntries(entries);
  }

  /**
   * Resolve stored bare account names to their current User Profile manager.
   * Values are canonical lower-cased bare account names. Each unique account
   * is read once; absent, malformed, and failed profile reads map to `null`.
   *
   * @param {string[]} accountNames
   * @returns {Promise<Record<string, string | null>>}
   */
  async resolveManagers(accountNames) {
    const unique = [...new Set(accountNames)];
    const entries = await Promise.all(
      unique.map(async (account) => {
        const profile = await this._resolveUserProfile(account);
        return /** @type {[string, string | null]} */ ([
          account,
          profile.manager,
        ]);
      })
    );
    return Object.fromEntries(entries);
  }

  /**
   * @param {string} account
   * @returns {Promise<{ displayName: string | null, manager: string | null }>}
   */
  async _resolveUserProfile(account) {
    const pending = this._profileReads.get(account);
    if (pending) return pending;

    const profileRead = this._readUserProfile(account);
    this._profileReads.set(account, profileRead);
    try {
      return await profileRead;
    } finally {
      if (this._profileReads.get(account) === profileRead) {
        this._profileReads.delete(account);
      }
    }
  }

  /**
   * @param {string} account
   * @returns {Promise<{ displayName: string | null, manager: string | null }>}
   */
  async _readUserProfile(account) {
    const login = toClaimsLogin(account);
    const url = this._absolute(
      `/_api/SP.UserProfiles.PeopleManager/GetPropertiesFor(accountName=@v)?@v='${encodeURIComponent(login)}'`
    );
    try {
      const body = await this._read(url);
      return profileFromProperties(body);
    } catch {
      return { displayName: null, manager: null };
    }
  }

  /**
   * The version identity of the Case Type's **current** Question Bank — what
   * completion stamps onto a Case row.
   *
   * Derived from the bank artifact rather than read out of a pointer file
   * beside it. The bank is the current version, so its identity is a fact about
   * its content; a stored pointer would be a second copy of that fact, and a
   * bank edited without republishing would go on claiming the old version.
   *
   * Deliberately reads the artifact rather than the Case Type config: the
   * config exposes the bank's fields, but the publish step hashes the *file*,
   * and a Case Type free to reshape what it exposes could otherwise produce an
   * identity no published version answers to.
   *
   * Returns null when the artifact is absent or unreadable — a Case Type with
   * no bank stamps no version rather than blocking completion.
   *
   * @param {string} slug
   * @returns {Promise<string | null>}
   */
  async getExportHash(slug) {
    const bank = await this._readBankArtifact(bankArtifactName(slug));
    if (!bank || typeof bank !== 'object' || !Array.isArray(bank.questions)) {
      return null;
    }
    try {
      return await bankVersionHash(bank);
    } catch {
      return null;
    }
  }

  /**
   * Fetches one immutable published version. Returns the parsed envelope on
   * success, null on any error (404, network failure) — never hard-fails, so a
   * version that was stamped but never published triggers the loader's
   * live-fallback path instead of breaking the Case.
   *
   * @param {string} slug
   * @param {string} hash
   * @returns {Promise<import('../sharepoint-client.js').VersionedExport | null>}
   */
  async getVersionedExport(slug, hash) {
    const body = await this._readBankArtifact(versionedExportName(slug, hash));
    if (!body || typeof body !== 'object') return null;
    return /** @type {import('../sharepoint-client.js').VersionedExport} */ (
      body
    );
  }

  /**
   * Reads one Question Bank artifact out of the deployed `case-types/banks/`
   * folder, resolved against this module rather than an absolute Style Library
   * path. That is how the current bank has always been loaded, and it is what
   * keeps a UAT deploy reading UAT's artifacts: both environments get the
   * folder they were deployed into, with nothing to declare and nothing to keep
   * in step.
   *
   * These are static files, not list items, so this deliberately does not go
   * through `_read`: no OData headers, no ETag handling, and the body is parsed
   * from text because the artifacts are JSON stored in `.txt` and a `.txt`
   * response arrives with a content type `Response.json()` has no business
   * assuming.
   *
   * Returns null on any failure. Every caller here treats a missing artifact as
   * "not published", which is a real state and not an error.
   *
   * @param {string} filename
   * @returns {Promise<any | null>}
   */
  async _readBankArtifact(filename) {
    const url = new URL(
      `../../case-types/${BANKS_DIR}/${filename}`,
      import.meta.url
    ).href;
    try {
      const res = await this._fetchWithThrottle(url, {});
      if (!res.ok) return null;
      return JSON.parse(await res.text());
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

  /**
   * A GET. `signal` is the caller's mount lifetime and is omitted
   * entirely when absent, so a read issued without one produces byte-identical
   * `RequestInit` to before.
   *
   * @param {string} url
   * @param {AbortSignal} [signal]
   * @returns {Promise<any>}
   */
  async _read(url, signal) {
    return this._request(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: ACCEPT_JSON },
      ...(signal ? { signal } : {}),
    });
  }

  /**
   * Reads a single response page's `value` array without following
   * `odata.nextLink` — the paged-read counterpart to `_getAllPages`.
   * @param {string} url
   * @param {AbortSignal} [signal]
   * @returns {Promise<unknown[]>}
   */
  async _readPage(url, signal) {
    const body = await this._read(url, signal);
    return Array.isArray(body?.value)
      ? body.value
      : Array.isArray(/** @type {any} */ (body?.d)?.results)
        ? /** @type {any} */ (body.d).results
        : [];
  }

  /**
   * Walks `odata.nextLink` (or legacy `__next`) until exhausted.
   * @param {string} initialUrl
   * @param {AbortSignal} [signal]
   * @returns {Promise<unknown[]>}
   */
  async _getAllPages(initialUrl, signal) {
    /** @type {unknown[]} */
    const out = [];
    /** @type {string | null} */
    let url = initialUrl;
    while (url) {
      const body = await this._read(url, signal);
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

  /**
   * The value SharePoint takes for a Person column named by `account`: the
   * numeric id for somebody, `null` for nobody. An empty account means the
   * column is being cleared, and SharePoint clears a Person column with
   * `null`; an empty string is not a person and would be rejected. This is the
   * write path's spelling — a filter names somebody by definition and calls
   * `_resolveUserId` directly, so its `Promise<number>` needs no null case.
   *
   * @param {string} account bare account login name
   * @returns {Promise<number | null>}
   */
  async _ensureUserId(account) {
    if (account === '') return null;
    return this._resolveUserId(account);
  }

  /**
   * The numeric id SharePoint holds for a person, from the bare account name
   * the application keys identity on. `EnsureUser` is the endpoint that
   * answers it, and it also adds a directory user to this site's User
   * Information List if they are not in it yet — which is what makes naming
   * someone who has never opened the site work at all.
   *
   * A response carrying no usable id throws rather than yielding `NaN` — a
   * write caller turns that into a failed save, a filter caller into a
   * rejected query.
   *
   * @param {string} account bare account login name, never empty
   * @returns {Promise<number>}
   */
  async _resolveUserId(account) {
    const cached = this._userIds.get(account);
    if (cached !== undefined) return cached;
    const body = await this._write(
      this._absolute('/_api/web/ensureuser'),
      'POST',
      {},
      JSON.stringify({ logonName: toClaimsLogin(account) })
    );
    const id = Number(body?.Id ?? /** @type {any} */ (body?.d)?.Id);
    // Ids are allocated from 1, so anything below that is not a person.
    // Rejecting zero here is what lets every caller treat a resolved id as
    // truthy without a filter condition quietly disappearing.
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(`EnsureUser returned no id for account "${account}"`);
    }
    this._userIds.set(account, id);
    return id;
  }

  /**
   * The same filter with its person fields resolved from account names to the
   * numeric ids the Person columns actually hold, `anyOf` branches included.
   *
   * Only truthy accounts are resolved: `buildFilterExpr` drops a falsy person
   * field entirely, and resolving one would produce `null` — a filter that
   * silently matches only the Cases nobody holds.
   *
   * An account that cannot be resolved rejects, and the rejection is left to
   * propagate out of the query. Dropping the condition instead would widen
   * "my Cases" to every Case, which is a disclosure rather than a degradation.
   *
   * @param {ListCasesFilter} filter
   * @returns {Promise<ResolvedFilter>}
   */
  async _resolvePeopleInFilter(filter) {
    const {
      assignedReviewer,
      responsibleParty,
      assignedReviewerManager,
      anyOf,
      ...rest
    } = filter;
    /** @type {ResolvedFilter} */
    const out = { ...rest };
    if (assignedReviewer) {
      out.assignedReviewer = await this._resolveUserId(assignedReviewer);
    }
    if (responsibleParty) {
      out.responsibleParty = await this._resolveUserId(responsibleParty);
    }
    if (assignedReviewerManager) {
      out.assignedReviewerManager = await this._resolveUserId(
        assignedReviewerManager
      );
    }
    if (anyOf !== undefined) {
      /** @type {ResolvedFilter[]} */
      const branches = [];
      for (const branch of anyOf) {
        branches.push(await this._resolvePeopleInFilter(branch));
      }
      out.anyOf = branches;
    }
    return out;
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
   *
   * A read carries the caller's mount lifetime on `init.signal`, so the
   * retry loop rechecks it: without this, an abort during a long `Retry-After`
   * wait is only noticed by the next `fetch`. The sleep timer itself is still
   * not cancelled — `_sleep` is an injectable `(ms) => Promise<void>` that
   * several tests substitute, and giving it a signal would change that seam for
   * one dangling timer — so the wait runs out and *then* throws. Writes never
   * set `init.signal`, so they never take this path.
   *
   * @param {string} url
   * @param {RequestInit} init
   * @returns {Promise<Response>}
   */
  async _fetchWithThrottle(url, init) {
    while (true) {
      init.signal?.throwIfAborted();
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
 * Resolve a `CaseRow` sort key to its SharePoint internal column name. An
 * unmapped key fails loudly here rather than travelling to SharePoint as an
 * invalid `$orderby` and coming back as an opaque 400.
 *
 * @param {string} key
 * @returns {string}
 */
function orderByColumn(key) {
  const column = ORDER_BY_COLUMNS[key];
  if (!column) {
    throw new Error(
      `HttpSharePointClient: orderBy "${key}" has no SharePoint column — ` +
        `sortable keys are ${Object.keys(ORDER_BY_COLUMNS).join(', ')}.`
    );
  }
  return column;
}

/**
 * A `ListCasesFilter` whose two person fields have been resolved from account
 * names to the ids the Person columns hold. It exists so the resolved and
 * unresolved forms are different types: they differ in exactly the place this
 * client used to get wrong, and a filter that reached the query builder still
 * carrying account names is the bug, not a variation.
 *
 * @typedef {Omit<ListCasesFilter, 'assignedReviewer' | 'responsibleParty' | 'assignedReviewerManager' | 'anyOf'> & {
 *   assignedReviewer?: number,
 *   responsibleParty?: number,
 *   assignedReviewerManager?: number,
 *   anyOf?: ResolvedFilter[],
 * }} ResolvedFilter
 */

/**
 * Build the OData `$filter` expression for a resolved filter.
 * Shared by `listCases` and `countCases` so a paged read and its count are
 * always the same server-side query. Scalar fields AND together; `anyOf` ORs
 * each (parenthesised) sub-expression for the deduped headline count. Every
 * predicate targets an indexed column so the query stays cheap at scale.
 *
 * Pure and synchronous, which is why the person ids arrive already resolved:
 * making this async would spread the wait through the `anyOf` recursion for
 * nothing.
 *
 * @param {ResolvedFilter} filter
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
  // The ReportableAt window sits alongside the CompletedAt one, and for the
  // same reason: an indexed date range is the most selective predicate a lookup
  // is likely to carry, so it must be the one that narrows first. Inclusive
  // lower, exclusive upper, so two adjacent windows never count a Case twice.
  if (filter.reportableAfter) {
    conds.push(`ReportableAt ge '${escapeOData(filter.reportableAfter)}'`);
  }
  if (filter.reportableBefore) {
    conds.push(`ReportableAt lt '${escapeOData(filter.reportableBefore)}'`);
  }
  // And the VoidedAt window, for the third time and the same reason: the void
  // report reads one rolling window, and `Status eq 'Void'` on its own would
  // scan every Case ever voided.
  if (filter.voidedAfter) {
    conds.push(`VoidedAt ge '${escapeOData(filter.voidedAfter)}'`);
  }
  if (filter.voidedBefore) {
    conds.push(`VoidedAt lt '${escapeOData(filter.voidedBefore)}'`);
  }
  // A prefix match, never `substringof`: an unanchored contains cannot be served
  // from a column index, so past the List View Threshold SharePoint throttles or
  // refuses it outright.
  if (filter.titlePrefix) {
    conds.push(`startswith(Title,'${escapeOData(filter.titlePrefix)}')`);
  }
  // Person columns compare against the numeric id, unquoted: the caller has
  // already turned the account name into one. A quoted value here matches no
  // row at all, which reads as an empty dashboard rather than as an error.
  if (filter.assignedReviewer) {
    conds.push(`AssignedReviewerId eq ${filter.assignedReviewer}`);
  }
  // The In progress Action Centre query must lead with its indexed reviewer,
  // narrow to rows carrying the allocation clock, then apply the grouped
  // outstanding statuses appended through `anyOf` below.
  if (filter.assignedAtPresent !== undefined) {
    conds.push(`AssignedAt ${filter.assignedAtPresent ? 'ne' : 'eq'} null`);
  }
  if (filter.status) conds.push(`Status eq '${escapeOData(filter.status)}'`);
  if (filter.responsibleParty) {
    conds.push(`ResponsiblePartyId eq ${filter.responsibleParty}`);
  }
  if (filter.assignedReviewerManager) {
    conds.push(
      `AssignedReviewerManagerId eq ${filter.assignedReviewerManager}`
    );
  }
  if (filter.overdue === true) {
    // The indexed, selective date column leads; the statuses the review clock
    // runs in follow as one ORed group, taken from the shared definition so the
    // server-side query and the derived row flag cannot drift apart.
    conds.push(`DueDate lt '${new Date().toISOString()}'`);
    const statuses = OVERDUE_STATUSES.map(
      (status) => `Status eq '${escapeOData(status)}'`
    );
    conds.push(`(${statuses.join(' or ')})`);
  } else if (filter.overdue === false) {
    // The negation of the rule above, built from the same status list so the
    // two can never drift. A null DueDate is not overdue — a Case with no
    // review date has no clock to have passed. Kept as one ORed group so the
    // indexed, selective terms a caller ANDs alongside it still lead the
    // query.
    const notInReview = OVERDUE_STATUSES.map(
      (status) => `Status ne '${escapeOData(status)}'`
    ).join(' and ');
    conds.push(
      `(${notInReview} or DueDate eq null or DueDate ge '${new Date().toISOString()}')`
    );
  }
  // Action Centre reason flags — indexed boolean columns hoisted onto the Case
  // row so a reason count is a cheap `$count`, never a blob parse.
  if (filter.awaitingResponsibleParty !== undefined) {
    conds.push(
      `AwaitingResponsibleParty eq ${filter.awaitingResponsibleParty ? 1 : 0}`
    );
  }
  if (filter.onHold !== undefined) {
    conds.push(`OnHold eq ${filter.onHold ? 1 : 0}`);
  }
  if (filter.hasOpenAppeal !== undefined) {
    conds.push(`HasOpenAppeal eq ${filter.hasOpenAppeal ? 1 : 0}`);
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
    if (ors.length) {
      conds.push(`(${ors.join(' or ')})`);
    } else if (!filter.anyOf.length) {
      // An OR of no branches matches nothing, and has to say so out loud: emit
      // no condition and the whole expression is unconstrained, silently
      // widening the read to every Case in the list. `Id eq 0` is the
      // never-true condition — SharePoint item ids start at 1 — and matching
      // nothing is what the mock's `anyOf` predicate answers for this input.
      conds.push('Id eq 0');
    }
  }
  return conds.join(' and ');
}

/**
 * The people-picker entity array, whichever envelope the farm wrapped it in:
 * the nometadata `value` or the verbose `d.ClientPeoplePickerSearchUser`, both
 * of which carry a JSON string. An empty string is a farm saying "nobody".
 *
 * Anything else throws, naming the endpoint and the payload's top-level keys.
 * The keys alone are the diagnosis — which envelope came back — and the values
 * are directory records that must not reach a log or a screenshot.
 *
 * @param {any} json the whole response
 * @param {string} url
 * @returns {any[]}
 */
function peoplePickerEntities(json, url) {
  const raw =
    json?.value ?? /** @type {any} */ (json?.d)?.ClientPeoplePickerSearchUser;
  /** @returns {Error} */
  const unreadable = () =>
    new Error(
      `Unrecognised people-picker response from ${url}: payload keys ${JSON.stringify(
        Object.keys(json ?? {})
      )}`
    );
  if (typeof raw !== 'string') throw unreadable();
  if (raw.trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unreadable();
  }
  if (!Array.isArray(parsed)) throw unreadable();
  return parsed;
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
  // The expanded Person columns: `Name` is the claims login, `Title` the
  // directory display name. Absent or null when nobody holds the role. The
  // columns are provisioned as "Person or Group", but a group has no claims
  // login a Role match could ever recognise, so only a single user resolves.
  const reviewer = /** @type {any} */ (item?.AssignedReviewer ?? null);
  const person = /** @type {any} */ (item?.ResponsibleParty ?? null);
  const reviewerManager = /** @type {any} */ (
    item?.AssignedReviewerManager ?? null
  );
  const partyManager = /** @type {any} */ (
    item?.ResponsiblePartyManager ?? null
  );
  const voidedByPerson = /** @type {any} */ (item?.VoidedBy ?? null);
  /** @type {CaseRow} */
  const row = {
    id: String(item?.Id ?? ''),
    caseType: String(item?.CaseType ?? ''),
    title: String(item?.Title ?? ''),
    status: /** @type {import('../lib/case-statuses.js').CaseStatus} */ (
      item?.Status ?? CASE_STATUS.IN_PROGRESS
    ),
    assignedReviewer: toBareAccount(String(reviewer?.Name ?? '')),
    responsibleParty: toBareAccount(String(person?.Name ?? '')),
    responsiblePartyDisplayName:
      person?.Title != null ? String(person.Title) : undefined,
    assignedReviewerManager: reviewerManager?.Name
      ? toBareAccount(String(reviewerManager.Name))
      : undefined,
    responsiblePartyManager: partyManager?.Name
      ? toBareAccount(String(partyManager.Name))
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
    assignedAt: typeof item?.AssignedAt === 'string' ? item.AssignedAt : null,
    reportableAt:
      typeof item?.ReportableAt === 'string' ? item.ReportableAt : null,
    remediationDueDate:
      typeof item?.RemediationDueDate === 'string'
        ? item.RemediationDueDate
        : null,
    completedAt:
      typeof item?.CompletedAt === 'string' ? item.CompletedAt : null,
    voidReason: item?.VoidReason != null ? String(item.VoidReason) : undefined,
    voidedAt: typeof item?.VoidedAt === 'string' ? item.VoidedAt : null,
    voidedBy: voidedByPerson?.Name
      ? toBareAccount(String(voidedByPerson.Name))
      : undefined,
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
    awaitingResponsibleParty:
      item?.AwaitingResponsibleParty != null
        ? Boolean(item.AwaitingResponsibleParty)
        : undefined,
    awaitingSince:
      typeof item?.AwaitingSince === 'string' ? item.AwaitingSince : null,
    reviewRequired:
      item?.ReviewRequired != null ? Boolean(item.ReviewRequired) : undefined,
    onHold: item?.OnHold != null ? Boolean(item.OnHold) : undefined,
    placedOnHoldAt:
      typeof item?.PlacedOnHoldAt === 'string' ? item.PlacedOnHoldAt : null,
    hasOpenAppeal:
      item?.HasOpenAppeal != null ? Boolean(item.HasOpenAppeal) : undefined,
    appealRaisedAt:
      typeof item?.AppealRaisedAt === 'string' ? item.AppealRaisedAt : null,
    etag,
  };
  // Derived, never read from a stored or calculated column, and derived by the
  // same evaluator the overdue `$filter` is built from — so the group filter
  // and the "also overdue" chip on the row it returns cannot disagree.
  return { ...row, overdue: isOverdue(row) };
}

/**
 * @param {Record<string, unknown>} item
 * @returns {RoadmapItem}
 */
function roadmapItemFromItem(item) {
  const rawLabels = item?.Labels;
  const labels = typeof rawLabels === 'string' ? rawLabels.split(/\r?\n/) : [];
  const id = String(item?.Id ?? '');
  const status = String(item?.Status ?? '')
    .trim()
    .toUpperCase();
  if (!ROADMAP_STATUSES.has(status)) {
    console.warn(
      `Roadmap item "${id}" has unsupported status "${status}" and was not displayed.`
    );
  }
  return {
    id,
    title: String(item?.Title ?? ''),
    description: String(item?.Description ?? ''),
    theme: String(item?.Theme ?? ''),
    labels: labels
      .map(String)
      .map((label) => label.trim())
      .filter(Boolean),
    status: /** @type {import('../sharepoint-client.js').RoadmapStatus} */ (
      status
    ),
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
  if (fields.assignedAt !== undefined) out.AssignedAt = fields.assignedAt;
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
  // The four people — `assignedReviewer`, `responsibleParty` and their two
  // managers — are deliberately absent: they are Person columns, written by a
  // numeric id that only a round trip to the directory can supply, and this
  // function is pure. `patchCase` resolves them and sets the columns there, so
  // there is one writer rather than a plausible-looking wrong one here.
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
  if (fields.onHold !== undefined) out.OnHold = fields.onHold;
  if (fields.placedOnHoldAt !== undefined)
    out.PlacedOnHoldAt = fields.placedOnHoldAt;
  // `voidedBy` is deliberately absent: it is a Person column, written by a
  // numeric id that only a round trip to the directory can supply, and this
  // function is pure. `patchCase` resolves it and sets the column there.
  if (fields.voidReason !== undefined) out.VoidReason = fields.voidReason;
  if (fields.voidedAt !== undefined) out.VoidedAt = fields.voidedAt;
  if (fields.hasOpenAppeal !== undefined)
    out.HasOpenAppeal = fields.hasOpenAppeal;
  if (fields.appealRaisedAt !== undefined)
    out.AppealRaisedAt = fields.appealRaisedAt;
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
