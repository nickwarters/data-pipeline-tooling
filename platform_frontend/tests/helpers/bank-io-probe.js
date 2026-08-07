// @ts-check
/**
 * Child-process probe: does importing a module perform Question Bank I/O?
 *
 * Run as `node --import ./tests/helpers/bank-io-register.js
 * tests/helpers/bank-io-probe.js <module-path-relative-to-repo-root>`. Prints a
 * single JSON line: `{ "afterImport": n, "afterLoad": m }`.
 *
 * `afterLoad` is what keeps the probe honest — it counts the reads made by an
 * explicit `loadQuestionBanks()` call, so a probe that has stopped observing
 * the real primitive reports 0 there and fails the contract test. That guard is
 * also why the probe instruments `readFile` alone: under Node the bank artifact
 * URL is always `file:`, so `fetch` is never the primitive taken. Were that to
 * change, `afterLoad` would fall to 0 and the contract test would say so rather
 * than quietly observing nothing.
 */

globalThis.__CORA_BANK_IO__ = 0;

const target = new URL(`../../${process.argv[2]}`, import.meta.url);
await import(target.href);
const afterImport = globalThis.__CORA_BANK_IO__;

const { loadQuestionBanks } =
  await import('../../src/pages/question-bank/question-bank-source.js');
const { banks, failures } = await loadQuestionBanks();
const afterLoad = globalThis.__CORA_BANK_IO__;

process.stdout.write(
  `${JSON.stringify({
    afterImport,
    afterLoad,
    loadedSlugs: Object.keys(banks),
    failures: failures.map((failure) => failure.slug),
  })}\n`
);
