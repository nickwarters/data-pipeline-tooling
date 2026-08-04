// @ts-check
import { evalCondition, evaluate } from './applicability-evaluator.js';
import { isFailure } from './failure-evaluator.js';

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */

/**
 * Load-time check that every `CaptureField.key` is unique across all groups of a
 * Case Type — keys double as storage keys and `showWhen` references,
 * so duplicates would be ambiguous. Throws on the first collision.
 *
 * @param {CaptureGroup[] | undefined} groups
 */
export function validateCaptureGroups(groups) {
  /** @type {Set<string>} */
  const seen = new Set();
  for (const group of groups ?? []) {
    for (const field of group.fields) {
      if (seen.has(field.key)) {
        throw new Error(
          `Duplicate Issue Capture Field key "${field.key}" across capture groups.`
        );
      }
      seen.add(field.key);
    }
  }
}

/**
 * Finds a `CaptureField` by key across all of a Case Type's capture groups.
 * Field keys are unique (see `validateCaptureGroups`), so the first match is
 * authoritative.
 *
 * @param {CaptureGroup[]} groups
 * @param {string} key
 * @returns {CaptureField | undefined}
 */
export function findCaptureField(groups, key) {
  for (const group of groups) {
    for (const field of group.fields) {
      if (field.key === key) return field;
    }
  }
  return undefined;
}

/**
 * What one Issue Capture Field holds: a string for the four text/choice types,
 * a person for a `person` field.
 *
 * @typedef {string | { loginName: string, displayName: string }} CaptureValue
 */

/**
 * Whether a value is a person: an object carrying both an account and a name.
 * Both must be present and non-empty — a half-filled person would render as a
 * blank chip.
 *
 * @param {unknown} value
 * @returns {value is { loginName: string, displayName: string }}
 */
function isPerson(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const { loginName, displayName } = /** @type {Record<string, unknown>} */ (
    value
  );
  return (
    typeof loginName === 'string' &&
    loginName !== '' &&
    typeof displayName === 'string' &&
    displayName !== ''
  );
}

/**
 * Whether a capture value counts as "nothing recorded" — the one definition the
 * write path (which deletes the key rather than storing emptiness) and the
 * completion gate (which asks whether a required field is filled) both read.
 *
 * Only an absent value or empty text is nothing. Anything else is something,
 * which is what keeps a malformed write a rejection rather than a silent
 * delete: emptiness clears a field, it does not excuse a value the field
 * cannot hold.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEmptyCaptureValue(value) {
  return value === null || value === undefined || value === '';
}

/**
 * How one stored capture value reads as text, whatever it holds.
 *
 * Total on purpose, and deliberately not given the field's declared type: a
 * Case saved before `person` fields were built holds a plain string under a
 * person key, because the control fell through to a text box then. Only the
 * write path judges what a field may hold; a reader shows what is there.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function captureDisplayText(value) {
  if (typeof value === 'string') return value;
  return isPerson(value) ? value.displayName : '';
}

/**
 * Rejects a write the field cannot hold, naming the field. Choice values are
 * checked against the declared options; a person must be a whole person; every
 * other type takes a string and nothing else.
 *
 * @param {CaptureField} field
 * @param {CaptureValue} value
 */
function validateCaptureWrite(field, value) {
  if (field.type === 'person') {
    if (!isPerson(value)) {
      throw new Error(
        `Invalid value for person Issue Capture Field "${field.key}" — expected an account and a display name.`
      );
    }
    return;
  }
  if (typeof value !== 'string') {
    throw new Error(
      `Invalid value for ${field.type} Issue Capture Field "${field.key}" — expected text.`
    );
  }
  if (
    (field.type === 'select' || field.type === 'radio') &&
    !(field.options ?? []).includes(value)
  ) {
    throw new Error(
      `Invalid value "${value}" for ${field.type} Issue Capture Field "${field.key}".`
    );
  }
}

/**
 * Records a single Issue Capture value against an Answer, returning a
 * fresh Answer with the value stored inline under `capture[field.key]`. Mirrors
 * the configurable remediation-detail capture, generalised to the unified engine.
 *
 * An empty value clears the key rather than storing emptiness, and is never
 * validated: clearing a field must stay possible whatever its options say.
 *
 * @param {Answer} answer
 * @param {CaptureField} field
 * @param {CaptureValue | null | undefined} value
 * @returns {Answer}
 */
function captureValue(answer, field, value) {
  const capture = { ...answer.capture };
  if (isEmptyCaptureValue(value)) {
    delete capture[field.key];
  } else {
    validateCaptureWrite(field, /** @type {CaptureValue} */ (value));
    capture[field.key] = /** @type {CaptureValue} */ (value);
  }
  if (Object.keys(capture).length === 0) {
    const { capture: _drop, ...rest } = answer;
    return rest;
  }
  return { ...answer, capture };
}

/**
 * The captured values as the `showWhen` evaluator reads them: one entry per
 * recorded field, its value as text. A person contributes their display name,
 * so `answered` works on one; `equals`/`in` against a person are not
 * meaningful, and the verify gate refuses a Case Type that writes one.
 *
 * @param {NonNullable<Answer['capture']>} capture
 * @returns {Record<string, { value: string }>}
 */
function captureConditionValues(capture) {
  /** @type {Record<string, { value: string }>} */
  const values = {};
  for (const [key, value] of Object.entries(capture)) {
    values[key] = { value: captureDisplayText(value) };
  }
  return values;
}

/**
 * The fields of one Issue Capture Group that are visible against an Answer's
 * captured values. A field with no `showWhen` is always visible; one with a
 * `showWhen` is evaluated with the same operators a Question Definition's is,
 * so a Case Type Owner learns one conditional vocabulary rather than two.
 *
 * @param {CaptureField[]} fields
 * @param {NonNullable<Answer['capture']>} capture
 * @returns {CaptureField[]}
 */
export function visibleCaptureFields(fields, capture) {
  const values = captureConditionValues(capture);
  return fields.filter(
    (field) => !field.showWhen || evalCondition(field.showWhen, values)
  );
}

/**
 * Record one Issue Capture value and settle visibility over the result: any
 * configured field the write has hidden loses its value in the same write, so
 * a hidden field is never carrying an answer the Reviewer cannot see.
 *
 * The prune iterates rather than passing once, because clearing a hidden
 * field's value can change what is visible again. It terminates because every
 * pass after the first only ever deletes keys: the recorded set strictly
 * shrinks, and it is finite.
 *
 * A key no group declares is no write at all — `null` rather than the Answer
 * back unchanged, so a caller cannot mistake "this Case Type does not declare
 * that field" for "the value was already what you asked for". The stored value
 * under such a key is left alone either way: it belongs to a field this Case
 * Type has stopped declaring, and pruning it would be this write deciding to
 * delete history it knows nothing about.
 *
 * @param {Answer} answer
 * @param {CaptureGroup[]} groups
 * @param {string} fieldKey
 * @param {CaptureValue | null | undefined} value
 * @returns {Answer | null}
 */
export function applyCapture(answer, groups, fieldKey, value) {
  const field = findCaptureField(groups, fieldKey);
  if (!field) return null;

  let next = captureValue(answer, field, value);
  for (;;) {
    const capture = next.capture ?? {};
    const visible = new Set(
      groups.flatMap((group) =>
        visibleCaptureFields(group.fields, capture).map((f) => f.key)
      )
    );
    const hidden = groups
      .flatMap((group) => group.fields)
      .filter(
        (f) => !visible.has(f.key) && !isEmptyCaptureValue(capture[f.key])
      );
    if (hidden.length === 0) return next;
    for (const stale of hidden) next = captureValue(next, stale, null);
  }
}

/**
 * Whether any Issue Capture Field the Reviewer must fill is still empty: the
 * completion half of `required`.
 *
 * A field only counts while it is *visible*, on an Answer that is *applicable*
 * and *failing* — the only Answers whose capture is shown or stored. So a
 * `required` field a `showWhen` has hidden gates nothing, which is what lets a
 * Case Type ask for detail on one branch without demanding it on the others.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @param {CaptureGroup[]} groups
 * @returns {boolean}
 */
export function unfilledRequiredCapture(catalogue, answers, groups) {
  if (!groups.length) return false;
  const applicable = evaluate(catalogue, answers);
  for (const question of catalogue) {
    if (!applicable.has(question.id)) continue;
    const answer = answers[question.id];
    if (!isFailure(question, answer)) continue;
    const capture = answer?.capture ?? {};
    for (const group of groups) {
      for (const field of visibleCaptureFields(group.fields, capture)) {
        if (field.required && isEmptyCaptureValue(capture[field.key])) {
          return true;
        }
      }
    }
  }
  return false;
}
