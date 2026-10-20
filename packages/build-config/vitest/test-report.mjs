/**
 * @description
 * The Vitest runs' reporters — and the JSON report the coverage gate reads.
 *
 * `scripts/run-tests.cjs --coverage` sets {@link REPORT_ENV} to the report's file name; each
 * package's run then writes it in its own directory, next to its `coverage/`, and
 * `scripts/check-test-failures.cjs` requires one per package. Without the variable, the run
 * prints and writes nothing more than before.
 *
 * ## Why an environment variable, and not arguments after `--`
 *
 * The first shape passed the reporters as `turbo run test:coverage … -- --reporter=json …`.
 * Turbo 2.10.12 hands those arguments to EVERY task of the run — the `build` tasks the
 * coverage depends on included — and hashes them into their keys: `@geoleaf/core#build` got a
 * second cache entry of its own, which restored another set of chunk names over the
 * `dist/` the plain build had written. Measured on 2026-10-20 (`--dry=json`: two keys for one
 * build, `cliArguments` on both). A variable declared in the `env` of `test:coverage` alone,
 * in `turbo.json`, reaches that task's hash and no other.
 *
 * ⚠️ The configs read it at load time, in the Vitest process turbo starts: the name is
 * imported by `run-tests.cjs`, never copied, for the reason `worker-budget.mjs` gives.
 */

/** Name of the variable holding the JSON report's file name. */
export const REPORT_ENV = "GEOLEAF_TEST_REPORT";

/**
 * The `reporters` (and `outputFile`) fields a package config spreads into its `test` block.
 *
 * @returns `verbose` alone; `verbose` and `json` into the named file when {@link REPORT_ENV}
 *   is set.
 */
export function testReporters() {
    const file = process.env[REPORT_ENV];
    return file
        ? { reporters: ["verbose", "json"], outputFile: { json: file } }
        : { reporters: ["verbose"] };
}
