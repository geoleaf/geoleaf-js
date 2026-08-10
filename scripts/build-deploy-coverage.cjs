#!/usr/bin/env node
// @ts-check
/**
 * build-deploy-coverage.cjs — Build instrumented bundle for E2E coverage
 *
 * Workflow:
 * 1. Save current (clean) dist/ files
 * 2. Run rollup with COVERAGE=true → instrumented ESM bundle in packages/core/dist/
 * 3. Copy deploy/deploy-core → deploy/deploy-coverage
 * 4. Replace JS bundles in deploy-coverage/dist/ with instrumented versions
 * 5. Restore original dist/ files
 *
 * ## `deploy-coverage` is TOOLING, not a deliverable (T2, arbitrage Q2)
 *
 * The two shipped variants are `deploy-core` and `deploy-full` (5.5 : `deploy-addpoi` est
 * partie avec le plugin fusionné).
 * `deploy-coverage` is a FOURTH folder that is served (port 8769, vhost
 * `demo.coverage.geoleaf.local.test`) but never delivered: it is `deploy-core` with an
 * Istanbul-instrumented bundle and a CSP relaxed to allow `unsafe-eval`. **It does not
 * ship, it measures** — 4 specs of the main suite
 * read their coverage from it. Kept for that reason, and documented here so nobody
 * mistakes it for a delivery target or "cleans it up" as a stray copy.
 *
 * It reads only DERIVED artefacts — `deploy/deploy-core` and `packages/core/dist` —
 * never the app's sources, which is why T2 (moving the app to `apps/geoleaf-app/`)
 * required no change here. ⚠️ But it goes STALE the moment `deploy-core` is rebuilt:
 * regenerate it after every `build:deploy` or the E2E run times out on a missing 8769.
 *
 * Usage: node scripts/build-deploy-coverage.cjs
 * Prerequisite: deploy/deploy-core must already exist (run npm run build:deploy first)
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// @security (audit L1) Disable the shell on POSIX (CI ubuntu + WSL). Static
// literal args only; on Windows `npx` resolves to npx.cmd which Node refuses to
// spawn without a shell (CVE-2024-27980), so the shell is retained there only.
const NPM_SHELL = process.platform === "win32";

const ROOT = path.resolve(__dirname, "..");
const DEPLOY_CORE = path.join(ROOT, "deploy", "deploy-core");
const DEPLOY_COV = path.join(ROOT, "deploy", "deploy-coverage");
// T5.5 — par le registre, qui jette. `CORE_PKG_DIR` sert aussi de `cwd` aux deux appels
// rollup (étapes 1 et 4) : un chemin périmé y ferait échouer le build avec un message
// d'outil, pas de gate — ce script laisserait alors `deploy-coverage` sur ses anciens
// bundles instrumentés, servis tels quels par le vhost 8769.
const CORE_PKG_DIR = require("./lib/packages.cjs").requireByDirName("core").absDir;
const CORE_DIST = path.join(CORE_PKG_DIR, "dist");

/**
 * Vide `packages/core/dist/` avant un appel direct à rollup.
 *
 * Les deux `npx rollup -c` de ce fichier court-circuitent le `rimraf dist &&` que porte le
 * script `build` du core, et rollup n'efface pas son répertoire de sortie : sans cette purge,
 * chaque passe SUPERPOSE son jeu de chunks hashés au précédent. Voir le commentaire de
 * l'étape 1 et `scripts/check-dist-integrity.cjs`, la garde qui rend le défaut visible.
 *
 * @param {string} phase Libellé de la passe, pour la trace.
 */
function purgeCoreDist(phase) {
    if (fs.existsSync(CORE_DIST)) {
        fs.rmSync(CORE_DIST, { recursive: true, force: true });
        log.ok(`dist/ vidé avant le build ${phase} (B-130)`);
    }
}

const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
};
const log = {
    ok: (m) => console.log(`${C.green}✓${C.reset}  ${m}`),
    err: (m) => console.error(`${C.red}✗${C.reset}  ${m}`),
    info: (m) => console.log(`${C.cyan}ℹ${C.reset}  ${m}`),
    section: (m) => console.log(`\n${C.cyan}── ${m} ──${C.reset}\n`),
};

/**
 * Recursive directory copy, with an optional per-file filter.
 *
 * @param {string} src
 * @param {string} dest
 * @param {(name: string) => boolean} [keepFile] receives the BASENAME of each regular file;
 *   return `false` to skip it. Omitted ⇒ copy all. Ajouté au S6.6, même motif que son jumeau
 *   de `build-deploy.cjs` : un `copyDir` en bloc réintroduit des sourcemaps sans qu'aucune
 *   ligne du script ne les nomme.
 */
function copyDirRecursive(src, dest, keepFile) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirRecursive(s, d, keepFile);
        else if (!keepFile || keepFile(entry.name)) fs.copyFileSync(s, d);
    }
}

// ── Pre-checks ──────────────────────────────────────────
if (!fs.existsSync(DEPLOY_CORE)) {
    log.err("deploy/deploy-core not found. Run 'npm run build:deploy' first.");
    process.exit(1);
}

// ── Step 1: Build instrumented core ─────────────────────
log.section("🔬 Building instrumented core (COVERAGE=true)");

// ⚠️ B-130, SECONDE CAUSE — trouvée en S6a le 06/08/2026, et elle n'est PAS celle que la
// ligne de registre décrit. B-130 attribue la superposition de chunks au cache turbo, ce qui
// est vrai et prouvé par canari ; mais elle ne suffit pas à l'expliquer ici.
//
// Le script du core fait `rimraf dist && rollup -c` (`package.json`). Ce fichier appelle
// `npx rollup -c` DIRECTEMENT, aux étapes 1 et 4 — donc SANS le `rimraf`. Rollup écrit ses
// chunks hashés par-dessus ceux déjà présents au lieu de les remplacer : après l'étape 1,
// `core/dist/chunks/` porte les chunks instrumentés ET les non-instrumentés, l'étape 3 copie
// LES DEUX vers `deploy-coverage`, et l'étape 4 en rajoute un troisième jeu.
//
// Mesuré : `packages/core/dist/chunks/` sort PROPRE d'un `turbo run build --force`, puis
// redevient double après ce seul script. Purger avant chaque rollup est le geste qui manque.
purgeCoreDist("instrumenté");

const buildResult = spawnSync("npx", ["rollup", "-c"], {
    cwd: CORE_PKG_DIR,
    stdio: "inherit",
    shell: NPM_SHELL,
    env: { ...process.env, COVERAGE: "true" },
});

if (buildResult.status !== 0) {
    log.err("Instrumented build failed — aborting.");
    process.exit(1);
}
log.ok("Instrumented build succeeded");

// ── Step 2: Copy deploy-core → deploy-coverage ──────────
log.section("📁 Creating deploy/deploy-coverage");

if (fs.existsSync(DEPLOY_COV)) {
    fs.rmSync(DEPLOY_COV, { recursive: true, force: true });
}
// 🛑 B-168 — les PRÉ-COMPRESSÉS de `deploy-core` ne sont PAS copiés, et c'est le correctif
// central de cette ligne, pas une optimisation.
//
// Ce script copie une variante ENTIÈREMENT BÂTIE puis n'en écrase qu'une partie : les `.js`
// passent en version instrumentée, les `.gz`/`.br` restaient ceux du build PROPRE. Or le nginx
// de dev porte `gzip_static on` : il sert le `.gz` de préférence au fichier nommé. Le navigateur
// recevait donc **l'entrée de `deploy-core`**, non instrumentée, qui importe les chunks de
// `deploy-core` — absents de cette variante, puisque les chunks instrumentés portent d'autres
// hachages de contenu. Résultat mesuré le 08/08/2026 : 3 chunks en 404, le module d'entrée
// n'instancie jamais, `window.GeoLeaf` et `window.__coverage__` restent `undefined`, et les
// 7 tests de `07-boot-sequence` échouent — **l'instrument qui mesure la couverture du bundle
// LIVRÉ était mort, sans que rien ne le dise.**
//
// ⚠️ Le symptôme DÉSIGNAIT LE MAUVAIS COUPABLE. Les trois 404 correspondent aussi, exactement,
// aux trois `<link rel="modulepreload">` hérités de `deploy-core` — d'où un premier diagnostic
// qui accusait le bloc de préchargement. Il est bien incohérent, mais un préchargement en échec
// ne fait qu'avertir : il n'empêche pas un module de s'exécuter. La preuve qui tranche n'est pas
// la liste des 404, c'est que le `.gz` servi ne contient AUCUN marqueur d'instrumentation.
//
// Purger plutôt que régénérer : cette variante est un instrument de test servi en local, aucune
// gate n'attend de compressés chez elle (`check-app-payload` la documente comme non gatée,
// `check-build-determinism` l'exclut), et un fichier absent ne peut pas diverger de sa source.
const PRECOMPRESSED = /\.(gz|br)$/;
copyDirRecursive(DEPLOY_CORE, DEPLOY_COV, (n) => !PRECOMPRESSED.test(n));
log.ok("Copied deploy-core → deploy-coverage (sans les pré-compressés — B-168)");

// ── Step 2b: Relax CSP for Istanbul (needs 'unsafe-eval' for Function()) ──
const indexPath = path.join(DEPLOY_COV, "index.html");
if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, "utf8");
    html = html.replace(/script-src\s+'self'/, "script-src 'self' 'unsafe-eval'");
    fs.writeFileSync(indexPath, html, "utf8");
    log.ok("CSP relaxed: added 'unsafe-eval' for Istanbul instrumentation");
}

// ── Step 3: Replace JS with instrumented versions ───────
log.section("🔄 Replacing JS bundles with instrumented versions");

// Copy main ESM bundle
const esmSrc = path.join(CORE_DIST, "geoleaf.esm.js");
const esmDest = path.join(DEPLOY_COV, "dist", "geoleaf.esm.js");
if (fs.existsSync(esmSrc)) {
    fs.copyFileSync(esmSrc, esmDest);
    log.ok("geoleaf.esm.js (instrumented)");
}

// S6.6 — la copie de `geoleaf.esm.js.map` est RETIRÉE, et la règle vaut ici AUSSI.
//
// Cette variante est un instrument de test, jamais servi en production : l'argument de
// divulgation qui motive S6.6 ne s'y applique pas de la même façon, et une exemption aurait
// été défendable. Vérifié avant de trancher : **rien ne lit cette sourcemap** — la couverture
// de boot passe par le global istanbul `window.__coverage__`, pas par un remappage.
// L'exemption aurait donc coûté une asymétrie à documenter et à défendre, pour aucun usage.
// Une règle uniforme est plus courte à tenir qu'une règle avec un cas particulier justifié.

// Copy instrumented chunks — sans leurs sourcemaps, même motif.
const chunksSrc = path.join(CORE_DIST, "chunks");
const chunksDest = path.join(DEPLOY_COV, "dist", "chunks");
if (fs.existsSync(chunksSrc)) {
    if (fs.existsSync(chunksDest)) {
        fs.rmSync(chunksDest, { recursive: true, force: true });
    }
    copyDirRecursive(chunksSrc, chunksDest, (n) => !n.endsWith(".map"));
    const count = fs.readdirSync(chunksDest).filter((f) => f.endsWith(".js")).length;
    log.ok(`${count} chunk(s) copied`);
}

// ── Step 3b: réaligner les `<link rel="modulepreload">` — B-168, second défaut ──
//
// `index.html` est copié de `deploy-core`, donc son bloc de préchargement nomme les chunks du
// build PROPRE. Les chunks instrumentés portent d'autres hachages de contenu : les trois liens
// tombaient en 404 à chaque chargement.
//
// ⚠️ Ce défaut est RÉEL mais il n'était PAS la cause de la panne, et les confondre a coûté un
// premier diagnostic entier. Un préchargement en échec avertit, il n'empêche pas un module de
// s'exécuter — la panne venait du `.gz` périmé servi par `gzip_static` (voir l'étape 2). Les
// deux produisent exactement les mêmes trois 404, ce qui rend le symptôme ambigu : c'est le
// contenu du `.gz`, pas la liste des 404, qui a tranché.
//
// Corrigé plutôt que supprimé : le préchargement fait partie de la forme de la page que
// `07-boot-sequence` observe. Le réalignement se fait par PRÉFIXE de nom de chunk — jamais par
// position dans la liste, qui ne dit rien —, et un préfixe sans correspondance fait ÉCHOUER le
// build au lieu de laisser un 404 muet revenir.
if (fs.existsSync(indexPath) && fs.existsSync(chunksDest)) {
    const present = fs.readdirSync(chunksDest).filter((f) => f.endsWith(".js"));
    let html = fs.readFileSync(indexPath, "utf8");
    let realigned = 0;
    const unresolved = [];

    html = html.replace(
        /(<link rel="modulepreload" href="dist\/chunks\/)([^"]+)(")/g,
        (whole, head, file, tail) => {
            if (present.includes(file)) return whole; // déjà juste
            // `geoleaf-chunk-core-utils-BNNAnI8S.js` → préfixe `geoleaf-chunk-core-utils-`
            const prefix = file.replace(/-[A-Za-z0-9_-]+\.js$/, "-");
            const match = present.find((f) => f.startsWith(prefix));
            if (!match) {
                unresolved.push(file);
                return whole;
            }
            realigned++;
            return head + match + tail;
        }
    );

    if (unresolved.length) {
        log.err(
            `B-168 — ${unresolved.length} modulepreload sans chunk correspondant : ` +
                `${unresolved.join(", ")}. Ils partiraient en 404 à chaque chargement et ` +
                `feraient échouer toute spec assertant « 0 erreur console ».`
        );
        process.exit(1);
    }
    fs.writeFileSync(indexPath, html, "utf8");
    log.ok(`${realigned} modulepreload réaligné(s) sur les chunks instrumentés (B-168)`);
}

// ── Step 4: Rebuild clean core (restore non-instrumented dist/) ──
log.section("🔨 Rebuilding clean core (restoring dist/)");

// Même motif qu'à l'étape 1 : sans cette purge, le jeu non-instrumenté s'ajoute au jeu
// instrumenté que l'étape 1 vient de produire, et `core/dist/` finit avec les deux.
purgeCoreDist("propre");

const cleanBuild = spawnSync("npx", ["rollup", "-c"], {
    cwd: CORE_PKG_DIR,
    stdio: "inherit",
    shell: NPM_SHELL,
});

if (cleanBuild.status !== 0) {
    log.err(
        "Clean rebuild failed — dist/ may still contain instrumented code. Run 'npm run build:core' manually."
    );
} else {
    log.ok("Clean dist/ restored");
}

// S6.6 — purge des `sourceMappingURL` orphelins, et GARDE.
//
// ⚠️ Cette passe est indispensable ICI et ne peut pas être déléguée à `build-deploy.cjs`, pour
// une raison d'ORDRE : ce script copie les bundles INSTRUMENTÉS depuis `CORE_DIST` **après**
// que build-deploy a nettoyé `deploy-core`. Les fichiers arrivent donc frais, avec leur
// commentaire intact. Mesuré le 08/08/2026 : `deploy-coverage` sortait à 0 sourcemap mais
// **6 `sourceMappingURL` orphelins**, chacun un 404 en devtools — la moitié du défaut réparée,
// l'autre reformée juste après, par un script que la première passe ne voyait pas.
{
    const stripped = [];
    const sweep = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                sweep(p);
                continue;
            }
            if (!/\.(js|css)$/.test(e.name)) continue;
            const before = fs.readFileSync(p, "utf8");
            const after = before.replace(
                /\s*(?:\/\/|\/\*)#\s*sourceMappingURL=[^\s*]+\s*(?:\*\/)?\s*$/,
                "\n"
            );
            if (after !== before) {
                fs.writeFileSync(p, after);
                stripped.push(path.relative(DEPLOY_COV, p));
            }
        }
    };
    sweep(DEPLOY_COV);
    log.ok(`sourceMappingURL retirés — ${stripped.length} fichier(s)`);

    const leaked = [];
    const findMaps = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) findMaps(p);
            else if (e.name.endsWith(".map")) leaked.push(path.relative(DEPLOY_COV, p));
        }
    };
    findMaps(DEPLOY_COV);
    if (leaked.length) {
        log.err(
            `${leaked.length} sourcemap(s) dans deploy-coverage : ${leaked.join(", ")}. ` +
                `Le déployé n'en expédie AUCUNE (S6.6). Filtrer la copie, ne pas retirer la garde.`
        );
        process.exit(1);
    }
    log.ok("aucune sourcemap dans deploy-coverage (garde S6.6)");
}

/**
 * GARDE B-168 — aucun pré-compressé, et l'entrée servie EST celle qui est instrumentée.
 *
 * Deux contrôles, parce qu'un seul laisserait passer la moitié de la classe :
 *
 * ① Aucun `.gz`/`.br` dans la variante. Sous `gzip_static on`, un compressé périmé est servi
 *   À LA PLACE du fichier nommé — le disque peut donc être juste pendant que le navigateur
 *   reçoit autre chose. C'est précisément ce qui a rendu B-168 invisible : toutes mes
 *   vérifications lisaient le `.js`, et nginx servait le `.gz`.
 *
 * ② L'entrée porte un marqueur d'instrumentation. ① seul sortirait vert sur un
 *   `deploy-coverage` où l'écrasement des `.js` aurait échoué — la variante serait alors
 *   cohérente et parfaitement inutile, ce qui est le pire des états : `verify-e2e-coverage`
 *   mesurerait un bundle NON instrumenté et rendrait 0 % sans qu'aucune erreur ne le dise.
 */
{
    const compressed = [];
    const findCompressed = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) findCompressed(p);
            else if (/\.(gz|br)$/.test(e.name)) compressed.push(path.relative(DEPLOY_COV, p));
        }
    };
    findCompressed(DEPLOY_COV);
    if (compressed.length) {
        log.err(
            `B-168 — ${compressed.length} pré-compressé(s) dans deploy-coverage : ` +
                `${compressed.slice(0, 5).join(", ")}${compressed.length > 5 ? "…" : ""}. ` +
                `Le nginx de dev porte \`gzip_static on\` et les servirait À LA PLACE des ` +
                `fichiers instrumentés — la variante boote alors du code NON instrumenté, ou ` +
                `ne boote pas du tout. Ne pas régénérer : ne pas copier.`
        );
        process.exit(1);
    }

    const entry = path.join(DEPLOY_COV, "dist", "geoleaf.esm.js");
    if (!fs.existsSync(entry)) {
        log.err("B-168 — dist/geoleaf.esm.js absent de deploy-coverage.");
        process.exit(1);
    }
    if (!fs.readFileSync(entry, "utf8").includes("__coverage__")) {
        log.err(
            "B-168 — dist/geoleaf.esm.js ne porte AUCUN marqueur d'instrumentation. La " +
                "variante servirait un bundle propre, et `verify-e2e-coverage` rendrait 0 % " +
                "sans qu'aucune erreur ne le signale."
        );
        process.exit(1);
    }
    log.ok("aucun pré-compressé, et l'entrée est instrumentée (garde B-168)");
}

log.section("✅ deploy/deploy-coverage ready (port 8769)");
const covSize = (function calcSize(dir) {
    let bytes = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) bytes += calcSize(p);
        else bytes += fs.statSync(p).size;
    }
    return bytes;
})(DEPLOY_COV);
log.info(`Total size: ${(covSize / 1024).toFixed(0)} KB`);
