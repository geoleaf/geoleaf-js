#!/usr/bin/env node
"use strict";
/**
 * verify-npm-readme-render.cjs — les README PUBLIÉS rendent sur npmjs.com.
 *
 * ## Le trou que cette gate ferme
 *
 * `npmjs.com` ne rend PAS les alertes GitHub (`> [!NOTE]`, `> [!WARNING]`, `> [!IMPORTANT]`,
 * `> [!TIP]`, `> [!CAUTION]`) : la syntaxe est une extension propre à GitHub, et le moteur
 * Markdown du registre la traite comme une citation ordinaire. Le marqueur s'affiche en TEXTE
 * LITTÉRAL, sans icône ni couleur — donc l'encadré promis devient une ligne de bruit AU-DESSUS
 * de l'avertissement qu'il devait souligner. Mesuré le 14/08/2026, avant correctif : 18 alertes
 * sur 6 des 14 README publiés, dont 5 dans `@geoleaf/core`, la page npm la plus lue du projet.
 *
 * La forme retenue est celle qui rend à l'identique des deux côtés : `> **Warning** — …`.
 *
 * ⚠️ **Aucune gate ne pouvait le voir, et deux le frôlaient.** `check-dead-links` n'extrait que
 * les liens (`[texte](cible)`). `validate-docs-examples` LIT bien ces fichiers — même corpus,
 * via `lib/tsdoc-examples.cjs#productDocsFiles` — mais son sujet est le CODE des blocs clôturés.
 * La faute vit dans la PROSE, sur une surface dont le rendu ne s'observe pas depuis ce dépôt :
 * c'est la définition d'un angle mort. Un défaut y reste invisible jusqu'à ce qu'un lecteur
 * ouvre la page du registre, ce que personne ne fait dans une boucle de développement.
 *
 * ## Pourquoi le périmètre s'arrête aux README PUBLIÉS
 *
 * 🛑 La règle est INVERSE ailleurs, et l'élargir la rendrait FAUSSE :
 *   • `README.md` racine  → vitrine GitHub (paquet `private`), qui rend les alertes. 7 y vivent,
 *                           légitimement, et elles doivent y rester.
 *   • `docs/`             → rendu par VitePress, qui les rend aussi.
 *   • le `docs/` d'un    → part parfois dans le tarball, mais npmjs.com ne rend QUE le
 *     paquet               `README.md` racine du paquet. Téléchargé, jamais rendu — hors sujet.
 * Une gate qui rougirait sur ces trois surfaces rougirait sur du légitime, et une gate qui
 * rougit sur du légitime se fait désactiver. Elle a donc besoin d'un périmètre à elle.
 *
 * ## Ce qui est vérifié
 *
 *   NPMDOC-01  aucune alerte GitHub dans un README de paquet publié, ni dans le README du
 *              scaffold — HORS blocs clôturés : un extrait de code ENSEIGNE la syntaxe, il ne
 *              la rend pas. Insensible à la casse et à l'espace (`>[!Warning]` est tout aussi
 *              cassé sur npm), et non ancré sur le `>` : la faute la plus probable d'une
 *              correction est de retirer le chevron en laissant le marqueur, et une règle qui
 *              ne prendrait que la forme canonique laisserait passer la forme mal réparée.
 *   NPMDOC-02  chaque paquet de `registry.publishable()` porte un README, et il a été LU. Un
 *              paquet publié sans README affiche « no README » sur sa page — défaut en soi ; et
 *              un corpus rétréci (registre qui rend moins, `private` posé par erreur, fichier
 *              déplacé) est le mode d'échec par lequel cette gate sortirait VERTE en n'ayant
 *              rien lu. Sortie 2 : refus de conclure, pas verdict.
 *   NPMDOC-03  le scaffold `_plugin-template/README.template.md` a été lu. C'est le SEUL chemin
 *              en dur du fichier, et il l'est pour la raison déjà écrite dans
 *              `lib/tsdoc-examples.cjs#productDocsFiles` : hors des globs `workspaces`
 *              (`!packages/_*`), donc invisible au registre. `create-plugin.cjs` ne l'émet
 *              jamais — il sert de MODÈLE recopié à la main, ce qui en fait le canal de
 *              contagion, pas son absence. Sortie 2 s'il a pourri.
 *
 * ⚠️ **La frontière est `private`, pas une liste.** Le jour où un paquet privé devient
 * publiable, son README entre dans le périmètre le même jour — c'est voulu, et
 * `packages/libs/host-runtime/README.md` en porte une aujourd'hui, hors périmètre. Si cette
 * gate rougit soudain sur des lignes qu'aucun commit n'a touchées, chercher un `private`
 * retiré avant de suspecter la gate.
 *
 * 🛑 **Ne PAS câbler cette gate dans `probe-gate-visibility.cjs`.** La sonde plante son paquet
 * témoin avec `private: true` : une gate à périmètre `publishable()` y est STRUCTURELLEMENT
 * invisible, et la sonde ne pourrait que rapporter un faux « aveugle ». Rendre le témoin
 * publiable pour la satisfaire le ferait entrer dans le périmètre des gates de licence et de
 * publication — un remède pire que le mal. L'anti-cécité vit donc ICI, en NPMDOC-02/03.
 *
 * Usage : node scripts/verify-npm-readme-render.cjs
 * Sortie : 0 propre · 1 alerte trouvée · 2 périmètre non concluant.
 */

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const C = { red: "\x1b[31m", green: "\x1b[32m", dim: "\x1b[2m", bold: "\x1b[1m", x: "\x1b[0m" };

/** Voir NPMDOC-03 pour le motif de ce littéral — le seul du fichier. */
const SCAFFOLD_README = path.join(ROOT, "packages", "_plugin-template", "README.template.md");

/** Le marqueur d'alerte, sous toutes les formes que npm rend en texte littéral. */
const ALERT_RE = /\[!\s*(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\s*\]/i;

/** Ouverture / fermeture d'un bloc clôturé (CommonMark : au plus 3 espaces d'indentation). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** @param {string} abs @returns {string} chemin relatif à la racine, en séparateurs POSIX */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/**
 * Relève les alertes GitHub d'un `.md`, en sautant les blocs clôturés.
 * Un marqueur de fermeture doit être du même caractère et au moins aussi long que l'ouvrant.
 *
 * @param {string} abs Chemin absolu du fichier.
 * @returns {{ line: number, type: string, text: string }[]}
 */
function scanReadme(abs) {
    const found = [];
    let fence = null;

    fs.readFileSync(abs, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
            const f = FENCE_RE.exec(line);
            if (f) {
                if (fence === null) {
                    fence = f[1];
                    return;
                }
                if (f[1][0] === fence[0] && f[1].length >= fence.length) {
                    fence = null;
                    return;
                }
            }
            if (fence !== null) return;

            const hit = ALERT_RE.exec(line);
            if (hit) found.push({ line: i + 1, type: hit[1].toUpperCase(), text: line.trim() });
        });

    return found;
}

// ── Le corpus ────────────────────────────────────────────────────────────────

/** @type {string[]} NPMDOC-02 / NPMDOC-03 — refus de conclure. */
const blind = [];
/** @type {{ abs: string, rel: string, owner: string }[]} */
const corpus = [];

const publishable = registry.publishable();

for (const pkg of publishable) {
    const abs = path.join(pkg.absDir, "README.md");
    if (!fs.existsSync(abs)) {
        blind.push(
            `NPMDOC-02 ${pkg.dir}/README.md — ABSENT alors que ${pkg.name} est publiable.\n` +
                `        ${C.dim}Sa page npm afficherait « no README ». Écrire le README, ` +
                `ou passer le paquet en \`private: true\` s'il n'a rien à faire au registre.${C.x}`
        );
        continue;
    }
    corpus.push({ abs, rel: rel(abs), owner: pkg.name });
}

if (!fs.existsSync(SCAFFOLD_README)) {
    blind.push(
        `NPMDOC-03 ${rel(SCAFFOLD_README)} — INTROUVABLE.\n` +
            `        ${C.dim}C'est le seul chemin en dur de cette gate (le scaffold est hors ` +
            `des globs workspaces). S'il a déménagé, mettre CE chemin à jour — ne pas retirer ` +
            `la règle : le modèle recopié à la main dans chaque nouveau plugin cesserait ` +
            `d'être lu.${C.x}`
    );
} else {
    corpus.push({
        abs: SCAFFOLD_README,
        rel: rel(SCAFFOLD_README),
        owner: "scaffold (_plugin-template)",
    });
}

// ── NPMDOC-02 — le scan n'est pas vide ───────────────────────────────────────
//
// 🛑 SANS CE BLOC, CETTE GATE EST DÉCORATIVE. Un registre qui rend moins de paquets, un README
// déplacé, un `private` posé par erreur : dans les trois cas, zéro alerte trouvée, et un vert.
// Une garde jamais vue rouge ne garde rien ; une garde qui ne PEUT pas rougir non plus.
if (publishable.length === 0) {
    blind.push(
        `NPMDOC-02 — \`registry.publishable()\` n'a rendu AUCUN paquet. Le registre ne voit ` +
            `plus rien, ou tout le dépôt est passé \`private\`. Le scan n'a rien couvert.`
    );
}
if (corpus.length === 0) {
    blind.push(`NPMDOC-02 — corpus VIDE. Un verdict sur zéro fichier n'est pas un verdict.`);
}

if (blind.length) {
    console.error(`\n${C.red}${C.bold}✖ NPM-README — périmètre non concluant${C.x}\n`);
    for (const b of blind) console.error(`  ${C.red}•${C.x} ${b}`);
    console.error("");
    process.exit(2);
}

// ── NPMDOC-01 — aucune alerte GitHub ─────────────────────────────────────────

const errors = [];

for (const file of corpus) {
    for (const hit of scanReadme(file.abs)) {
        const label = hit.type[0] + hit.type.slice(1).toLowerCase();
        errors.push(
            `NPMDOC-01 ${file.rel}:${hit.line} — alerte GitHub \`[!${hit.type}]\`.\n` +
                `        ${C.dim}${hit.text}${C.x}\n` +
                `        ${C.dim}npmjs.com ne rend pas cette syntaxe : le marqueur s'affiche ` +
                `en texte littéral sur la page du paquet. Écrire \`> **${label}** — …\`.${C.x}`
        );
    }
}

// ── Verdict — décomptes DÉRIVÉS, jamais recopiés en prose ────────────────────

const scanned = `${corpus.length} README (${publishable.length} paquets publiés + le scaffold)`;

if (errors.length) {
    console.error(`\n${C.red}${C.bold}✖ NPM-README — ${errors.length} alerte(s) GitHub${C.x}\n`);
    for (const e of errors) console.error(`  ${C.red}•${C.x} ${e}`);
    console.error(`\n  ${C.dim}Scanné : ${scanned}${C.x}\n`);
    process.exit(1);
}

console.log(
    `${C.green}✔ NPM-README${C.x} : aucune alerte GitHub dans les README publiés — ` +
        `3 invariants tenus (alertes, README de chaque paquet publiable, scaffold lu).\n` +
        `  ${C.dim}Scanné : ${scanned}${C.x}`
);
