#!/usr/bin/env node
/**
 * verify-test-load-mode.cjs — le garde-fou de la roadmap COUVERTURE (S1.1 / S1.2).
 *
 * ## Le défaut qu'il gèle
 *
 * Un module source chargé par `require()` depuis un test voit sa couverture attribuée
 * **aux mauvaises lignes et aux mauvaises fonctions**. Ce n'est pas de l'imprécision :
 * deux sondes ne différant QUE par le mode de chargement, chacune n'appelant que
 * `formatFileSize` dans un module à 4 fonctions, donnent en `import` `FNDA:1` sur la
 * bonne et `FNDA:0` sur les trois autres — et en `require()` exactement l'inverse, faux
 * sur les quatre. Les lignes bougent aussi, et les totaux ne sont pas préservés.
 *
 * Rien n'échoue : la suite est verte, le rapport est bien formé, les pourcentages sont
 * plausibles. C'est ce qui a permis au défaut de vivre un mois sans être vu.
 *
 * ## Pourquoi un gate AVANT de convertir
 *
 * La conversion porte sur **184 fichiers et 357 sites** (mesure de ce gate, 22/07/2026) :
 * plusieurs sessions. Tant que rien n'interdit le 185ᵉ, la dette se recreuse pendant qu'on
 * la comble — et ce n'est pas une hypothèse : entre la rédaction de la roadmap et la fin
 * du sprint 0, `sync-queue-order.test.js` est arrivé avec 2 sites (commit `b4654fa9`, le
 * jour même). **Rien ne l'a signalé.**
 *
 * La baseline ne fait donc que **descendre** : le gate ne bloque que sur un site ABSENT
 * d'elle. Même cliquet que `verify-purgecss` et `check-orphan-exports`.
 *
 * ## Ce qui est compté, et ce qui ne l'est PAS
 *
 * Seuls les `require()` d'un **module source réel** comptent — le specifier doit résoudre
 * vers un `.ts` existant. Un `require()` de fixture, de mock ou de paquet npm ne charge
 * pas de source mesurée, il est ignoré.
 *
 * **Les deux formes de specifier comptent** — relatif (`../x.js`) ET nu (`@core/…`,
 * `@core-offline/…`), ce dernier résolu par les `paths` du tsconfig du paquet.
 *
 * ⚠️ **La forme nue était invisible à ce gate jusqu'au S5** (22/07/2026). Mesuré alors :
 * 22 sites dans `plugin-addpoi` et `plugin-storage`, dont **8 chargeaient de la vraie
 * source du core** — et un fichier de test entier, `cache-workflow-cross.integration.test.js`,
 * n'employait QUE des specifiers nus, donc n'apparaissait dans aucun inventaire. La
 * baseline sous-comptait sans que rien ne le dise.
 *
 * ⚠️ **C'est ce qui explique l'écart avec les chiffres de la roadmap** (186 fichiers /
 * 373 sites, et 188/377 au relevé de fin de S0). Ce gate en trouve moins, et c'est
 * volontaire : le prototype qui a produit ces chiffres comptait TOUS les `require()`
 * relatifs, y compris ceux qui ne chargent aucune source mesurée —
 * `__mocks__/maplibre-gl.cjs`, `helpers/dom-create-double.js`,
 * `scripts/check-bundle-size.cjs`. Les convertir ne changerait rien à l'attribution de
 * couverture. Leur compte est affiché à part, pour que l'écart reste lisible.
 *
 * Le périmètre vient du registre (`lib/packages.cjs`), donc `packages/_plugin-template/`
 * en est exclu : il est hors `workspaces` (`!packages/_*`).
 *
 * ⚠️ **`vi.mock(...)` est neutralisé avant analyse.** Déclarer un mock ne charge pas le
 * module réel. C'est l'oubli de ce détail qui a fait annoncer « 139 modules » à l'entrée
 * B.46 là où il y en a 79 : le compte incluait les cibles de `vi.mock()`.
 *
 * ## Limite assumée — et elle n'est plus hypothétique
 *
 * La détection est **syntaxique**, donc aveugle à un `require()` dont le specifier est
 * construit à l'exécution.
 *
 * ⚠️ Cette limite portait « aucun site de cette forme n'a été observé ». **C'était faux** :
 * `geojson/geojson-core.test.js` boucle sur **9 modules source du core** par
 * `` require(`../../src/kernel/${subModule}`) ``. Neuf sites de fausse attribution que ni
 * la baseline ni le triage ne nommaient. Ils ne sont toujours pas résolus — il faudrait
 * évaluer la boucle — mais ils sont désormais **comptés et affichés**, ce qui est la seule
 * chose qui les empêche de redevenir invisibles. Leur conversion relève des sprints 3 et 4.
 *
 * `createRequire()` et `module.require()` : vérifiés repo-wide au S5 (solde du backlog
 * B.3). Un seul site, `guards/prototype-pollution-sinks.guard.test.js`, et il charge un
 * `.cjs` — un module réellement CommonJS, donc aucune attribution faussée.
 *
 * Usage :
 *   node scripts/verify-test-load-mode.cjs                    # gate
 *   node scripts/verify-test-load-mode.cjs --update-baseline  # refiger après conversion
 *   node scripts/verify-test-load-mode.cjs --report           # tableau de bord, sans gate
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

/** @param {string} abs @returns {string} Chemin repo-relatif, séparateurs POSIX. */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/** Clé stable d'un site : fichier de test + specifier. */
const siteKey = (testFile, spec) => `${rel(testFile)}::${spec}`;

/**
 * Analyse l'ensemble des tests du monorepo.
 *
 * @returns {{sites: {key: string, testFile: string, spec: string}[],
 *   modules: {reqOnly: number, both: number, impOnly: number},
 *   files: {mech: number, mock: number, reset: number, total: number},
 *   packagesScanned: number, testFilesScanned: number, nonSourceRequires: number}}
 */
function analyse() {
    // Dérivé du registre, jamais d'un glob écrit à la main : un chemin en dur ne casse pas
    // au déplacement d'un paquet, il cesse silencieusement de matcher et la gate sort verte
    // en n'ayant rien scanné (cf. `probe-gate-visibility.cjs`).
    const packages = registry.all();

    /** module source → { req: Set, imp: Set } */
    const loads = new Map();
    const touch = (mod) => {
        if (!loads.has(mod)) loads.set(mod, { req: new Set(), imp: new Set() });
        return loads.get(mod);
    };

    const sites = [];
    /** fichier de test → { sites, viMock, resetModules } */
    const perTest = new Map();
    let testFilesScanned = 0;
    let nonSourceRequires = 0;
    /** Sites `require(`…${x}`)` — visibles, non résolus. */
    const dynamicRequires = [];

    for (const p of packages) {
        // Les sites (specifiers RELATIFS **et NUS**), leur résolution et le classement en
        // familles viennent de `lib/test-load-sites.cjs`, partagé avec
        // `audit-test-load-conversion.cjs`. Chacun en portait sa copie jusqu'au S5, et
        // elles avaient déjà divergé : au S2 il a fallu corriger le classifieur DANS LES
        // DEUX (`vi.isolateModules` comptait comme mécanique alors qu'il recharge).
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
                    // Specifier construit à l'exécution : irrésolvable sans évaluer la
                    // boucle. Compté À PART plutôt qu'ignoré — c'est la seule façon qu'il
                    // ne redevienne pas invisible. Conversion : sprints 3 et 4.
                    dynamicRequires.push(`${relTf}:${s.line}`);
                    continue;
                }
                if (!s.mod) {
                    // Ne charge aucune source mesurée (mock, helper, script). Hors périmètre
                    // couverture — compté à part pour que l'écart reste explicable.
                    nonSourceRequires += 1;
                    continue;
                }
                touch(path.join(ROOT, s.mod)).req.add(tf);
                resolvedReq += 1;
                sites.push({ key: siteKey(tf, s.spec), testFile: relTf, spec: s.spec });
            }

            // Versant `import` du graphe : relatifs ET nus, mêmes règles de résolution.
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
                    // ⚠️ `isolateModules` compte avec `resetModules` (COUVERTURE S2, lot 4).
                    // Il en fait le même travail — recharger un module dans un registre
                    // neuf — et relève donc du sprint 4, pas des conversions mécaniques.
                    // Sans lui, `api/api-extended.test.js` sortait « mécanique » alors que
                    // ses 3 sites vivent dans des `vi.isolateModules(() => require(…))` :
                    // un classement trop optimiste, du côté qui coûte cher.
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
        // ⚠️ Ne JAMAIS taire ce compte. Ces sites chargent bel et bien des sources
        // mesurées — `geojson-core.test.js` en boucle 9 — mais leur specifier n'existe
        // qu'à l'exécution, donc ni la baseline ni le triage ne peuvent les nommer. Les
        // afficher est le seul moyen qu'ils ne repassent pas sous le radar.
        console.log(
            `  ⚠ specifier CONSTRUIT : ${a.dynamicRequires.length} site(s) irrésolvable(s) ` +
                "statiquement — chargent des sources, sprints 3/4 :"
        );
        for (const d of a.dynamicRequires) console.log(`      ${d}`);
    }
}

// ── Exécution ────────────────────────────────────────────────────────────────
const a = analyse();

// Un périmètre vide est un échec, pas un succès : c'est la signature d'une gate qui ne
// voit plus rien. `packages.cjs` jette déjà sur un registre incohérent ; ceci couvre le
// cas où le registre est bon mais le parcours ne trouve aucun test.
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
// Un site en baseline qui n'apparaît plus a été converti — bonne nouvelle, mais la
// baseline doit rétrécir pour que le cliquet reste serré.
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
        "  fonctions. Les charger par `import` — voir _docs_projet/archives/roadmap_couverture-tests.md.\n" +
        "  ⚠️ Ne PAS régénérer la baseline pour faire taire un site neuf : elle ne descend que\n" +
        "     sur des conversions réelles."
);
process.exit(1);
