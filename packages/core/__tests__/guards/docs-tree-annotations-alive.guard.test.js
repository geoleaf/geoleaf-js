/**
 * @file docs-tree-annotations-alive.guard.test.js
 * @description Test-garde — toute clé de `scripts/docs-tree-annotations.json` désigne un
 * répertoire qui EXISTE.
 *
 * Pourquoi ce garde existe (B-26, 29/07/2026)
 * -------------------------------------------
 * `generate-docs-tree.cjs` annote l'arborescence générée à partir de ce fichier : une clé = un
 * répertoire, une valeur = le régime de maintenance qu'on lui reconnaît. C'est ce qui fait passer
 * l'arbre de « liste de chemins » à « arbre qualifié ».
 *
 * Une clé dont le répertoire a disparu ne provoque **rien** : le générateur ne la rencontre jamais,
 * ne s'en plaint pas, et l'arbre sort identique. Mesuré à la fermeture de B-26 : **39 clés mortes
 * sur 126**, dont tout un sous-arbre `src/modules/built-in/` dissous depuis l'ARCHI S10.1. Leur
 * retrait n'a **rien changé** à la sortie du générateur (1105/1150 qualifiés avant comme après) —
 * ce qui est exactement la preuve qu'elles étaient mortes, et la raison pour laquelle personne ne
 * pouvait s'en apercevoir.
 *
 * ## Pourquoi c'est plus qu'un fichier en désordre
 *
 * Ces annotations sont le **vocabulaire** avec lequel le dépôt décrit sa propre structure. Une clé
 * morte n'est pas seulement inutile : elle donne à croire qu'un répertoire est qualifié alors qu'il
 * n'existe plus, et elle survit d'autant plus longtemps que le fichier est long. C'est la même
 * classe que les arbres écrits à la main (B-33) — une description qui ne suit pas ce qu'elle décrit.
 *
 * ⚠️ Le sens inverse n'est PAS gardé, et c'est délibéré : un répertoire sans annotation est le cas
 * NORMAL (45 le sont aujourd'hui). Le générateur les compte et les affiche ; c'est son rôle, pas
 * celui d'un test.
 *
 * ## Une garde jamais vue rouge ne garde rien
 *
 * Une assertion anti-garde-vide : au moins une clé lue. Sans elle, un fichier renommé ou une
 * structure JSON changée rendrait ce garde vert en n'ayant rien vérifié.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ANNOTATIONS = path.join(REPO_ROOT, "scripts/docs-tree-annotations.json");

/**
 * Les clés annotées. Aucun repli silencieux : si le fichier ou sa forme disparaît, le garde jette
 * avec le chemin en clair — un `{}` par accident le rendrait vert sur un corpus vide.
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
                `seulement à croire que ce répertoire est qualifié. La retirer. (B-26)`
        );
        expect(dead, dead.join("\n")).toEqual([]);
    });
});
