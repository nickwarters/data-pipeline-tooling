// @ts-check
import { failureOf, isConnectionFailure } from './save-failure.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */
/** @typedef {import('./save-failure.js').SaveFailure} SaveFailure */

/**
 * In order of precedence when the queue settles: a conflict outranks a failed
 * write, which outranks a lost connection, which outranks work still in hand.
 *
 * @typedef {'saved' | 'saving' | 'reconnecting' | 'failed' | 'conflict'} SaveStatus
 */

/**
 * A write the queue gave up on. `fields` are the Case fields it carried. The
 * queue does not know what SharePoint held before: a page that showed the new
 * value optimistically (a person picker) keeps the value to put back itself.
 *
 * @typedef {{
 * caseId: string,
 * fields: string[],
 * failure: SaveFailure
 * }} SaveFailureNotice
 */

/**
 * What a status listener is told beside the status itself.
 *
 * @typedef {{
 * failures: SaveFailureNotice[],
 * longOutage: boolean
 * }} SaveStatusDetail
 */

/**
 * How many more times an unclassified failure is sent before the queue stops.
 * Enough to ride out a one-off blip; not enough to retry a write that can
 * never succeed for as long as the tab is open.
 */
const UNKNOWN_EXTRA_ATTEMPTS = 2;

/**
 * Where one flush has got to across its attempts.
 *
 * @typedef {{
 * connectionFailures: number,
 * unknownRetries: number,
 * reconnecting: boolean,
 * longOutage: boolean
 * }} FlushProgress
 */

/**
 * @typedef {{
 * etag: string,
 * opts: CaseListOptions,
 * baselineAnswers: Record<string, Answer> | null,
 * pending: Record<string, { value: Partial<CaseRow>, timerId: unknown }>,
 * inFlight: Set<Promise<boolean>>
 * }} CaseState
 */

export class SaveQueue {
  /**
   * @param {SharePointClient} client
   * @param {{
   * debounceMs?: number,
   * backoffSchedule?: number[],
   * setTimer?: (callback: () => void, delay: number) => unknown,
   * clearTimer?: (timerId: unknown) => void,
   * sleep?: (delay: number) => Promise<void>
   * }} [opts]
   */
  constructor(
    client,
    {
      debounceMs = 1500,
      backoffSchedule = [1000, 2000, 4000, 8000, 16000, 30000],
      setTimer = (callback, delay) => setTimeout(callback, delay),
      clearTimer = (timerId) =>
        clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timerId)),
      sleep,
    } = {}
  ) {
    this._client = client;
    this._debounceMs = debounceMs;
    this._backoffSchedule = backoffSchedule;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._sleep =
      sleep ??
      ((delay) =>
        new Promise((resolve) => {
          this._setTimer(resolve, delay);
        }));
    /** @type {Record<string, CaseState>} */
    this._state = {};
    /** @type {SaveStatus} */
    this._status = 'saved';
    /** @type {Set<(status: SaveStatus, detail: SaveStatusDetail) => void>} */
    this._statusListeners = new Set();
    /** @type {SaveFailureNotice[]} */
    this._failures = [];
    /** Flushes currently waiting out a lost connection. */
    this._reconnecting = 0;
    /** Of those, the ones that have outlasted the whole backoff schedule. */
    this._longOutages = 0;
    /** @type {Set<() => void>} */
    this._idleWaiters = new Set();
  }

  /** @returns {{ get: () => SaveStatus }} */
  get status() {
    return { get: () => this._status };
  }

  /**
   * Observe status transitions. The listener is called immediately with the
   * current status and again after each transition, including a transition to
   * the status it already holds. Its second argument says what went wrong
   * (the writes the queue gave up on) and whether a lost connection has lasted
   * long enough that the person should be told to check theirs; a listener
   * that only wants the status can ignore it.
   *
   * @param {(status: SaveStatus, detail: SaveStatusDetail) => void} listener
   * @returns {() => void}
   */
  subscribeStatus(listener) {
    this._statusListeners.add(listener);
    listener(this._status, this._detail());
    return () => this._statusListeners.delete(listener);
  }

  /** @returns {SaveStatusDetail} */
  _detail() {
    return {
      failures: [...this._failures],
      longOutage: this._longOutages > 0,
    };
  }

  /**
   * Announce what the queue is doing, held to the precedence a person needs: a
   * recorded failure outranks everything but a conflict, and a lost connection
   * is not hidden by a newer write starting behind it. Notification is
   * unconditional — a transition to the status already held still fires, which
   * is what the retry path relies on to re-announce 'reconnecting' on each
   * attempt.
   *
   * Iterates a copy, and re-checks membership, so a listener that unsubscribes
   * during notification is not called afterwards.
   *
   * @param {SaveStatus} activity
   * @returns {void}
   */
  _setStatus(activity) {
    let status = activity;
    if (status !== 'conflict') {
      if (this._failures.length > 0) status = 'failed';
      else if (status === 'saving' && this._reconnecting > 0) {
        status = 'reconnecting';
      }
    }
    this._status = status;
    const detail = this._detail();
    for (const listener of [...this._statusListeners]) {
      if (this._statusListeners.has(listener)) listener(status, detail);
    }
  }

  /**
   * Wait until every pending debounce, in-flight write, conflict check, and
   * retry has completed. This is an observation seam: it does not force an
   * early flush or change the queue's debounce behaviour.
   *
   * @returns {Promise<void>}
   */
  whenIdle() {
    if (!this._hasWork()) return Promise.resolve();
    return new Promise((resolve) => this._idleWaiters.add(resolve));
  }

  /**
   * Initialize ETag and baseline answers from a freshly-fetched CaseRow.
   * Call this after every successful getCase or patchCase.
   *
   * **The queue opts out of the mount-lifetime AbortSignal.** A page
   * hands `loadCase` the same options bag it read the Case with, and that bag
   * may carry a route-scoped `signal`. The signal is dropped
   * here rather than stored: a write must survive navigation — the whole point
   * of the 1500 ms debounce plus ETag concurrency is that an edit
   * outlives the user moving on — and a cancelled PATCH would silently drop a
   * Reviewer's Answer. The 412 conflict re-read is part of that write and is
   * covered by the same rule.
   *
   * @param {CaseRow} row
   * @param {import('../sharepoint-client.js').CaseReadOptions} [opts]
   */
  loadCase(row, opts = {}) {
    const existing = this._state[row.id];
    const { signal: _mountLifetime, ...writeOpts } = opts;
    this._state[row.id] = {
      etag: row.etag,
      opts: writeOpts,
      baselineAnswers: row.answers ? { ...row.answers } : null,
      pending: existing?.pending ?? {},
      inFlight: existing?.inFlight ?? new Set(),
    };
  }

  /**
   * Returns the last committed ETag for a case, or '' if none loaded.
   * @param {string} caseId
   * @returns {string}
   */
  getEtag(caseId) {
    return this._state[caseId]?.etag ?? '';
  }

  /**
   * Enqueue a field mutation. Resets the debounce timer for that field.
   * @param {string} caseId
   * @param {string} fieldName
   * @param {unknown} value
   */
  enqueue(caseId, fieldName, value) {
    this._scheduleFlush(caseId, fieldName, { [fieldName]: value });
  }

  /**
   * Immediately flush all debounced writes for a Case and wait until they have
   * persisted. Returns false if a conflict or missing Case prevents persistence,
   * or if a write for the Case was given up on: completing a Case over an edit
   * that never saved would lose it.
   * @param {string} caseId
   * @returns {Promise<boolean>}
   */
  async flushCase(caseId) {
    const state = this._state[caseId];
    if (!state) return true;

    const pendingEntries = Object.entries(state.pending);
    for (const [pendingKey, pending] of pendingEntries) {
      this._clearTimer(pending.timerId);
      delete state.pending[pendingKey];
    }

    const existingResults = await Promise.all([...state.inFlight]);
    if (!existingResults.every(Boolean)) return false;

    for (const [, pending] of pendingEntries) {
      const flushed = await this._flush(caseId, pending.value);
      if (!flushed) return false;
    }
    return this._status !== 'conflict' && !this._hasFailure(caseId);
  }

  /**
   * @param {string} caseId
   * @returns {CaseState}
   */
  _ensureState(caseId) {
    if (!this._state[caseId]) {
      this._state[caseId] = {
        etag: '',
        opts: {},
        baselineAnswers: null,
        pending: {},
        inFlight: new Set(),
      };
    }
    return this._state[caseId];
  }

  /**
   * Enqueue several field mutations as a single atomic write: one debounce, one
   * ETag-guarded PATCH carrying every field. Use this when the fields
   * must stay consistent with each other — e.g. a case-level Amended Outcome
   * re-stamping `effectiveOutcome` / `effectiveHadRemediation` /
   * `outcomeOverridden` together; a per-field PATCH each could desync
   * on a partial write.
   *
   * @param {string} caseId
   * @param {Partial<CaseRow>} fields
   */
  enqueueFields(caseId, fields) {
    // Key the debounce by the field set so re-enqueuing the same set resets its
    // own timer without disturbing unrelated single-field saves in flight.
    const key = `__fields:${Object.keys(fields).sort().join(',')}`;
    this._scheduleFlush(caseId, key, fields);
  }

  /**
   * Reset the debounce timer for a pending-key and arm a flush of `fields`.
   * @param {string} caseId
   * @param {string} pendingKey
   * @param {Partial<CaseRow>} fields
   */
  _scheduleFlush(caseId, pendingKey, fields) {
    const state = this._ensureState(caseId);

    const existing = state.pending[pendingKey];
    if (existing) this._clearTimer(existing.timerId);

    state.pending[pendingKey] = {
      value: fields,
      timerId: this._setTimer(() => {
        delete state.pending[pendingKey];
        this._flush(caseId, fields);
      }, this._debounceMs),
    };

    this._setStatus('saving');
  }

  /**
   * @param {string} caseId
   * @param {Partial<CaseRow>} fields
   * @returns {Promise<boolean>}
   */
  async _flush(caseId, fields) {
    const state = this._ensureState(caseId);
    /** @type {FlushProgress} */
    const progress = {
      connectionFailures: 0,
      unknownRetries: 0,
      reconnecting: false,
      longOutage: false,
    };
    const flush = this._flushAttempt(caseId, fields, progress).finally(() => {
      state.inFlight.delete(flush);
      if (progress.reconnecting) this._reconnecting--;
      if (progress.longOutage) this._longOutages--;
      this._settle();
    });
    state.inFlight.add(flush);
    return await flush;
  }

  /**
   * @param {string} caseId
   * @param {Partial<CaseRow>} fields
   * @param {FlushProgress} progress
   * @returns {Promise<boolean>}
   */
  async _flushAttempt(caseId, fields, progress) {
    const state = this._state[caseId];
    if (!state) return true;

    /** @type {PatchResult} */
    let result;
    try {
      result = await this._client.patchCase(
        caseId,
        fields,
        state.etag,
        state.opts
      );
    } catch (_err) {
      result = { ok: false, status: 0 };
    }

    if (result.ok) {
      if (result.data) {
        state.etag = result.data.etag;
        state.baselineAnswers = result.data.answers
          ? { ...result.data.answers }
          : state.baselineAnswers;
      }
      this._clearFailures(caseId, Object.keys(fields));
      return true;
    }

    if (result.status === 412) {
      return await this._handle412(caseId, fields, progress);
    }

    const failure = failureOf(result);

    if (isConnectionFailure(failure)) {
      const delay =
        this._backoffSchedule[
          Math.min(
            progress.connectionFailures,
            this._backoffSchedule.length - 1
          )
        ];
      // Past the end of the schedule the connection has been gone for about a
      // minute, which is when "check your connection or VPN" starts to help.
      if (
        progress.connectionFailures >= this._backoffSchedule.length &&
        !progress.longOutage
      ) {
        progress.longOutage = true;
        this._longOutages++;
      }
      progress.connectionFailures++;
      if (!progress.reconnecting) {
        progress.reconnecting = true;
        this._reconnecting++;
      }
      this._setStatus('reconnecting');
      await this._sleep(delay);
      return await this._flushAttempt(caseId, fields, progress);
    }

    if (
      failure.reason === 'unknown' &&
      progress.unknownRetries < UNKNOWN_EXTRA_ATTEMPTS
    ) {
      const delay =
        this._backoffSchedule[
          Math.min(progress.unknownRetries, this._backoffSchedule.length - 1)
        ];
      progress.unknownRetries++;
      await this._sleep(delay);
      return await this._flushAttempt(caseId, fields, progress);
    }

    this._recordFailure(caseId, fields, failure);
    return false;
  }

  /**
   * Give up on a write: remember why, so the page can say so.
   *
   * @param {string} caseId
   * @param {Partial<CaseRow>} fields
   * @param {SaveFailure} failure
   */
  _recordFailure(caseId, fields, failure) {
    const names = Object.keys(fields);
    // A newer failure for the same fields replaces the one it supersedes.
    this._failures = this._failures.filter(
      (notice) => !this._overlaps(notice, caseId, names)
    );
    this._failures.push({ caseId, fields: names, failure });
  }

  /**
   * A write that lands for a field cleared the failure recorded against it:
   * the person fixed the text and it saved.
   *
   * @param {string} caseId
   * @param {string[]} names
   */
  _clearFailures(caseId, names) {
    this._failures = this._failures.filter(
      (notice) => !this._overlaps(notice, caseId, names)
    );
  }

  /**
   * @param {SaveFailureNotice} notice
   * @param {string} caseId
   * @param {string[]} names
   * @returns {boolean}
   */
  _overlaps(notice, caseId, names) {
    return (
      notice.caseId === caseId &&
      notice.fields.some((field) => names.includes(field))
    );
  }

  /**
   * @param {string} caseId
   * @returns {boolean}
   */
  _hasFailure(caseId) {
    return this._failures.some((notice) => notice.caseId === caseId);
  }

  /**
   * @param {string} caseId
   * @param {Partial<CaseRow>} fields
   * @param {FlushProgress} progress
   * @returns {Promise<boolean>}
   */
  async _handle412(caseId, fields, progress) {
    const state = this._state[caseId];
    const fresh = await this._client.getCase(caseId, state.opts);

    if (!fresh) {
      this._setStatus('conflict');
      return false;
    }

    const baseJson = JSON.stringify(state.baselineAnswers ?? {});
    const freshJson = JSON.stringify(fresh.answers ?? {});

    if (freshJson !== baseJson) {
      this._setStatus('conflict');
      return false;
    }

    state.etag = fresh.etag;
    state.baselineAnswers = fresh.answers ? { ...fresh.answers } : null;
    return await this._flushAttempt(caseId, fields, progress);
  }

  _hasWork() {
    return Object.values(this._state).some(
      (state) =>
        state.inFlight.size > 0 || Object.keys(state.pending).length > 0
    );
  }

  /**
   * A flush has ended. While other work is still in hand the status follows
   * it (a write that settled the outage stops saying 'reconnecting'); once
   * nothing is left the queue settles, and anyone waiting for idle is released
   * — a write it gave up on included, since waiting on it forever helps nobody.
   */
  _settle() {
    if (this._hasWork()) {
      if (this._status === 'conflict') return;
      const next = this._reconnecting > 0 ? 'reconnecting' : 'saving';
      const effective = this._failures.length > 0 ? 'failed' : next;
      if (effective !== this._status) this._setStatus(next);
      return;
    }
    if (this._status !== 'conflict') {
      this._setStatus('saved');
    }
    for (const resolve of this._idleWaiters) resolve();
    this._idleWaiters.clear();
  }
}
