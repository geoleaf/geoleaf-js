/**
 * @file docs-tree-annotations-alive.guard.test.js
 * @description Guard test — every key of `scripts/docs-tree-annotations.json`
 * designates a directory that EXISTS.
 *
 * Why this guard exists (29/07/2026)
 * -------------------------------------------
 * `generate-docs-tree.cjs` annotates the generated tree from this file: a
 * key = a directory, a value = the maintenance regime recognised for it.
 * What takes the tree from "path list" to "qualified tree".
 *
 * A key whose directory vanished causes **nothing**: the generator never
 * meets it, does not complain, and the tree comes out identical. Measured at
 * the work's closing: **39 dead keys out of 126**, including a whole
 * `src/modules/built-in/` subtree since dissolved. Their removal changed
 * **nothing** in the generator's output (1105/1150 qualified before as
 * after) — exactly the proof they were dead, and the reason nobody could notice.
 *
 * ## Why it is more than a messy file
 *
 * These annotations are the **vocabulary** with which the repo describes its
 * own structure. A dead key is not just useless: it suggests a directory is
 * qualified when it no longer exists, and it survives the longer the file
 * is. The same class as hand-written trees — a description that does not
 * follow what it describes.
 *
 * ⚠️ The reverse direction is NOT guarded, deliberately: an unannotated
 * directory is the NORMAL case (45 are today). The generator counts and
 * displays them; that is its role, not a test's.
 *
 * ## A guard never seen red guards nothing
 *
 * One anti-empty-guard assertion: at least one key read. Without it, a
 * renamed file or a changed JSON structure would make this guard green
 * having verified nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ANNOTATIONS = path.join(REPO_ROOT, "scripts/docs-tree-annotations.json");

/**
 * The annotated keys. No silent fallback: if the file or its shape vanishes,
 * the guard throws with the path in clear — an accidental `{}` would make it
 * green on an empty corpus.
 */
function readKeys() {
    if (!fs.existsSync(ANNOTATIONS)) {
        throw new Error(
            `docs-tree-annotations-alive.guard: ${ANNOTATIONS} introuvable. ` +
                `Si le fichier a été renommé, re-pointer ce garde — ne pas le neutraliser.`
        );
    }
    const parsed = JSON.parse(fs.readFileSync(ANNOTATIONS, "utf8"));
    const dirs = parsed.directories;
    if (!dirs || typeof dirs !== "object") {
        throw new Error(
            `docs-tree-annotations-alive.guard: pas d'objet \`directories\` dans ` +
                `scripts/docs-tree-annotations.json — la forme a changé, re-pointer ce garde.`
        );
    }
    return Object.keys(dirs);
}

const KEYS = readKeys();

describe("test-garde — les annotations d'arborescence désignent des répertoires vivants", () => {
    it("lit au moins une clé (sinon ce garde ne garde rien)", () => {
        expect(KEYS.length, "aucune clé dans `directories`").toBeGreaterThan(0);
    });

    it("chaque clé annotée désigne un répertoire qui existe", () => {
        const dead = KEYS.filter((k) => !fs.existsSync(path.join(REPO_ROOT, k))).map(
            (k) =>
                `scripts/docs-tree-annotations.json — \`${k}\` n'existe plus. Une annotation morte ` +
                `ne fait rien rougir et ne change pas la sortie du générateur : elle donne ` +
                `seulement à croire que ce répertoire est qualifié. La retirer.`
        );
        expect(dead, dead.join("\n")).toEqual([]);
    });
});
