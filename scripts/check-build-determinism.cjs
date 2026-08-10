#!/usr/bin/env node
/**
 * BUILD-DET: two identical builds must produce identical artefacts.
 *
 * ## Ce que ce gate surveille
 *
 * Le build de `@geoleaf/core` produisait 7 chunks dont le NOM changeait à chaque
 * build, pour un contenu byte-à-byte identique (`.js` et `.js.map`). Cause :
 * `rollup-plugin-postcss@4.0.2` sérialise une **Map** dans son `augmentChunkHash`,
 * donc dans l'ordre de transformation des modules CSS — qui n'est pas stable.
 * Rollup ajoute cette valeur au hash de CHAQUE chunk.
 *
 * Le correctif vit dans `packages/build-config/rollup.mjs` (`withStableChunkHash`).
 * Ce gate existe parce qu'un correctif de non-déterminisme ne se voit pas : rien ne
 * casse quand il disparaît, le build reste vert, et on ne le remarque qu'en
 * observant des caches qui n'accrochent plus.
 *
 * ## Ce que le non-déterminisme coûte, et pourquoi ça vaut un gate
 *
 *  - cache Turborepo invalidé à chaque build (rien n'est jamais réutilisable) ;
 *  - `deploy/` qui diffère à chaque génération sans un seul changement de code —
 *    donc un diff de déploiement illisible ;
 *  - cache navigateur cassé sur des chunks identiques, soit l'inverse exact de ce
 *    à quoi sert un hash de contenu ;
 *  - toute vérification « dist byte-à-byte identique » devient impossible, et c'est
 *    précisément l'outil qui a prouvé la neutralité des refactos ARCHI S9.
 *
 * ## Usage
 *
 *   node scripts/check-build-determinism.cjs            # 2 builds, compare tout
 *   node scripts/check-build-determinism.cjs --package @geoleaf-plugins/table
 *   node scripts/check-build-determinism.cjs --deploy    # 2 `build:deploy`, compare `deploy/`
 *   node scripts/check-build-determinism.cjs --deploy --reuse-built   # 1 seul build (câblé en CI)
 *
 * ## Le mode `--deploy` (S5.8)
 *
 * 🛑 **Le mode par défaut ne voit JAMAIS `deploy/`** — il bâtit `@geoleaf/core` par
 * `npx rollup -c` et compare `packages/core/dist/`. Or le non-déterminisme le plus coûteux ne
 * vivait pas là : `build-deploy.cjs` posait un `?v=<Date.now()>` sur l'entrée et les plugins,
 * et un `CACHE_VERSION` horodaté sur le service worker. Deux déploiements de la même source
 * produisaient donc des URL différentes pour des octets identiques — ~101 Ko gz re-téléchargés
 * à chaque mise en ligne, et un pré-cache intégralement reconstitué à chaque `activate`.
 *
 * ⚠️ **La gate annoncée à la roadmap ne regardait que les `?v=`, et elle serait sortie VERTE
 * sur un déploiement toujours cassé** : le `CACHE_VERSION` aurait continué de changer, donc
 * `activate` de purger, donc l'install de tout refetcher — le gain du `?v=` haché annulé, sans
 * qu'aucune assertion ne bouge. Ce mode compare **tout le déployé**, `sw-core.js` compris.
 *
 * Coûteux par construction (deux builds complets), donc PAS câblé en pre-commit — ni, pour la
 * même raison, dans le chemin par défaut de `ci:local` : `--deploy` enchaîne deux
 * `build:deploy` entiers, ce qui ajouterait plusieurs minutes à chaque run.
 *
 * ⚠️ **Une gate que personne ne lance ne garde rien.** Les deux moments où celle-ci doit être
 * exécutée, et où son absence coûterait le plus :
 *   - avant une release / une mise en ligne — c'est là que le non-déterminisme se paie, en
 *     re-téléchargements inutiles chez tous les visiteurs ;
 *   - après toute modification de `rollup.config.mjs`, de `build-deploy.cjs` ou de
 *     `lib/bundle-profiles.cjs` — les trois endroits d'où sont venues les trois sources de
 *     non-déterminisme trouvées à ce jour.
 * Elle est portée par la revue finale de la roadmap socle-init (S11).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const registry = require("./lib/packages.cjs");

const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", c: "\x1b[36m", x: "\x1b[0m" };

const DEPLOY_MODE = process.argv.includes("--deploy");

/**
 * Prend le `deploy/` PRÉSENT comme premier build, au lieu d'en faire un.
 *
 * 🛑 **C'est ce qui rend la gate câblable.** En deux builds elle coûte ~100 s ; `ci:local`
 * bâtit DÉJÀ `deploy/` à l'étape « Build deploy variants », juste avant. Repartir de ce
 * résultat ramène le coût à **un seul build (~50 s)** — la différence entre une gate qu'on
 * câble et une gate qu'on réserve à un drapeau, c'est-à-dire qu'on n'exécute jamais.
 *
 * ⚠️ **N'a de sens qu'IMMÉDIATEMENT après un build.** Sur un `deploy/` périmé, la comparaison
 * oppose l'ancien au neuf : le rouge serait réel (le déployé ne correspond pas aux sources)
 * mais son message parlerait de déterminisme, ce qui enverrait chercher au mauvais endroit.
 * Hors de ce couplage, employer `--deploy` seul.
 */
const REUSE_BUILT = process.argv.includes("--reuse-built");

const argName = (() => {
    const i = process.argv.indexOf("--package");
    return i !== -1 ? process.argv[i + 1] : "@geoleaf/core";
})();

const pkg = registry.byName(argName);
if (!pkg) {
    console.error(`check-build-determinism: unknown package "${argName}".`);
    process.exit(1);
}

const distDir = path.join(pkg.absDir, "dist");

/** Hash every file under dist/, keyed by path relative to dist/. */
function snapshot() {
    /** @type {Record<string,string>} */
    const out = {};
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else {
                const rel = path.relative(distDir, full).split(path.sep).join("/");
                out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
            }
        }
    };
    walk(distDir);
    return out;
}

function build(label) {
    fs.rmSync(distDir, { recursive: true, force: true });
    const res = spawnSync("npx", ["rollup", "-c"], {
        cwd: pkg.absDir,
        encoding: "utf8",
        stdio: "pipe",
    });
    if (res.status !== 0) {
        console.error(`${C.r}✗${C.x} build ${label} en échec :`);
        console.error((res.stderr || res.stdout || "").split("\n").slice(-15).join("\n"));
        process.exit(1);
    }
    return snapshot();
}

const DEPLOY_DIR = path.join(registry.ROOT, "deploy");

/**
 * Empreinte de `deploy/`, hors artefacts pré-compressés.
 *
 * ⚠️ `.gz`/`.br` sont exclus : leur en-tête peut porter un horodatage selon l'implémentation,
 * ce qui rendrait la gate rouge sur une propriété qui n'est pas celle qu'on mesure. Leur source
 * est comparée, donc une divergence réelle se voit quand même.
 * ⚠️ `deploy-coverage/` est exclu : il est produit par un AUTRE script, à partir d'un build
 * instrumenté, et n'est pas ce que `build:deploy` génère.
 */
function snapshotDeploy() {
    /** @type {Record<string,string>} */
    const out = {};
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === "deploy-coverage") continue;
                walk(full);
            } else if (!/\.(gz|br)$/.test(e.name)) {
                const rel = path.relative(DEPLOY_DIR, full).split(path.sep).join("/");
                out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
            }
        }
    };
    walk(DEPLOY_DIR);
    return out;
}

function buildDeploy(label) {
    const res = spawnSync("npm", ["run", "build:deploy"], {
        cwd: registry.ROOT,
        encoding: "utf8",
        stdio: "pipe",
        shell: process.platform === "win32",
    });
    if (res.status !== 0) {
        console.error(`${C.r}✗${C.x} build:deploy ${label} en échec :`);
        console.error((res.stderr || res.stdout || "").split("\n").slice(-15).join("\n"));
        process.exit(1);
    }
    return snapshotDeploy();
}

const subject = DEPLOY_MODE ? "deploy/ (build:deploy)" : argName;
console.log(`${C.c}── Déterminisme du build — ${subject} ──${C.x}`);
console.log(
    `${C.d}   ${DEPLOY_MODE && REUSE_BUILT ? "le deploy/ existant contre un build neuf" : "deux builds complets"}, ` +
        `${DEPLOY_MODE ? "deploy/" : "dist/"} comparé fichier par fichier${C.x}\n`
);

let a, b;
if (DEPLOY_MODE) {
    a = REUSE_BUILT ? snapshotDeploy() : buildDeploy("1");
    if (REUSE_BUILT && Object.keys(a).length === 0) {
        console.error(`${C.r}✗ BUILD-DET : \`--reuse-built\` mais \`deploy/\` est vide.${C.x}`);
        console.error(`  Ce mode suppose un build immédiatement antérieur. Sans lui, lancer`);
        console.error(`  \`npm run check:determinism:deploy\` (deux builds).`);
        process.exit(1);
    }
    b = buildDeploy(REUSE_BUILT ? "2 (le 1er est le deploy/ existant)" : "2");
} else {
    a = build("1");
    b = build("2");
}

if (Object.keys(a).length === 0) {
    // Anti-gate-vide : deux répertoires vides sont « identiques » et ne prouvent rien.
    console.error(`${C.r}✗ BUILD-DET : aucun fichier scanné — le périmètre est vide.${C.x}`);
    process.exit(1);
}

const namesA = Object.keys(a).sort();
const namesB = Object.keys(b).sort();

const onlyA = namesA.filter((n) => !(n in b));
const onlyB = namesB.filter((n) => !(n in a));
const differing = namesA.filter((n) => n in b && a[n] !== b[n]);

if (onlyA.length === 0 && onlyB.length === 0 && differing.length === 0) {
    console.log(`${C.g}✓ BUILD-DET : ${namesA.length} fichiers identiques sur deux builds.${C.x}`);
    process.exit(0);
}

console.error(`${C.r}✗ BUILD-DET : le build n'est pas déterministe.${C.x}\n`);

// Renamed files are the signature of an unstable content hash — the exact defect
// this gate was written for. Report them as such rather than as add/remove noise.
if (onlyA.length && onlyB.length) {
    console.error(`  ${onlyA.length} fichier(s) ont changé de NOM entre deux builds identiques :`);
    for (const n of onlyA.slice(0, 8)) console.error(`    build 1 : ${n}`);
    for (const n of onlyB.slice(0, 8)) console.error(`    build 2 : ${n}`);
    console.error(`\n  ${C.d}Un nom qui bouge à contenu constant = un hash de contenu instable.`);
    console.error(
        `  ${C.d}Piste connue : un plugin dont \`augmentChunkHash\` sérialise une Map ou un Set`
    );
    console.error(
        `  ${C.d}(ordre d'insertion non stable). Cf. withStableChunkHash dans build-config/rollup.mjs.${C.x}`
    );
} else {
    if (onlyA.length)
        console.error(`  présents au build 1 seulement : ${onlyA.slice(0, 5).join(", ")}`);
    if (onlyB.length)
        console.error(`  présents au build 2 seulement : ${onlyB.slice(0, 5).join(", ")}`);
}

if (differing.length) {
    console.error(`\n  ${differing.length} fichier(s) de même nom mais de contenu différent :`);
    for (const n of differing.slice(0, 8)) console.error(`    ${n}`);
    console.error(
        `  ${C.d}Chercher une date, un horodatage, un chemin absolu ou un aléa dans le build.${C.x}`
    );
}

process.exit(1);
