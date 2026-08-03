// @ts-check

/**
 * A miniature evaluator for the `$filter` expressions the SharePoint client
 * emits, so a test can ask "which of these rows would the server have
 * returned?" without a server.
 *
 * Deliberately NOT a general OData engine. It covers exactly the grammar the
 * client produces and nothing else: `and`-joined terms, where a term is an
 * atomic `Column op value` comparison, a `startswith(Column,'literal')` call, or
 * a parenthesised group of `or`-ed expressions, and a value is either a
 * single-quoted string or a bare number.
 * Anything outside that throws rather than guessing, so a query form that grows
 * a new shape is a loud failure here rather than a silently wrong answer.
 *
 * It knows no column names and no domain rules — it is a parser, so it cannot
 * quietly agree with the code it is used to check.
 */

/**
 * Split an expression on a separator at the top level only — occurrences inside
 * quotes or parentheses belong to a sub-expression.
 *
 * @param {string} expr
 * @param {string} separator
 * @returns {string[]}
 */
function splitTop(expr, separator) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const char = expr[i];
    if (char === "'") quoted = !quoted;
    else if (quoted) continue;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (depth === 0 && expr.startsWith(separator, i)) {
      parts.push(expr.slice(start, i));
      i += separator.length - 1;
      start = i + 1;
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

/**
 * Evaluate one atomic comparison against a row — either a
 * `startswith(Column,'literal')` call or a `Column op value` comparison. A
 * column the row does not carry, or carries as null, matches nothing —
 * SharePoint's answer for an empty column.
 *
 * @param {string} term
 * @param {Record<string, unknown>} item
 * @returns {boolean}
 */
function matchesTerm(term, item) {
  // SharePoint's `startswith` ignores case, which `String.prototype.startsWith`
  // does not; the evaluator has to model the server, not JavaScript.
  const prefix = /^startswith\((\w+),'(.*)'\)$/.exec(term);
  if (prefix) {
    const [, column, literal] = prefix;
    const actual = item[column];
    if (actual === undefined || actual === null) return false;
    return String(actual)
      .toLowerCase()
      .startsWith(literal.replaceAll("''", "'").toLowerCase());
  }

  const parsed = /^(\w+) (eq|lt|ge) (.+)$/.exec(term);
  if (!parsed) throw new Error(`Unsupported $filter term: ${term}`);
  const [, column, op, literal] = parsed;
  const expected = literal.startsWith("'")
    ? literal.slice(1, -1).replaceAll("''", "'")
    : Number(literal);
  const actual = item[column];
  if (actual === undefined || actual === null) return false;
  if (op === 'eq') return actual === expected;
  if (op === 'lt') return /** @type {any} */ (actual) < expected;
  return /** @type {any} */ (actual) >= expected;
}

/**
 * Whether a row, projected into its SharePoint columns, satisfies a `$filter`
 * expression. An empty expression matches everything, as an absent `$filter`
 * does.
 *
 * @param {string} expr
 * @param {Record<string, unknown>} item
 * @returns {boolean}
 */
export function matchesFilter(expr, item) {
  const text = expr.trim();
  if (text === '') return true;
  // Lowest-precedence operator first: `and` binds tighter than `or`, so
  // `A or B and C` must split into `A` and `B and C`, not into `A or B` and `C`.
  const ors = splitTop(text, ' or ');
  if (ors.length > 1) return ors.some((part) => matchesFilter(part, item));
  const ands = splitTop(text, ' and ');
  if (ands.length > 1) return ands.every((part) => matchesFilter(part, item));
  if (text.startsWith('(')) return matchesFilter(text.slice(1, -1), item);
  return matchesTerm(text, item);
}
