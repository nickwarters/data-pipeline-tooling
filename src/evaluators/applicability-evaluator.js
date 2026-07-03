// @ts-check
/** @typedef {import('../sharepoint-client.js').QuestionDefinition} QuestionDefinition */
/** @typedef {import('../sharepoint-client.js').Answer} Answer */

/**
 * Evaluates which questions are applicable given current answers.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {Set<string>}
 */
export function evaluate(catalogue, answers) {
  const applicable = new Set();
  for (const q of catalogue) {
    if (!q.showWhen || evalCondition(q.showWhen, answers)) {
      applicable.add(q.id);
    }
  }
  return applicable;
}

/**
 * Returns true if every applicable question has an Answer value.
 * Multi-choice answers count as unanswered when the array is empty.
 *
 * @param {QuestionDefinition[]} catalogue
 * @param {Record<string, Answer>} answers
 * @returns {boolean}
 */
export function allApplicableAnswered(catalogue, answers) {
  const applicable = evaluate(catalogue, answers);
  for (const id of applicable) {
    const v = answers[id]?.value;
    if (Array.isArray(v) ? v.length === 0 : !v) return false;
  }
  return true;
}

/**
 * Returns true if the catalogue's showWhen graph contains a cycle.
 *
 * @param {QuestionDefinition[]} catalogue
 * @returns {boolean}
 */
export function detectCycles(catalogue) {
  const ids = new Set(catalogue.map((q) => q.id));
  /** @type {Map<string, Set<string>>} */
  const deps = new Map();
  for (const q of catalogue) {
    deps.set(q.id, extractRefs(q.showWhen));
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  /** @type {Map<string, number>} */
  const color = new Map();
  for (const id of ids) color.set(id, WHITE);

  /** @param {string} id @returns {boolean} */
  function dfs(id) {
    color.set(id, GRAY);
    for (const dep of deps.get(id) ?? []) {
      if (!ids.has(dep)) continue;
      const c = color.get(dep);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  for (const id of ids) {
    if (color.get(id) === WHITE && dfs(id)) return true;
  }
  return false;
}

/**
 * @param {Record<string, unknown>} cond
 * @param {Record<string, Answer>} answers
 * @returns {boolean}
 */
function evalCondition(cond, answers) {
  if ('$and' in cond) {
    return /** @type {Record<string, unknown>[]} */ (cond['$and']).every((c) =>
      evalCondition(c, answers)
    );
  }
  if ('$or' in cond) {
    return /** @type {Record<string, unknown>[]} */ (cond['$or']).some((c) =>
      evalCondition(c, answers)
    );
  }
  for (const [qId, op] of Object.entries(cond)) {
    if (!evalOp(/** @type {Record<string, unknown>} */ (op), answers[qId]))
      return false;
  }
  return true;
}

/**
 * @param {Record<string, unknown>} op
 * @param {Answer|undefined} answer
 * @returns {boolean}
 */
function evalOp(op, answer) {
  const value = answer?.value ?? '';
  if ('in' in op) {
    const list = /** @type {string[]} */ (op['in']);
    if (Array.isArray(value)) return value.some((v) => list.includes(v));
    return list.includes(value);
  }
  if ('equals' in op) return value === op['equals'];
  if ('answered' in op && op['answered'] === true) {
    if (Array.isArray(value)) return value.length > 0;
    return value !== '';
  }
  return false;
}

/**
 * Extracts all question IDs referenced in a showWhen condition.
 *
 * @param {Record<string, unknown>|undefined} cond
 * @returns {Set<string>}
 */
function extractRefs(cond) {
  const refs = new Set();
  if (!cond) return refs;
  if ('$and' in cond) {
    for (const c of /** @type {Record<string, unknown>[]} */ (cond['$and'])) {
      for (const ref of extractRefs(c)) refs.add(ref);
    }
  } else if ('$or' in cond) {
    for (const c of /** @type {Record<string, unknown>[]} */ (cond['$or'])) {
      for (const ref of extractRefs(c)) refs.add(ref);
    }
  } else {
    for (const key of Object.keys(cond)) {
      refs.add(key);
    }
  }
  return refs;
}
