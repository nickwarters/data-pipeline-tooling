// @ts-check
/**
 * Generic ordering helpers for the two-level question grouping:
 * `category` is the top, presentation-only level; `questionGroup` is the inner
 * level (what `category` meant before the rename). Question order in the
 * catalogue array is the single source of display order — these helpers
 * reorder that array.
 *
 * @typedef {{ category?: string | null, questionGroup?: string | null }} Groupable
 */

/**
 * @param {Groupable} q
 * @returns {string}
 */
export function categoryKey(q) {
  return q.category || 'Uncategorised';
}

/**
 * @param {Groupable} q
 * @returns {string}
 */
export function groupKey(q) {
  return q.questionGroup || 'Uncategorised';
}

/**
 * First-seen category order across the catalogue.
 * @param {Groupable[]} questions
 * @returns {string[]}
 */
export function categoryOrder(questions) {
  return firstSeenOrder(questions, categoryKey);
}

/**
 * First-seen Question Group order across the supplied questions (callers
 * scope to one category when the two-level structure matters).
 * @param {Groupable[]} questions
 * @returns {string[]}
 */
export function groupOrder(questions) {
  return firstSeenOrder(questions, groupKey);
}

/**
 * @param {Groupable[]} questions
 * @param {(q: Groupable) => string} keyOf
 * @returns {string[]}
 */
function firstSeenOrder(questions, keyOf) {
  const seen = new Set();
  const order = [];
  for (const q of questions) {
    const key = keyOf(q);
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  return order;
}

/**
 * @param {any[]} questions
 * @param {object} question
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function canMoveQuestion(questions, question, direction) {
  const from = questions.indexOf(question);
  const to = from + direction;
  return from >= 0 && to >= 0 && to < questions.length;
}

/**
 * @param {any[]} questions
 * @param {object} question
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function moveQuestion(questions, question, direction) {
  if (!canMoveQuestion(questions, question, direction)) return false;
  const from = questions.indexOf(question);
  const to = from + direction;
  const [item] = questions.splice(from, 1);
  questions.splice(to, 0, item);
  return true;
}

/**
 * @param {Groupable[]} questions
 * @param {object} question
 * @param {-1 | 1} direction
 * @returns {number}
 */
function adjacentGroupQuestionIndex(questions, question, direction) {
  const from = questions.indexOf(/** @type {Groupable} */ (question));
  if (from < 0) return -1;

  const key = groupKey(questions[from]);
  for (
    let to = from + direction;
    to >= 0 && to < questions.length;
    to += direction
  ) {
    if (groupKey(questions[to]) === key) return to;
  }
  return -1;
}

/**
 * @param {Groupable[]} questions
 * @param {object} question
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function canMoveQuestionWithinGroup(questions, question, direction) {
  return adjacentGroupQuestionIndex(questions, question, direction) !== -1;
}

/**
 * @param {Groupable[]} questions
 * @param {object} question
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function moveQuestionWithinGroup(questions, question, direction) {
  const from = questions.indexOf(/** @type {Groupable} */ (question));
  const to = adjacentGroupQuestionIndex(questions, question, direction);
  if (from < 0 || to < 0) return false;

  const [item] = questions.splice(from, 1);
  questions.splice(to, 0, item);
  return true;
}

/**
 * Whether a Question Group can move up/down among its category's groups.
 * @param {Groupable[]} questions
 * @param {string} category
 * @param {string} group
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function canMoveGroup(questions, category, group, direction) {
  const inCategory = questions.filter((q) => categoryKey(q) === category);
  const order = groupOrder(inCategory);
  const from = order.indexOf(group);
  const to = from + direction;
  return from >= 0 && to >= 0 && to < order.length;
}

/**
 * Reorders a Question Group among its category's groups. Only the target
 * category's questions change position — they are rewritten into their own
 * index slots, so questions in other categories are untouched.
 *
 * @param {Groupable[]} questions
 * @param {string} category
 * @param {string} group
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function moveGroup(questions, category, group, direction) {
  if (!canMoveGroup(questions, category, group, direction)) return false;

  const slots = [];
  for (const [index, q] of questions.entries()) {
    if (categoryKey(q) === category) slots.push(index);
  }
  const inCategory = slots.map((index) => questions[index]);

  const order = groupOrder(inCategory);
  const from = order.indexOf(group);
  const nextOrder = order.slice();
  const [moved] = nextOrder.splice(from, 1);
  nextOrder.splice(from + direction, 0, moved);

  /** @type {Map<string, Groupable[]>} */
  const byGroup = new Map(nextOrder.map((key) => [key, []]));
  for (const q of inCategory) byGroup.get(groupKey(q))?.push(q);

  const reordered = nextOrder.flatMap((key) => byGroup.get(key) || []);
  for (const [i, index] of slots.entries()) questions[index] = reordered[i];
  return true;
}

/**
 * @param {Groupable[]} questions
 * @param {string} category
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function canMoveCategory(questions, category, direction) {
  const order = categoryOrder(questions);
  const from = order.indexOf(category);
  const to = from + direction;
  return from >= 0 && to >= 0 && to < order.length;
}

/**
 * Reorders a whole category (with its questions, in their current order)
 * among the catalogue's categories.
 *
 * @param {Groupable[]} questions
 * @param {string} category
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function moveCategory(questions, category, direction) {
  if (!canMoveCategory(questions, category, direction)) return false;

  const order = categoryOrder(questions);
  const from = order.indexOf(category);
  const nextOrder = order.slice();
  const [moved] = nextOrder.splice(from, 1);
  nextOrder.splice(from + direction, 0, moved);

  /** @type {Map<string, Groupable[]>} */
  const byCategory = new Map(nextOrder.map((key) => [key, []]));
  for (const q of questions) {
    byCategory.get(categoryKey(q))?.push(q);
  }

  questions.splice(
    0,
    questions.length,
    ...nextOrder.flatMap((key) => byCategory.get(key) || [])
  );
  return true;
}
