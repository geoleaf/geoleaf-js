#!/usr/bin/env node
"use strict";
/**
 * verify-deploy-server-contract.cjs — ce qu'on livre DIT ce qu'il exige.
 *
 * ## Le trou que cette gate ferme
 *
 * Le 09/08/2026, `deploy-full` a été copié tel quel sur un serveur de production nginx. Le
 * spinner a tourné indéfiniment. Cause unique, rendue en clair par la première ligne de console :
 * le serveur servait les `.mjs` du moteur MapLibre en `application/octet-stream`, et le
 * navigateur refuse d'exécuter un module sous ce type.
 *
 * 🛑 **Le dépôt SAVAIT.** `docker/nginx.dev.conf` porte la directive, précédée de « SANS CETTE
 * LIGNE, RIEN NE BOOTE » et d'un aveu qui décrit exactement ce qui allait arriver : « ⚠️ Cette
 * contrainte VIT HORS DU DÉPÔT pour l'intégrateur — aucune gate ne peut la voir chez lui ».
 *
 * Ce n'était donc pas un trou de connaissance mais un trou de **diffusion**. La connaissance
 * vivait dans un fichier de développement qui ne part pas avec le dossier ; le livrable, lui, ne
 * portait aucun fichier d'accompagnement, et le dernier texte imprimé par le build conseillait
 * « Serve via http » — que la CSP de la page rend impossible.
 *
 * ## Ce que cette gate peut, et ce qu'elle ne peut pas
 *
 * Elle vérifie que la recette **part avec le dossier** et **dit la seule chose sans laquelle rien
 * ne démarre**. Elle ne peut évidemment pas vérifier le serveur du client : ce versant-là
 * n'appartient à personne ici, et c'est précisément pourquoi la recette doit voyager.
 *
 *   SC-01  chaque variante qui part porte les 3 fichiers d'accompagnement.
 *   SC-02  les 2 recettes serveur déclarent effectivement le type MIME de `.mjs`.
 *          → un fichier présent mais muet est le mode d'échec que cette gate existe pour
 *            éviter, pas un demi-succès.
 *   SC-03  assertion anti-gate-vide, à deux étages : au moins une variante scannée, et la
 *          variante contient au moins un `.mjs`.
 *          → sans le second, le jour où MapLibre cesserait d'être ESM-only, cette gate
 *            continuerait d'exiger — en sortant verte — une recette devenue sans objet. Une
 *            garde qui ne peut plus rougir ne garde rien (cf. `probe-gate-visibility.cjs`).
 *
 * ⚠️ **SC-02 relit le disque, il ne compare pas le générateur à lui-même.** Vérifier que
 * `serverContractFiles()` contient ce que `serverContractFiles()` contient serait une
 * tautologie — le mode d'échec que `verify-app-template.cjs` nomme dans son propre en-tête. Ce
 * qui est mesuré est le fichier ÉMIS, donc la chaîne complète générateur → build → disque.
 *
 * ## Vu rougir avant d'être cru (09/08/2026)
 *
 *   • un des 3 fichiers supprimé du livrable            → SC-01 rouge
 *   • ligne `mjs` retirée du `nginx.conf.example` émis  → SC-02 rouge
 *   • gate pointée sur une variante sans `.mjs`         → SC-03 rouge
 */

const fs = require("node:fs");
const path = require("node:path");

const {
    SERVER_CONTRACT_FILES,
    MJS_MIME_TOKEN,
    declaresMjsType,
    carriesServerContract,
} = require("./lib/server-contract.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY = path.join(ROOT, "deploy");

const C = {
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    x: "\x1b[0m",
};

/** Les deux fichiers qui portent une recette serveur — `SERVEUR.md` est de la prose. */
const RECIPE_FILES = ["nginx.conf.example", ".htaccess"];

/** @type {string[]} */
const errors = [];
const stats = { variants: 0, covered: 0, files: 0, mjs: 0 };

/**
 * Compte les `.mjs` d'un arbre, sans descendre dans ce qui n'est pas servi.
 * @param {string} dir
 * @returns {number}
 */
function countMjs(dir) {
    let n = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) n += countMjs(full);
        else if (entry.name.endsWith(".mjs")) n += 1;
    }
    return n;
}

if (!fs.existsSync(DEPLOY)) {
    console.error(
        `${C.red}${C.bold}✖ DEPLOY-SERVER-CONTRACT${C.x} — ${path.relative(ROOT, DEPLOY)}/ est ` +
            `introuvable.\n  ${C.dim}Rien à vérifier, et un vert ici serait un verdict sur le ` +
            `vide. Construire d'abord : npm run build:deploy${C.x}`
    );
    process.exit(1);
}

const variantDirs = fs
    .readdirSync(DEPLOY, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

for (const variant of variantDirs) {
    stats.variants += 1;
    const dir = path.join(DEPLOY, variant);

    if (!carriesServerContract(variant)) {
        console.log(
            `${C.yellow}↷${C.x} ${variant} ${C.dim}— servie sur le poste uniquement, ` +
                `pas de contrat serveur attendu${C.x}`
        );
        continue;
    }
    stats.covered += 1;

    // ── SC-01 — les 3 fichiers sont là ───────────────────────────────────────
    /** @type {string[]} */
    const present = [];
    for (const name of SERVER_CONTRACT_FILES) {
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) {
            errors.push(
                `SC-01 ${variant}/${name} — absent. Une variante qui part chez quelqu'un doit ` +
                    `dire ce qu'elle exige de son serveur ; sans ce fichier, la recette reste ` +
                    `dans docker/nginx.dev.conf, que l'exploitant ne lira jamais. Émission : ` +
                    `scripts/lib/server-contract.cjs, appelée par build-deploy.cjs.`
            );
            continue;
        }
        present.push(name);
        stats.files += 1;
    }

    // ── SC-02 — les recettes disent la seule chose qui bloque ────────────────
    for (const name of RECIPE_FILES) {
        if (!present.includes(name)) continue; // déjà signalé par SC-01
        const body = fs.readFileSync(path.join(dir, name), "utf-8");
        if (!declaresMjsType(body)) {
            errors.push(
                `SC-02 ${variant}/${name} — aucune LIGNE DE DIRECTIVE n'associe \`${MJS_MIME_TOKEN}\` ` +
                    `à l'extension \`.mjs\`. C'est la seule exigence dont l'absence empêche le ` +
                    `boot : un fichier présent qui ne la porte pas donne une fausse assurance, ` +
                    `ce qui est pire que son absence.\n` +
                    `        Attendu — nginx : \`text/javascript mjs;\` dans un bloc \`types\` · ` +
                    `Apache : \`AddType text/javascript .mjs\`.\n` +
                    `        Les lignes commentées ne comptent pas, et les deux jetons doivent ` +
                    `être sur la même ligne — voir \`declaresMjsType()\` et le motif du dépouillement.`
            );
        }
    }

    // ── SC-03 (2/2) — la recette a encore un objet ───────────────────────────
    const mjs = countMjs(dir);
    stats.mjs += mjs;
    if (mjs === 0) {
        errors.push(
            `SC-03 ${variant} — la variante ne contient AUCUN fichier \`.mjs\`, alors que tout ` +
                `le contrat serveur existe pour eux. Soit le moteur n'est plus livré en modules ` +
                `— et la recette est à réécrire, pas à maintenir —, soit la variante est ` +
                `incomplète. Dans les deux cas, un vert ici ne voudrait rien dire.`
        );
    }
}

// ── SC-03 (1/2) — le scan n'est pas vide ─────────────────────────────────────
//
// 🛑 SANS CE BLOC, CETTE GATE EST DÉCORATIVE. Un `deploy/` sans variante, un renommage, une
// exclusion élargie par erreur : dans les trois cas zéro fichier manquant, donc vert. Même
// raisonnement que DNS-04 dans `verify-deploy-no-secrets.cjs`, et même motif — ce dépôt a déjà
// payé cette classe deux fois.
if (stats.covered === 0) {
    errors.push(
        `SC-03 — aucune variante attendue porteuse de contrat sous ${path.relative(ROOT, DEPLOY)}/ ` +
            `(vues : ${variantDirs.join(", ") || "aucune"}). Le scan n'a rien couvert, et un ` +
            `verdict sur un corpus vide n'est pas un verdict.`
    );
}

// ── Verdict ──────────────────────────────────────────────────────────────────

const scanned =
    `${stats.covered}/${stats.variants} variante(s) porteuse(s), ` +
    `${stats.files} fichier(s) de contrat, ${stats.mjs} module(s) .mjs couvert(s)`;

if (errors.length) {
    console.error(
        `\n${C.red}${C.bold}✖ DEPLOY-SERVER-CONTRACT — ${errors.length} défaut(s)${C.x}\n`
    );
    for (const e of errors) console.error(`  ${C.red}•${C.x} ${e}`);
    console.error(`\n  ${C.dim}Scanné : ${scanned}${C.x}\n`);
    process.exit(1);
}

console.log(
    `${C.green}✔ DEPLOY-SERVER-CONTRACT${C.x} : chaque livrable emporte sa recette serveur — ` +
        `3 invariants tenus (présence, type MIME .mjs déclaré, scan non vide).\n` +
        `  ${C.dim}Scanné : ${scanned}${C.x}`
);
