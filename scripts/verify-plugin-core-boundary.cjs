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
 *     compatibility commitment than a pure function, so S7 left them to a separate
 *     arbitration (ARCHI backlog).
 *   - `@core-offline/cache/tile-math.js` replaces the former `cache/calculator.js` entry
 *     (CAPACITÉS S1). Same plugin → CAPABILITY edge, but the target is now a ~130-line
 *     dependency-free module instead of 465 lines carrying `Log`: rollup copies the
 *     resolved source into the plugin bundle, so what that file imports is what the
 *     plugin ships. Keep `tile-math.ts` import-free or the debt grows back.
 *   - `@core/config/profile-layers.js` is what remains of the same edge after S7 moved
 *     the module out of `capabilities/offline/`. Made `Log`-free at CAPACITÉS S1 by
 *     injecting the warning sink (`onWarn`), for the same reason.
 *
 * Shrink this list as those land. Adding to it requires a deliberate decision.
 *
 * ✅ **API publique S3 — 2 entrées retirées, 5 → 3 pour `addpoi`.**
 * `@core/contracts/layer-data.contract.js` et `@core/contracts/map-adapter.contract.js`
 * ne sont plus une dette : les contrats sont désormais PUBLIÉS
 * (`@geoleaf/core/contracts/<fichier>.js`, sous-chemins types-seuls). Les 3 imports
 * concernés passent par la carte `exports`, exactement comme un intégrateur tiers —
 * ce ne sont plus des deep imports vers les sources du core, donc plus l'objet de
 * cette gate. Le `paths` tsconfig qui les résolvait a été retiré dans le même geste :
 * sans cela, la ligne serait sortie de la baseline sans que rien ne change au réel.
 */
const BASELINE = {
    // API publique S4.4 — addpoi est SOLDÉ : ses 3 deep imports ont disparu. Les deux
    // singletons (`StorageContract`, `GeoJSONShared`) passent par le namespace — leur identité
    // était le contrat, et une copie embarquée n'est jamais celle que le core initialise. Le
    // type `PoiToFeatureInput` est recopié, gardé par un seam.
    //
    // ⚠️ Le tableau est VIDÉ, la clé est GARDÉE. Retirer la clé ferait itérer la boucle
    // `Object.entries(BASELINE)` zéro fois pour ce paquet : la gate imprimerait deux ✅ sans
    // avoir lu un seul fichier — et `probe-gate-visibility.cjs` ne l'attraperait pas, son
    // assertion codant en dur les deux noms. Avec `[]`, elle lit toujours les 65 fichiers
    // d'addpoi et rougit au premier `@core/*` réintroduit.
    // API publique S4.4 — le plugin hors-ligne est SOLDÉ à son tour. `StorageContract` passe par le
    // namespace (son identité était le contrat) ; `resolveProfileLayers` et
    // `estimateVectorZone` passent par la carte `exports` publiée du core — ce sont des
    // fonctions PURES et sans import, donc en embarquer une copie est sans conséquence,
    // contrairement à un singleton.
    //
    // ⚠️ Tableau vidé, clé GARDÉE — même raison qu'au-dessus. `BASELINE = {}` ferait sortir
    // la gate verte en n'ayant lu aucun fichier.
    "offline-ui": [],
};

/** Any specifier addressing core sources, whichever alias scheme the plugin uses. */
const CORE_SPECIFIER_RE = /["'](@core(?:-offline)?\/[^"']+)["']/g;

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

// ARCHI S9.5 (complété au S10.2) — les chemins viennent du registre de workspaces.
//
// Cette gate n'énumère pas les packages : elle scanne exactement les 2 clés de
// BASELINE. Elle n'était donc pas dans la liste des 8 énumérations converties au
// 9.5 — mais elle portait la MÊME défaillance par un autre mécanisme :
// `path.join(ROOT, "packages", plugin, "src")` est sensible à la profondeur.
// Après le regroupement du S10, ce chemin n'aurait plus existé, `collectSources`
// aurait renvoyé une liste vide, et la gate aurait annoncé « 0 violation » en
// n'ayant rien lu — verte et aveugle sur la seule frontière qu'elle surveille.
//
// `requireByDirName` JETTE si le package est introuvable : un déplacement casse
// bruyamment au lieu de vider le périmètre en silence. Trouvé par la sonde
// `scripts/probe-gate-visibility.cjs`, pas par relecture.
const registry = require("./lib/packages.cjs");

for (const [plugin, allowed] of Object.entries(BASELINE)) {
    const srcDir = path.join(registry.requireByDirName(plugin).absDir, "src");
    seen[plugin] = new Set();
    const violations = [];

    for (const file of collectSources(srcDir, [])) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
            if (isComment(line)) return;
            for (const m of line.matchAll(CORE_SPECIFIER_RE)) {
                const spec = m[1];
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

if (!failed) console.log("✅ [PCB-01] Aucun deep import plugin → core hors baseline.");

// PCB-02 — la baseline doit rétrécir. Une entrée devenue inutile est signalée pour
// être retirée : la laisser autoriserait silencieusement une régression future.
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
