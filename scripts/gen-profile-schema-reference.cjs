#!/usr/bin/env node
/*!
 * PROFILE-SCHEMA-REFERENCE: `profiles/schemas/*.json` rendered to a markdown
 * reference, with its freshness gate.
 *
 * ## The defect this generator closes
 *
 * `PROFILE_JSON_REFERENCE.md` is **hand-written** and published on npm. Measured on
 * 2026-07-29: it documents **128 parameters** while the 12 schemas carry **233**.
 * It is thus not merely exposed to drift — **it is 45 % incomplete**, and nothing
 * said so. An integrator looking for a key absent from the document concludes it
 * does not exist.
 *
 * ⚠️ **The gap's direction was not the expected one.** The document was classed
 * "derivable, hence replaceable"; measurement says a generator **covers nearly
 * double** what the hand-written one covers. The gain is not deleting 3,306 lines,
 * it is exhaustiveness.
 *
 * ## What it does NOT replace yet, and the number is written here
 *
 * The schemas carry the STRUCTURE in full (**233/233** have a type or a `$ref`),
 * but the prose only by half: **129/233 descriptions (55 %)**, **17 defaults
 * (7 %)**, **0 examples**. Yet `PROFILE_JSON_REFERENCE.md` carries **60 code
 * blocks**.
 *
 * **So this generator cannot replace the hand-written one yet, and saying so is
 * the result.** What follows is SOURCE work, not document work: write the 104
 * missing descriptions **in the schemas**, where `check-config-coverage.cjs`
 * already gates them in both directions. Any other route — an annotation sidecar,
 * a merge at generation — recreates a second place where the same sentence can
 * diverge, i.e. the original defect.
 *
 * ## Where it writes, and why not in the tarball
 *
 * Output under `docs/reference/`, **not** `packages/core/docs/`. Writing there
 * would publish **two profile references on npm** — the exact duplicate this
 * rework removes — and the plan says to "verify its output **before** removing"
 * the old one. While both coexist, only one is published. The day the old one
 * leaves, `OUT_FILE` moves: one line.
 *
 * ⚠️ The output is a **generated** `.md`, hence listed in `.prettierignore` on the
 * `ARBORESCENCE_QUALIFIEE.md` pattern: letting Prettier reformat it would make it
 * diverge from the generator and turn the gate permanently red with no source
 * change.
 *
 * ## Determinism
 *
 * Pure function of the schemas: no date, no SHA, no absolute path; files and
 * properties sorted. Same requirement as `docs:tree:check` and
 * `gen-api-surface.cjs`, for the same reason — an artifact containing "now"
 * compares to nothing.
 *
 * Usage:
 *   node scripts/gen-profile-schema-reference.cjs           # (re)generates
 *   node scripts/gen-profile-schema-reference.cjs --check    # gate: exit 1 if stale
 *   node scripts/gen-profile-schema-reference.cjs --audit     # gap vs the hand-written doc, writes nothing
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");

const ROOT = registry.ROOT;
const SCHEMA_DIR = path.join(ROOT, "profiles", "schemas");
const OUT_FILE = docsPaths.reference("PROFILE_SCHEMA_REFERENCE.md");
// The hand-written doc `--audit` compares against. Resolved by the registry: a
// hard-coded path would silently stop matching if the core moved, and the audit
// would output "0 gaps".
const LEGACY_DOC = path.join(
    registry.requireByDirName("core").absDir,
    "docs",
    "PROFILE_JSON_REFERENCE.md"
);

const CHECK = process.argv.includes("--check");
const AUDIT = process.argv.includes("--audit");

// ---------------------------------------------------------------------------
// Schema reading
// ---------------------------------------------------------------------------

/** @returns {{file: string, schema: object}[]} the schemas, sorted by file name. */
function readSchemas() {
    if (!fs.existsSync(SCHEMA_DIR)) {
        throw new Error(
            `[PROFILE-SCHEMA] ${path.relative(ROOT, SCHEMA_DIR)} est introuvable — la gate ` +
                "refuse de conclure plutôt que de générer une référence vide."
        );
    }
    const files = fs
        .readdirSync(SCHEMA_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort();
    if (files.length === 0) {
        throw new Error("[PROFILE-SCHEMA] aucun schéma trouvé — même motif.");
    }
    return files.map((f) => ({
        file: f,
        schema: JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), "utf8")),
    }));
}

/**
 * Resolves an INTERNAL `$ref` (`#/definitions/x`, `#/$defs/x`).
 *
 * Measured on 2026-07-29: the 12 schemas use **only** internal refs. An external
 * ref would return `undefined` here — it is thus flagged rather than ignored,
 * without which the property would vanish from the reference without a word.
 *
 * @returns {object|null}
 */
function resolveRef(ref, root) {
    if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
    let node = root;
    for (const seg of ref.slice(2).split("/")) {
        if (!node || typeof node !== "object") return null;
        node = node[seg];
    }
    return node && typeof node === "object" ? node : null;
}

/**
 * Flattens a schema into dotted paths.
 *
 * ⚠️ The cycle guard is load-bearing: `panelBlock` → `panelBlockBase` references
 * itself in a loop (11 occurrences of the same `$ref`), and without it the walk
 * does not terminate. It cuts on the already-visited DEFINITION, not the path —
 * two distinct properties can legitimately point at the same definition.
 *
 * @returns {{path: string, type: string, required: boolean, description: string, def: string, enum: string}[]}
 */
function flatten(node, root, prefix, seenRefs, out) {
    if (!node || typeof node !== "object") return out;

    if (node.$ref) {
        if (seenRefs.has(node.$ref)) return out;
        const target = resolveRef(node.$ref, root);
        if (!target) {
            out.push({
                path: prefix || "(racine)",
                type: `⚠️ $ref non résolue : \`${node.$ref}\``,
                required: false,
                description: "",
                def: "",
                enum: "",
            });
            return out;
        }
        return flatten(target, root, prefix, new Set([...seenRefs, node.$ref]), out);
    }

    for (const key of ["oneOf", "anyOf", "allOf"]) {
        if (Array.isArray(node[key])) {
            for (const sub of node[key]) flatten(sub, root, prefix, seenRefs, out);
        }
    }

    if (node.items) flatten(node.items, root, prefix ? `${prefix}[]` : "[]", seenRefs, out);

    const props = node.properties;
    if (props && typeof props === "object") {
        const required = new Set(Array.isArray(node.required) ? node.required : []);
        for (const key of Object.keys(props).sort()) {
            const val = props[key];
            if (!val || typeof val !== "object") continue;
            const p = prefix ? `${prefix}.${key}` : key;
            out.push({
                path: p,
                type: typeName(val, root),
                required: required.has(key),
                description: (val.description || "").replace(/\s+/g, " ").trim(),
                def: "default" in val ? JSON.stringify(val.default) : "",
                enum: Array.isArray(val.enum)
                    ? val.enum.map((e) => JSON.stringify(e)).join(" \\| ")
                    : "",
            });
            flatten(val, root, p, seenRefs, out);
        }
    }

    // `additionalProperties` describes a map's entries — `basemaps.{id}.*`. The
    // `{id}` form is the one the hand-written doc already uses, adopted so the two
    // stay comparable.
    if (node.additionalProperties && typeof node.additionalProperties === "object") {
        flatten(node.additionalProperties, root, prefix ? `${prefix}.{id}` : "{id}", seenRefs, out);
    }
    return out;
}

/** A property's displayed type — a `$ref` rendered by its definition name. */
function typeName(val, root) {
    if (val.$ref) {
        const target = resolveRef(val.$ref, root);
        const name = val.$ref.split("/").pop();
        return target ? `\`${name}\`` : `⚠️ \`${val.$ref}\` non résolue`;
    }
    if (Array.isArray(val.type)) return val.type.join(" \\| ");
    if (val.type) return val.type;
    if (val.oneOf || val.anyOf) return "oneOf";
    return "—";
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

const BANNER = `<!-- GÉNÉRÉ — ne pas éditer à la main. -->

# Référence des schémas de profil — GÉNÉRÉE

> **Source unique : \`profiles/schemas/*.json\`.** Ce fichier est produit par
> \`npm run gen:profile-schema\` et vérifié à l'octet près par \`npm run gen:profile-schema:check\`
> (câblé dans \`ci:local\` et \`ci.yml\`). Ne pas l'éditer : la prochaine génération écrase.
>
> **Pour corriger une description, éditer le SCHÉMA**, pas ce document. C'est le seul endroit
> où la phrase ne peut pas diverger de ce que le validateur applique.
>
> Ce fichier ne porte ni date ni numéro de version, à dessein : c'est ce qui en fait une
> fonction pure de ses schémas, donc gatable. Les décomptes s'obtiennent par
> \`npm run gen:profile-schema\`, qui les imprime.

`;

function render(schemas) {
    const lines = [BANNER];
    let total = 0;
    let described = 0;

    for (const { file, schema } of schemas) {
        const rows = flatten(schema, schema, "", new Set(), []);
        // Dedup by path: `oneOf` can yield the same key twice.
        const byPath = new Map();
        for (const r of rows) if (!byPath.has(r.path)) byPath.set(r.path, r);
        const sorted = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));

        lines.push(`## \`${file}\``);
        lines.push("");
        if (schema.title) lines.push(`_${schema.title}_`, "");
        if (schema.description)
            lines.push(String(schema.description).replace(/\s+/g, " ").trim(), "");

        if (sorted.length === 0) {
            lines.push("_Aucune propriété déclarée._", "");
            continue;
        }

        lines.push("| Chemin | Type | Requis | Défaut | Valeurs | Description |");
        lines.push("| ------ | ---- | ------ | ------ | ------- | ----------- |");
        for (const r of sorted) {
            total++;
            if (r.description) described++;
            lines.push(
                `| \`${r.path}\` | ${r.type} | ${r.required ? "oui" : "—"} | ${
                    r.def ? `\`${r.def}\`` : "—"
                } | ${r.enum || "—"} | ${r.description || "—"} |`
            );
        }
        lines.push("");
    }

    if (total === 0) {
        throw new Error(
            "[PROFILE-SCHEMA] 0 propriété extraite des schémas. La gate refuse de conclure — " +
                "une référence vide se comparerait à elle-même et sortirait verte en ne décrivant rien."
        );
    }
    return { content: lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n", total, described };
}

// ---------------------------------------------------------------------------

/** The parameters the HAND-WRITTEN document covers, read off its headings. */
function legacyParams() {
    if (!fs.existsSync(LEGACY_DOC)) return null;
    const txt = fs.readFileSync(LEGACY_DOC, "utf8");
    const out = new Set();
    for (const m of txt.matchAll(/^#{3,4} `([^`]+)`/gm)) out.add(m[1]);
    return out;
}

function main() {
    const schemas = readSchemas();
    const { content, total, described } = render(schemas);

    if (AUDIT) {
        const legacy = legacyParams();
        const generated = new Set();
        for (const m of content.matchAll(/^\| `([^`]+)` \|/gm)) generated.add(m[1]);
        console.log("─".repeat(72));
        if (!legacy) {
            console.log("ℹ  Le rédigé est absent — plus rien à comparer, l'item 8 est passé.");
            console.log("─".repeat(72));
            return 0;
        }
        const onlySchema = [...generated].filter((p) => !legacy.has(p)).sort();
        const onlyDoc = [...legacy].filter((p) => !generated.has(p)).sort();
        console.log(
            `AUDIT — schémas : ${generated.size} chemins · rédigé : ${legacy.size} paramètres`
        );
        console.log(`  dans les SCHÉMAS et absents du rédigé : ${onlySchema.length}`);
        for (const p of onlySchema.slice(0, 15)) console.log(`     + ${p}`);
        if (onlySchema.length > 15) console.log(`     … et ${onlySchema.length - 15} de plus`);
        console.log(`  dans le RÉDIGÉ et absents des schémas : ${onlyDoc.length}`);
        for (const p of onlyDoc.slice(0, 15)) console.log(`     − ${p}`);
        if (onlyDoc.length > 15) console.log(`     … et ${onlyDoc.length - 15} de plus`);
        console.log(
            `\n⚠️  Les deux colonnes comptent. « + » = ce que le rédigé NE DIT PAS ; « − » = ce\n` +
                `   qu'il dit et que les schémas n'imposent pas — soit une clé morte, soit une clé\n` +
                `   vivante qu'aucun schéma ne valide. Les départager demande de lire, pas de compter.\n` +
                `\n🛑 ET UNE TROISIÈME LECTURE DE « − », QUE CE COMPTE NE SAIT PAS DISTINGUER :\n` +
                `   une clé peut n'être validée par AUCUN schéma **par décision**, et non par\n` +
                `   oubli. Les blocs \`modules.<id>\` sont OUVERTS par conception — le schéma\n` +
                `   racine les déclare tels —, et certaines clés d'interface sont conservées\n` +
                `   comme ancres de migration. Les compter comme un manque produit une dette\n` +
                `   IMAGINAIRE, et c'est le genre de chiffre qui finit par justifier un geste :\n` +
                `   fermer un bloc volontairement ouvert contredirait un invariant écrit.\n` +
                `   Tant que cet outil ne sait pas faire la différence, son « − » se relit avec\n` +
                `   cette réserve. (Mesuré et arbitré le 17/08/2026 ; réserve versée ici le\n` +
                `   19/08/2026 parce qu'elle doit voyager avec l'instrument, pas avec la ligne\n` +
                `   de registre qui l'a formulée.)`
        );
        console.log("─".repeat(72));
        return 0;
    }

    if (!CHECK) {
        fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
        fs.writeFileSync(OUT_FILE, content);
        console.log(
            `✅ [PROFILE-SCHEMA] ${path.relative(ROOT, OUT_FILE)} — ${total} propriété(s) sur ` +
                `${schemas.length} schéma(s) ; ${described} décrite(s) ` +
                `(${((100 * described) / total).toFixed(1)} %, informatif).`
        );
        return 0;
    }

    console.log("─".repeat(72));
    if (!fs.existsSync(OUT_FILE)) {
        console.log(
            `❌ [PROFILE-SCHEMA] ${path.relative(ROOT, OUT_FILE)} est ABSENT.\n` +
                "   Lancer : npm run gen:profile-schema — puis commiter le résultat."
        );
        console.log("─".repeat(72));
        return 1;
    }
    if (fs.readFileSync(OUT_FILE, "utf8") !== content) {
        console.log(
            "❌ [PROFILE-SCHEMA] la référence est PÉRIMÉE — un schéma a bougé depuis la dernière\n" +
                "   génération. Lancer : npm run gen:profile-schema — puis commiter le résultat."
        );
        console.log("─".repeat(72));
        return 1;
    }
    console.log(
        `✅ [PROFILE-SCHEMA] à jour — ${total} propriété(s), ${schemas.length} schéma(s), ` +
            `${described} décrite(s).`
    );
    console.log("─".repeat(72));
    return 0;
}

try {
    process.exit(main());
} catch (err) {
    console.error(String(err && err.message ? err.message : err));
    process.exit(2);
}
