#!/usr/bin/env node
/**
 * verify-test-load-mode.cjs — the guard on how modules load under test.
 *
 * ## The defect it freezes
 *
 * A source module loaded through `require()` from a test gets its coverage attributed
 * **to the wrong lines and the wrong functions**. This is not imprecision: two probes
 * differing ONLY by load mode, each calling only `formatFileSize` in a 4-function
 * module, give under `import` `FNDA:1` on the right one and `FNDA:0` on the other
 * three — and under `require()` exactly the reverse, wrong on all four. Lines move
 * too, and totals are not preserved.
 *
 * Nothing fails: the suite is green, the report is well-formed, the percentages are
 * plausible. That is what let the defect live a month unseen.
 *
 * ## Why a gate BEFORE converting
 *
 * The conversion covers **184 files and 357 sites** (this gate's measurement,
 * 2026-07-22): several sessions. As long as nothing forbids the 185th, the debt
 * re-digs while being filled — and it is not a hypothesis: between the plan's
 * writing and the end of the first pass, `sync-queue-order.test.js` arrived with 2
 * sites (commit `b4654fa9`, the same day). **Nothing flagged it.**
 *
 * The baseline therefore only **descends**: the gate only blocks on a site ABSENT
 * from it. Same ratchet as `verify-purgecss` and `check-orphan-exports`.
 *
 * ## What is counted, and what is NOT
 *
 * Only `require()`s of a **real source module** count — the specifier must resolve to
 * an existing `.ts`. A `require()` of a fixture, a mock or an npm package loads no
 * measured source, it is ignored.
 *
 * **Both specifier shapes count** — relative (`../x.js`) AND bare (`@core/…`,
 * `@core-offline/…`), the latter resolved through the package tsconfig's `paths`.
 *
 * ⚠️ **The bare shape was invisible to this gate for a long while** (2026-07-22).
 * Measured then: 22 sites in `plugin-addpoi` and `plugin-storage`, of which **8
 * loaded real core source** — and one whole test file,
 * `cache-workflow-cross.integration.test.js`, used ONLY bare specifiers, hence
 * appeared in no inventory. The baseline under-counted with nothing saying so.
 *
 * ⚠️ **That is what explains the gap with the plan's numbers** (186 files /
 * 373 sites, and 188/377 at the first pass's closing census). This gate finds fewer,
 * and it is deliberate: the prototype that produced those numbers counted ALL
 * relative `require()`s, including those loading no measured source —
 * `__mocks__/maplibre-gl.cjs`, `helpers/dom-create-double.js`,
 * `scripts/check-bundle-size.cjs`. Converting them would change nothing to coverage
 * attribution. Their count is shown separately, so the gap stays readable.
 *
 * The perimeter comes from the registry (`lib/packages.cjs`), so
 * `packages/_plugin-template/` is excluded: it sits outside `workspaces`
 * (`!packages/_*`).
 *
 * ⚠️ **`vi.mock(...)` is neutralized before analysis.** Declaring a mock does not
 * load the real module. Forgetting that detail is what once made a census announce
 * "139 modules" where there are 79: the count included the `vi.mock()` targets.
 *
 * ## Accepted limit — and it is no longer hypothetical
 *
 * Detection is **syntactic**, hence blind to a `require()` whose specifier is built
 * at runtime.
 *
 * ⚠️ This limit carried "no site of that shape has been observed". **That was
 * false**: `geojson/geojson-core.test.js` loops over **9 core source modules**
 * through `` require(`../../src/kernel/${subModule}`) ``. Nine misattribution sites
 * neither the baseline nor the triage named. They are still unresolved — the loop
 * would have to be evaluated — but they are now **counted and shown**, the only
 * thing keeping them from turning invisible again. Their conversion belongs to the
 * reload-conversion batches.
 *
 * `createRequire()` and `module.require()`: verified repo-wide since. A single site,
 * `guards/prototype-pollution-sinks.guard.test.js`, and it loads a `.cjs` — a
 * genuinely CommonJS module, hence no skewed attribution.
 *
 * Usage :
 *   node scripts/verify-test-load-mode.cjs                    # gate
 *   node scripts/verify-test-load-mode.cjs --update-baseline  # re-freeze after converting
 *   node scripts/verify-test-load-mode.cjs --report           # dashboard, no gate
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");
const shared = require("./lib/test-load-sites.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, "verify-test-load-mode.baseline.json");

const UPDATE_BASELINE = process.argv.includes("--update-baseline");
const REPORT_ONLY = process.argv.includes("--report");

const BASELINE_COMMENT =
    "Sites `require()` de module source CONNUS dans les tests — état figé, PAS une liste " +
    "d'exemptions. Chaque entrée est un endroit où la couverture est attribuée aux " +
    "mauvaises lignes et aux mauvaises fonctions (roadmap COUVERTURE, sprints 2 à 5). " +
    "Le gate ne bloque que sur un site ABSENT d'ici : la baseline ne peut que DESCENDRE. " +
    "Régénérer via `--update-baseline` après avoir converti un lot — jamais pour faire " +
    "taire un site neuf, qui doit être converti et non figé.";

/** @param {string} abs @returns {string} Repo-relative path, POSIX separators. */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/** A site's stable key: test file + specifier. */
const siteKey = (testFile, spec) => `${rel(testFile)}::${spec}`;

/**
 * Analyses the whole monorepo's tests.
 *
 * @returns {{sites: {key: string, testFile: string, spec: string}[],
 *   modules: {reqOnly: number, both: number, impOnly: number},
 *   files: {mech: number, mock: number, reset: number, total: number},
 *   packagesScanned: number, testFilesScanned: number, nonSourceRequires: number}}
 */
function analyse() {
    // Derived from the registry, never from a hand-written glob: a hard-coded path
    // does not break when a package moves, it silently stops matching and the gate
    // goes green having scanned nothing (cf. `probe-gate-visibility.cjs`).
    const packages = registry.all();

    /** module source → { req: Set, imp: Set } */
    const loads = new Map();
    const touch = (mod) => {
        if (!loads.has(mod)) loads.set(mod, { req: new Set(), imp: new Set() });
        return loads.get(mod);
    };

    const sites = [];
    /** test file → { sites, viMock, resetModules } */
    const perTest = new Map();
    let testFilesScanned = 0;
    let nonSourceRequires = 0;
    /** `require(`…${x}`)` sites — visible, unresolved. */
    const dynamicRequires = [];

    for (const p of packages) {
        // The sites (RELATIVE **and BARE** specifiers), their resolution and the
        // family classification come from `lib/test-load-sites.cjs`, shared with
        // `audit-test-load-conversion.cjs`. Each carried its own copy for a long
        // while, and they had already diverged: the classifier had to be fixed IN
        // BOTH (`vi.isolateModules` counted as mechanical although it reloads).
        const bySite = shared.collectSites(p);
        const seenTests = new Set();

        for (const tf of shared.walkTests(p.absDir)) {
            testFilesScanned += 1;
            const relTf = rel(tf);
            const src = fs.readFileSync(tf, "utf8");
            const scrubbed = shared.scrubMocks(src);

            let resolvedReq = 0;
            for (const s of bySite.filter((x) => x.file === relTf)) {
                if (s.kind === "dynamic") {
                    // Runtime-built specifier: unresolvable without evaluating the
                    // loop. Counted SEPARATELY rather than ignored — the only way it
                    // does not turn invisible again. Conversion: the reload batches.
                    dynamicRequires.push(`${relTf}:${s.line}`);
                    continue;
                }
                if (!s.mod) {
                    // Loads no measured source (mock, helper, script). Outside the
                    // coverage perimeter — counted separately so the gap stays
                    // explainable.
                    nonSourceRequires += 1;
                    continue;
                }
                touch(path.join(ROOT, s.mod)).req.add(tf);
                resolvedReq += 1;
                sites.push({ key: siteKey(tf, s.spec), testFile: relTf, spec: s.spec });
            }

            // The graph's `import` side: relative AND bare, same resolution rules.
            const impSpecs = [
                ...scrubbed.matchAll(/(?:^|\s)import\s[^;]*?from\s*(['"])([^'"]+)\1/g),
                ...scrubbed.matchAll(/(?:await\s+)?import\(\s*(['"])([^'"]+)\1\s*\)/g),
                ...scrubbed.matchAll(/importActual\(\s*(['"])([^'"]+)\1\s*\)/g),
            ].map((m) => m[2]);
            for (const spec of impSpecs) {
                const hit = shared.resolveSource(tf, spec, p);
                if (hit) touch(hit.abs).imp.add(tf);
            }

            if (resolvedReq > 0 && !seenTests.has(relTf)) {
                seenTests.add(relTf);
                const family = shared.classify(src);
                perTest.set(tf, {
                    sites: resolvedReq,
                    viMock: family === "mock",
                    // ⚠️ `isolateModules` counts with `resetModules`. It does the
                    // same work — reload a module into a fresh registry — and thus
                    // belongs to the reload batch, not the mechanical conversions.
                    // Without it, `api/api-extended.test.js` came out "mechanical"
                    // while its 3 sites live inside
                    // `vi.isolateModules(() => require(…))`: an over-optimistic
                    // classification, on the side that costs dearly.
                    resetModules: family === "reload",
                });
            }
        }
    }

    const modules = { reqOnly: 0, both: 0, impOnly: 0 };
    for (const { req, imp } of loads.values()) {
        if (req.size && !imp.size) modules.reqOnly += 1;
        else if (req.size && imp.size) modules.both += 1;
        else if (imp.size) modules.impOnly += 1;
    }

    const files = { mech: 0, mock: 0, reset: 0, total: perTest.size };
    for (const v of perTest.values()) {
        if (v.resetModules) files.reset += 1;
        else if (v.viMock) files.mock += 1;
        else files.mech += 1;
    }

    return {
        sites,
        modules,
        files,
        dynamicRequires,
        packagesScanned: packages.length,
        testFilesScanned,
        nonSourceRequires,
    };
}

/** @param {string[]} keys */
function writeBaseline(keys) {
    fs.writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
            { _comment: BASELINE_COMMENT, generatedCount: keys.length, sites: [...keys].sort() },
            null,
            4
        ) + "\n"
    );
}

/** @returns {Set<string>|null} */
function loadBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) return null;
    try {
        return new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).sites || []);
    } catch (err) {
        console.error(`✘ verify-test-load-mode: baseline illisible (${rel(BASELINE_PATH)})`);
        console.error(`  ${err.message}`);
        process.exit(1);
    }
}

/** @param {ReturnType<typeof analyse>} a */
function printDashboard(a) {
    console.log(
        `  périmètre : ${a.packagesScanned} paquets, ${a.testFilesScanned} fichiers de test scannés`
    );
    console.log(
        `  modules   : ${a.modules.reqOnly} en require() SEUL (mesure fausse) · ` +
            `${a.modules.both} par les DEUX (mesure polluée) · ${a.modules.impOnly} en import (exacte)`
    );
    console.log(
        `  à convertir : ${a.files.total} fichiers / ${a.sites.length} sites — ` +
            `${a.files.mech} mécaniques, ${a.files.mock} à vi.mock(), ${a.files.reset} à resetModules()`
    );
    console.log(
        `  hors périmètre : ${a.nonSourceRequires} require() de mock/helper/script — ` +
            "ne chargent aucune source mesurée (question « ESM pur », sprint 5)"
    );
    if (a.dynamicRequires.length) {
        // ⚠️ NEVER silence this count. These sites do load measured sources —
        // `geojson-core.test.js` loops 9 of them — but their specifier only exists at
        // runtime, so neither the baseline nor the triage can name them. Showing them
        // is the only way they do not slip back under the radar.
        console.log(
            `  ⚠ specifier CONSTRUIT : ${a.dynamicRequires.length} site(s) irrésolvable(s) ` +
                "statiquement — chargent des sources, sprints 3/4 :"
        );
        for (const d of a.dynamicRequires) console.log(`      ${d}`);
    }
}

// ── Execution ────────────────────────────────────────────────────────────────
const a = analyse();

// An empty perimeter is a failure, not a success: the signature of a gate that no
// longer sees anything. `packages.cjs` already throws on an incoherent registry; this
// covers the case where the registry is fine but the walk finds no test.
if (a.testFilesScanned === 0) {
    console.error(
        "✘ verify-test-load-mode: 0 fichier de test trouvé sur " +
            `${a.packagesScanned} paquets — le parcours ne voit plus rien.`
    );
    process.exit(1);
}

if (REPORT_ONLY) {
    console.log("ℹ verify-test-load-mode — tableau de bord :");
    printDashboard(a);
    process.exit(0);
}

if (UPDATE_BASELINE) {
    writeBaseline(a.sites.map((s) => s.key));
    console.log(
        `✓ verify-test-load-mode: baseline régénérée — ${a.sites.length} site(s) figé(s) dans ` +
            `${rel(BASELINE_PATH)}.`
    );
    printDashboard(a);
    process.exit(0);
}

const baseline = loadBaseline();
if (baseline === null) {
    console.error(
        `✘ verify-test-load-mode: baseline absente (${rel(BASELINE_PATH)}).\n` +
            "  Générer une première fois avec : node scripts/verify-test-load-mode.cjs --update-baseline"
    );
    process.exit(1);
}

const fresh = a.sites.filter((s) => !baseline.has(s.key));
const known = a.sites.length - fresh.length;
// A baseline site that no longer appears was converted — good news, but the baseline
// must shrink for the ratchet to stay tight.
const present = new Set(a.sites.map((s) => s.key));
const stale = [...baseline].filter((k) => !present.has(k));

if (fresh.length === 0) {
    console.log(
        `✔ verify-test-load-mode: aucun NOUVEAU require() de source (${known} déjà en baseline).`
    );
    printDashboard(a);
    if (stale.length > 0) {
        console.log(
            `ℹ ${stale.length} entrée(s) de baseline obsolète(s) — ${stale.length} site(s) converti(s). ` +
                "Resserrer le plancher : node scripts/verify-test-load-mode.cjs --update-baseline"
        );
    }
    process.exit(0);
}

console.error(
    `✘ verify-test-load-mode: ${fresh.length} NOUVEAU(X) require() de module source ` +
        `(${known} déjà connu(s) en baseline) :\n`
);
for (const s of fresh) console.error(`  ${s.testFile}  →  require("${s.spec}")`);
console.error(
    "\n  La couverture de ces modules sera attribuée aux mauvaises lignes et aux mauvaises\n" +
        "  fonctions. Les charger par `import`.\n" +
        "  ⚠️ Ne PAS régénérer la baseline pour faire taire un site neuf : elle ne descend que\n" +
        "     sur des conversions réelles."
);
process.exit(1);
