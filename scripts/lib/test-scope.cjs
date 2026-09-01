#!/usr/bin/env node
/**
 * Which packages belong to which test scope — and the invariant binding them.
 *
 * This repo runs its unit tests in **two** ways, and both are needed:
 *
 *   1. **The turbo fan-out** — `npm test` → `turbo run test`, one `vitest run` process
 *      per package, each reading ITS config. This is `ci:local`'s gate.
 *   2. **`projects` mode** — `npx vitest run` from the root, ONE process loading the
 *      package configs as so many projects. This is `ci.yml`'s gate.
 *
 * Each had its own hand-written list, and they had diverged. The `packages.cjs` header
 * already noted it: "the root `test` script and `vitest.config.ts#projects` diverged on
 * nine packages". As of 2026-07-22 the `npm test` list still skipped **5 packages / 27
 * test files** (`plugin-cog`, `plugin-file-import`, `plugin-flatgeobuf`,
 * `plugin-realtime-layer`, `host-runtime`) — never by arbitration:
 * `git log -L21,21:package.json` shows a list **by accretion**, each package added by
 * hand the day it received tests. The 5 were simply never added.
 *
 * ## The invariant: `unitScope() ⊇ rootProjectScope()`
 *
 * It is the only property that makes the push protocol's sentence true — "local green →
 * safe push". If `ci:local` tests less than `ci.yml`, a local green says nothing about
 * the remote run, and the GitHub Actions quota gets spent on an unknown.
 *
 * It is therefore **verified, not conventioned**: {@link assertUnitScopeCoversRoot}
 * throws.
 *
 * ## Why both lists are derived, and the exceptions written
 *
 * Same reason as `packages.cjs`: a hard-coded list **does not break** when a package
 * moves, it silently stops matching, and the gate goes green having scanned nothing.
 * Here, a new package joins both perimeters **by default**; taking one out requires
 * writing why, in {@link PARKED} or {@link EXCLUDED_FROM_ROOT_RUN}.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./packages.cjs");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Parked packages, excluded from the turbo unit gate (`npm test`).
 *
 * **Empty as of 2026-07-22, and that is the normal state.** This register exists so a
 * package can be taken out of the gate for the duration of a rewrite WITHOUT doing it by
 * omission — the reason is mandatory, and it is read at every run.
 *
 * ⚠️ **Parking really hides the package, and from BOTH local gates** — the unit one and
 * the coverage one both go through `run-tests.cjs`. That is accepted: a parked package
 * is one whose tests we have decided to stop reading for a while. What changes compared
 * to the silent omission of before is that the fact is **written, motivated, and shown
 * at every execution** instead of invisible.
 *
 * The guard is elsewhere: {@link assertUnitScopeCoversRoot} forbids parking a package
 * that `ci.yml` keeps running — otherwise a local green would cover a remote red.
 *
 * @type {Record<string, string>}
 */
const PARKED = {};

/**
 * Packages deliberately absent from the root `projects` run (`npx vitest run`).
 *
 * Moved here from `vitest.config.ts`: this is **perimeter** knowledge, not Vitest
 * configuration, and it must be readable by the CJS runner that verifies the invariant.
 * The root config now reads it from this module.
 *
 * The list used to be the inverse — 11 hard-coded paths, so every exclusion was an
 * exclusion BY OMISSION: invisible, unexplained, and silently wrong the day a package
 * moved. Stating the exclusions means a new package joins the run by default, and taking
 * one out now requires writing why.
 *
 * @type {Record<string, string>}
 */
const EXCLUDED_FROM_ROOT_RUN = {
    "@geoleaf-plugins/offline-ui":
        "infrastructure de test à reprendre (mock IndexedDB/IDBFactory) — exclusion héritée",
    "@geoleaf/field-renderer": "tourne en autonome via son propre `npm test`",
    "@geoleaf-plugins/editor": "tourne en autonome via son propre `npm test`",
    "@geoleaf-plugins/measure": "tourne en autonome via son propre `npm test`",
    "@geoleaf/host-runtime": "tourne en autonome via son propre `npm test`",
    "@geoleaf/build-config": "package de configuration — aucun test propre",
};

/**
 * The packages carrying a Vitest suite, derived — with config/script coherence checked
 * in passing.
 *
 * The filter is **structural** (`vitest.config.ts` present), so a package losing its
 * config would vanish from both perimeters noiselessly: exactly the failure mode this
 * module fights. Hence the counter-check — a `package.json` declaring a `test` script
 * without a config, or the reverse, **throws**.
 *
 * @returns {{name: string, dir: string, absDir: string}[]}
 */
function testablePackages() {
    const all = registry.all();
    /** @type {string[]} */
    const inconsistent = [];
    const testable = [];

    for (const p of all) {
        const hasConfig = fs.existsSync(path.join(p.absDir, "vitest.config.ts"));
        const hasScript = Boolean(p.manifest.scripts && p.manifest.scripts.test);

        if (hasConfig !== hasScript) {
            inconsistent.push(
                `  - ${p.name} (${p.dir}) : vitest.config.ts ${hasConfig ? "présent" : "ABSENT"}, ` +
                    `script "test" ${hasScript ? "déclaré" : "ABSENT"}`
            );
            continue;
        }
        if (hasConfig) testable.push(p);
    }

    if (inconsistent.length) {
        throw new Error(
            "test-scope.cjs : config Vitest et script `test` désaccordés — un paquet ne peut " +
                "pas sortir d'un périmètre de test en silence.\n" +
                inconsistent.join("\n")
        );
    }

    return testable;
}

/**
 * Perimeter of the turbo unit gate (`npm test`).
 * @returns {{name: string, dir: string, absDir: string}[]}
 */
function unitScope() {
    return testablePackages().filter((p) => !(p.name in PARKED));
}

/**
 * Perimeter of the root `projects` run (`npx vitest run`).
 * @returns {{name: string, dir: string, absDir: string}[]}
 */
function rootProjectScope() {
    return testablePackages().filter((p) => !(p.name in EXCLUDED_FROM_ROOT_RUN));
}

/**
 * Verifies that every key of {@link PARKED} and {@link EXCLUDED_FROM_ROOT_RUN}
 * designates a package that exists. Throws naming the dead keys.
 *
 * ⚠️ 2026-07-26 — this check was MISSING, and that is what made these two tables a
 * SILENT failure. Both filters are `!(p.name in TABLE)`: a key matching no package
 * removes nothing and warns of nothing. At the `@geoleaf-plugins/storage` →
 * `@geoleaf-plugins/offline-ui` rename, the package would thus have rejoined the root
 * `projects` run **without a word**, its IndexedDB mock infrastructure not ported — a
 * red pinned on the wrong culprit, two sprints later.
 *
 * The asymmetry matters: a dead key is always an error (a non-existent package was
 * named), whereas a package absent from both tables is the NORMAL case — it runs.
 *
 * ⚠️ The liveness criterion is `registry.all()`, NOT `testablePackages()`. First version
 * written on `testablePackages()`: it reddened on `@geoleaf/build-config`, a perfectly
 * legitimate exclusion — that package has no tests, hence no `vitest.config.ts`, hence
 * it is not "testable". Excluding a suiteless package is precisely what one wants to be
 * able to write; its ABSENCE FROM THE REPO is the error.
 *
 * @returns {void}
 */
function assertExclusionKeysAlive() {
    const alive = new Set(registry.all().map((p) => p.name));
    /** @type {string[]} */
    const dead = [];

    for (const [table, entries] of [
        ["PARKED", PARKED],
        ["EXCLUDED_FROM_ROOT_RUN", EXCLUDED_FROM_ROOT_RUN],
    ]) {
        for (const name of Object.keys(entries)) {
            if (!alive.has(name)) dead.push(`  - ${name} : clé de ${table}, paquet introuvable`);
        }
    }

    if (dead.length) {
        throw new Error(
            "test-scope.cjs : une exclusion nomme un paquet qui n'existe pas. Elle ne retire " +
                "plus rien — le paquet visé est SILENCIEUSEMENT revenu dans le périmètre.\n" +
                dead.join("\n") +
                "\nRe-keyer l'entrée sur le nouveau nom du paquet, ou la supprimer si " +
                "l'exclusion n'a plus lieu d'être."
        );
    }
}

/**
 * Verifies `unitScope() ⊇ rootProjectScope()` — the property that makes "`ci:local`
 * green → safe push" true. Throws naming the offending packages.
 *
 * A package cannot be in the root run AND parked: it would have been removed from the
 * local gate while left in the remote one — precisely the case where a local green says
 * nothing about the red to come.
 *
 * @returns {void}
 */
function assertUnitScopeCoversRoot() {
    assertExclusionKeysAlive();

    const unit = new Set(unitScope().map((p) => p.name));
    const missing = rootProjectScope()
        .map((p) => p.name)
        .filter((name) => !unit.has(name));

    if (missing.length) {
        throw new Error(
            "test-scope.cjs : `ci:local` testerait MOINS que `ci.yml` — un vert local ne " +
                "dirait plus rien du run distant, et le quota se dépenserait sur une inconnue.\n" +
                missing
                    .map((n) => `  - ${n} : dans le run racine, mais au parc (PARKED)`)
                    .join("\n") +
                "\nRetirer ces paquets de PARKED, ou les exclure AUSSI du run racine " +
                "(EXCLUDED_FROM_ROOT_RUN) en écrivant la raison."
        );
    }
}

// Surface deliberately reduced to what is consumed: `run-tests.cjs` (the first three)
// and `vitest.config.ts` (the last). `EXCLUDED_FROM_ROOT_RUN` and `testablePackages`
// stay internal — exposing them without a consumer would make this module a source of
// orphan exports, which `dead-code` (knip) and `check-orphan-exports` gate.
module.exports = {
    PARKED,
    unitScope,
    assertUnitScopeCoversRoot,
    rootProjectScope,
};
