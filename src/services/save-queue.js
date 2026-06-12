// @ts-check
/** @typedef {import('../sharepoint-client.js').SharePointClient} SharePointClient */
/** @typedef {import('../sharepoint-client.js').CaseRow} CaseRow */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').PatchResult} PatchResult */

import { signal } from '../lib/signal.js';

/** @typedef {'saved' | 'saving' | 'reconnecting' | 'conflict'} SaveStatus */

/**
 * @typedef {{
 *   etag: string,
 *   baselineAnswers: Record<string, Answer> | null,
 *   pending: Record<string, { value: unknown, timerId: ReturnType<typeof setTimeout> }>
 * }} CaseState
 */

export class SaveQueue {
  /**
   * @param {SharePointClient} client
   * @param {{ debounceMs?: number, backoffSchedule?: number[] }} [opts]
   */
  constructor(client, { debounceMs = 1500, backoffSchedule = [1000, 2000, 4000, 8000, 16000, 30000] } = {}) {
    this._client = client;
    this._debounceMs = debounceMs;
    this._backoffSchedule = backoffSchedule;
    /** @type {Record<string, CaseState>} */
    this._state = {};
    this._statusSignal = signal(/** @type {SaveStatus} */ ('saved'));
  }

  /** @returns {{ get: () => SaveStatus }} */
  get status() {
    return this._statusSignal;
  }

  /**
   * Initialize ETag and baseline answers from a freshly-fetched CaseRow.
   * Call this after every successful getCase or patchCase.
   * @param {CaseRow} row
   */
  loadCase(row) {
    const existing = this._state[row.id];
    this._state[row.id] = {
      etag: row.etag,
      baselineAnswers: row.answers ? { ...row.answers } : null,
      pending: existing?.pending ?? {},
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
   * Enqueue several field mutations as a single atomic write: one debounce, one
   * ETag-guarded PATCH carrying every field (ADR-0008). Use this when the fields
   * must stay consistent with each other — e.g. an Answer Override appending to
   * `overrides[]` while re-stamping `effectiveOutcome` / `effectiveHadRemediation`
   * / `outcomeOverridden` (ADR-0019); a per-field PATCH each could desync on a
   * partial write.
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
    if (!this._state[caseId]) {
      this._state[caseId] = { etag: '', baselineAnswers: null, pending: {} };
    }
    const state = this._state[caseId];

    const existing = state.pending[pendingKey];
    if (existing) clearTimeout(existing.timerId);

    state.pending[pendingKey] = {
      value: fields,
      timerId: setTimeout(() => {
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
   */
  async _flush(caseId, fields, retryIdx) {
    const state = this._state[caseId];
    if (!state) return;

    /** @type {PatchResult} */
    let result;
    try {
      result = await this._client.patchCase(caseId, fields, state.etag);
    } catch (_err) {
      result = { ok: false, status: 0 };
    }

    if (result.ok) {
      if (result.data) {
        state.etag = result.data.etag;
        state.baselineAnswers = result.data.answers ? { ...result.data.answers } : state.baselineAnswers;
      }
      this._statusSignal.set('saved');
      return;
    }

    if (result.status === 412) {
      await this._handle412(caseId, fields, retryIdx);
      return;
    }

    const delay = this._backoffSchedule[Math.min(retryIdx, this._backoffSchedule.length - 1)];
    this._statusSignal.set('reconnecting');
    setTimeout(() => this._flush(caseId, fields, retryIdx + 1), delay);
  }

  /**
   * @param {string} caseId
   * @param {Partial<CaseRow>} fields
   * @param {number} retryIdx
   */
  async _handle412(caseId, fields, retryIdx) {
    const state = this._state[caseId];
    const fresh = await this._client.getCase(caseId);

    if (!fresh) {
      this._statusSignal.set('conflict');
      return;
    }

    const baseJson = JSON.stringify(state.baselineAnswers ?? {});
    const freshJson = JSON.stringify(fresh.answers ?? {});

    if (freshJson !== baseJson) {
      this._statusSignal.set('conflict');
      return;
    }

    state.etag = fresh.etag;
    state.baselineAnswers = fresh.answers ? { ...fresh.answers } : null;
    await this._flush(caseId, fields, retryIdx);
  }
}
