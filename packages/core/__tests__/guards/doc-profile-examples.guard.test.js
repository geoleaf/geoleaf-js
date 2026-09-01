/**
 * @file doc-profile-examples.guard.test.js
 * @description Guard test — the NORMATIVE docs' profile examples validate
 * against `profiles/schemas/profile.schema.json`.
 *
 * Why this guard exists (18/07/2026)
 * ---------------------------------------------------------------
 * `Files.taxonomyFile` was removed from the contract: purged from the
 * schema, the 9 profiles and the loader, and its token is banned from
 * `packages/core/src` by `extracted-features.guard.test.js`. But **the
 * normative docs were guarded by nothing** — `PROFILE_CONTRACT_SPEC.md` and
 * `GUIDE_VALIDATION_PROFILS.md` kept prescribing `taxonomyFile` in their
 * examples and their whitelist. The `Files` block being
 * `additionalProperties: false`, an integrator following the docs wrote a
 * profile `npm run validate:profiles` REJECTED.
 *
 * The token ban could not cover this case: the docs legitimately mention
 * `taxonomyFile` in historical prose ("the key was removed"). The EXAMPLES
 * are therefore validated against the schema — precise, and insensitive to prose.
 *
 * Deliberately narrow scope: only the docs authoritative on the profile
 * contract. Archives (`_docs_projet/archives/**`) are out of perimeter by construction.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

// The docs root comes from `scripts/lib/docs-paths.cjs`, never a literal:
// hardcoded, these three paths would survive the directory's move by
// matching nothing any more, and `existsSync` would turn them red without
// saying why. The module THROWS if its root is absent — the failure then names its cause.
const docsPaths = createRequire(import.meta.url)(
    path.join(REPO_ROOT, "scripts/lib/docs-paths.cjs")
);

/**
 * Docs authoritative on a profile's structure. Add any new normative doc
 * here. ABSOLUTE paths, derived from the public root.
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
        // The removed key must not be reintroduced into the schema.
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
                    // A block that SPEAKS of `Files` but does not parse must
                    // shout, not be skipped: a silent skip reads "all is
                    // well" while the file's most normative example was never verified.
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

            // Without this assertion the guard would be EMPTY as soon as a
            // doc changes shape (renamed fence, moved example) — and an empty
            // guard goes green.
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
