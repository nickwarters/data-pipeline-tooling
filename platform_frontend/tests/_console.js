// @ts-check

/**
 * Run `fn` with `console.error` captured, returning what it logged.
 *
 * The containment paths report to the console and take no reporter seam, so
 * this is how a test reads what they said — and it keeps a deliberate failure
 * from printing noise into an otherwise clean run.
 *
 * @param {() => any} fn
 * @returns {Promise<{ result: any, logged: any[][] }>}
 */
export async function captureConsoleError(fn) {
  const original = console.error;
  /** @type {any[][]} */
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}
