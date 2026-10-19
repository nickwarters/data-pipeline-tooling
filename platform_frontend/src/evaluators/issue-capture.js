// @ts-check
import { evalCondition, evaluate } from './applicability-evaluator.js';
import { isFailure } from './failure-evaluator.js';
import { captureDisplayText, isEmptyCaptureValue } from './capture-values.js';
import { getCaptureFieldType } from '../capture-fields/registry.js';

// Re-exported from their leaf home so this module stays the one import a
// caller needs for capture, while the field types can read them without
// importing back into here.
export { captureDisplayText, isEmptyCaptureValue } from './capture-values.js';

/** @typedef {import('../sharepoint-client.js').Answer} Answer */
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').CaptureField} CaptureField */
/** @typedef {import('../sharepoint-client.js').CaptureGroup} CaptureGroup */
/** @typedef {import('../sharepoint-client.js').CaptureSlot} CaptureSlot */

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
 * @typedef {string | { loginName: string, displayName: string, domain?: string, email?: string }} CaptureValue
 */

/**
 * Rejects a write the field cannot hold, naming the field. Each field type says
 * what it may hold, so this asks the type rather than branching on it.
 *
 * A field declaring a type this framework does not know is held to the text
 * rule, which is what every field was held to before any type had a module of
 * its own. `verify-config.js` refuses a Case Type declaring an unknown type, so
 * the only way here is a field that declares none at all.
 *
 * @param {CaptureField} field
 * @param {CaptureValue} value
 */
function validateCaptureWrite(field, value) {
  const type = getCaptureFieldType(field.type);
  if (type) {
    type.validate(field, value);
    return;
  }
  if (typeof value !== 'string') {
    throw new Error(
      `Invalid value for ${field.type} Issue Capture Field "${field.key}" — expected text.`
    );
  }
}

/**
 * Records a single capture value against an Answer, returning a fresh Answer
 * with the value stored inline under `answer[slot][field.key]`. Mirrors the
 * configurable remediation-detail capture, generalised to the unified engine.
 *
 * An empty value clears the key rather than storing emptiness, and is never
 * validated: clearing a field must stay possible whatever its options say. A
 * slot left with no keys is dropped from the Answer, so an empty one is never
 * stored.
 *
 * @param {Answer} answer
 * @param {CaptureField} field
 * @param {CaptureValue | null | undefined} value
 * @param {CaptureSlot} slot
 * @returns {Answer}
 */
function captureValue(answer, field, value, slot) {
  /** @type {Record<string, unknown>} */
  const capture = { ...answer[slot] };
  if (isEmptyCaptureValue(value)) {
    delete capture[field.key];
  } else {
    validateCaptureWrite(field, /** @type {CaptureValue} */ (value));
    capture[field.key] = /** @type {CaptureValue} */ (value);
  }
  if (Object.keys(capture).length === 0) {
    const { [slot]: _drop, ...rest } = answer;
    return rest;
  }
  return { ...answer, [slot]: capture };
}

/**
 * The captured values as the `showWhen` evaluator reads them: one entry per
 * recorded field, its value as text. A person contributes their display name,
 * so `answered` works on one; `equals`/`in` against a person are not
 * meaningful, and the verify gate refuses a Case Type that writes one.
 *
 * @param {Record<string, unknown>} capture
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
 * @param {Record<string, unknown>} capture
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
 * `slot` names the Answer property the groups write to. Issue capture is the
 * default; Root Cause capture passes `'rcaCapture'`. Visibility and pruning
 * read only that slot, so one slot's writes never touch the other's values.
 *
 * @param {Answer} answer
 * @param {CaptureGroup[]} groups
 * @param {string} fieldKey
 * @param {CaptureValue | null | undefined} value
 * @param {CaptureSlot} [slot]
 * @returns {Answer | null}
 */
export function applyCapture(
  answer,
  groups,
  fieldKey,
  value,
  slot = 'capture'
) {
  const field = findCaptureField(groups, fieldKey);
  if (!field) return null;

  let next = captureValue(answer, field, value, slot);
  for (;;) {
    /** @type {Record<string, unknown>} */
    const capture = next[slot] ?? {};
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
    for (const stale of hidden) next = captureValue(next, stale, null, slot);
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
 * `slot` names the Answer property the groups are recorded in, as for
 * `applyCapture`.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @param {CaptureGroup[]} groups
 * @param {CaptureSlot} [slot]
 * @returns {boolean}
 */
export function unfilledRequiredCapture(
  catalogue,
  answers,
  groups,
  slot = 'capture'
) {
  if (!groups.length) return false;
  const applicable = evaluate(catalogue, answers);
  for (const question of catalogue) {
    if (!applicable.has(question.id)) continue;
    const answer = answers[question.id];
    if (!isFailure(question, answer)) continue;
    /** @type {Record<string, unknown>} */
    const capture = answer?.[slot] ?? {};
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
