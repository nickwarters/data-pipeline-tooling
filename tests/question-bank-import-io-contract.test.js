// @ts-check
/**
 * #521: importing the Question Bank source or slice must perform no I/O.
 *
 * A same-process test cannot prove this — a module-scope load runs the real
 * `QUESTION_BANK_IMPORTERS`, which an in-test fake importer never sees, and a
 * source-text assertion is defeated by a rename, a parenthesised `await`, or a
 * split statement. So each module is imported in a child process whose real
 * bank-reading primitive (`node:fs/promises`' `readFile`, the one
 * `case-types/load-bank.js` takes for the `file:` URLs Node sees) is counted,
 * and the count must be 0.
 *
 * The same child then calls `loadQuestionBanks()` explicitly and the count must
 * rise, which is what proves the probe is still watching the live primitive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string} modulePath repo-root-relative module to import in the child
 * @returns {{ afterImport: number, afterLoad: number, loadedSlugs: string[], failures: string[] }}
 */
function probeImport(modulePath) {
  const stdout = execFileSync(
    process.execPath,
    [
      '--import',
      './tests/helpers/bank-io-register.js',
      'tests/helpers/bank-io-probe.js',
      modulePath,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  return JSON.parse(stdout.trim().split('\n').pop() ?? '{}');
}

for (const modulePath of [
  'src/pages/question-bank/question-bank-source.js',
  'src/pages/question-bank/bank-slice.js',
  // The route slice is the module that actually calls the loader, so it is
  // where a module-scope `await loadQuestionBanks()` would most plausibly
  // reappear — cover the likeliest regression path, not just the two the
  // ticket named.
  'src/pages/question-bank/cora-bank-editor.js',
]) {
  test(`#521 importing ${modulePath} reads no Question Bank artifact`, () => {
    const probe = probeImport(modulePath);

    assert.ok(
      probe.afterLoad > probe.afterImport,
      `the probe saw no read from an explicit loadQuestionBanks() call ` +
        `(${JSON.stringify(probe)}) — it is no longer observing the real ` +
        `bank-loading primitive, so its zero counts prove nothing`
    );
    assert.deepEqual(probe.failures, []);
    assert.equal(
      probe.afterImport,
      0,
      `importing ${modulePath} read a Question Bank artifact ` +
        `${probe.afterImport} time(s); bank I/O belongs in the route slice's ` +
        `start(), not at module scope`
    );
  });
}
