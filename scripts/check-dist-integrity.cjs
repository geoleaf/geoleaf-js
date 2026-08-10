#!/usr/bin/env node
/**
 * @fileoverview DIST-INTEGRITY — la garde qui rend B-130 VISIBLE au lieu de la prévenir
 * au petit bonheur.
 *
 * ## Le défaut, mesuré et re-mesuré
 *
 * `turbo run build` restaure son cache **sans vider `dist/` d'abord**. Quand la tâche sort
 * en `FULL TURBO`, les artefacts restaurés se **superposent** à ceux déjà présents : deux
 * jeux de chunks, capturés à des états d'entrée différents, cohabitent.
 *
 * Re-vérifié au pré-vol de S6a (06/08/2026, turbo **2.9.18**) par un canari : un fichier
 * posé à la main dans `packages/core/dist/chunks/` **survit** à un `turbo run build` qui
 * sort en `cache hit, replaying logs` / `>>> FULL TURBO`. L'issue (a) du registre —
 * « déclarer `outputs` pour que la restauration remplace au lieu de superposer » — est donc
 * **écartée par la mesure** : `outputs: ["dist/**"]` est déjà déclaré, et ne suffit pas.
 *
 * ## Pourquoi une GARDE, et pas seulement une purge
 *
 * `scripts/purge-dist.cjs` prévient le défaut, et il est câblé dans `npm run build`. Mais
 * `CLAUDE.md` prescrit `npx turbo run build` **en premier temps** du protocole de
 * regénération du déployé — un appel direct qui contourne le script npm. Une prévention
 * qu'un chemin documenté contourne n'est pas une prévention.
 *
 * Le registre le dit lui-même (B-130, issue **c**) : c'est « la seule issue qui rende le
 * défaut VISIBLE au lieu de le prévenir au petit bonheur ». Ce fichier est cette issue.
 *
 * ## Les trois règles
 *
 *   DIST-01  **Zéro chunk en double.** Deux fichiers d'un même nom LOGIQUE (tout ce qui
 *            précède le hash de contenu final) dans un même répertoire de chunks ⟹ erreur.
 *            C'est la signature exacte de la superposition.
 *   DIST-02  **Zéro chunk orphelin.** Un fichier de `chunks/` que plus rien ne référence
 *            dans son propre `dist/` est du poids mort — et il **partirait dans le tarball
 *            npm** (B-141 ②, mesuré : 3,5 Mo sur `realtime-layer`).
 *   DIST-03  **Le corpus ne peut pas être vide.** Une gate verte qui n'a rien scanné est le
 *            pire des résultats — même classe que JTD-03, NNA-03 et EOD-03. Ici le piège est
 *            réel : avant tout build, il n'y a AUCUN `dist/`, et la gate sortirait verte en
 *            ne regardant rien.
 *
 * ## Deux décisions de conception
 *
 * **Le périmètre vient du registre** (`scripts/lib/packages.cjs`), jamais d'un glob
 * `packages/*​/dist` — qui ne matche ni `packages/plugins/*` ni `packages/libs/*`, donc
 * mettrait treize paquets sur quinze hors compteur sans que rien ne rougisse. Classe
 * surveillée par `probe-gate-visibility.cjs`.
 *
 * **`deploy/` est scanné aussi, et séparément.** La duplication vient de la SOURCE
 * (`packages/*​/dist/`), mais une reconstruction de `deploy/` sur un `dist/` pollué la
 * reproduit — vérifié au 05/08. Les deux périmètres sont donc mesurés, et le rapport les
 * distingue pour qu'on sache lequel purger.
 *
 * @see _docs_projet/registres/backlog_technique.md § B-130
 * @see scripts/purge-dist.cjs — le versant préventif
 */

const fs = require("node:fs");
const path = require("node:path");
const packages = require("./lib/packages.cjs");

const ROOT = packages.ROOT;

/**
 * Retire le hash de contenu final d'un nom de chunk pour en tirer le nom LOGIQUE.
 *
 * Rollup émet `geoleaf-chunk-core-utils-DmkBZ6K6.js` : le segment final est un hash base64url
 * de 8 caractères. Deux builds d'un même chunk logique ne diffèrent que par lui — c'est
 * précisément ce qui rend la superposition détectable.
 *
 * 🛑 **La première version de cette fonction acceptait `[A-Za-z0-9_-]{8}`, et elle a produit
 * un FAUX POSITIF au premier run** : `maplibre-layer-builders.js` et
 * `maplibre-layer-registry.js` (deux modules bien distincts de `dist/esm/`) ont été rendus
 * comme « deux variantes de `maplibre-layer` », parce que `builders` et `registry` font
 * exactement huit lettres. Une gate bruyante apprend à être ignorée, ce qui est pire qu'une
 * gate absente — le dépôt l'a écrit en S5c/5.8 après le même incident sur DOC-CONFIG-EXAMPLES.
 *
 * D'où **deux resserrages, et non un** : le hash doit porter au moins une **majuscule** ET au
 * moins un **chiffre ou une seconde majuscule** (un mot anglais en minuscules ne peut plus
 * passer), et l'appelant ne juge que les répertoires `chunks/` — voir `analyse()`.
 *
 * @param {string} file Nom de fichier, sans son répertoire.
 * @returns {string|null} Le nom logique, ou `null` si le fichier ne porte pas de hash (auquel
 *   cas il n'est pas un chunk hashé et ne peut pas se dupliquer par superposition).
 */
function logicalName(file) {
    const m = file.match(/^(.*)-([A-Za-z0-9_-]{8})\.js$/);
    if (!m) return null;
    const hash = m[2];
    const uppers = (hash.match(/[A-Z]/g) || []).length;
    const digits = (hash.match(/[0-9]/g) || []).length;
    if (uppers === 0) return null;
    if (uppers + digits < 2) return null;
    return m[1];
}

/**
 * Collecte les répertoires de chunks d'une racine `dist/`.
 *
 * @param {string} distDir Chemin absolu d'un répertoire `dist`.
 * @returns {string[]} Chemins absolus des répertoires contenant des `.js`.
 */
function chunkDirs(distDir) {
    const out = [];
    if (!fs.existsSync(distDir)) return out;
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const q = path.join(d, e.name);
            if (e.isDirectory()) walk(q);
        }
        if (fs.readdirSync(d).some((f) => f.endsWith(".js"))) out.push(d);
    })(distDir);
    return out;
}

/**
 * Analyse une racine `dist/` : doublons logiques et chunks orphelins.
 *
 * @param {string} label Nom lisible du périmètre (paquet ou variante de déploiement).
 * @param {string} distDir Chemin absolu du `dist/`.
 * @returns {{label: string, scanned: number, duplicates: object[], orphans: string[]}}
 */
function analyse(label, distDir) {
    const duplicates = [];
    const orphans = [];
    let scanned = 0;

    // Contenu de TOUS les .js du périmètre : c'est là que se lisent les références.
    const allJs = [];
    for (const dir of chunkDirs(distDir)) {
        for (const f of fs.readdirSync(dir)) {
            if (f.endsWith(".js")) allJs.push(path.join(dir, f));
        }
    }
    const corpus = allJs.map((f) => ({ file: f, text: fs.readFileSync(f, "utf-8") }));

    for (const dir of chunkDirs(distDir)) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
        scanned += files.length;

        // Les deux règles ne jugent QUE les répertoires `chunks/`. C'est là que rollup émet
        // ses fichiers hashés, donc le seul endroit où la superposition de B-130 est
        // exprimable. `dist/esm/` porte des modules NOMMÉS, préservés un par un : deux noms
        // voisins y sont deux modules, jamais deux variantes — et les y juger a produit le
        // faux positif `maplibre-layer-builders` / `maplibre-layer-registry` au premier run.
        if (path.basename(dir) !== "chunks") continue;

        // DIST-01 — deux hashes pour un même nom logique.
        const byLogical = new Map();
        for (const f of files) {
            const ln = logicalName(f);
            if (!ln) continue;
            if (!byLogical.has(ln)) byLogical.set(ln, []);
            byLogical.get(ln).push(f);
        }
        for (const [ln, variants] of byLogical) {
            if (variants.length > 1) {
                duplicates.push({
                    dir: path.relative(ROOT, dir),
                    logical: ln,
                    variants: variants.sort(),
                });
            }
        }

        // DIST-02 — un chunk que rien ne référence. À la racine d'un `dist/`, un .js non
        // référencé est une ENTRÉE, pas un orphelin ; le filtre `chunks/` ci-dessus l'exclut
        // déjà, et c'est ce qui empêche la règle de compter chaque point d'entrée du dépôt.
        for (const f of files) {
            const referenced = corpus.some((c) => c.file !== path.join(dir, f) && c.text.includes(f));
            if (!referenced) orphans.push(path.relative(ROOT, path.join(dir, f)));
        }
    }

    return { label, scanned, duplicates, orphans };
}

const results = [];

for (const p of packages.all()) {
    const dist = path.join(p.absDir, "dist");
    if (!fs.existsSync(dist)) continue;
    results.push(analyse(p.name, dist));
}

const deployRoot = path.join(ROOT, "deploy");
if (fs.existsSync(deployRoot)) {
    for (const variant of fs.readdirSync(deployRoot)) {
        const dist = path.join(deployRoot, variant, "dist");
        if (!fs.existsSync(dist)) continue;
        results.push(analyse("deploy/" + variant, dist));
    }
}

const totalScanned = results.reduce((n, r) => n + r.scanned, 0);
const dupes = results.filter((r) => r.duplicates.length);
const orphs = results.filter((r) => r.orphans.length);

const BAR = "─".repeat(72);
console.log(BAR);

let failed = false;

// DIST-03 — anti-gate-vide, évaluée EN PREMIER : sans elle, un dépôt jamais buildé sort vert
// en n'ayant rien regardé, ce qui est le résultat le plus trompeur possible.
if (totalScanned === 0) {
    console.error("❌ [DIST-03] corpus VIDE — aucun fichier .js scanné dans aucun dist/.");
    console.error("   Une gate verte qui n'a rien scanné ne garde rien. Lancer un build d'abord :");
    console.error("     npx turbo run build");
    failed = true;
}

for (const r of dupes) {
    failed = true;
    console.error(`❌ [DIST-01] ${r.label} — chunk(s) en DOUBLE (superposition de cache turbo) :`);
    for (const d of r.duplicates) {
        console.error(`     ${d.dir}/${d.logical} → ${d.variants.length} variantes :`);
        for (const v of d.variants) console.error(`        ${v}`);
    }
}

for (const r of orphs) {
    failed = true;
    console.error(`❌ [DIST-02] ${r.label} — chunk(s) ORPHELIN(S), référencés par rien :`);
    for (const o of r.orphans) console.error(`     ${o}`);
}

if (failed) {
    console.error("");
    console.error("   Cause probable : B-130 — turbo restaure son cache SANS vider dist/.");
    console.error("   Geste : node scripts/purge-dist.cjs && npx turbo run build");
    console.error(BAR);
    process.exit(1);
}

console.log(
    `✅ [DIST-INTEGRITY] ${totalScanned} fichier(s) .js scanné(s) sur ${results.length} périmètre(s) — ` +
        "0 chunk en double, 0 orphelin."
);
console.log(BAR);
