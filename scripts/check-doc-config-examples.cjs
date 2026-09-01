#!/usr/bin/env node
/**
 * @fileoverview DOC-CONFIG-EXAMPLES — are the PRODUCT docs' JSON configuration examples
 * validatable by the profile schemas?
 *
 * ## The hole this gate closes
 *
 * The repo already gates its doc examples heavily — `validate-docs-examples.cjs` hunts
 * ghost APIs, `typecheck-docs-examples.cjs` compiles the TypeScript blocks **and** the
 * TSDoc `@example`s. Both share the same blind spot: **they look at CODE**. A
 * ` ```json ` block describing a profile is neither an API nor TypeScript — nobody
 * reads it.
 *
 * Yet `profiles/schemas/*.json` sets `additionalProperties: false` on its fixed-shape
 * objects. A key removed from a schema but left in a doc example produces a
 * **copy-pastable snippet that fails `npm run validate:profiles` on the integrator's
 * side**, in the project's two most-read configuration guides.
 *
 * 🛑 **It is the EXACT shape of the hole plugged on 2026-07-31** — a copy-pastable
 * `GeoLeaf.POI.add()` lived in `README.md` and `packages/core/README.md` while the
 * rule forbidding it existed and had been seen biting. **The rule was good, its corpus
 * stopped short.** Here, the corpus was good and the BLOCK TYPE is what stopped short.
 *
 * ## The three rules
 *
 *   CDE-01  No NEW invalid key in a JSON config example. A key absent from the
 *           baseline is an error: it cannot be born as debt.
 *   CDE-02  The baseline can only SHRINK. An entry fixed in the docs must be removed
 *           from the file.
 *   CDE-03  Neither the corpus nor the container table can be empty. A green gate that
 *           scanned nothing, or resolved no schema, is the worst outcome — same class
 *           as NNA-03, EOD-03 and JTD-03.
 *
 * ## Two design decisions, each motivated by a MEASURED defect
 *
 * **Containers are DERIVED from the schemas, never listed here.** Every object at
 * `additionalProperties: false` carrying its own `properties` is indexed, by its
 * property name. A hand-written list would go stale at the first modified schema — and
 * it would go stale IN SILENCE, by ceasing to match, exactly the class
 * `probe-gate-visibility.cjs` watches.
 *
 * **The corpus comes from `productDocsFiles()`** (`lib/tsdoc-examples.cjs`), shared
 * with the two other doc gates. One corpus, three consumers — never a `packages/**`
 * glob, which would capture `dist/` and `node_modules/`.
 *
 * ⚠️ **The first instrument written for this census was WRONG, and it must be said
 * here**: it compared the examples' `ui.*` keys to the TOP-LEVEL properties of
 * `ui.schema.json` — yet that schema describes the FILE `ui.json`, whose root is
 * `{_comment, ui, layerManagerConfig}`. It returned **75 violations of which the vast
 * majority were false**, against **44 real** once the indexing was fixed. It is the
 * corollary "the preflight carries the blindness it measures", met while writing the
 * gate that measures. Hence the generic indexing below, which assumes no depth.
 *
 * ## What this gate does NOT guard
 *
 * It verifies the keys' **existence**, not their types nor the `required`. Doc
 * examples are FRAGMENTS: validating a fragment against the full schema would redden
 * every partial illustration on `required`, i.e. almost all of them. The hunted class
 * is "this key does not / no longer exist", and it is the one that breaks on
 * copy-paste.
 *
 * ⚠️ **Residual limit, bounded and accepted: matching goes by NAME, so a JSON block
 * that is not a profile but uses a profile container's name is judged as if it were
 * one.** Measured at wiring: 3 `map.target` entries come from JavaScript
 * initialization examples, not profiles. Removing the ambiguous names (above)
 * eliminated the massive class — 150 → 118 entries, including the 24 `data.*` that
 * were all false — and the rest is absorbed by the baseline. Closing this last case
 * would require identifying each block's document TYPE, which no corpus marker gives
 * today. Accepted preference: a false positive is noisy and gets fixed; a false
 * negative is silent, and it is exactly the class this gate exists to close.
 *
 * ⚠️ **What the 2026-08-09 fix COST, measured before being written.** Registering the
 * openness of an `additionalProperties: true` node without `properties` (see
 * `visit()`) takes **one single** container out of the index: `offline`. The keys of a
 * LAYER-LEVEL `offline` block are thus no longer judged in doc examples. Loss measured
 * the same day: **0 violations** — 93 → 92, the only one gone being the CHANGELOG's
 * false positive, and **0** baseline entries orphaned (it cited none in `offline.*`).
 * It is the honest consequence of a name two schemas use for two things; silencing it
 * would have required rewriting a RIGHT example.
 *
 * 🛑 **And a wider variant was measured then DISCARDED**: no longer judging under an
 * open parent (`modules`, `data`, `table`…) removed 6 violations — including
 * `defaultSort.direction`, which is a **REAL** defect (`layer-config.schema.json`
 * declares `{field, order}`, the docs write `direction`) today correctly frozen in the
 * baseline. It bought the repair of one false positive at the price of a false
 * negative, i.e. on the wrong side of the arbitration stated just above.
 *
 * ⚠️ **A wiring-time find, left open because it exits the perimeter**:
 * `themes.schema.json` declares **`defautTheme`** (missing the second `l`) where the
 * docs write `defaultTheme`. It is a typo IN THE SCHEMA, hence a configuration key
 * rename — breaking for profiles, to settle separately.
 *
 * ## Usage
 *
 *        node scripts/check-doc-config-examples.cjs
 *        node scripts/check-doc-config-examples.cjs --update-baseline
 *
 * ⚠️ `--update-baseline` runs AFTER fixing the docs, never to silence a new example —
 * which must be written with keys that exist.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { productDocsFiles } = require("./lib/tsdoc-examples.cjs");

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(ROOT, "profiles", "schemas");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "doc-config-examples.json");
const UPDATE = process.argv.includes("--update-baseline");

/**
 * Indexes, across all profile schemas, the CLOSED-shape objects
 * (`additionalProperties: false`) carrying their own `properties`, by their property
 * name.
 *
 * ⚠️ The descent is generic and assumes NO depth: precisely the depth assumption that
 * skewed the first census (see the header). A container can live under `properties`,
 * under `items`, under `definitions` or under a `patternProperties` — all are visited.
 *
 * @returns {Map<string, Set<string>>} container name → keys it accepts
 */
function closedContainers() {
    /** @type {Map<string, Set<string>>} */
    const index = new Map();
    /**
     * Names that AT LEAST ONE schema declares OPEN. They are removed from the index
     * at the end.
     *
     * 🛑 Without this removal, the gate mass-produces false positives, and it is
     * MEASURED: `data` exists in three schemas — closed at 3 keys in
     * `geoleaf-config`, **open at 15 in `layer-config`**. Indexing only the closed
     * one had every layer-example `data` block judged against the wrong schema:
     * `data.file`, `data.url`, `data.directory`… were flagged invalid while they are
     * declared. **Judging by NAME is only sound if the name is closed EVERYWHERE** —
     * otherwise a legitimate block of the open variant gets judged by the closed one.
     * A noisy gate learns to be ignored, which is worse than an absent one.
     *
     * @type {Set<string>}
     */
    const openSomewhere = new Set();

    /**
     * @param {unknown} node
     * @param {string | null} name name of the property carrying this node, if known
     * @returns {void}
     */
    const visit = (node, name) => {
        if (!node || typeof node !== "object" || Array.isArray(node)) return;
        const obj = /** @type {Record<string, unknown>} */ (node);

        // 🛑 Openness is registered BEFORE the `properties` test, and that is where
        // the hole was (2026-08-09). The MOST OPEN shape there is — `{type: "object",
        // additionalProperties: true}` **without `properties`** — entered neither of
        // the two branches below: the mechanism written to see openness was blind to
        // its plainest case. Measured: `profile.schema.json` declares
        // `modules.offline` exactly in that shape, on purpose ("opaque to the
        // schema", the content belongs to the capability). Consequence: the RIGHT
        // example of the public CHANGELOG
        // `{"modules":{"offline":{"cache":{"maxTileCacheEntries":2000}}}}` got judged
        // against the LAYER-LEVEL `offline` (`layer-config.schema.json`, closed at
        // `enabled|maxFeatures|maxAgeMs|source`): red gate, right docs.
        if (name && obj["additionalProperties"] === true) openSomewhere.add(name);

        const props = obj["properties"];
        if (name && props && typeof props === "object" && !Array.isArray(props)) {
            if (obj["additionalProperties"] === false) {
                const keys = Object.keys(/** @type {Record<string, unknown>} */ (props));
                const existing = index.get(name);
                // Two schemas can describe the same CLOSED name: we UNITE rather than
                // overwrite. Overwriting would make the verdict depend on read order.
                if (existing) for (const k of keys) existing.add(k);
                else index.set(name, new Set(keys));
            } else {
                // Same name, OPEN shape elsewhere → the name becomes unjudgeable (see
                // `openSomewhere`). Registered even if another schema closed it: the
                // existence of ONE open variant is what makes the judgment unsafe.
                openSomewhere.add(name);
            }
        }

        for (const [key, value] of Object.entries(obj)) {
            // `properties` / `definitions` / `patternProperties` carry NAMES;
            // everywhere else (`items`, `allOf`, `then`…) the current name propagates.
            const carriesNames =
                key === "properties" || key === "definitions" || key === "patternProperties";
            if (carriesNames && value && typeof value === "object" && !Array.isArray(value)) {
                for (const [child, sub] of Object.entries(
                    /** @type {Record<string, unknown>} */ (value)
                )) {
                    visit(sub, child);
                }
            } else {
                visit(value, name);
            }
        }
    };

    for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".json"))) {
        visit(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), "utf8")), null);
    }
    for (const ambiguous of openSomewhere) index.delete(ambiguous);
    return index;
}

/**
 * A Markdown file's ```json blocks, parsed. Unparseable blocks are silently ignored:
 * a deliberately truncated snippet (`…`) is a legitimate illustration, not a
 * configuration error.
 *
 * @param {string} src content of the `.md`
 * @returns {unknown[]} the valid JSON blocks
 */
function jsonBlocks(src) {
    const out = [];
    for (const m of src.matchAll(/```json\s*\n([\s\S]*?)```/g)) {
        try {
            out.push(JSON.parse(m[1]));
        } catch {
            /* illustrative fragment — unparseable, hence unjudgeable */
        }
    }
    return out;
}

/**
 * The schemas whose ROOT is closed, with a signature allowing a doc block to be
 * recognized WITHOUT ambiguity.
 *
 * 🛑 **Why this function exists: without it the gate is blind to half its own
 * target.** `scan()` only judged the keys of a NAMED CONTAINER (`ui.x`,
 * `edition.y`). The TOP-LEVEL keys of a `profile.json` example were never confronted,
 * while the 10 root schemas are `additionalProperties: false` — so the most direct
 * class passed. Measured at landing: **`poiAddConfig` is taught as a root block in
 * three product documents** (including an entire §17 of `PROFILE_JSON_REFERENCE.md`)
 * and is declared in NO schema. The gate went green on it.
 *
 * **The signature is DERIVED, not written.** A root schema is only usable if it
 * carries at least one property NO other root schema declares: that is what makes the
 * matching unambiguous by construction. Without this criterion, `profile.schema.json`
 * and `layer-config.schema.json` are indistinguishable — both have
 * `required: ["id"]`, and judging a layer example against the profile schema would
 * mass-produce false positives, exactly the `data.*` class already met on the
 * containers.
 *
 * A block matching NO signature is ignored: not judging beats misjudging.
 *
 * @returns {{ required: string[], unique: Set<string>, keys: Set<string>, name: string }[]}
 */
function rootSchemas() {
    const roots = [];
    for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".json"))) {
        const s = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), "utf8"));
        if (s.additionalProperties !== false || !s.properties) continue;
        roots.push({
            name: file,
            required: Array.isArray(s.required) ? s.required : [],
            keys: new Set(Object.keys(s.properties)),
            unique: new Set(),
        });
    }
    for (const r of roots) {
        for (const k of r.keys) {
            if (!roots.some((o) => o !== r && o.keys.has(k))) r.unique.add(k);
        }
    }
    return roots.filter((r) => r.unique.size > 0);
}

/**
 * @returns {{ violations: string[], files: number, blocks: number, containers: number,
 *   rootsJudged: number }}
 */
function scan() {
    const containers = closedContainers();
    const roots = rootSchemas();
    const violations = [];
    let files = 0;
    let blocks = 0;
    let rootsJudged = 0;

    for (const file of productDocsFiles()) {
        if (!file.endsWith(".md")) continue;
        files++;
        const rel = path.relative(ROOT, file).split(path.sep).join("/");

        for (const block of jsonBlocks(fs.readFileSync(file, "utf8"))) {
            blocks++;

            // ── Root: judged only if ONE discriminating signature matches ───────────────
            if (block && typeof block === "object" && !Array.isArray(block)) {
                const rootKeys = Object.keys(/** @type {Record<string, unknown>} */ (block));
                const matched = roots.filter(
                    (r) =>
                        r.required.every((k) => rootKeys.includes(k)) &&
                        rootKeys.some((k) => r.unique.has(k))
                );
                // Two signatures matching the same block = ambiguity: we do not judge.
                if (matched.length === 1) {
                    rootsJudged++;
                    const r = matched[0];
                    for (const k of rootKeys) {
                        if (k.startsWith("_") || k === "$schema") continue;
                        if (!r.keys.has(k)) violations.push(`${rel} :: <${r.name}>.${k}`);
                    }
                }
            }

            /**
             * @param {unknown} node
             * @returns {void}
             */
            const walk = (node) => {
                if (!node || typeof node !== "object") return;
                if (Array.isArray(node)) {
                    for (const item of node) walk(item);
                    return;
                }
                for (const [key, value] of Object.entries(
                    /** @type {Record<string, unknown>} */ (node)
                )) {
                    const valid = containers.get(key);
                    if (valid && value && typeof value === "object" && !Array.isArray(value)) {
                        for (const child of Object.keys(
                            /** @type {Record<string, unknown>} */ (value)
                        )) {
                            // `_comment*` is tolerated everywhere by the schemas (PRF-SCHEMA).
                            if (child.startsWith("_") || child === "$schema") continue;
                            if (!valid.has(child)) violations.push(`${rel} :: ${key}.${child}`);
                        }
                    }
                    walk(value);
                }
            };
            walk(block);
        }
    }

    return {
        violations: [...new Set(violations)].sort(),
        files,
        blocks,
        containers: containers.size,
        rootsJudged,
    };
}

const { violations, files, blocks, containers, rootsJudged } = scan();
const bar = "─".repeat(72);

// ── CDE-03 — a gate that scanned nothing, or resolved nothing, proved nothing ────────────
if (files === 0 || blocks === 0 || containers === 0) {
    console.error("ERROR [DOC-CONFIG-EXAMPLES/CDE-03]: corpus ou table de conteneurs vide.");
    console.error(
        `  ${files} fichier(s) de doc produit · ${blocks} bloc(s) JSON · ${containers} conteneur(s)\n` +
            "  fermé(s) résolu(s) depuis profiles/schemas/. Si l'un des trois est à zéro, c'est\n" +
            "  la gate qui est aveugle, pas la doc qui est propre."
    );
    process.exit(2);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        // Indentation 4: Prettier owns `scripts/**/*.json` at `tabWidth: 4`.
        JSON.stringify(
            {
                _comment:
                    "DOC-CONFIG-EXAMPLES — clés de configuration citées par un exemple JSON de " +
                    "la doc PRODUIT et absentes du schéma qui les gouverne. Chaque entrée est un " +
                    "extrait copiable-collable qui ferait échouer `npm run validate:profiles` " +
                    "chez l'intégrateur, parce que les objets à forme fixe sont " +
                    "`additionalProperties: false`. Cette liste ne peut que RÉTRÉCIR (CDE-02) et " +
                    "aucune entrée ne peut y NAÎTRE (CDE-01). Régénérer avec --update-baseline " +
                    "UNIQUEMENT après avoir corrigé la doc, jamais pour faire taire un exemple neuf.",
                _generated: "node scripts/check-doc-config-examples.cjs --update-baseline",
                count: violations.length,
                entries: violations,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [DOC-CONFIG-EXAMPLES] baseline régénérée — ${violations.length} entrée(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    // An absent baseline is NOT an empty list: it would declare the docs clean.
    console.error("ERROR [DOC-CONFIG-EXAMPLES]: baseline absente.");
    console.error("  Run: node scripts/check-doc-config-examples.cjs --update-baseline");
    process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(violations);

const fresh = violations.filter((v) => !baseline.has(v)); // CDE-01
const stale = [...baseline].filter((v) => !seen.has(v)).sort(); // CDE-02

console.log(bar);

if (fresh.length === 0 && stale.length === 0) {
    console.log(
        `✅ [DOC-CONFIG-EXAMPLES] ${violations.length} clé(s) invalide(s) gelée(s) — baseline à ` +
            `jour (${files} docs produit, ${blocks} blocs JSON, ${containers} conteneurs fermés).`
    );
    console.log(bar);
    process.exit(0);
}

if (fresh.length > 0) {
    console.error(`❌ [DOC-CONFIG-EXAMPLES/CDE-01] ${fresh.length} clé(s) invalide(s) NEUVE(S) :`);
    for (const v of fresh) console.error(`     + ${v}`);
    console.error(
        "\n  Cette clé n'existe pas dans le schéma qui gouverne ce bloc, et l'objet est\n" +
            "  `additionalProperties: false` : l'exemple est copiable-collable et ferait ÉCHOUER\n" +
            "  `npm run validate:profiles` chez celui qui le recopie. Corriger l'exemple, ou\n" +
            "  déclarer la clé au schéma si elle doit exister."
    );
}

if (stale.length > 0) {
    console.error(
        `\n❌ [DOC-CONFIG-EXAMPLES/CDE-02] ${stale.length} entrée(s) de baseline sans site :`
    );
    for (const v of stale) console.error(`     - ${v}`);
    console.error(
        "\n  Ces exemples ont été corrigés — bonne nouvelle, mais la baseline doit\n" +
            "  l'enregistrer : `--update-baseline`. Une baseline qui garde des entrées mortes\n" +
            "  cesse de mesurer la dette réelle."
    );
}

console.log(bar);
process.exit(1);
