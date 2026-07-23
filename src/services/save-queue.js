// @ts-check
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */
/** @typedef {import('../sharepoint-client.js').CaseListOptions} CaseListOptions */

import { effect, signal } from '../lib/signal.js';

/** @typedef {'saved' | 'saving' | 'reconnecting' | 'conflict'} SaveStatus */

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
    this._statusSignal = signal(/** @type {SaveStatus} */ ('saved'));
    /** @type {Set<() => void>} */
    this._idleWaiters = new Set();
  }

  /** @returns {{ get: () => SaveStatus }} */
  get status() {
    return this._statusSignal;
  }

  /**
   * Observe status transitions without exposing the queue's reactive
   * implementation to consumers. The listener is called immediately with the
   * current status and again after each transition.
   *
   * @param {(status: SaveStatus) => void} listener
   * @returns {() => void}
   */
  subscribeStatus(listener) {
    return effect(() => listener(this._statusSignal.get()));
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
   * @param {CaseRow} row
   * @param {CaseListOptions} [opts]
   */
  loadCase(row, opts = {}) {
    const existing = this._state[row.id];
    this._state[row.id] = {
      etag: row.etag,
      opts,
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
    return this.status.get() !== 'conflict';
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
        this._flush(caseId, fields, 0);
      }, this._debounceMs),
    };

    this._statusSignal.set('saving');
  }

  /**
   * @param {string} caseId
   * @param {Partial<CaseRow>} fields
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
   * @param {Partial<CaseRow>} fields
   * @param {number} retryIdx
   * @returns {Promise<boolean>}
   */
  async _flushAttempt(caseId, fields, retryIdx) {
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
    this._statusSignal.set('reconnecting');
    await this._sleep(delay);
    return await this._flushAttempt(caseId, fields, retryIdx + 1);
  }

  /**
   * @param {string} caseId
   * @param {Partial<CaseRow>} fields
   * @param {number} retryIdx
   * @returns {Promise<boolean>}
   */
  async _handle412(caseId, fields, retryIdx) {
    const state = this._state[caseId];
    const fresh = await this._client.getCase(caseId, state.opts);

    if (!fresh) {
      this._statusSignal.set('conflict');
      return false;
    }

    const baseJson = JSON.stringify(state.baselineAnswers ?? {});
    const freshJson = JSON.stringify(fresh.answers ?? {});

    if (freshJson !== baseJson) {
      this._statusSignal.set('conflict');
      return false;
    }

    state.etag = fresh.etag;
    state.baselineAnswers = fresh.answers ? { ...fresh.answers } : null;
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
    if (this.status.get() !== 'conflict') {
      this._statusSignal.set('saved');
    }
    for (const resolve of this._idleWaiters) resolve();
    this._idleWaiters.clear();
  }
}
