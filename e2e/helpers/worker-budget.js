// @ts-check
// Worker budget for the Playwright suite — derived, not hard-coded.
//
// ## What this replaces, and what the replacement is really about
//
// `playwright.config.js` carried `workers: 1` with not one word next to it. The natural
// reading — "someone measured a race and pinned it" — could not be checked, because nothing
// said what the race was. And the value itself is the wrong shape for a setting like this:
// a constant imposes the slowest machine's answer on every machine. This repository already
// solved the same problem for Vitest, in `packages/build-config/vitest/worker-budget.mjs`,
// by deriving the budget from the host. The motive, there and here, IS the derivation.
//
// ## What is actually shared between two Playwright workers — measured, not assumed
//
// The premise behind pinning to one worker was that the suite mutates shared state: 28 of
// the 45 specs touch the service worker and a comparable number write through the connector,
// all against the same virtual hosts. Two of those three facts do not produce interference,
// and the measurement says so:
//
//   • Service workers, Cache Storage, IndexedDB and localStorage are per BrowserContext.
//     Playwright opens a fresh context per test, so two workers running service-worker specs
//     never see each other's registrations. `e2e/helpers/db-seed.js` seeds IndexedDB inside
//     the page — same isolation.
//   • The static hosts serving the deploy variants are read-only. Concurrent reads of a
//     built artefact cannot collide.
//   • The BACKEND is genuinely shared, and it is the only thing that is. Exactly two specs
//     write to it: `11-connector.spec.js` and `30-sync-cycle.spec.js`.
//
// Measured on the reference host (16 cores, 13.6 GB): the full suite at four workers returns
// the same verdict as at one — 227 passed, 16 skipped, 0 failed — in 6.7 minutes instead of
// 13.9. Repeated, because one green run of a concurrency change proves nothing: a race that
// shows up one run in three is not a pass.
//
// ## The one collision that remains, and why it is refused rather than hoped away
//
// `30-sync-cycle.spec.js` SKIPS on a normally built `deploy-full` — the backend bindings are
// stripped from the served profile — so today the two backend writers never run together.
// That is a property of the build, not of the suite: pointing the build at a backend
// un-skips it, and then two specs write the same rows at once. The failure would be
// intermittent, which is the worst kind: it gets blamed on whichever commit happens to be
// under test.
//
// So this module REFUSES that combination instead of documenting it. Asking for more than one
// worker while the backend bindings are present is an error with a named motive, not a
// warning nobody reads. A guard that can only be believed once it has been seen refusing is
// worth more than a comment that is always true and never checked.

import { availableParallelism } from "node:os";

/** Explicit override, for a machine or a CI runner that knows better than the derivation. */
export const WORKERS_ENV = "GEOLEAF_E2E_WORKERS";

/**
 * Whether the run is pointed at a backend, which un-skips the second backend-writing spec.
 *
 * Read from the same variable the deploy build reads, because that is what actually decides
 * whether the served profile keeps its backend bindings. Deriving the answer from the spec
 * files instead would state an intention; this states the condition.
 *
 * @returns {boolean} True when a backend base URL is configured for this run.
 */
export function backendBound() {
    return Boolean(process.env.GEOLEAF_BACKEND_BASE_URL);
}

/**
 * Workers for this run.
 *
 * The derivation mirrors the Vitest one in shape but not in numbers, because the unit is not
 * the same: a Playwright worker drives a whole browser, which costs far more memory than a
 * Vitest worker and does not benefit from a high count. Half the cores, floor 1, ceiling 4 —
 * beyond four browsers the reference host spends its time in the compositor rather than in
 * the tests, and the suite stops getting faster.
 *
 * ⚠️ The ceiling is a measured stopping point, not a safety margin. Raising it is a decision
 * to re-measure, not a knob to turn.
 *
 * @returns {number} Integer ≥ 1.
 * @throws {Error} If more than one worker is requested while the backend bindings are present.
 */
export function e2eWorkers() {
    const override = process.env[WORKERS_ENV];
    const asked = override
        ? Number.parseInt(override, 10)
        : Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2)));

    if (!Number.isFinite(asked) || asked < 1) {
        throw new Error(
            `${WORKERS_ENV}="${override}" is not a worker count. Set a positive integer, or leave it unset to derive one.`
        );
    }

    // The single genuine collision, refused rather than hoped away.
    if (asked > 1 && backendBound()) {
        throw new Error(
            `Refusing ${asked} workers: GEOLEAF_BACKEND_BASE_URL is set, which un-skips the second ` +
                `backend-writing spec. 11-connector.spec.js and 30-sync-cycle.spec.js then write the same ` +
                `rows concurrently, and the failure would be intermittent — blamed on whichever commit is ` +
                `under test rather than on the concurrency. Run that combination with ${WORKERS_ENV}=1.`
        );
    }

    return asked;
}

/**
 * The resolved budget, for logging — what the run will cost before it costs it.
 *
 * No production consumer: it exists so the number that governs the suite is printed rather
 * than inferred from how long the run took.
 *
 * @returns {{workers: number, cores: number, derived: boolean, backendBound: boolean}} The budget.
 */
export function describeE2EBudget() {
    return {
        workers: e2eWorkers(),
        cores: availableParallelism(),
        derived: !process.env[WORKERS_ENV],
        backendBound: backendBound(),
    };
}
