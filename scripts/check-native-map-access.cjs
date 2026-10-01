#!/usr/bin/env node
/**
 * NMA — the calls to `getNativeMap()` outside the map adapter are counted, under a ratchet.
 *
 * ## The defect this holds
 *
 * Every map operation goes through `IMapAdapter` (the kernel spec's ADR-01). `getNativeMap()`
 * is the door left open in that rule: it hands the engine's own map to whoever asks, and
 * from there on the caller speaks the engine's API directly. Each such call is a place the
 * adapter does not mediate — where a change of the engine's API lands unannounced, and
 * where a test double of the adapter proves nothing.
 *
 * The door is legitimate, and it is not being closed. What was missing is a COUNT: nothing
 * saw the number of these sites move. This gate makes a new one a decision someone takes —
 * it reddens, and the answer is either to go through the adapter or to raise the baseline
 * on purpose, in a commit that says why.
 *
 * ## What is counted, and why this is AST and not grep
 *
 * The line that asked for this gate counted `grep 'getNativeMap('`: 58 lines. Read one by
 * one, they were three different things — the comments and TSDoc that name the method, its
 * declarations, and the calls. And the calls themselves take two forms, of which a grep on
 * the member name alone sees one:
 *
 *   · the MEMBER call, `a.getNativeMap()` or `a?.getNativeMap?.()` — a property access;
 *   · the call to a package's own SEAM, `_getNativeMap()` or `getNativeMap()` — a function
 *     each plugin keeps in its `internal.ts` (or takes from the shared host runtime) so that
 *     the chain `Core.getMap().getNativeMap()` is written once. Most plugin code reaches the
 *     native map through it: counting member calls alone would see one site per plugin and
 *     miss every consumer.
 *
 * So: `ts.createSourceFile` per file, and every CallExpression whose callee is a property
 * access named `getNativeMap`, or an identifier named `getNativeMap` or `_getNativeMap`.
 *
 * Counted PER FILE, and the counts are compared — a second call in a file that already has
 * one is seen. Keys carry no line number: lines drift without information.
 *
 * ## What it does NOT see
 *
 *   · A call that names neither the member nor a seam: `a["getNativeMap"]()`, a seam function
 *     under another name, a native map kept in a variable and passed around. The run prints
 *     how many times the member is READ without being called, so that such a detour shows.
 *   · What the caller does with the native map afterwards. One call followed by forty
 *     engine calls weighs one here.
 *   · JavaScript: the application shell and the deployed variants are not `src/` of a package.
 *
 * ## Perimeter
 *
 * The `src/` of every package of the workspace registry (`lib/packages.cjs`, which throws
 * on a package it cannot find — a hard-coded path does not break on a move, it stops
 * matching). Tests and mocks are out. So is the adapter itself, `adapters/maplibre/` in the
 * core: it IS the mediation, its calls are not escapes from it.
 *
 *   NMA-01  a file calls `getNativeMap()` more often than its baseline says → ERROR.
 *   NMA-02  a file calls it less often → ERROR until the baseline is tightened (ratchet down).
 *   NMA-03  fewer than 20 calls found in total → refuse to conclude (broken corpus).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const packages = require("./lib/packages.cjs");

const ROOT = packages.ROOT;
const BASELINE_PATH = path.join(__dirname, ".baselines", "native-map-access.json");
const UPDATE = process.argv.includes("--update-baseline");
const FLOOR = 20;
const MEMBER = "getNativeMap";
/** The names a package gives its own seam function over the member. */
const SEAM_NAMES = new Set(["getNativeMap", "_getNativeMap"]);
const SKIPPED_DIRS = new Set(["node_modules", "dist", "coverage", "__tests__", "__mocks__"]);

/** The adapter's own directory — the mediation itself, hence out of the count. */
const ADAPTER_DIR = path.join(
    packages.requireByDirName("core").absDir,
    "src",
    "adapters",
    "maplibre"
);

/**
 * Every production `.ts` under the `src/` of each registry package.
 *
 * @returns {string[]} Absolute paths, sorted.
 */
function sourceFiles() {
    /** @type {string[]} */
    const out = [];
    const walk = (/** @type {string} */ dir) => {
        if (dir === ADAPTER_DIR) return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (SKIPPED_DIRS.has(e.name)) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
        }
    };
    for (const pkg of packages.all()) walk(path.join(pkg.absDir, "src"));
    return out.sort();
}

/** @type {Map<string, number>} file → number of calls */
const observed = new Map();
let totalCalls = 0;
let uncalledReads = 0;
for (const file of sourceFiles()) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    const count = () => {
        totalCalls++;
        observed.set(rel, (observed.get(rel) ?? 0) + 1);
    };
    (function visit(/** @type {import("typescript").Node} */ node) {
        if (ts.isPropertyAccessExpression(node) && node.name.text === MEMBER) {
            const parent = node.parent;
            if (ts.isCallExpression(parent) && parent.expression === node) count();
            else uncalledReads++;
        } else if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            SEAM_NAMES.has(node.expression.text)
        ) {
            count();
        }
        ts.forEachChild(node, visit);
    })(sf);
}

const observedFiles = [...observed.keys()].sort();
console.log(
    `\x1b[2m── NMA — les appels à getNativeMap() hors de l'adaptateur sont comptés ──\x1b[0m`
);
console.log(
    `  ${totalCalls} appel(s) dans ${observedFiles.length} fichier(s) · ` +
        `${uncalledReads} lecture(s) du membre sans appel (gardes \`typeof\`, relais) — non comptées`
);

if (totalCalls < FLOOR) {
    console.error(
        `❌ [NMA-03] ${totalCalls} appel(s) trouvé(s) — sous le plancher de ${FLOOR} : corpus cassé, refus de conclure.`
    );
    process.exit(1);
}

if (UPDATE) {
    /** @type {Record<string, number>} */
    const entries = {};
    for (const file of observedFiles) entries[file] = observed.get(file) ?? 0;
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
            {
                _comment:
                    "NMA-01/02 — appels à `getNativeMap()` par fichier de production, hors `adapters/maplibre/`, gelés à la pose. Un appel de plus rougit : passer par l'adaptateur, ou relever CE compte dans un commit qui dit pourquoi l'accès natif est nécessaire. Un appel de moins rougit aussi, jusqu'à ce que le gel soit resserré. Clés sans numéro de ligne — les lignes dérivent sans information.",
                _generated: "node scripts/check-native-map-access.cjs --update-baseline",
                total: totalCalls,
                entries,
            },
            null,
            4
        ) + "\n"
    );
    console.log(
        `\x1b[32m✓\x1b[0m baseline écrite — ${totalCalls} appel(s), ${observedFiles.length} fichier(s).`
    );
    process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`❌ [NMA] baseline absente — première pose : --update-baseline`);
    process.exit(1);
}

/** @type {Record<string, number>} */
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).entries;
const grown = observedFiles.filter((f) => (observed.get(f) ?? 0) > (baseline[f] ?? 0));
const shrunk = Object.keys(baseline)
    .filter((f) => (observed.get(f) ?? 0) < (baseline[f] ?? 0))
    .sort();

let failed = false;
if (grown.length) {
    failed = true;
    console.error(`❌ [NMA-01] ${grown.length} fichier(s) appellent getNativeMap() plus souvent :`);
    for (const f of grown) console.error(`   + ${f} — ${baseline[f] ?? 0} → ${observed.get(f)}`);
    console.error(
        `   Passer par l'adaptateur (IMapAdapter). Si l'accès natif est nécessaire, relever ce` +
            ` compte dans un commit qui le motive.`
    );
}
if (shrunk.length) {
    failed = true;
    console.error(`❌ [NMA-02] ${shrunk.length} fichier(s) en appellent moins — resserrer :`);
    for (const f of shrunk.slice(0, 10)) {
        console.error(`   − ${f} — ${baseline[f]} → ${observed.get(f) ?? 0}`);
    }
    console.error(`   \x1b[2mnode scripts/check-native-map-access.cjs --update-baseline\x1b[0m`);
}
if (failed) process.exit(1);
console.log(
    `\x1b[32m✓ NMA\x1b[0m — aucun appel nouveau (${totalCalls} gelé(s), ${observedFiles.length} fichier(s)).`
);
