#!/usr/bin/env node
/**
 * The boundary between the WORKSHOP and what ships to the public.
 *
 * This module answers a single question — "does this tracked path ship to the public
 * repo?" — and it carries the `.gitignore` text that prevents reintroduction on the clone
 * side.
 *
 * ## Why the patterns are DATA and not a derivation
 *
 * Everything else in this repo derives its lists (`packages.cjs`, and the seven places
 * where the package list had diverged). Not here: a publication boundary is a
 * **decision**, and deriving it would make it depend on a side effect. It is exactly the
 * arbitration written in `publish-plugins.cjs` for `PUBLISHED_PLUGINS` — widening an
 * external surface is decided, not observed. The four patterns below are therefore
 * written by hand.
 *
 * What IS derived, however, is the **check**: a pattern that no longer matches anything
 * THROWS (see {@link assertPartitionSane}). Without it, a renamed `_docs_projet/` would
 * go green while removing nothing, and the workshop would ship to the public — the
 * blindness class `probe-gate-visibility.cjs` watches everywhere else.
 *
 * ## Why these patterns are NOT anchored, deliberately
 *
 * `CLAUDE.md` is read by its harness in **any** sub-directory: an anchored pattern
 * (`/CLAUDE.md`) would let `packages/core/CLAUDE.md` through — the most likely shape of
 * a reintroduction. Measured when laying the rule on 2026-08-10, and re-measured on
 * 08-11: 0 other `CLAUDE.md`, 0 other `_docs_projet`, 0 other `.claude` in the tree —
 * the generic form swallows nothing today, and it covers the case where there would be
 * one tomorrow. The fourth is anchored by its slash alone, and that suffices: that file
 * is only read at the root.
 *
 * ## Why this file is not a `.gitignore` of the working repo
 *
 * These patterns are right **in the clone** and harmful **here**: `_docs_projet/` is
 * tracked here, so the rule would be inert on the existing files but active on new ones —
 * every new report would silently stop being versioned. The text therefore lives here as
 * a script's data, and is only written into the clone.
 *
 * ⚠️ Until 2026-08-11 it lived **outside the repo**, in `~/.claude/geoleaf-nuit/`. A port
 * that failed to find it reintroduced 39 workshop files with nothing turning red; and
 * since the clone is ephemeral, the only copy of the text was on one machine. That
 * repatriation is what makes the port reproducible.
 *
 * Usage :
 *   const partition = require("./lib/public-partition.cjs");
 *   partition.isInternal("CLAUDE.md");        // true
 *   partition.split(trackedFiles);            // { publicFiles, internalFiles, byPattern }
 */

"use strict";

/**
 * The four internal-apparatus patterns, in the `.gitignore` form they take on the clone
 * side.
 *
 * `dir: true` designates a directory (the pattern matches the path prefix); otherwise the
 * pattern matches a **file name** at any depth, unless it contains a slash, in which case
 * it is anchored at the root.
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
 * Plausibility floor of the ported batch.
 *
 * ⚠️ This is not superstition: it is the only guard against a `git ls-files` returning
 * little or nothing (wrong working directory, uninitialized repo, over-wide filter).
 * Without it the port would overwrite the public clone with a handful of files **while
 * exiting 0** — the exact shape of the "green that scanned nothing" `packages.cjs`
 * documents. Measured on 2026-08-11: 2,413 tracked files, of which 39 internal, hence
 * 2,374 ported.
 */
const MIN_PUBLIC_FILES = 2000;

/**
 * Does this tracked path belong to the internal apparatus?
 *
 * @param {string} relPath Repo-relative path, POSIX separators (`git ls-files` form).
 * @returns {{internal: boolean, pattern?: string}} The pattern that bit, for the tally.
 */
function classify(relPath) {
    for (const { pattern, dir } of INTERNAL_PATTERNS) {
        const bare = dir ? pattern.slice(0, -1) : pattern;

        if (dir) {
            // Unanchored: `_docs_projet/` also bites `packages/x/_docs_projet/y.md`.
            if (relPath === bare || relPath.startsWith(`${bare}/`) || relPath.includes(`/${bare}/`))
                return { internal: true, pattern };
            continue;
        }

        if (bare.includes("/")) {
            // Anchored by its slash — that file is only read at this location.
            if (relPath === bare) return { internal: true, pattern };
            continue;
        }

        // File name, at any depth: that is the `CLAUDE.md` case.
        if (relPath === bare || relPath.endsWith(`/${bare}`)) return { internal: true, pattern };
    }
    return { internal: false };
}

/**
 * Boolean shortcut of {@link classify}.
 *
 * @param {string} relPath Repo-relative path, POSIX separators.
 * @returns {boolean}
 */
function isInternal(relPath) {
    return classify(relPath).internal;
}

/**
 * Splits a tracked-file list into "ships to the public" / "stays in the workshop".
 *
 * @param {string[]} trackedFiles `git ls-files` output, repo-relative POSIX paths.
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
 * Throws if the partition did not bite the way it must.
 *
 * Two distinct failures, and the second is the dangerous one:
 *   1. the public batch is below the floor — we were about to overwrite the clone with
 *      nothing;
 *   2. **a pattern removed nothing** — the directory was renamed, or `git ls-files` does
 *      not see what we think. A partition that removes nothing lets the workshop ship
 *      **while exiting green**, and that is precisely what no downstream gate will see.
 *
 * @param {{publicFiles: string[], internalFiles: string[], byPattern: Map<string, string[]>}} parts
 * @throws {Error} On either.
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
 * The block to append to the clone's `.gitignore`.
 *
 * It is **appended at the tail**, never merged with the rules inherited from the working
 * repo: those describe the proper hygiene of `.claude/` and `_docs_projet/` (runtime
 * state, regenerable outputs), which stays true where those directories keep living. A
 * redundant rule costs one line; a rule deleted because it was believed moot costs the
 * day its object comes back.
 *
 * @returns {string} `.gitignore` fragment, newline-terminated.
 */
function gitignoreFragment() {
    const rules = INTERNAL_PATTERNS.map(
        ({ pattern, why }) => `${pattern}${" ".repeat(Math.max(1, 34 - pattern.length))}# ${why}`
    );
    return [
        "",
        "# ─── Appareil INTERNE — la frontière de ce dépôt ─────────────────────────────",
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
