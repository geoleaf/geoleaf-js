#!/usr/bin/env node
/**
 * La frontière entre l'ATELIER et ce qui part au public (roadmap `passage-public-npm`, S9.4).
 *
 * Ce module répond à une seule question — « ce chemin suivi part-il dans le dépôt public ? » —
 * et il porte le texte du `.gitignore` qui empêche la réintroduction côté clone.
 *
 * ## Pourquoi les motifs sont une DONNÉE et pas une dérivation
 *
 * Tout le reste de ce dépôt dérive ses listes (`packages.cjs`, et les sept endroits où la liste
 * des paquets avait divergé). Ici, non : une frontière de publication est une **décision**, et
 * la dériver la rendrait dépendante d'un effet de bord. C'est exactement l'arbitrage écrit dans
 * `publish-plugins.cjs` pour `PUBLISHED_PLUGINS` — élargir une surface externe se décide, ça ne
 * se constate pas. Les quatre motifs ci-dessous sont donc écrits à la main.
 *
 * Ce qui EST dérivé, en revanche, c'est le **contrôle** : un motif qui ne matche plus rien fait
 * JETER (voir {@link assertPartitionSane}). Sans lui, un `_docs_projet/` renommé sortirait vert
 * en ne retirant plus rien, et l'atelier partirait au public — la classe de cécité que
 * `probe-gate-visibility.cjs` surveille partout ailleurs.
 *
 * ## Pourquoi ces motifs ne sont PAS ancrés, délibérément
 *
 * `CLAUDE.md` est lu par son harnais dans **n'importe quel** sous-répertoire : un motif ancré
 * (`/CLAUDE.md`) laisserait passer `packages/core/CLAUDE.md`, c'est-à-dire la forme la plus
 * probable de la réintroduction. Mesuré en posant la règle le 10/08/2026, et re-mesuré le
 * 11/08 : 0 autre `CLAUDE.md`, 0 autre `_docs_projet`, 0 autre `.claude` dans l'arbre — le
 * générique n'avale rien aujourd'hui, et il couvre le cas où il y en aurait un demain.
 * Le quatrième est ancré par sa seule barre oblique, et ça suffit : ce fichier n'est lu qu'à
 * la racine.
 *
 * ## Pourquoi ce fichier n'est pas un `.gitignore` du dépôt de travail
 *
 * Ces motifs sont justes **dans le clone** et nuisibles **ici** : `_docs_projet/` y est suivi,
 * donc la règle serait inerte sur l'existant mais active sur les fichiers neufs — tout nouveau
 * rapport cesserait silencieusement d'être versionné. Le texte vit donc ici comme donnée d'un
 * script, et n'est écrit que dans le clone.
 *
 * ⚠️ Il a vécu jusqu'au 11/08/2026 **hors du dépôt**, dans `~/.claude/geoleaf-nuit/`. Un portage
 * qui ne le retrouvait pas réintroduisait 39 fichiers d'atelier sans que rien ne rougisse ; et
 * comme le clone est éphémère, la seule copie du texte était sur un poste. C'est ce rapatriement
 * qui rend le portage reproductible.
 *
 * Usage :
 *   const partition = require("./lib/public-partition.cjs");
 *   partition.isInternal("CLAUDE.md");        // true
 *   partition.split(trackedFiles);            // { publicFiles, internalFiles, byPattern }
 */

"use strict";

/**
 * Les quatre motifs d'appareil interne, dans la forme `.gitignore` qu'ils prennent côté clone.
 *
 * `dir: true` désigne un répertoire (le motif matche le préfixe de chemin) ; sinon le motif
 * matche un **nom de fichier** à n'importe quelle profondeur, sauf s'il contient une barre
 * oblique, auquel cas il est ancré à la racine.
 */
const INTERNAL_PATTERNS = [
    {
        pattern: "_docs_projet/",
        dir: true,
        why: "l'atelier — journal, état, registres, roadmaps, rapports",
    },
    {
        pattern: "CLAUDE.md",
        dir: false,
        why: "instructions du harnais, lues dans n'importe quel sous-répertoire",
    },
    { pattern: ".claude/", dir: true, why: "commandes et réglages du harnais" },
    {
        pattern: ".github/copilot-instructions.md",
        dir: false,
        why: "appareil interne pur — six lignes qui disent de lire CLAUDE.md",
    },
];

/**
 * Plancher de vraisemblance du lot porté.
 *
 * ⚠️ Ce n'est pas une superstition : c'est le seul garde-fou contre un `git ls-files` qui
 * rendrait peu ou rien (mauvais répertoire de travail, dépôt non initialisé, filtre trop
 * large). Sans lui le portage écraserait le clone public avec une poignée de fichiers **en
 * sortant 0** — la forme exacte du « vert qui n'a rien scanné » que `packages.cjs` documente.
 * Mesuré le 11/08/2026 : 2 413 fichiers suivis, dont 39 internes, soit 2 374 portés.
 */
const MIN_PUBLIC_FILES = 2000;

/**
 * Ce chemin suivi appartient-il à l'appareil interne ?
 *
 * @param {string} relPath Chemin repo-relatif, séparateurs POSIX (forme `git ls-files`).
 * @returns {{internal: boolean, pattern?: string}} Le motif qui a mordu, pour le décompte.
 */
function classify(relPath) {
    for (const { pattern, dir } of INTERNAL_PATTERNS) {
        const bare = dir ? pattern.slice(0, -1) : pattern;

        if (dir) {
            // Non ancré : `_docs_projet/` mord aussi `packages/x/_docs_projet/y.md`.
            if (relPath === bare || relPath.startsWith(`${bare}/`) || relPath.includes(`/${bare}/`))
                return { internal: true, pattern };
            continue;
        }

        if (bare.includes("/")) {
            // Ancré par sa barre oblique — ce fichier n'est lu qu'à cet emplacement.
            if (relPath === bare) return { internal: true, pattern };
            continue;
        }

        // Nom de fichier, à n'importe quelle profondeur : c'est le cas `CLAUDE.md`.
        if (relPath === bare || relPath.endsWith(`/${bare}`)) return { internal: true, pattern };
    }
    return { internal: false };
}

/**
 * Raccourci booléen de {@link classify}.
 *
 * @param {string} relPath Chemin repo-relatif, séparateurs POSIX.
 * @returns {boolean}
 */
function isInternal(relPath) {
    return classify(relPath).internal;
}

/**
 * Partager une liste de fichiers suivis en « part au public » / « reste à l'atelier ».
 *
 * @param {string[]} trackedFiles Sortie de `git ls-files`, chemins repo-relatifs POSIX.
 * @returns {{publicFiles: string[], internalFiles: string[], byPattern: Map<string, string[]>}}
 */
function split(trackedFiles) {
    /** @type {string[]} */
    const publicFiles = [];
    /** @type {string[]} */
    const internalFiles = [];
    /** @type {Map<string, string[]>} */
    const byPattern = new Map(INTERNAL_PATTERNS.map(({ pattern }) => [pattern, []]));

    for (const file of trackedFiles) {
        const { internal, pattern } = classify(file);
        if (internal) {
            internalFiles.push(file);
            byPattern.get(pattern).push(file);
        } else {
            publicFiles.push(file);
        }
    }

    return { publicFiles, internalFiles, byPattern };
}

/**
 * Jeter si la partition n'a pas mordu comme elle le doit.
 *
 * Deux échecs distincts, et le second est le dangereux :
 *   1. le lot public est sous le plancher — on s'apprêtait à écraser le clone avec rien ;
 *   2. **un motif n'a rien retiré** — le répertoire a été renommé, ou le `git ls-files` ne
 *      voit pas ce qu'on croit. Une partition qui ne retire rien laisse partir l'atelier
 *      **en sortant vert**, et c'est précisément ce qu'aucune gate en aval ne verra.
 *
 * @param {{publicFiles: string[], internalFiles: string[], byPattern: Map<string, string[]>}} parts
 * @throws {Error} Sur l'un ou l'autre.
 */
function assertPartitionSane(parts) {
    if (parts.publicFiles.length < MIN_PUBLIC_FILES) {
        throw new Error(
            `public-partition: seulement ${parts.publicFiles.length} fichier(s) à porter, ` +
                `plancher ${MIN_PUBLIC_FILES}. Un lot aussi maigre signifie un git ls-files ` +
                `qui n'a pas lu ce qu'on croit — REFUS avant d'écraser le clone public.`
        );
    }

    const barren = [...parts.byPattern.entries()].filter(([, files]) => files.length === 0);
    if (barren.length > 0) {
        throw new Error(
            `public-partition: ${barren.length} motif(s) n'ont retiré AUCUN fichier — ` +
                `${barren.map(([p]) => `"${p}"`).join(", ")}. ` +
                `Soit la cible a été renommée, soit elle n'est plus suivie. Une partition qui ` +
                `ne retire rien laisse partir l'atelier en sortant vert : corriger le motif ` +
                `dans scripts/lib/public-partition.cjs, ne pas contourner.`
        );
    }
}

/**
 * Le bloc à ajouter au `.gitignore` du clone.
 *
 * Il est **ajouté en queue**, jamais fusionné avec les règles héritées du dépôt de travail :
 * celles-ci décrivent l'hygiène propre de `.claude/` et `_docs_projet/` (état runtime, sorties
 * régénérables), qui reste vraie là où ces répertoires continuent de vivre. Une règle redondante
 * coûte une ligne ; une règle supprimée parce qu'on la croyait sans objet coûte le jour où
 * l'objet revient.
 *
 * @returns {string} Fragment `.gitignore`, terminé par un saut de ligne.
 */
function gitignoreFragment() {
    const rules = INTERNAL_PATTERNS.map(
        ({ pattern, why }) => `${pattern}${" ".repeat(Math.max(1, 34 - pattern.length))}# ${why}`
    );
    return [
        "",
        "# ─── Appareil INTERNE — la frontière de ce dépôt (S9.4) ──────────────────────",
        "#",
        "# Ce dépôt est dérivé du monorepo de travail, amputé de son appareil interne. La",
        "# liste n'est jamais recopiée d'un document : elle est DÉRIVÉE à chaque portage",
        "# par `scripts/lib/public-partition.cjs`, qui JETTE si un motif ne mord plus.",
        "#",
        "# ⚠️ Ces règles ne retirent rien : elles empêchent la RÉINTRODUCTION. Le retrait",
        "# est acquis par construction, ce dépôt ne portant que les fichiers que le",
        "# portage lui copie. Sans ces lignes, un `git add -A` lancé depuis une copie de",
        "# travail qui porte encore l'appareil les ferait entrer, et rien — aucune gate,",
        "# aucun test — ne le signalerait.",
        "#",
        "# ⚠️ Trois motifs sur quatre sont NON ancrés, délibérément : `CLAUDE.md` est lu",
        "# par son harnais dans N'IMPORTE QUEL sous-répertoire, donc un motif ancré",
        "# laisserait passer `packages/core/CLAUDE.md` — la forme la plus probable de la",
        "# réintroduction. Le quatrième est ancré par sa seule barre oblique, et ça",
        "# suffit : ce fichier n'est lu qu'à la racine.",
        ...rules,
        "",
    ].join("\n");
}

module.exports = {
    INTERNAL_PATTERNS,
    MIN_PUBLIC_FILES,
    classify,
    isInternal,
    split,
    assertPartitionSane,
    gitignoreFragment,
};
