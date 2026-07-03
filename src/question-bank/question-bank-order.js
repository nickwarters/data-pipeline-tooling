// @ts-check
/**
 * @param {{ category?: string | null }} q
 * @returns {string}
 */
export function categoryKey(q) {
  return q.category || 'Uncategorised';
}

/**
 * @param {Array<{ category?: string | null }>} questions
 * @returns {string[]}
 */
export function categoryOrder(questions) {
  const seen = new Set();
  const order = [];
  for (const q of questions) {
    const key = categoryKey(q);
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
 * @param {Array<{ category?: string | null }>} questions
 * @param {object} question
 * @param {-1 | 1} direction
 * @returns {number}
 */
export function adjacentCategoryQuestionIndex(questions, question, direction) {
  const from = questions.indexOf(question);
  if (from < 0) return -1;

  const key = categoryKey(questions[from]);
  for (
    let to = from + direction;
    to >= 0 && to < questions.length;
    to += direction
  ) {
    if (categoryKey(questions[to]) === key) return to;
  }
  return -1;
}

/**
 * @param {Array<{ category?: string | null }>} questions
 * @param {object} question
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function canMoveQuestionWithinCategory(questions, question, direction) {
  return adjacentCategoryQuestionIndex(questions, question, direction) !== -1;
}

/**
 * @param {Array<{ category?: string | null }>} questions
 * @param {object} question
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function moveQuestionWithinCategory(questions, question, direction) {
  const from = questions.indexOf(question);
  const to = adjacentCategoryQuestionIndex(questions, question, direction);
  if (from < 0 || to < 0) return false;

  const [item] = questions.splice(from, 1);
  questions.splice(to, 0, item);
  return true;
}

/**
 * @param {Array<{ category?: string | null }>} questions
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
 * @param {Array<{ category?: string | null }>} questions
 * @param {string} category
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function moveCategory(questions, category, direction) {
  const order = categoryOrder(questions);
  const from = order.indexOf(category);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return false;

  const nextOrder = order.slice();
  const [moved] = nextOrder.splice(from, 1);
  nextOrder.splice(to, 0, moved);

  /** @type {Map<string, Array<{ category?: string | null }>>} */
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
