#!/usr/bin/env node
/**
 * PROFILE-SCHEMAS: ships the profile contract with `@geoleaf/core` — the JSON Schemas, byte for
 * byte, and TypeScript types generated from them.
 *
 * ## The defect this closes
 *
 * The schemas lived in `profiles/schemas/` and in no tarball: an integrator could not validate a
 * profile with what npm gave them, and no type described the FORMAT of a profile file — the
 * core's own interfaces describe what its code READS, which is narrower and says nothing of the
 * file. The source stays `profiles/schemas/`; this script copies, it never becomes a second
 * source.
 *
 * ## What it writes, under `dist/schemas/` (the `./schemas` subpaths of the exports map)
 *
 *   <name>.schema.json   the source file, byte-identical — the validator's authority
 *   types/<name>.d.ts    json-schema-to-typescript's output for that schema
 *   index.d.ts           the ROOT type of each schema, re-exported by name — the public surface;
 *                        the `definitions` stay reachable by indexed access, not by name
 *
 * ## Why the generator never sees the schema as shipped
 *
 * The types promise an UPPER BOUND: every file a schema accepts type-checks; the reverse is not
 * promised. Rendered raw, the generator breaks that promise, or empties it, in three ways — each
 * measured on the ten schemas and on every file of the repo's profiles:
 *
 *   1. A sub-schema without any shape keyword (`styleCondition.value`, which takes any value)
 *      comes out as an OBJECT: 262 diagnostics on the repo's own profiles. It is marked
 *      `tsType: "unknown"`.
 *   2. Presence-only branches (`anyOf: [{ required }]`) and conditionals (`if`/`then`/`else`,
 *      `not`, `dependencies`) come out as `{ [k: string]: unknown }` intersected with the
 *      object — reopening it to any key. A type cannot express them; they are dropped. Dropping
 *      a constraint only widens the type, so the upper bound holds. A branch that also names
 *      its key (`properties: { k: true }`, which ajv's `strictRequired` demands) is still
 *      presence-only: the marker is removed first, or the branch would keep a shape.
 *   3. The `^_comment` pattern, carried by closed objects, comes out as `[k: string]: unknown`:
 *      a type that swallows every typo. It is rewritten into the exact template-literal index
 *      `` [k: `_comment${string}`] ``, and the number of rewrites must equal the number of
 *      patterns found. ONE object carries it beside another pattern — `mapping.json`'s root,
 *      where no TypeScript form is exact (a string index must also admit `$schema`). Both
 *      patterns fold into `additionalProperties: anyOf[<the other pattern's schema>, string]`,
 *      which keeps the per-source type — at the price of a NAMED exception, written in the
 *      shipped `index.d.ts`: there, a `_comment…` key types only as a string.
 *
 * Those changes apply to an in-memory copy fed to the generator. The shipped JSON is the source
 * file, copied.
 *
 * ## What it refuses — exit 1, and nothing written
 *
 * Zero schemas; a schema without `title` (it names the root type); a schema no profile file is
 * tied to (`FILE_OF_SCHEMA` in `lib/profile-schemas.cjs` — an orphan is the illusion of a
 * contract); two schemas yielding the same root name; a root name the generator did not emit; a
 * rewrite count that does not match the patterns found. Everything is computed before the first
 * write, so a refusal never leaves a half-written `dist/schemas/` behind.
 *
 * `render()` is exported for the proof test (`packages/core/__tests__/bundle-profile-contract.test.ts`),
 * which compares it with what the tarball carries: a `dist/` restored from turbo's cache would
 * otherwise ship types generated from older schemas.
 *
 * Usage: node scripts/emit-profile-schemas.cjs   (post-build of @geoleaf/core)
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { compile } = require("json-schema-to-typescript");
const registry = require("./lib/packages.cjs");
const {
    SCHEMAS_DIR,
    SCHEMA_SUFFIX,
    FILE_OF_SCHEMA,
    listSchemaNames,
} = require("./lib/profile-schemas.cjs");

const COMMENT_PATTERN = "^_comment";
const OUT_REL = path.join("dist", "schemas");
const SELF = "scripts/emit-profile-schemas.cjs";

/** Keywords that give a sub-schema a shape the generator can render. */
const SHAPE_KEYWORDS = [
    "type",
    "properties",
    "patternProperties",
    "additionalProperties",
    "items",
    "$ref",
    "enum",
    "const",
    "anyOf",
    "oneOf",
    "allOf",
];

/** Keywords that constrain without shaping — a type cannot express them. */
const CONDITIONAL_KEYWORDS = ["if", "then", "else", "not", "dependencies"];

/**
 * @typedef {Record<string, any>} Schema
 * @typedef {{ commentPatterns: number, folded: number }} PrepareStats
 */

/**
 * @param {Schema} schema
 * @returns {boolean}
 */
const hasShape = (schema) => SHAPE_KEYWORDS.some((k) => k in schema);

/**
 * A combinator branch without its presence markers: `properties: { k: true }` beside a
 * `required: ["k"]` names the key for ajv's `strictRequired` and constrains nothing. Left in,
 * it gives a presence-only branch a shape, and the generator reopens the object — header,
 * point 2. Branches only: under a closed object, `properties: { k: true }` DECLARES `k`, and
 * removing it there would refuse a key the schema accepts.
 *
 * @param {unknown} branch
 * @returns {unknown}
 */
function withoutPresenceMarkers(branch) {
    if (!branch || typeof branch !== "object" || Array.isArray(branch)) return branch;
    /** @type {Schema} */
    const node = branch;
    if (!node.properties || !Array.isArray(node.required)) return node;
    const properties = Object.fromEntries(
        Object.entries(node.properties).filter(
            ([key, sub]) => !(sub === true && node.required.includes(key))
        )
    );
    const out = { ...node, properties };
    if (Object.keys(properties).length === 0) delete out.properties;
    return out;
}

/**
 * A copy of `schema` the generator renders as an upper bound — see the header, points 1 to 3.
 * Visits SCHEMA positions only, never the `properties` / `definitions` maps themselves: marking
 * a map would add a property to it.
 *
 * @param {unknown} node
 * @param {PrepareStats} stats Counts what the rewrite step must account for.
 * @returns {any}
 */
function prepare(node, stats) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    /** @type {Schema} */
    const out = { ...node };

    for (const k of CONDITIONAL_KEYWORDS) delete out[k];
    for (const k of ["properties", "patternProperties", "definitions"]) {
        if (out[k] && typeof out[k] === "object") {
            out[k] = Object.fromEntries(
                Object.entries(out[k]).map(([name, sub]) => [name, prepare(sub, stats)])
            );
        }
    }
    if (out.additionalProperties && typeof out.additionalProperties === "object") {
        out.additionalProperties = prepare(out.additionalProperties, stats);
    }
    if (out.items) {
        out.items = Array.isArray(out.items)
            ? out.items.map((s) => prepare(s, stats))
            : prepare(out.items, stats);
    }
    for (const k of ["anyOf", "oneOf", "allOf"]) {
        if (!Array.isArray(out[k])) continue;
        const kept = out[k].map((s) => prepare(withoutPresenceMarkers(s), stats)).filter(hasShape);
        if (kept.length > 0) out[k] = kept;
        else delete out[k];
    }

    if (out.patternProperties && COMMENT_PATTERN in out.patternProperties) {
        stats.commentPatterns++;
        const others = Object.entries(out.patternProperties).filter(([p]) => p !== COMMENT_PATTERN);
        if (others.length > 0) {
            stats.folded++;
            out.additionalProperties = {
                anyOf: [...others.map(([, sub]) => sub), { type: "string" }],
            };
            delete out.patternProperties;
        }
    }

    if (!hasShape(out)) out.tsType = "unknown";
    return out;
}

/**
 * The generator's rendering of a `^_comment` pattern: its note, then a string index.
 * Anchored on the note rather than on the index, which an open object also produces.
 */
const COMMENT_INDEX =
    /\n([ \t]*)\/\*\*\n[ \t]*\* This interface was referenced by `[^`]*`'s JSON-Schema definition\n[ \t]*\* via the `patternProperty` "\^_comment"\.\n[ \t]*\*\/\n[ \t]*\[k: string\]: unknown \| undefined;/g;

/**
 * The root type name the generator derives from a schema `title`.
 *
 * @param {string} title
 * @returns {string} `GeoLeaf UI Config` → `GeoLeafUIConfig`.
 */
function rootTypeName(title) {
    return title
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join("");
}

/**
 * @param {string} message
 * @returns {never}
 */
function refuse(message) {
    throw new Error(`[PROFILE-SCHEMAS] ${message}`);
}

/**
 * The header of the public entry. Its promise is the upper bound, and it names the exceptions
 * rather than letting a reader find them — DERIVED from the folds `prepare()` actually made, so
 * the sentence cannot outlive the schema shape that makes it true.
 *
 * @param {{ name: string, root: string }[]} entries
 * @param {string[]} foldedFiles Profile files whose schema had `^_comment` folded (see header).
 * @returns {string}
 */
function indexSource(entries, foldedFiles) {
    const lines = [
        `// Generated by ${SELF} from profiles/schemas — do not edit.`,
        "/**",
        " * Types of the files of a GeoLeaf profile, generated from the JSON Schemas this package",
        " * ships at `@geoleaf/core/schemas/<name>.schema.json`.",
        " *",
        " * They are an upper bound of the schemas: every file a schema accepts type-checks, the",
        " * reverse is not promised — conditional rules, presence rules, patterns and bounds are not",
        " * expressed. The verdict belongs to the schemas: validate the files with them (ajv).",
        " *",
        ...(foldedFiles.length === 0
            ? []
            : [
                  ` * One exception to the upper bound: in ${foldedFiles.map((f) => `\`${f}\``).join(", ")}, a \`_comment…\` key types`,
                  " * only as a string (the schema accepts any value there).",
                  " *",
              ]),
        " * A `modules.<id>` block is opaque: its keys belong to the capability or plugin `<id>`.",
        " *",
        " * @packageDocumentation",
        " */",
    ];
    for (const { name, root } of entries) {
        lines.push(`/** \`${FILE_OF_SCHEMA[name]}\` */`);
        lines.push(`export type { ${root} } from "./types/${name}.js";`);
    }
    return `${lines.join("\n")}\n`;
}

/**
 * Everything `dist/schemas/` must contain, computed without writing.
 *
 * @param {string} [schemasDir] Source directory — `profiles/schemas/` unless told otherwise.
 * @returns {Promise<Map<string, Buffer | string>>} Path relative to `dist/schemas/` → content;
 *   the schemas as the source's bytes, the declarations as text.
 * @throws {Error} On any refusal listed in the header.
 */
async function render(schemasDir = SCHEMAS_DIR) {
    /** @type {Map<string, Buffer | string>} */
    const files = new Map();
    /** @type {{ name: string, root: string }[]} */
    const entries = [];
    /** @type {Map<string, string>} */
    const rootOwner = new Map();
    /** @type {string[]} */
    const foldedFiles = [];

    for (const name of listSchemaNames(schemasDir)) {
        const file = `${name}${SCHEMA_SUFFIX}`;
        const bytes = fs.readFileSync(path.join(schemasDir, file));
        const schema = JSON.parse(bytes.toString("utf8"));

        if (typeof schema.title !== "string" || schema.title.trim() === "") {
            refuse(`${file} n'a pas de \`title\` — c'est lui qui nomme le type racine.`);
        }
        if (!Object.hasOwn(FILE_OF_SCHEMA, name)) {
            refuse(
                `${file} ne juge aucun fichier de profil connu (FILE_OF_SCHEMA, lib/profile-schemas.cjs). ` +
                    "Un schéma livré qui ne juge rien est l'illusion d'un contrat."
            );
        }
        const root = rootTypeName(schema.title);
        if (rootOwner.has(root)) {
            refuse(`${file} et ${rootOwner.get(root)} donnent le même type racine \`${root}\`.`);
        }
        rootOwner.set(root, file);

        /** @type {PrepareStats} */
        const stats = { commentPatterns: 0, folded: 0 };
        const prepared = prepare(schema, stats);
        const generated = await compile(prepared, name, {
            bannerComment: `// Generated by ${SELF} from profiles/schemas/${file} — do not edit.`,
            cwd: schemasDir,
            unknownAny: true,
            strictIndexSignatures: true,
            additionalProperties: true,
            format: true,
        });

        let rewrites = 0;
        const declarations = generated.replace(COMMENT_INDEX, (_match, indent) => {
            rewrites++;
            return (
                `\n${indent}/** Comment keys (\`_comment…\`): accepted by the schema, ignored at runtime. */` +
                `\n${indent}[k: \`_comment\${string}\`]: unknown;`
            );
        });
        if (rewrites !== stats.commentPatterns - stats.folded) {
            refuse(
                `${file} : ${stats.commentPatterns} motif(s) ^_comment, dont ${stats.folded} replié(s), ` +
                    `mais ${rewrites} réécriture(s) — le rendu du générateur a changé, ` +
                    "et une signature ouverte laisserait passer toute faute de frappe."
            );
        }
        if (!new RegExp(`^export (?:interface|type) ${root}\\b`, "m").test(declarations)) {
            refuse(`${file} : le générateur n'a pas émis le type racine \`${root}\`.`);
        }

        if (stats.folded > 0) foldedFiles.push(FILE_OF_SCHEMA[name]);
        files.set(file, bytes);
        files.set(path.posix.join("types", `${name}.d.ts`), declarations);
        entries.push({ name, root });
    }

    files.set("index.d.ts", indexSource(entries, foldedFiles));
    return files;
}

/**
 * Replaces `dist/schemas/` of the core with `render()`'s output.
 *
 * @returns {Promise<void>}
 */
async function main() {
    const core = registry.requireByDirName("core");
    const outDir = path.join(core.absDir, OUT_REL);
    const files = await render();

    fs.rmSync(outDir, { recursive: true, force: true });
    for (const [rel, content] of files) {
        const abs = path.join(outDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
    }
    const schemas = [...files.keys()].filter((f) => f.endsWith(SCHEMA_SUFFIX)).length;
    console.log(
        `✅ [PROFILE-SCHEMAS] ${schemas} schémas et leurs types → ${path.relative(registry.ROOT, outDir)}/`
    );
}

module.exports = { render, rootTypeName };

if (require.main === module) {
    main().catch((err) => {
        console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
}
