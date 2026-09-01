#!/usr/bin/env node
/**
 * Enforces the plugin → core boundary settled by ARCHI S7.
 *
 * The rule, in one line: a plugin reaches the core through the RUNNING namespace
 * (`globalThis.GeoLeaf.*`), not by importing its source files. Deep imports make the
 * bundler inline a copy of the core — `plugin-addpoi` shipped 404 Ko that way, against
 * 124 Ko for `plugin-table`, which has always used the namespace.
 *
 * They also produce a subtler failure, and S7 found four instances of it: the bundled
 * copy is NOT the instance the host initialises. `Config` imported from
 * `config-primitives.js` carries neither `.get` nor `getActiveProfile` — those are
 * grafted by `config-accessors.ts`, which plugins do not bundle. Four code paths were
 * therefore dead at runtime while their tests passed against the bundled copy.
 *
 * PCB-01: no NEW deep import of core sources in plugin `src/` (baseline below).
 * PCB-02: the baseline must shrink, never grow — an entry no longer used is reported
 *         so it gets pruned rather than quietly authorising a future regression.
 *
 * Scope: `src/**\/*.ts` excluding `__tests__/`. Test files legitimately require core
 * modules to drive mocks; they do not ship. Comment lines are exempt.
 *
 * Usage: node scripts/verify-plugin-core-boundary.cjs (from repo root)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/**
 * Deep imports still allowed, per plugin, as left by ARCHI S7 (2026-07-19).
 *
 * Every entry is a DEBT with an owner, not an exemption:
 *   - `utils/general/poi-to-feature` is `import type` only — erased at build, zero bundle
 *     weight. It may stay.
 *   - `built-in/shared/*` carry shared STATE; exposing them publicly is a heavier
 *     compatibility commitment than a pure function, so they were left to a separate
 *     arbitration.
 *   - `@core-offline/cache/tile-math.js` replaces the former `cache/calculator.js`
 *     entry. Same plugin → CAPABILITY edge, but the target is now a ~130-line
 *     dependency-free module instead of 465 lines carrying `Log`: rollup copies the
 *     resolved source into the plugin bundle, so what that file imports is what the
 *     plugin ships. Keep `tile-math.ts` import-free or the debt grows back.
 *   - `@core/config/profile-layers.js` is what remains of the same edge after the
 *     module moved out of `capabilities/offline/`. Made `Log`-free by injecting the
 *     warning sink (`onWarn`), for the same reason.
 *
 * Shrink this list as those land. Adding to it requires a deliberate decision.
 *
 * ✅ **2 entries removed, 5 → 3 for `addpoi`.**
 * `@core/contracts/layer-data.contract.js` and `@core/contracts/map-adapter.contract.js`
 * are no longer a debt: the contracts are now PUBLISHED
 * (`@geoleaf/core/contracts/<file>.js`, types-only subpaths). The 3 affected imports go
 * through the `exports` map, exactly like a third-party integrator — they are no longer
 * deep imports into the core's sources, hence no longer this gate's subject. The
 * tsconfig `paths` that resolved them was removed in the same move: without that, the
 * line would have left the baseline with nothing changing for real.
 */
// ✅ **EMPTY — and that is the TARGET state, not an accident.** The last two entries
// (`addpoi` then `offline-ui`) were settled: singletons go through the namespace, pure
// functions through the published `exports` map.
//
// 🛑 **THE EMPTY KEY THAT REMAINED IS NO LONGER NEEDED, and its comment said why.** It
// explained that `"offline-ui": []` was kept because "removing the key would make the
// `Object.entries(BASELINE)` loop iterate zero times for this package: the gate would
// print two ✅ without having read a single file". **That was exact, and it was a parry
// laid by hand on the two packages anyone had thought of.** The ten others never got it
// — hence this hole.
//
// Since the loop derives its perimeter from `registry.plugins()`, a plugin absent from
// here is scanned **with zero tolerance**, which is the right default for an
// architecture boundary. The parry has no object left: the structure carries it, not an
// entry.
//
// ⚠️ What stays true: **adding an entry here is a deliberate decision**, and each one is
// a DEBT with an owner, never a permanent permission. PCB-02 makes it shrink.
const BASELINE = {};

/**
 * Any specifier that ADDRESSES the core — whatever scheme it uses.
 *
 * 🛑 **THIS PATTERN ONLY RECOGNIZED A DEAD SCHEME, and that is the half of the defect
 * the founding note did not carry.** It was written `/["'](@core(?:-offline)?\/[^"']+)["']/g`,
 * so it only saw the `@core/` and `@core-offline/` aliases. Measured on 2026-08-16:
 * **no plugin declares those aliases anymore** — neither in its `tsconfig.json` nor in
 * its `rollup.config.mjs`.
 *
 * ⚠️ **Consequence: even scanning the 12 packages, the gate could catch NO deep import
 * written today.** A developer writing `@geoleaf/core/src/kernel/…` or
 * `../../../core/src/…` passed without a word. The green was not a property of the
 * code, it was the shape of the question.
 *
 * ✅ Three families recognized now, each matching a real way of reaching the sources:
 * the historical alias, the published package's subpath, and the relative path climbing
 * up to `core/src`.
 */
const CORE_SPECIFIER_RE =
    /["'](@core(?:-offline)?\/[^"']+|@geoleaf\/core\/[^"']+|(?:\.\.\/)+(?:packages\/)?core\/src\/[^"']+)["']/g;

/**
 * The subpaths the core PUBLISHES — derived from its `exports` map, never copied.
 *
 * 🛑 **This is what separates a LEGITIMATE import from a DEEP one, and the distinction
 * is not cosmetic.** `@geoleaf/core/kernel/config/layer-geometry.js` is declared in
 * `exports`: a third-party integrator writes it the same way, the bundler resolves to
 * the published point, and nothing gets re-bundled on the sly.
 * `@geoleaf/core/src/kernel/…` is not: it short-circuits the map and gets a source
 * copied into the plugin's bundle — the exact defect this gate exists to prevent.
 *
 * ⚠️ **Derived and not listed.** A hard-coded list here would go stale at the first
 * published subpath, and go stale IN SILENCE: the gate would redden on a perfectly
 * legitimate import, it would get added to the baseline, and the debt would grow by an
 * entry that is not one.
 */
const CORE_EXPORT_PATTERNS = Object.keys(
    require(path.join(ROOT, "packages/core/package.json")).exports || {}
)
    .filter((k) => k.startsWith("./"))
    .map((k) => k.slice(2));

/**
 * Does an `@geoleaf/core/<sub>` subpath go through the `exports` map?
 *
 * Handles the `*` wildcard of keys like `./capabilities/*.js`, with Node's semantics:
 * `*` stands for any path segment, including an empty one.
 */
function isPublishedSubpath(sub) {
    return CORE_EXPORT_PATTERNS.some((pat) => {
        if (!pat.includes("*")) return pat === sub;
        const [head, tail] = pat.split("*");
        return (
            sub.startsWith(head) && sub.endsWith(tail) && sub.length >= head.length + tail.length
        );
    });
}

/** Walks `dir`, collecting `.ts` files outside `__tests__/`. */
function collectSources(dir, results) {
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__tests__" || entry.name === "node_modules") continue;
            collectSources(full, results);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            results.push(full);
        }
    }
    return results;
}

/** `true` when the line is a comment — docs may name any module they like. */
function isComment(line) {
    const t = line.trim();
    return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

let failed = false;
const seen = {};

// Paths come from the workspace registry.
//
// This gate does not enumerate the packages: it scans exactly the 2 BASELINE keys. It
// was therefore not in the list of 8 enumerations converted with the others — yet it
// carried the SAME failure through another mechanism:
// `path.join(ROOT, "packages", plugin, "src")` is depth-sensitive. After the plugin
// regrouping, that path would no longer have existed, `collectSources` would have
// returned an empty list, and the gate would have announced "0 violations" having read
// nothing — green and blind on the only boundary it watches.
//
// `requireByDirName` THROWS if the package cannot be found: a move breaks loudly
// instead of emptying the perimeter in silence. Found by the
// `scripts/probe-gate-visibility.cjs` probe, not by re-reading.
const registry = require("./lib/packages.cjs");

// ── THE GATE ITERATES OVER THE REGISTRY, NO LONGER OVER ITS BASELINE ───────────
//
// 🛑 WHAT IT USED TO DO, AND WHY IT IS THE WORST FORM OF THE DEFECT. The loop was
// written `for (const [plugin, allowed] of Object.entries(BASELINE))`. `BASELINE`
// contains only ONE key: the gate guarding the project's architecture boundary
// **opened 1 plugin out of 12**, and its success message asserted conformance without
// saying what it covered. Eleven plugins were never read — not once since this gate
// exists.
//
// ⚠️ **The mechanism was UNDERSTOOD and documented, thirty lines from here.** The
// `BASELINE` comments explain that a settled plugin's key is kept EMPTY because
// "removing the key would make the loop iterate zero times for this package: the gate
// would print two ✅ without having read a single file". The parry was right — it was
// applied **case by case**, to the two packages someone had thought to take out of the
// baseline. The ten others never got it. A parry that must be laid by hand on every
// member is not a parry: it is a list, and a list forgets.
//
// ✅ **The perimeter now DERIVES**: `registry.plugins()` returns the workspace
// registry's `@geoleaf-plugins/*` packages. `BASELINE` no longer decides WHO is
// scanned, only WHAT is tolerated for them — a plugin absent from the baseline is
// scanned with zero tolerance, the right default for an architecture boundary.
const pluginPkgs = registry.plugins();

// Anti-empty-gate, floor #1: an empty registry would render "0 violations" reading nothing.
if (pluginPkgs.length === 0) {
    console.error(
        "❌ [PCB-00] 0 plugin rendu par `registry.plugins()` — impossible dans ce dépôt.\n" +
            "   L'instrument est cassé, pas le code. La gate refuse de conclure."
    );
    process.exit(2);
}

let filesScanned = 0;

for (const pkg of pluginPkgs) {
    const plugin = pkg.dirName;
    const allowed = BASELINE[plugin] ?? [];
    const srcDir = path.join(registry.requireByDirName(plugin).absDir, "src");
    seen[plugin] = new Set();
    const violations = [];

    const sources = collectSources(srcDir, []);
    filesScanned += sources.length;

    for (const file of sources) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
            if (isComment(line)) return;
            for (const m of line.matchAll(CORE_SPECIFIER_RE)) {
                const spec = m[1];

                // A PUBLISHED subpath is not a deep import: it goes through the
                // `exports` map, as for a third-party integrator. Set aside before even
                // being seen — recording it in `seen` would make it look like a debt to
                // purge.
                if (spec.startsWith("@geoleaf/core/") && isPublishedSubpath(spec.slice(14))) {
                    continue;
                }

                seen[plugin].add(spec);
                if (!allowed.includes(spec)) {
                    violations.push(`${path.relative(ROOT, file)}:${i + 1}  ${spec}`);
                }
            }
        });
    }

    if (violations.length) {
        failed = true;
        console.error(`\n❌ [PCB-01] ${plugin} — deep import(s) hors baseline :`);
        for (const v of violations) console.error(`   ${v}`);
        console.error(
            `   → Passez par le namespace du core en cours d'exécution :\n` +
                `     src/utils/core-utils.ts (accesseurs) ou src/utils/log.ts.\n` +
                `     Un import direct fait ré-embarquer une copie du core dans le bundle,\n` +
                `     et cette copie n'est PAS l'instance que l'hôte initialise.`
        );
    }
}

// Anti-empty-gate, floor #2: twelve packages returning zero files is a broken
// `collectSources` or a moved tree — not a repo without sources.
if (filesScanned === 0) {
    console.error(
        `❌ [PCB-00] ${pluginPkgs.length} plugin(s) visité(s), et 0 fichier lu.\n` +
            "   L'instrument est cassé, pas le code. La gate refuse de conclure."
    );
    process.exit(2);
}

if (!failed) {
    console.log(
        `✅ [PCB-01] Aucun deep import plugin → core hors baseline.\n` +
            `   périmètre : ${pluginPkgs.length} plugin(s), ${filesScanned} fichier(s) — ` +
            `${pluginPkgs.map((p) => p.dirName).join(", ")}`
    );
}

// PCB-02 — the baseline must shrink. An entry gone useless is flagged for removal:
// leaving it would silently authorize a future regression.
let stale = false;
for (const [plugin, allowed] of Object.entries(BASELINE)) {
    const unused = allowed.filter((spec) => !seen[plugin].has(spec));
    if (unused.length) {
        stale = true;
        console.error(`\n❌ [PCB-02] ${plugin} — entrée(s) de baseline devenue(s) inutiles :`);
        for (const u of unused) console.error(`   ${u}`);
        console.error(
            `   → Retirez-les de BASELINE dans scripts/verify-plugin-core-boundary.cjs.\n` +
                `     La baseline est une dette, pas une permission permanente.`
        );
    }
}

if (stale) failed = true;
else console.log("✅ [PCB-02] Baseline à jour — aucune entrée obsolète.");

process.exit(failed ? 1 : 0);
