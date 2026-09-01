#!/usr/bin/env node
/**
 * verify-purgecss.cjs — Dead-CSS CI gate.
 *
 * Runs PurgeCSS over the shared config (scripts/lib/purgecss-config.cjs — the
 * same inputs as the audit) and fails on any selector that is not referenced by
 * scanned content, not covered by the safelist, AND not already frozen in the
 * baseline.
 *
 * ── Why a baseline ───────────────────────────────────────────────────
 * The gate used to safelist `/^gl-/` and `/^geoleaf/` — the project's own
 * prefixes — which exempted 149 of the 165 GeoLeaf classes. It printed
 * "0 dead CSS selectors across 49 stylesheets" while checking almost nothing,
 * and would not have caught the deletion of a LIVE selector either. Removing the
 * two blanket entries surfaces 425 rejected selectors.
 *
 * Those 425 are NOT 425 bugs. They fall into three groups:
 *   1. Genuinely dynamic → moved to SAFELIST in the shared config.
 *   2. Referenced only from places the content globs deliberately exclude
 *      (tests, __mocks__, the generated docs site). A class used only by a test
 *      IS dead in production, so widening the globs would re-hide the problem.
 *   3. Deliberately-offered surfaces never consumed in-repo — the utility layer
 *      of `ui-base.css` (`.gl-stack`, `.gl-mt-*`, `.gl-badge*`, `.gl-btn--*`)
 *      and the speculative `.gl-geojson-*` classes, both claimed as such by
 *      their own file headers. S12 explicitly decided NOT to purge them.
 *
 * Deciding the fate of group 3 is a product call, not a gate repair. So the
 * baseline freezes the known set and the gate blocks only on a NEW dead
 * selector — same ratchet as `check-orphan-exports.cjs`. Purge a batch, then
 * regenerate; the floor only ever moves down.
 *
 * Usage:
 *   node scripts/verify-purgecss.cjs                   # gate
 *   node scripts/verify-purgecss.cjs --update-baseline # refreeze after a purge
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { purge, ROOT, ENUMERATED_CONTENT } = require("./lib/purgecss-config.cjs");

/**
 * Fail if one of the app's enumerated content files stopped resolving (T2).
 *
 * The gate compares dead selectors against a baseline, so a content path that stops
 * matching does NOT fail: it silently drops from the scanned corpus, and the selectors
 * used ONLY there get reported as dead — or worse, stay hidden because the baseline
 * already tolerates them. Measured at T2: blanking the two app paths newly killed just
 * 2 selectors of 130 (`.gl-page`, `.gl-filter-toggle__icon`). That is a thread, not a
 * net — the day a CSS refactor removes those two, the muteness becomes undetectable.
 *
 * Only the ENUMERATED paths are asserted. The derived per-workspace `src/**` patterns
 * are allowed to match nothing (several workspaces ship no TS and no CSS), so checking
 * every glob would be a false invariant.
 */
async function assertEnumeratedContentResolves() {
    const { glob } = require("glob");
    const mute = [];
    for (const g of ENUMERATED_CONTENT) {
        if ((await glob(g)).length === 0) mute.push(g);
    }
    if (mute.length) {
        console.error(
            `✘ verify-purgecss: ${mute.length} enumerated content path(s) match nothing — ` +
                `the gate would report coverage it does not have:`
        );
        for (const g of mute) console.error(`    ${path.relative(ROOT, g)}`);
        console.error("  Fix the path in lib/purgecss-config.cjs (ENUMERATED_CONTENT).");
        process.exit(1);
    }
}

const BASELINE_PATH = path.join(__dirname, "verify-purgecss.baseline.json");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const BASELINE_COMMENT =
    "Sélecteurs CSS non référencés CONNUS — état figé, pas une liste d'exemptions. " +
    "Le gate ne bloque que sur un sélecteur ABSENT d'ici. Trois natures s'y mélangent " +
    "volontairement : (a) surfaces offertes et assumées (utilitaires de ui-base.css, " +
    "classes .gl-geojson-* — leurs en-têtes les revendiquent comme telles, S12 a refusé " +
    "de les purger), (b) classes référencées uniquement depuis des sources exclues par " +
    "conception (tests, __mocks__, docs générées) — une classe utilisée seulement par un " +
    "test EST morte en prod, (c) vraie dette. Ce qui est dynamique par construction va " +
    "dans SAFELIST (purgecss-config.cjs), PAS ici. Régénérer via `--update-baseline` " +
    "après avoir purgé un lot : le plancher ne fait que descendre.";

/** Stable key for a rejected selector: file + selector, normalised. */
function selectorKey(file, selector) {
    return `${file}::${selector.replace(/\s+/g, " ").trim()}`;
}

function loadBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
        return new Set(raw.selectors || []);
    } catch (err) {
        console.error(`✘ verify-purgecss: baseline illisible (${BASELINE_PATH})\n`, err.message);
        process.exit(1);
    }
}

function writeBaseline(keys) {
    fs.writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
            { _comment: BASELINE_COMMENT, generatedCount: keys.length, selectors: keys.sort() },
            null,
            4
        ) + "\n"
    );
}

(async () => {
    await assertEnumeratedContentResolves();

    const { cssFiles, results } = await purge();

    if (cssFiles.length === 0) {
        console.error(
            "✘ verify-purgecss: no CSS files found — check CSS_GLOBS in lib/purgecss-config.cjs"
        );
        process.exit(1);
    }

    const dead = [];
    for (const r of results) {
        const file = r._file ? path.relative(ROOT, r._file).split(path.sep).join("/") : "unknown";
        for (const sel of r.rejected || []) {
            dead.push({ file, selector: sel, key: selectorKey(file, sel) });
        }
    }

    if (UPDATE_BASELINE) {
        writeBaseline(dead.map((d) => d.key));
        console.log(
            `✓ verify-purgecss: baseline régénérée (${dead.length} sélecteur(s) figé(s) dans ` +
                `${path.relative(ROOT, BASELINE_PATH)}).`
        );
        process.exit(0);
    }

    const baseline = loadBaseline();
    if (baseline === null) {
        console.error(
            `✘ verify-purgecss: baseline absente (${path.relative(ROOT, BASELINE_PATH)}).\n` +
                "  Générer une première fois avec : node scripts/verify-purgecss.cjs --update-baseline"
        );
        process.exit(1);
    }

    const fresh = dead.filter((d) => !baseline.has(d.key));
    const known = dead.length - fresh.length;
    // A selector in the baseline that no longer shows up means it was purged or
    // revived — good news, but the baseline should shrink to keep the ratchet tight.
    const stale = [...baseline].filter((k) => !dead.some((d) => d.key === k));

    if (fresh.length === 0) {
        console.log(
            `✔ verify-purgecss: aucun NOUVEAU sélecteur mort (${known} déjà en baseline, ` +
                `${cssFiles.length} feuilles).`
        );
        if (stale.length > 0) {
            console.log(
                `ℹ ${stale.length} entrée(s) de baseline obsolète(s) — régénérer avec ` +
                    "`node scripts/verify-purgecss.cjs --update-baseline` pour resserrer le plancher."
            );
        }
        process.exit(0);
    }

    console.error(
        `✘ verify-purgecss: ${fresh.length} NOUVEAU(X) sélecteur(s) mort(s) ` +
            `(${known} déjà connu(s) en baseline) :\n`
    );
    for (const d of fresh) {
        console.error(`  ${d.file}\n    ${d.selector}`);
    }
    console.error(
        "\nAu choix :\n" +
            "  • supprimer la règle morte ;\n" +
            "  • si la classe est construite à l'exécution → SAFELIST dans " +
            "scripts/lib/purgecss-config.cjs (en documentant le site d'appel) ;\n" +
            "  • si c'est une surface volontairement offerte → régénérer la baseline " +
            "(--update-baseline) en le justifiant dans le commit."
    );
    process.exit(1);
})().catch((err) => {
    console.error("✘ verify-purgecss: unexpected error\n", err);
    process.exit(1);
});
