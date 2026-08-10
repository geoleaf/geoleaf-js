/*!
 * Extraction des `@example` du TSDoc — moteur PARTAGÉ.
 *
 * Écrit pour B-44 dans `typecheck-docs-examples.cjs`, extrait ici le 30/07/2026 quand
 * `validate-docs-examples.cjs` a eu besoin du même corpus (B-75). Le recopier aurait créé
 * deux extracteurs à faire diverger — exactement le défaut que cette refonte combat, un
 * étage plus bas.
 *
 * ⚠️ **Deux formes coexistent dans ce dépôt**, mesurées le 27/07/2026 : **37 blocs
 * clôturés** (une fence ` ```ts ` à l'intérieur du bloc TSDoc) et **81 bruts** (le code
 * directement après le tag). Les deux sont traitées ; un corps clôturé ne garde que
 * l'intérieur de la fence, donc les backticks n'atteignent jamais le consommateur.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Fichiers hors périmètre : un test documente son intention, pas une API.
 *
 * ⚠️ **Les `.d.ts` ne sont PLUS exclus depuis le 31/07/2026 (B-80).** Ils l'étaient, et c'était
 * le dernier trou du régime que la refonte V3 a fermé partout ailleurs : `global.d.ts` porte
 * `GeoLeafGlobal`, c'est-à-dire la surface `GeoLeaf.*` que l'intégrateur lit en premier, et ses
 * `@example` étaient **rendus par TypeDoc sans jamais être compilés**.
 *
 * L'exclusion se justifiait par « un `.d.ts` n'a pas de corps, l'inclure ferait entrer des
 * déclarations dans le programme de test ». **C'est faux, et c'est vérifiable** : ce module ne
 * fait que LIRE les fichiers pour en extraire le texte des `@example`. Chez son consommateur
 * `typecheck-docs-examples.cjs`, chaque exemple part dans son propre fichier temporaire sous
 * `TMP_DIR`, et le tsconfig généré porte `include: ["*.ts"]` **relatif à ce répertoire**. Le
 * `.d.ts` source n'entre donc jamais dans le programme vérifié.
 */
const EXCLUDED = /(\/__tests__\/|\/__mocks__\/|\.test\.ts$|\.spec\.ts$)/;

/**
 * Extrait les corps d'`@example` du TSDoc d'un fichier source.
 *
 * @param {string} content - Le texte du fichier.
 * @returns {{ code: string, startLine: number }[]} un élément par `@example` non vide.
 */
function extractTsdocExamples(content) {
    const out = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*\*\s*@example\b/.test(lines[i])) continue;
        const body = [];
        let j = i + 1;
        let inFence = false;
        let sawFence = false;
        for (; j < lines.length; j++) {
            const raw = lines[j];
            if (/^\s*\*\//.test(raw)) break; // fin du bloc TSDoc
            const stripped = raw.replace(/^\s*\*\s?/, "");
            if (/^\s*```/.test(stripped)) {
                if (inFence) {
                    inFence = false;
                    break;
                }
                inFence = true;
                sawFence = true;
                continue;
            }
            if (/^\s*@\w+/.test(stripped) && !inFence) break; // tag suivant
            if (!sawFence || inFence) body.push(stripped);
        }
        const code = body.join("\n").trim();
        if (code) out.push({ code, startLine: i + 1 });
        i = j;
    }
    return out;
}

/** Marche récursive, `.ts` seulement. */
function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name.endsWith(".ts")) out.push(full);
    }
    return out;
}

/**
 * Les fichiers source de tous les paquets du registre, hors tests.
 *
 * ⚠️ Le périmètre vient du REGISTRE, jamais d'un `packages/<nom>` en dur : un chemin en dur
 * ne casse pas au déplacement, il cesse silencieusement de matcher, et le consommateur
 * sortirait vert en n'ayant rien scanné.
 *
 * @returns {string[]} chemins absolus, triés — le tri rend toute sortie dérivée stable.
 * @throws {Error} si le registre ne rend aucun fichier source.
 */
function sourceFiles() {
    const registry = require("./packages.cjs");
    const out = [];
    for (const pkg of registry.all()) {
        const src = path.join(pkg.absDir, "src");
        if (fs.existsSync(src)) walk(src, out);
    }
    const kept = out.filter((f) => !EXCLUDED.test(f.replace(/\\/g, "/"))).sort();
    if (kept.length === 0) {
        throw new Error(
            "[tsdoc-examples] le registre ne rend aucun fichier source — le corpus des " +
                "`@example` serait vide, et son consommateur sortirait vert sans rien avoir lu."
        );
    }
    return kept;
}

/** Marche récursive, `.md` seulement, `node_modules/` sauté. `maxDepth` 0 = ce répertoire seul. */
function walkMd(dir, out, maxDepth = Infinity) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (maxDepth > 0) walkMd(full, out, maxDepth - 1);
        } else if (e.name.endsWith(".md")) out.push(full);
    }
    return out;
}

/**
 * Le markdown des SURFACES PRODUIT — corpus partagé des deux gates d'exemples.
 *
 * ## Pourquoi il vit ici et pas dans chaque gate (31/07/2026)
 *
 * `validate-docs-examples` et `typecheck-docs-examples` lisaient chacune `packages/core/docs`
 * par un `path.join` qui leur était propre. Tant que le périmètre valait un seul répertoire,
 * la duplication ne coûtait rien ; l'élargir dans deux fichiers en aurait fait deux périmètres
 * libres de diverger. **B-80 a déjà prouvé cette panne un étage plus bas** : l'exclusion des
 * `.d.ts` vivait à deux endroits, on n'en a corrigé qu'un, et une gate est restée aveugle.
 * Même cause, même remède que pour `sourceFiles()` — un seul corpus, deux consommateurs.
 *
 * ## Ce que « surface produit » veut dire, et ce que ça exclut
 *
 * Ce que le corpus contient est ce qu'un lecteur peut **copier-coller depuis npm ou GitHub** :
 * la racine du dépôt, la racine de chaque paquet (les vitrines npm), les `docs/` de paquet, et
 * le scaffold. C'est le trou mesuré le 31/07 : les deux documents les plus lus du projet —
 * `README.md` et `packages/core/README.md` — portaient chacun un `GeoLeaf.POI.add()`
 * copiable-collable sur une API dissoute, alors qu'une règle de `validate-docs-examples`
 * l'interdit **depuis l'item 4 de la refonte V3**. La règle était bonne ; son corpus s'arrêtait
 * à `packages/core/docs/`.
 *
 * Sont hors périmètre, et c'est délibéré :
 *   `_docs_projet/`        doc interne, pas une surface publiée ; ses classes sont gardées par
 *                          `doc-capability-config` et `doc-plugin-manifest`
 *   `.github/`, `e2e/`     0 bloc de code mesuré pour le premier, contributeur-facing pour le
 *                          second — les deux restent gatés en LIENS par `check-dead-links`
 *   `archives/`            des enregistrements : ils citent le code de leur date
 *
 * @returns {string[]} chemins absolus, triés.
 * @throws {Error} si le corpus est vide, ou si un `README.md` présent sur le disque en est absent.
 */
function productDocsFiles() {
    const registry = require("./packages.cjs");
    const repoRoot = path.resolve(__dirname, "..", "..");
    const out = [];

    walkMd(repoRoot, out, 0); // racine du dépôt — README, CONTRIBUTING, CHANGELOG, CLAUDE
    for (const pkg of registry.all()) {
        walkMd(pkg.absDir, out, 0); // la vitrine npm du paquet
        walkMd(path.join(pkg.absDir, "docs"), out); // sa doc embarquée
    }
    // Hors `workspaces` (`!packages/_*`), donc invisible au registre. Nommé en dur pour
    // cette raison précise : c'est le SCAFFOLD, et un défaut qu'il porte est re-semé dans
    // chaque plugin créé après lui.
    walkMd(path.join(repoRoot, "packages", "_plugin-template"), out);

    const kept = [...new Set(out)].sort();
    if (kept.length === 0) {
        throw new Error(
            "[tsdoc-examples] corpus de doc produit vide — le consommateur sortirait vert " +
                "sans avoir lu un seul document."
        );
    }
    // Anti-cécité : l'oracle est le disque, la chose testée est la construction du corpus.
    // Un `path.join` faux laisse le fichier en place et hors du scan, et la gate sort verte.
    const missing = registry
        .all()
        .map((p) => path.join(p.absDir, "README.md"))
        .filter((f) => fs.existsSync(f) && !kept.includes(f));
    if (missing.length > 0) {
        throw new Error(
            `[tsdoc-examples] ${missing.length} README.md sur le disque hors du corpus : ` +
                missing.map((f) => path.relative(repoRoot, f)).join(", ")
        );
    }
    return kept;
}

module.exports = { extractTsdocExamples, sourceFiles, productDocsFiles, EXCLUDED };
