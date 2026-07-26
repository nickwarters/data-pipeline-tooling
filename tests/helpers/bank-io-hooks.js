// @ts-check
/**
 * Module customization hooks that make Question Bank I/O observable (#521).
 *
 * `case-types/load-bank.js` reads a bank artifact with `fetch()` over http and
 * with `node:fs/promises`' `readFile` for `file:` URLs. The probe process can
 * wrap `fetch` itself, but `readFile` is reached through
 * `await import('node:fs/promises')`, whose namespace cannot be monkey-patched.
 * These hooks redirect that specifier to a generated module that re-exports the
 * real one and counts `readFile` calls in `globalThis.__CORA_BANK_IO__`.
 *
 * The counter lives in the application thread (the generated source is
 * evaluated there); the hooks themselves only rewrite the module.
 */

const PROBE_URL = 'cora-bank-io-probe:fs-promises';

const PROBE_SOURCE = `
import * as real from 'node:fs/promises';
export * from 'node:fs/promises';
export default real.default;
export const readFile = (...args) => {
  globalThis.__CORA_BANK_IO__ = (globalThis.__CORA_BANK_IO__ ?? 0) + 1;
  return real.readFile(...args);
};
`;

/**
 * @param {string} specifier
 * @param {{ parentURL?: string }} context
 * @param {(specifier: string, context: unknown) => unknown} nextResolve
 */
export function resolve(specifier, context, nextResolve) {
  const isFsPromises =
    specifier === 'node:fs/promises' || specifier === 'fs/promises';
  if (isFsPromises && context.parentURL !== PROBE_URL) {
    return { url: PROBE_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

/**
 * @param {string} url
 * @param {unknown} context
 * @param {(url: string, context: unknown) => unknown} nextLoad
 */
export function load(url, context, nextLoad) {
  if (url === PROBE_URL) {
    return { format: 'module', source: PROBE_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
