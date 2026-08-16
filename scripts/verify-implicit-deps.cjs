#!/usr/bin/env node
/**
 * IMPL: les dépendances que le dépôt CHARGE sans les IMPORTER sont déclarées, et c'est
 * bien la copie déclarée qui s'exécute.
 *
 * ## Pourquoi cette gate existe — la classe d'angle mort qu'aucune autre ne voit
 *
 * Toutes les gardes de dépendances du dépôt partent d'un import :
 *
 *   - `check-shipped-specifiers.cjs` (SHIP-SPEC-01) lit les specifiers nus des fichiers
 *     ATTEIGNABLES du paquet publié — donc du code, donc des `import`/`require` ;
 *   - `knip` (catégorie `unlisted`) lit le graphe de modules des sources.
 *
 * Il reste une classe qu'aucune des deux ne peut voir : un paquet que le dépôt charge
 * **sans jamais l'importer**. Deux cas mesurés le 15/08/2026 (backlog **B-258**) :
 *
 *   - `happy-dom` — nommé par une CHAÎNE de caractères (`environment: "happy-dom"` dans
 *     14 `vitest.config.ts`). C'est Vitest qui l'importe, depuis son propre `dist/` ;
 *   - `tsx` — injecté dans `NODE_OPTIONS` par `ensure-tsx-node-options.mjs`. Une option
 *     de ligne de commande, pas une arête du graphe de modules.
 *
 * Aucun des deux n'était déclaré par qui le charge. Les deux étaient présents à la racine
 * comme **peerDependencies optionnelles auto-installées** (`vitest → happy-dom: "*"`,
 * `vite → tsx`) — une propriété que personne n'a demandée. `npm ci` sous le npm de Node 22
 * (10.9.x) la reconduisait ; un recalcul sous npm ≥ 11 la retirait, et toute la suite de
 * tests mourait sur « Cannot find package 'tsx' ». Or **seul `publish.yml` monte à npm ≥ 11**
 * (exigence du trusted publishing) : `ci.yml` comme `ci:local` sont structurellement aveugles
 * à ce défaut.
 *
 * ## Le second défaut, plus discret : DÉCLARÉ ≠ EXÉCUTÉ
 *
 * 14 paquets déclaraient `happy-dom: "^20.11.2"` et recevaient chacun une copie nichée en
 * 20.11.2. **Aucune n'était jamais chargée.** `environment: "happy-dom"` est un environnement
 * *builtin* de Vitest, qui fait `await import('happy-dom')` depuis `vitest/dist/` — la
 * résolution part donc de là et atteint toujours la RACINE, qui portait la 20.9.0. Quatorze
 * déclarations décoratives, et deux mineures d'écart entre la version annoncée et la version
 * qui tourne.
 *
 * Cet écart n'est pas cosmétique : happy-dom ≥ 20.11 pose `window.OffscreenCanvas`, ce que la
 * 20.9 ne fait pas. Deux `typeof OffscreenCanvas !== "undefined"` en production basculaient
 * donc sur une surface dont `getContext("2d")` rend `null`. Le jour où quoi que ce soit
 * alignait la racine, 8 tests de `cog` et le rendu de hachures du core tombaient — sans qu'une
 * seule ligne de code ait changé.
 *
 * ## Ce que cette gate NE fait PAS, et pourquoi
 *
 * 🛑 **Elle ne s'adosse pas au marqueur `peer + optional` du lockfile.** C'était le dessin
 * initial (« verify-peer-hoist »), et la mesure l'a écarté : ce marqueur **n'est pas stable
 * d'une version de npm à l'autre**. Mesuré le 15/08/2026 sur le même dépôt —
 *
 *     npm 10.9.8   happy-dom   peer=true  optional=true
 *     npm 12.0.2   happy-dom   peer=false optional=false
 *     npm 10.9.8   @esbuild/linux-x64   peer=true  optional=true
 *     npm 12.0.2   @esbuild/linux-x64   peer=false optional=true
 *
 * — sous npm 12 l'ensemble « racine, peer ET optional » est **vide**. Une gate bâtie dessus
 * aurait donc scanné zéro entrée en sortant verte : exactement le mode d'échec que ce dépôt
 * poursuit. Le marqueur reste balayé par IMPL-03, mais en filet AVANT, jamais comme plancher.
 *
 * Le fondement est ailleurs : une table EXPLICITE des paquets que l'outillage charge sans les
 * importer, chacun portant son motif et sa position de chargement. Une table se périme, mais
 * elle se périme **bruyamment** (IMPL-04), là où un marqueur qui change de sémantique se
 * périme en silence.
 *
 *   IMPL-01  chaque entrée de la table est déclarée par au moins un manifeste du dépôt
 *   IMPL-02  la copie résolue depuis la POSITION DE CHARGEMENT est la même que celle résolue
 *            depuis chaque manifeste qui la déclare — c'est « déclaré = exécuté »
 *   IMPL-03  balayage du lock : une entrée racine `peer+optional` sans `os`/`cpu` que nul
 *            manifeste ne déclare est signalée. Peut légitimement ne rien voir (cf. ci-dessus),
 *            donc son décompte s'imprime et ne sert JAMAIS de plancher
 *   IMPL-04  refus de conclure (exit 2) : table vide, lock illisible, ou position de
 *            chargement introuvable — une entrée dont la sonde ne résout plus décrit un
 *            montage qui n'existe plus
 *
 * ## Crochets d'environnement (pour `probe-gate-visibility.cjs`)
 *
 *   GEOLEAF_LOCKFILE        — viser un autre lockfile (IMPL-03)
 *   GEOLEAF_IMPLICIT_EXTRA  — ajouter un nom à la table (IMPL-01/02), pour éprouver la règle
 *                             sur un paquet que rien ne déclare
 *
 * Exit 0 = conforme · 1 = violation · 2 = la gate refuse de conclure.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const registry = require("./lib/packages.cjs");

const ROOT = registry.ROOT;

// ─── La table — un paquet chargé sans être importé, et pourquoi ───────────────
//
// ⚠️ Chaque entrée porte son MOTIF et sa POSITION DE CHARGEMENT. Le motif dit pourquoi
// aucune analyse statique ne peut voir ce paquet ; la position dit d'où part la résolution
// réelle, qui n'est presque jamais le paquet qui déclare. Une entrée sans les deux serait
// indiscernable d'une dépendance ordinaire — que knip et SHIP-SPEC couvrent déjà.

const IMPLICIT_TOOLCHAIN = [
    {
        name: "happy-dom",
        why:
            'Nommé par une CHAÎNE (`environment: "happy-dom"`), jamais importé. C\'est un ' +
            "environnement builtin de Vitest : il fait `await import('happy-dom')` depuis son " +
            "propre dist/, donc la copie qui s'exécute est celle résolvable depuis vitest — " +
            "jamais celle qu'un paquet déclare à côté de son vitest.config.ts.",
        loadFrom: () => path.join(path.dirname(require.resolve("vitest/package.json")), "dist"),
    },
    {
        name: "tsx",
        why:
            "Injecté dans NODE_OPTIONS par `packages/build-config/vitest/ensure-tsx-node-options.mjs`, " +
            "qui l'impose à TOUTES les suites. Une option de ligne de commande n'est pas une arête " +
            "du graphe de modules : ni knip ni SHIP-SPEC ne peuvent la voir.",
        loadFrom: () => registry.requireByDirName("build-config").absDir,
    },
];

// ─── Utilitaires ──────────────────────────────────────────────────────────────

/**
 * Répertoire racine d'un paquet, par la remontée `node_modules` de Node.
 *
 * Délibérément fait à la main plutôt que par `require.resolve(name + "/package.json")` :
 * tout paquet n'expose pas `./package.json` dans sa carte `exports`, et un échec de
 * résolution serait alors indiscernable d'une absence réelle.
 *
 * @param {string} name - nom du paquet.
 * @param {string} fromDir - répertoire d'où part la résolution.
 * @returns {string | null} chemin réel du répertoire du paquet, ou `null`.
 */
function resolvePkgDir(name, fromDir) {
    let dir = path.resolve(fromDir);
    for (;;) {
        const candidate = path.join(dir, "node_modules", name, "package.json");
        if (fs.existsSync(candidate)) return fs.realpathSync(path.dirname(candidate));
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** @param {string} pkgDir @returns {string} */
function versionOf(pkgDir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
    } catch {
        return "?";
    }
}

/**
 * Chemin lisible : relatif au dépôt s'il y est, ABSOLU sinon.
 *
 * Le `GEOLEAF_LOCKFILE` des sondes vit dans `/tmp` ; un `path.relative` y rendrait
 * « ../../../../../tmp/… », que personne ne relit. Un message de gate qu'on ne peut pas
 * lire ne vaut pas mieux qu'un silence.
 *
 * @param {string} p
 * @returns {string}
 */
function rel(p) {
    const r = path.relative(ROOT, p);
    if (r.startsWith("..") || path.isAbsolute(r)) return p;
    return r.split(path.sep).join("/") || ".";
}

/**
 * Tous les manifestes du dépôt : la racine plus chaque workspace.
 *
 * ⚠️ Dérivé de `lib/packages.cjs`, JAMAIS d'un glob `packages/**` — qui capterait `dist/`
 * et `node_modules/`, et ferait croire à des déclarations qui ne sont pas les nôtres.
 *
 * @returns {{name: string, dir: string, file: string, deps: Record<string, string>}[]}
 */
function allManifests() {
    const out = [];
    const rootJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    out.push({
        name: rootJson.name || "<racine>",
        dir: ROOT,
        file: "package.json",
        deps: {
            ...rootJson.dependencies,
            ...rootJson.devDependencies,
            ...rootJson.peerDependencies,
            ...rootJson.optionalDependencies,
        },
    });
    for (const pkg of registry.all()) {
        const m = pkg.manifest;
        out.push({
            name: pkg.name,
            dir: pkg.absDir,
            file: `${rel(pkg.absDir)}/package.json`,
            deps: {
                ...m.dependencies,
                ...m.devDependencies,
                ...m.peerDependencies,
                ...m.optionalDependencies,
            },
        });
    }
    return out;
}

// ─── Exécution ────────────────────────────────────────────────────────────────

const problems = [];
const refuse = (code, msg) => {
    console.error(`ERROR [${code}]: ${msg}`);
    process.exit(2);
};

const table = [...IMPLICIT_TOOLCHAIN];
const extra = process.env.GEOLEAF_IMPLICIT_EXTRA;
if (extra) {
    for (const name of extra
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        table.push({
            name,
            why: "Entrée injectée par GEOLEAF_IMPLICIT_EXTRA (sonde).",
            loadFrom: () => ROOT,
        });
    }
}

// IMPL-04 — plancher anti-gate-vide. Sans lui, une table vidée par mégarde sortirait verte
// en n'ayant rien vérifié, ce qui est exactement le défaut que la gate poursuit.
if (table.length === 0) {
    refuse(
        "IMPL-04",
        "la table IMPLICIT_TOOLCHAIN est vide — rien à vérifier, donc rien à conclure."
    );
}

const manifests = allManifests();
if (manifests.length < 2) {
    refuse(
        "IMPL-04",
        `${manifests.length} manifeste(s) lu(s) — le registre des workspaces n'a rien rendu, la gate refuse de conclure.`
    );
}

// ─── IMPL-01 / IMPL-02 ────────────────────────────────────────────────────────

for (const entry of table) {
    let loadDir;
    try {
        loadDir = entry.loadFrom();
    } catch (err) {
        refuse(
            "IMPL-04",
            `position de chargement de « ${entry.name} » introuvable (${err.message}) — l'entrée décrit un montage qui n'existe plus.`
        );
    }

    const declarers = manifests.filter((m) => entry.name in m.deps);

    if (declarers.length === 0) {
        problems.push({
            code: "IMPL-01",
            lines: [
                `« ${entry.name} » est chargé par l'outillage mais AUCUN manifeste du dépôt ne le déclare.`,
                `  motif : ${entry.why}`,
                `  il n'est résolvable que par ce que npm a bien voulu poser à la racine — une propriété que personne n'a demandée.`,
            ],
        });
        continue;
    }

    const loaded = resolvePkgDir(entry.name, loadDir);
    if (!loaded) {
        problems.push({
            code: "IMPL-01",
            lines: [
                `« ${entry.name} » est déclaré par ${declarers.map((d) => d.name).join(", ")} mais INTROUVABLE depuis sa position de chargement.`,
                `  position : ${rel(loadDir)}`,
            ],
        });
        continue;
    }

    // IMPL-02 — « déclaré = exécuté ». Comparaison de CHEMINS RÉELS, pas de plages semver :
    // deux copies d'une même version satisfont la même plage tout en étant deux fichiers
    // différents, et c'est précisément ce cas (14 copies nichées, une seule chargée) qui a
    // laissé passer un écart de deux mineures pendant toute la vie de la déclaration.
    for (const d of declarers) {
        const seen = resolvePkgDir(entry.name, d.dir);
        if (seen && seen !== loaded) {
            problems.push({
                code: "IMPL-02",
                lines: [
                    `« ${entry.name} » : ${d.name} déclare ${d.deps[entry.name]} mais ce n'est PAS la copie qui s'exécute.`,
                    `  déclarée  → ${rel(seen)} (v${versionOf(seen)})`,
                    `  exécutée  → ${rel(loaded)} (v${versionOf(loaded)}), résolue depuis ${rel(loadDir)}`,
                    `  motif : ${entry.why}`,
                ],
            });
        }
    }
}

// ─── IMPL-03 — balayage du lockfile ───────────────────────────────────────────

const lockPath = process.env.GEOLEAF_LOCKFILE || path.join(ROOT, "package-lock.json");
let lock;
try {
    lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
} catch (err) {
    refuse("IMPL-04", `lockfile illisible (${rel(lockPath)}) : ${err.message}`);
}
if (!lock.packages || typeof lock.packages !== "object") {
    refuse("IMPL-04", `lockfile sans carte « packages » (${rel(lockPath)}) — format inattendu.`);
}

const declaredAnywhere = new Set(manifests.flatMap((m) => Object.keys(m.deps)));
let sweptCount = 0;

for (const [key, meta] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/")) continue;
    const name = key.slice("node_modules/".length);
    if (name.includes("/node_modules/")) continue; // niché, pas racine
    if (!meta.peer || !meta.optional) continue;
    if (meta.os || meta.cpu) continue; // binaire de plateforme : optionnel par conception
    sweptCount++;
    if (!declaredAnywhere.has(name)) {
        problems.push({
            code: "IMPL-03",
            lines: [
                `« ${name} » (v${meta.version}) est à la racine du lock en peerDependency OPTIONNELLE, et aucun manifeste du dépôt ne le déclare.`,
                `  il disparaîtra au premier recalcul par un npm qui ne reconduit pas ce choix.`,
            ],
        });
    }
}

// ─── Rapport ──────────────────────────────────────────────────────────────────

if (problems.length > 0) {
    for (const p of problems) {
        console.error(`ERROR [${p.code}]: ${p.lines[0]}`);
        for (const l of p.lines.slice(1)) console.error(l);
        console.error("");
    }
    console.error(`✗ IMPL : ${problems.length} violation(s).`);
    process.exit(1);
}

console.log(`✅ [IMPL-01] ${table.length} paquet(s) chargé(s) sans import : tous déclarés.`);
console.log(`✅ [IMPL-02] déclaré = exécuté sur les ${table.length} entrée(s).`);
console.log(
    `✅ [IMPL-03] ${sweptCount} entrée(s) racine peer+optional hors binaires de plateforme, aucune orpheline.`
);
if (sweptCount === 0) {
    // Pas un échec : npm ≥ 12 ne pose plus ce marqueur (cf. docblock). Le dire à voix haute
    // évite qu'un lecteur prenne ce vert-là pour une preuve qu'il n'est pas.
    console.log(
        `   ↳ ⚠️ 0 entrée balayée — ce npm ne pose pas le marqueur peer+optional. IMPL-03 n'a rien prouvé ici ; ce sont IMPL-01/02 qui portent la garde.`
    );
}
console.log(
    `   périmètre : ${manifests.length} manifestes (racine + ${manifests.length - 1} workspaces), lock ${rel(lockPath)}.`
);
process.exit(0);
