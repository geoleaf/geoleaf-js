/**
 * @file doc-profile-examples.guard.test.js
 * @description Test-garde — les exemples de profil des docs NORMATIVES valident contre
 * `profiles/schemas/profile.schema.json`.
 *
 * Pourquoi ce garde existe (S5, optimisation KERNEL, 18/07/2026)
 * ---------------------------------------------------------------
 * `Files.taxonomyFile` a été retiré du contrat au Lot 2 (11/07) : purgé du schéma, des 9
 * profils et du loader, et son token est banni de `packages/core/src` par
 * `extracted-features.guard.test.js`. Mais **la doc normative, elle, n'était gardée par
 * rien** — `PROFILE_CONTRACT_SPEC.md` et `GUIDE_VALIDATION_PROFILS.md` ont continué à
 * prescrire `taxonomyFile` dans leurs exemples et leur whitelist. Le bloc `Files` étant en
 * `additionalProperties: false`, un intégrateur qui suivait la doc écrivait un profil que
 * `npm run validate:profiles` REJETAIT.
 *
 * Le token-ban ne pouvait pas couvrir ce cas : les docs mentionnent légitimement
 * `taxonomyFile` en prose historique (« la clé a été retirée »). On valide donc les
 * EXEMPLES contre le schéma — précis, et insensible à la prose.
 *
 * Portée volontairement étroite : uniquement les docs qui font autorité sur le contrat de
 * profil. Les archives (`_docs_projet/archives/**`) sont hors périmètre par construction.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

// La racine de la doc vient de `scripts/lib/docs-paths.cjs`, jamais d'un littéral :
// écrits en dur, ces trois chemins survivraient au déplacement du répertoire en ne
// matchant plus rien, et `existsSync` les ferait rougir sans dire pourquoi. Le module
// JETTE si sa racine est absente — la panne nomme alors sa cause.
const docsPaths = createRequire(import.meta.url)(
    path.join(REPO_ROOT, "scripts/lib/docs-paths.cjs")
);

/**
 * Docs faisant autorité sur la structure d'un profil. Ajouter ici toute nouvelle doc
 * normative. Chemins ABSOLUS, dérivés de la racine publique.
 */
const NORMATIVE_DOCS = [
    docsPaths.specs("contrats", "PROFILE_CONTRACT_SPEC.md"),
    docsPaths.reference("GUIDE_VALIDATION_PROFILS.md"),
    docsPaths.specs("CDC_kernel.md"),
];

const SCHEMA_PATH = path.join(REPO_ROOT, "profiles/schemas/profile.schema.json");

/**
 * Strips `//` line comments and trailing commas so annotated examples parse.
 * Docs annotate their reference blocks heavily (`// ⬤ déclaration des compagnons`), and a
 * strict JSON.parse would reject exactly the blocks that matter most. String literals are
 * tracked so a `//` inside `"https://…"` survives.
 */
function stripJsonAnnotations(source) {
    let out = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];

        if (inString) {
            out += ch;
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }
        if (ch === "/" && source[i + 1] === "/") {
            while (i < source.length && source[i] !== "\n") i += 1;
            out += "\n";
            continue;
        }
        out += ch;
    }

    // Trailing commas before a closing brace/bracket.
    return out.replace(/,(\s*[}\]])/g, "$1");
}

/** Extracts ```json fenced blocks, keeping the 1-based line where each block opens. */
function extractJsonBlocks(markdown) {
    const blocks = [];
    const lines = markdown.split(/\r?\n/);
    let open = null;
    let buffer = [];

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (open === null) {
            // `jsonc`/`json5` included on purpose: the most normative blocks are the
            // annotated ones, and matching only ```json skipped them in silence.
            if (/^\s*```(json|jsonc|json5)\s*$/i.test(line)) {
                open = i + 1;
                buffer = [];
            }
        } else if (/^\s*```\s*$/.test(line)) {
            blocks.push({ line: open, source: buffer.join("\n") });
            open = null;
        } else {
            buffer.push(line);
        }
    }
    return blocks;
}

/**
 * Finds every `Files` object in a parsed example, at any depth. Docs show `Files` both as a
 * bare fragment (`{ "Files": {…} }`) and nested inside a full profile.json.
 */
function collectFilesBlocks(value, found = []) {
    if (!value || typeof value !== "object") return found;
    if (Array.isArray(value)) {
        value.forEach((item) => collectFilesBlocks(item, found));
        return found;
    }
    if (value.Files && typeof value.Files === "object" && !Array.isArray(value.Files)) {
        found.push(value.Files);
    }
    Object.values(value).forEach((child) => collectFilesBlocks(child, found));
    return found;
}

describe("test-garde — les exemples `Files` des docs normatives valident contre profile.schema.json", () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
    const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
    const validateFiles = ajv.compile(schema.properties.Files);

    it("le schéma expose bien un bloc Files fermé (sinon ce garde ne garde rien)", () => {
        expect(schema.properties.Files).toBeDefined();
        expect(schema.properties.Files.additionalProperties).toBe(false);
        // La clé retirée au Lot 2 ne doit pas être réintroduite dans le schéma.
        expect(Object.keys(schema.properties.Files.properties)).not.toContain("taxonomyFile");
    });

    NORMATIVE_DOCS.forEach((absPath) => {
        const relPath = docsPaths.rel(absPath);
        describe(relPath, () => {
            it("existe (une doc normative renommée doit être re-déclarée ici)", () => {
                expect(fs.existsSync(absPath)).toBe(true);
            });

            if (!fs.existsSync(absPath)) return;

            const markdown = fs.readFileSync(absPath, "utf8");
            const candidates = [];
            const unparseable = [];

            extractJsonBlocks(markdown).forEach(({ line, source }) => {
                let parsed;
                try {
                    parsed = JSON.parse(stripJsonAnnotations(source));
                } catch (err) {
                    // Un bloc qui PARLE de `Files` mais ne parse pas doit crier, pas être
                    // sauté : un skip silencieux se lit « tout va bien » alors que l'exemple
                    // le plus normatif du fichier n'a jamais été vérifié.
                    if (/"Files"\s*:/.test(source)) {
                        unparseable.push({ line, message: err.message });
                    }
                    return;
                }
                collectFilesBlocks(parsed).forEach((files) => candidates.push({ line, files }));
            });

            it("tout bloc déclarant `Files` est analysable (pas de skip silencieux)", () => {
                expect(
                    unparseable,
                    unparseable.map((u) => `${relPath}:${u.line} — ${u.message}`).join("\n")
                ).toHaveLength(0);
            });

            // Sans cette assertion le garde serait VIDE dès qu'une doc change de forme
            // (fence renommée, exemple déplacé) — et un garde vide passe au vert.
            it("expose au moins un exemple `Files` à valider", () => {
                expect(
                    candidates.length,
                    `Aucun bloc \`Files\` trouvé dans ${relPath}. Soit la doc a changé de forme ` +
                        "(fence, structure) et l'extracteur doit suivre, soit elle n'est plus normative " +
                        "et doit sortir de NORMATIVE_DOCS. Un garde qui ne trouve rien ne garde rien."
                ).toBeGreaterThan(0);
            });

            if (candidates.length === 0) return;

            candidates.forEach(({ line, files }) => {
                it(`exemple \`Files\` ouvert ligne ${line} — clés conformes au contrat`, () => {
                    const ok = validateFiles(files);
                    const detail = (validateFiles.errors ?? [])
                        .map((e) => `${e.instancePath || "/"} ${e.message}`)
                        .join(" · ");
                    expect(
                        ok,
                        `${relPath}:${line} — l'exemple contredit profile.schema.json (${detail}). ` +
                            "Un intégrateur qui le recopie écrit un profil que `npm run validate:profiles` rejette."
                    ).toBe(true);
                });
            });
        });
    });
});
