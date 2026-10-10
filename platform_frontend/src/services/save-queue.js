// @ts-check
import { caseSaveTarget } from './case-save-target.js';

/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */

/** @typedef {'saved' | 'saving' | 'reconnecting' | 'conflict'} SaveStatus */

/**
 * What the queue saves: anything read and written as one item by id, carrying
 * the ETag its next write is guarded by.
 *
 * @typedef {{ id: string, etag: string }} SaveItem
 */

/**
 * Where the queue writes, and what it treats as a conflict. The queue owns the
 * debounce, the ETag, the retries and the status; a target owns the two
 * requests and the one rule that differs between kinds of item.
 *
 * - `patch` is a field-level, ETag-guarded write that reports failure as a
 *   status and never throws for a failed request; 412 means the ETag is stale.
 * - `get` re-reads the item after a 412, or yields `null` when it is gone.
 * - `baseline` is what the queue remembers of an item it has read, to judge a
 *   later 412 against. `previous` is the baseline already held, for a target
 *   that keeps it when a write's response carries nothing new.
 * - `isConflict` decides whether a 412 is somebody else's edit the user must
 *   see, or only a stale ETag the queue can retry past.
 *
 * @typedef {{
 * patch: (id: string, fields: Record<string, unknown>, etag: string, opts: CaseListOptions) => Promise<{ ok: boolean, status: number, data?: SaveItem }>,
 * get: (id: string, opts: CaseListOptions) => Promise<SaveItem | null>,
 * baseline: (item: SaveItem, previous: unknown) => unknown,
 * isConflict: (baseline: unknown, fresh: SaveItem, fields: Record<string, unknown>) => boolean
 * }} SaveTarget
 */

/**
 * @typedef {{
 * etag: string,
 * opts: CaseListOptions,
 * readOnly: boolean,
 * baseline: unknown,
 * pending: Record<string, { value: Record<string, unknown>, timerId: unknown }>,
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
   * sleep?: (delay: number) => Promise<void>,
   * target?: SaveTarget,
   * now?: () => Date
   * }} [opts] `target` defaults to the Case target over `client`, so a queue
   *   built as before saves Cases exactly as before.
   */
  constructor(
    client,
    {
      target = caseSaveTarget(client),
      now = () => new Date(),
      debounceMs = 1500,
      backoffSchedule = [1000, 2000, 4000, 8000, 16000, 30000],
      setTimer = (callback, delay) => setTimeout(callback, delay),
      clearTimer = (timerId) =>
        clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (timerId)),
      sleep,
    } = {}
  ) {
    this._target = target;
    this._now = now;
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
    /** @type {string | null} */
    this._lastSavedAt = null;
    /** @type {Set<(status: SaveStatus) => void>} */
    this._statusListeners = new Set();
    /** @type {Set<() => void>} */
    this._idleWaiters = new Set();
  }

  /** @returns {{ get: () => SaveStatus }} */
  get status() {
    return { get: () => this._status };
  }

  /**
   * When a write last succeeded, as an ISO instant, or `null` before the first.
   * Set before the transition to 'saved' is announced, so a status listener
   * reads the time of the save that settled.
   *
   * @returns {string | null}
   */
  get lastSavedAt() {
    return this._lastSavedAt;
  }

  /**
   * Observe status transitions. The listener is called immediately with the
   * current status and again after each transition, including a transition to
   * the status it already holds.
   *
   * @param {(status: SaveStatus) => void} listener
   * @returns {() => void}
   */
  subscribeStatus(listener) {
    this._statusListeners.add(listener);
    listener(this._status);
    return () => this._statusListeners.delete(listener);
  }

  /**
   * Set the status and notify. Notification is unconditional — a transition to
   * the status already held still fires, which is what the retry path relies on
   * to re-announce 'reconnecting' on each attempt.
   *
   * Iterates a copy, and re-checks membership, so a listener that unsubscribes
   * during notification is not called afterwards.
   *
   * @param {SaveStatus} status
   * @returns {void}
   */
  _setStatus(status) {
    this._status = status;
    for (const listener of [...this._statusListeners]) {
      if (this._statusListeners.has(listener)) listener(status);
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
   * Initialize the ETag and conflict baseline from a freshly-read item: a
   * CaseRow for the Case target, or whatever the queue's target reads. Call
   * this after every successful read.
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
   * `readOnly` marks an item the viewer may not edit. The page is what keeps
   * such an item away from the queue; the flag makes the queue refuse it too,
   * so a view that wires an editor by mistake fails loudly instead of sending
   * a write the access rule forbids.
   *
   * @param {SaveItem} row
   * @param {import('../sharepoint-client.js').CaseReadOptions & { readOnly?: boolean }} [opts]
   */
  loadCase(row, opts = {}) {
    const existing = this._state[row.id];
    const { signal: _mountLifetime, readOnly = false, ...writeOpts } = opts;
    this._state[row.id] = {
      etag: row.etag,
      opts: writeOpts,
      readOnly,
      baseline: this._target.baseline(row, null),
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
   * persisted. Returns false if a conflict or missing Case prevents persistence.
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
      const flushed = await this._flush(caseId, pending.value, 0);
      if (!flushed) return false;
    }
    return this._status !== 'conflict';
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
        readOnly: false,
        baseline: null,
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
   * @param {Record<string, unknown>} fields
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
   * @param {Record<string, unknown>} fields
   */
  _scheduleFlush(caseId, pendingKey, fields) {
    const state = this._ensureState(caseId);
    if (state.readOnly) {
      throw new Error(`"${caseId}" was loaded read-only and cannot be saved`);
    }

    const existing = state.pending[pendingKey];
    if (existing) this._clearTimer(existing.timerId);

    state.pending[pendingKey] = {
      value: fields,
      timerId: this._setTimer(() => {
        delete state.pending[pendingKey];
        this._flush(caseId, fields, 0);
      }, this._debounceMs),
    };

    this._setStatus('saving');
  }

  /**
   * @param {string} caseId
   * @param {Record<string, unknown>} fields
   * @param {number} retryIdx
   * @returns {Promise<boolean>}
   */
  async _flush(caseId, fields, retryIdx) {
    const state = this._ensureState(caseId);
    const flush = this._flushAttempt(caseId, fields, retryIdx).finally(() => {
      state.inFlight.delete(flush);
      this._markSavedIfIdle();
    });
    state.inFlight.add(flush);
    return await flush;
  }

  /**
   * @param {string} caseId
   * @param {Record<string, unknown>} fields
   * @param {number} retryIdx
   * @returns {Promise<boolean>}
   */
  async _flushAttempt(caseId, fields, retryIdx) {
    const state = this._state[caseId];
    if (!state) return true;

    /** @type {{ ok: boolean, status: number, data?: SaveItem }} */
    let result;
    try {
      result = await this._target.patch(caseId, fields, state.etag, state.opts);
    } catch (_err) {
      result = { ok: false, status: 0 };
    }

    if (result.ok) {
      if (result.data) {
        state.etag = result.data.etag;
        state.baseline = this._target.baseline(result.data, state.baseline);
      }
      this._lastSavedAt = this._now().toISOString();
      this._markSavedIfIdle();
      return true;
    }

    if (result.status === 412) {
      return await this._handle412(caseId, fields, retryIdx);
    }

    const delay =
      this._backoffSchedule[
        Math.min(retryIdx, this._backoffSchedule.length - 1)
      ];
    this._setStatus('reconnecting');
    await this._sleep(delay);
    return await this._flushAttempt(caseId, fields, retryIdx + 1);
  }

  /**
   * @param {string} caseId
   * @param {Record<string, unknown>} fields
   * @param {number} retryIdx
   * @returns {Promise<boolean>}
   */
  async _handle412(caseId, fields, retryIdx) {
    const state = this._state[caseId];
    const fresh = await this._target.get(caseId, state.opts);

    if (!fresh) {
      this._setStatus('conflict');
      return false;
    }

    if (this._target.isConflict(state.baseline, fresh, fields)) {
      this._setStatus('conflict');
      return false;
    }

    state.etag = fresh.etag;
    state.baseline = this._target.baseline(fresh, null);
    return await this._flushAttempt(caseId, fields, retryIdx);
  }

  _hasWork() {
    return Object.values(this._state).some(
      (state) =>
        state.inFlight.size > 0 || Object.keys(state.pending).length > 0
    );
  }

  _markSavedIfIdle() {
    if (this._hasWork()) return;
    if (this._status !== 'conflict') {
      this._setStatus('saved');
    }
    for (const resolve of this._idleWaiters) resolve();
    this._idleWaiters.clear();
  }
}
