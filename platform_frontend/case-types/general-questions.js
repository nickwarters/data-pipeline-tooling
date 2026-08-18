// @ts-check
/**
 * The **shared General Questions** every Case Type may include, plus the
 * resolver a Case Type module uses to turn its declaration into the resolved
 * `generalQuestions` field list.
 *
 * A General Question's `key` is its answer key (`general:<key>` in the Case's
 * Answers blob), so the same question asked by two Case Types must carry the
 * same key or reporting silently splits. That is why the catalogue is keyed by
 * the answer key and the definitions hold no `key` of their own: an including
 * Case Type selects a question, it does not restate it.
 *
 * A Case Type may include a shared question, leave it out, or declare its own
 * question inline — but it may not override a shared question's wording or
 * options, which would put the same key behind two different questions.
 *
 * `required` is the one exception, and deliberately so: it is not part of what
 * the question *asks*, it is how hard this Case Type insists on an answer
 * before the Reviewer may send. Two Case Types may reasonably differ there
 * while asking the same question, so it is declared at the inclusion —
 * `{ key: 'reviewChannel', required: true }` — rather than in the catalogue.
 */

import { validateGeneralQuestions } from '../src/evaluators/general-questions.js';

/** @typedef {import('../src/sharepoint-client.js').GeneralQuestionField} GeneralQuestionField */
/** @typedef {Omit<GeneralQuestionField, 'key'>} SharedGeneralQuestion */
/**
 * How a Case Type includes a shared question while insisting on an answer: the
 * key, plus `required`. Nothing else may be set — anything more would be the
 * wording override the catalogue exists to prevent.
 * @typedef {{ key: string, required?: boolean }} SharedGeneralQuestionInclusion
 */
/**
 * What a Case Type module declares: the key of a shared question to include
 * (bare, or with `required`), or a Case Type-specific question written out in
 * full. The two object forms are told apart by `type`, which every inline
 * question must carry and an inclusion may never carry.
 * @typedef {string | SharedGeneralQuestionInclusion | GeneralQuestionField} GeneralQuestionDeclaration
 */

/**
 * The shared catalogue, keyed by answer key.
 * @type {Record<string, SharedGeneralQuestion>}
 */
export const SHARED_GENERAL_QUESTIONS = {
  reviewChannel: {
    label: 'How was this Case reviewed?',
    type: 'select',
    options: ['Case file only', 'Call recording', 'Both'],
  },
  reviewerObservations: {
    label: 'Observations for the Case Type Owner',
    type: 'textarea',
    placeholder: 'Optional — anything worth feeding back on the journey.',
  },
};

/**
 * Resolves a Case Type's declared General Questions into the field list the
 * Review tab renders, preserving declaration order so a Case Type can interleave
 * its own questions with shared ones.
 *
 * Throws on an unknown shared key, a duplicate key, an unsupported type, or an
 * inclusion trying to set anything but `required`.
 * That throw lands at module-evaluation time, which at runtime means *boot* —
 * `resolveAppCaseSources` loads every registered Case Type before any route
 * registers, so a bad declaration costs the app its boot rather than one Case
 * Type. The intended catch is therefore CI, not the browser: the manifest sweep
 * in `tests/case-type-manifest.test.js` evaluates every registered Case Type and
 * runs these gates.
 *
 * @param {GeneralQuestionDeclaration[]} [declarations]
 * @returns {GeneralQuestionField[]}
 */
export function resolveGeneralQuestions(declarations = []) {
  const fields = declarations.map((declaration) => {
    if (typeof declaration === 'string') return sharedField(declaration);
    // An inline question declares its own `type`; an inclusion never does. That
    // is the whole discriminator, so an author who meant to include a shared
    // question and typed a `label` is told, rather than quietly getting a new
    // question under a catalogue key.
    if ('type' in declaration) return { ...declaration };
    return includedField(declaration);
  });
  validateGeneralQuestions(fields);
  return fields;
}

/**
 * A shared question included by key, with this Case Type's `required` on it.
 *
 * @param {SharedGeneralQuestionInclusion} inclusion
 * @returns {GeneralQuestionField}
 */
function includedField(inclusion) {
  const extra = Object.keys(inclusion).filter(
    (name) => name !== 'key' && name !== 'required'
  );
  if (extra.length) {
    throw new Error(
      `Shared General Question "${inclusion.key}" may only add "required" at the inclusion — remove ${extra.sort().join(', ')}, or declare a question of your own with its own key.`
    );
  }
  const field = sharedField(inclusion.key);
  return inclusion.required === true ? { ...field, required: true } : field;
}

/**
 * @param {string} key
 * @returns {GeneralQuestionField}
 */
function sharedField(key) {
  const definition = SHARED_GENERAL_QUESTIONS[key];
  if (!definition) {
    throw new Error(
      `Unknown shared General Question "${key}" — known keys: ${Object.keys(SHARED_GENERAL_QUESTIONS).sort().join(', ')}.`
    );
  }
  // A copy per Case Type: the catalogue is shared, the resolved field is not.
  // `options` is copied explicitly — a spread copies the array by reference, so
  // an in-place `push` on one Case Type's resolved field would otherwise rewrite
  // the catalogue and every other Case Type's already-resolved field.
  const field = { ...definition, key };
  if (definition.options) field.options = [...definition.options];
  return field;
}
