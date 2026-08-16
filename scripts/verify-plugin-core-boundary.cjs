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
// ✅ **VIDE — et c'est l'état CIBLE, pas un accident.** Les deux dernières entrées (`addpoi`
// puis `offline-ui`) ont été soldées à l'API publique S4.4 : les singletons passent par le
// namespace, les fonctions pures par la carte `exports` publiée.
//
// 🛑 **LA CLÉ VIDE QUI SUBSISTAIT N'EST PLUS NÉCESSAIRE, et son commentaire disait pourquoi.**
// Il expliquait qu'on gardait `"offline-ui": []` parce que « retirer la clé ferait itérer la
// boucle `Object.entries(BASELINE)` zéro fois pour ce paquet : la gate imprimerait deux ✅ sans
// avoir lu un seul fichier ». **C'était exact, et c'était une parade posée à la main sur les
// deux paquets auxquels on avait pensé.** Les dix autres n'y ont jamais eu droit — d'où B-153 ②.
//
// Depuis que la boucle dérive son périmètre de `registry.plugins()`, un plugin absent d'ici est
// scanné **avec zéro tolérance**, ce qui est la bonne valeur par défaut pour une frontière
// d'architecture. La parade n'a plus d'objet : c'est la structure qui la porte, plus une entrée.
//
// ⚠️ Ce qui reste vrai : **y ajouter une entrée est une décision délibérée**, et chacune est une
// DETTE avec un propriétaire, jamais une permission permanente. PCB-02 la fait rétrécir.
const BASELINE = {};

/**
 * Any specifier that ADDRESSES the core — quel que soit le schéma employé.
 *
 * 🛑 **B-153 ② — CE MOTIF NE RECONNAISSAIT QU'UN SCHÉMA MORT, et c'est la moitié du défaut que
 * la ligne ne portait pas.** Il s'écrivait `/["'](@core(?:-offline)?\/[^"']+)["']/g`, donc il ne
 * voyait que les alias `@core/` et `@core-offline/`. Mesuré le 16/08/2026 : **aucun plugin ne
 * déclare plus ces alias** — ni dans son `tsconfig.json`, ni dans son `rollup.config.mjs`.
 *
 * ⚠️ **Conséquence : même en scannant les 12 paquets, la gate ne pouvait attraper AUCUN import
 * profond écrit aujourd'hui.** Un développeur qui écrirait `@geoleaf/core/src/kernel/…` ou
 * `../../../core/src/…` passait sans un mot. Le vert n'était pas la propriété du code, c'était
 * la forme de la question.
 *
 * ✅ Trois familles reconnues désormais, chacune correspondant à une façon réelle d'atteindre
 * les sources : l'alias historique, le sous-chemin du paquet publié, et le chemin relatif qui
 * remonte jusqu'à `core/src`.
 */
const CORE_SPECIFIER_RE =
    /["'](@core(?:-offline)?\/[^"']+|@geoleaf\/core\/[^"']+|(?:\.\.\/)+(?:packages\/)?core\/src\/[^"']+)["']/g;

/**
 * Les sous-chemins que le core PUBLIE — dérivés de sa carte `exports`, jamais recopiés.
 *
 * 🛑 **C'est ce qui sépare un import LÉGITIME d'un import PROFOND, et la distinction n'est pas
 * cosmétique.** `@geoleaf/core/kernel/config/layer-geometry.js` est déclaré dans `exports` : un
 * intégrateur tiers l'écrit de la même façon, le bundler résout vers le point publié, et rien
 * n'est ré-embarqué en douce. `@geoleaf/core/src/kernel/…` ne l'est pas : il court-circuite la
 * carte et fait recopier une source dans le bundle du plugin — le défaut exact que cette gate
 * existe pour empêcher.
 *
 * ⚠️ **Dérivé et non listé.** Une liste en dur ici se périmerait au premier sous-chemin publié,
 * et se périmerait EN SILENCE : la gate rougirait sur un import parfaitement légitime, on
 * l'ajouterait à la baseline, et la dette grossirait d'une entrée qui n'en est pas une.
 */
const CORE_EXPORT_PATTERNS = Object.keys(
    require(path.join(ROOT, "packages/core/package.json")).exports || {}
)
    .filter((k) => k.startsWith("./"))
    .map((k) => k.slice(2));

/**
 * Un sous-chemin `@geoleaf/core/<sub>` passe-t-il par la carte `exports` ?
 *
 * Gère le joker `*` des clés du type `./capabilities/*.js`, avec la sémantique de Node : `*`
 * remplace un segment de chemin quelconque, y compris vide.
 */
function isPublishedSubpath(sub) {
    return CORE_EXPORT_PATTERNS.some((pat) => {
        if (!pat.includes("*")) return pat === sub;
        const [head, tail] = pat.split("*");
        return sub.startsWith(head) && sub.endsWith(tail) && sub.length >= head.length + tail.length;
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

// ── B-153 ② — LA GATE ITÈRE SUR LE REGISTRE, PLUS SUR SA BASELINE ────────────────────────
//
// 🛑 CE QU'ELLE FAISAIT, ET POURQUOI C'EST LA PIRE FORME DU DÉFAUT. La boucle s'écrivait
// `for (const [plugin, allowed] of Object.entries(BASELINE))`. `BASELINE` ne contient qu'UNE
// clé : la gate qui garde la frontière d'architecture du projet **ouvrait 1 plugin sur 12**,
// et son message de succès affirmait la conformité sans dire sur quoi il portait. Onze plugins
// n'ont jamais été lus — pas une seule fois depuis que cette gate existe.
//
// ⚠️ **Le mécanisme était COMPRIS et documenté, à trente lignes d'ici.** Les commentaires de
// `BASELINE` expliquent que la clé d'un plugin soldé est gardée VIDE parce que « retirer la clé
// ferait itérer la boucle zéro fois pour ce paquet : la gate imprimerait deux ✅ sans avoir lu
// un seul fichier ». La parade était juste — elle était appliquée **au cas par cas**, aux deux
// paquets qu'on avait pensé à sortir de la baseline. Les dix autres n'y ont jamais eu droit.
// Une parade qui doit être posée à la main sur chaque membre n'est pas une parade : c'est une
// liste, et une liste oublie.
//
// ✅ **Le périmètre se DÉRIVE désormais** : `registry.plugins()` rend les paquets
// `@geoleaf-plugins/*` du registre de workspaces. `BASELINE` ne décide plus de QUI est scanné,
// seulement de CE QUI est toléré chez lui — un plugin absent de la baseline est scanné avec
// zéro tolérance, ce qui est la bonne valeur par défaut pour une frontière d'architecture.
const pluginPkgs = registry.plugins();

// Anti-gate-vide, plancher n° 1 : un registre vide rendrait « 0 violation » sans rien lire.
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

                // Un sous-chemin PUBLIÉ n'est pas un deep import : il passe par la carte
                // `exports`, comme chez un intégrateur tiers. Écarté avant même d'être vu —
                // l'inscrire dans `seen` le ferait apparaître comme une dette à purger.
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

// Anti-gate-vide, plancher n° 2 : douze paquets qui rendent zéro fichier, c'est un
// `collectSources` cassé ou une arborescence déplacée — pas un dépôt sans sources.
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
