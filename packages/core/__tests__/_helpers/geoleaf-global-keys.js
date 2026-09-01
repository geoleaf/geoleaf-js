/**
 * @file geoleaf-global-keys.js
 * @description SHARED reader of `interface GeoLeafGlobal` (`packages/core/src/global.d.ts`).
 *
 * ## Pourquoi ce helper existe
 *
 * Two guards read the same interface, and for symmetric questions:
 * `plugin-namespace-declared.guard.test.js` verifies that every namespace
 * WRITTEN by a plugin is declared there;
 * `namespace-local-views.guard.test.js` verifies that every member READ by
 * a local view is declared there. Two copies of a reader drift, and the
 * drift is invisible while both guards come out green — the rule already
 * written in `scripts/lib/ts-decl-read.cjs`, and it holds here for the same
 * reason.
 *
 * ## Why the AST and not brace counting
 *
 * The first reader counted braces and recognised members with a
 * line-by-line regular expression. That works, and it breaks silently on
 * three shapes the file may take at any moment: a brace in a comment or a
 * string falsifies the depth, a member written over two lines escapes the
 * pattern, and a quoted name too. None of these failures returns an error —
 * they return an INCOMPLETE set, hence a guard that exempts instead of
 * refusing. The AST makes the class structurally impossible.
 *
 * ⚠️ This module NEVER returns an empty set: every read-failure cause
 * throws. A guard comparing its subject to an empty set agrees perfectly
 * with itself and proves nothing.
 */
import fs from "node:fs";
import ts from "typescript";

/**
 * Reads the first-level property names of `interface GeoLeafGlobal`.
 *
 * @param {string} globalDtsPath - Absolute path to `packages/core/src/global.d.ts`.
 * @returns {Set<string>} The declared member names — never empty.
 * @throws {Error} When the interface is missing, empty, or carries an `extends` clause.
 */
export function readGeoLeafGlobalKeys(globalDtsPath) {
    const text = fs.readFileSync(globalDtsPath, "utf8");
    const sf = ts.createSourceFile(globalDtsPath, text, ts.ScriptTarget.ES2022, true);

    let found = null;
    const visit = (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === "GeoLeafGlobal") found = node;
        ts.forEachChild(node, visit);
    };
    visit(sf);

    if (!found) {
        throw new Error(
            "`interface GeoLeafGlobal` introuvable dans global.d.ts — elle a été renommée. " +
                "Re-pointer les gardes qui la lisent, ne pas les assouplir : sortir vert ici " +
                "signifierait « aucun membre à vérifier »."
        );
    }
    // ⚠️ `extends` makes the read REFUSE: this function only iterates
    // `node.members`, so an inherited member is invisible to it and would
    // vanish from the set with nothing saying so.
    if (found.heritageClauses?.length) {
        throw new Error(
            "`GeoLeafGlobal` porte une clause `extends` — les membres hérités sont invisibles à " +
                "ce lecteur. Étendre le lecteur AVANT d'étendre l'interface."
        );
    }

    const keys = new Set();
    for (const m of found.members) {
        // Index signatures name nothing: ignoring them is the wanted behaviour.
        if (!m.name) continue;
        keys.add(m.name.getText(sf).replace(/^["']|["']$/g, ""));
    }
    if (keys.size === 0) {
        throw new Error("`GeoLeafGlobal` ne déclare aucun membre nommé — lecture refusée.");
    }
    return keys;
}
