/**
 * @file style-operators-single-source.guard.test.ts
 * @description Guard test — the style operator table stays UNIQUE, and every
 * other operator list in the repo stays EQUAL to it.
 *
 * Why this guard exists (17/08/2026)
 * ---------------------------------------------------------
 * The 16 operators of `styleRules[].when.operator` lived in **three copies**:
 *  1. `GeoJSONShared.STYLE_OPERATORS` (shared.ts) — the original;
 *  2. `DEFAULT_STYLE_OPERATORS` (style-resolver.ts), presented as a
 *     "fallback", in reality byte-for-byte identical — adding an operator to
 *     one gave different behaviour depending on which call site resolved;
 *  3. `VALID_RULE_OPERATORS` (style-validator-rules.ts), a hand-written array
 *     of **8** operators out of 16 — the only PARTIAL one, hence the only one
 *     whose drift nobody saw. The validator refused styles the engine renders
 *     correctly.
 *
 * All three are closed: `style-operators.ts` is the single declaration, and
 * the two consumers derive it. **What nothing prevented is the fourth.**
 *
 * 🛑 What this file does NOT do, and why — the equality literally requested
 * by the arbitration (`VALID_RULE_OPERATORS === Object.keys(STYLE_OPERATORS)`)
 * is NOT written: it is TAUTOLOGICAL by construction.
 * `style-validator-rules.ts` is exactly
 * `const VALID_RULE_OPERATORS = Object.keys(STYLE_OPERATORS)` — the
 * assertion would compare the thing with itself and could never turn red.
 * That is the "structural green" `CLAUDE.md` forbids, and the motive for
 * which the arbitration itself ruled out its "equality only" variant. The
 * equality written here bears on the repo's only list that is HAND-HELD and
 * can therefore really diverge: the JSON schema's `enum`.
 *
 * What this file locks, and why each lock:
 *  1. **Schema ↔ engine equality** — `style.schema.json` carries the 16
 *     operators as an `enum`, hand-maintained, in a file no compiler ties to
 *     the code. A 17th operator added on one side makes "what the profile
 *     may declare" diverge from "what the engine can evaluate". Turns red BOTH ways.
 *  2. **Anti-recopy** — no 4th hand-written copy in the sources.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { STYLE_OPERATORS } from "../../src/kernel/geojson/style-operators.js";

/** The shape of the CommonJS module under test, described here because it emits no types. */
interface PackagesLib {
    all(): ReadonlyArray<{ absDir: string; name: string }>;
}

/** The profile schema's operator `enum` — the only piece read here. */
interface StyleSchema {
    definitions: { styleCondition: { properties: { operator: { enum: string[] } } } };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const requireCjs = createRequire(import.meta.url);

/** Canonical declaration — the only file allowed to spell the table. */
const CANONICAL = path.join(
    REPO_ROOT,
    "packages",
    "core",
    "src",
    "kernel",
    "geojson",
    "style-operators.ts"
);

const OPERATORS = Object.keys(STYLE_OPERATORS);

/**
 * Strips block and line comments.
 *
 * ⚠️ Indispensable, not a convenience: `style-operators.ts` and
 * `style-validator-rules.ts` CITE the operator names in prose to explain the
 * fix that closed the 3rd copy. A guard reading the comments would punish
 * having documented — a defect already measured elsewhere in this repo.
 *
 * The line pattern's `[^:]` spares URLs' `://` (`https://geoleaf.dev` in
 * each file's licence header).
 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Sources to scan: each package's `src/`, derived from `packages.cjs`.
 *
 * ⚠️ Never a `packages/**` glob — it would catch `dist/` and `node_modules/`,
 * where the compiled bundle legitimately contains the table and would turn
 * the guard red on its own output.
 */
function sourceFiles(): string[] {
    const packages = requireCjs(
        path.join(REPO_ROOT, "scripts", "lib", "packages.cjs")
    ) as PackagesLib;
    const out: string[] = [];
    for (const pkg of packages.all()) {
        const srcDir = path.join(pkg.absDir, "src");
        if (!fs.existsSync(srcDir)) continue;
        walk(srcDir, out);
    }
    return out;
}

function walk(dir: string, out: string[]): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) out.push(full);
    }
    return out;
}

describe("garde de source unique — opérateurs de style", () => {
    // Anti-empty-gate assertion: if `packages.cjs` stopped resolving, or
    // `src/` were renamed, the guard would sweep 0 files and come out GREEN
    // guarding nothing.
    it("balaie un corpus non vide", () => {
        expect(sourceFiles().length).toBeGreaterThan(100);
        expect(OPERATORS.length).toBeGreaterThan(10);
    });

    it("l'enum du schéma de profil est ÉGAL à la table du moteur", () => {
        const schemaPath = path.join(REPO_ROOT, "profiles", "schemas", "style.schema.json");
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as StyleSchema;
        const enumerated = schema.definitions.styleCondition.properties.operator.enum;

        // Set comparison: the two lists' ORDER carries nothing (one is a JS
        // object, the other a JSON Schema enum), and imposing it would turn
        // red on a cosmetic reshuffle — a red one would learn to ignore.
        const inSchemaOnly = enumerated.filter((op) => !OPERATORS.includes(op));
        const inEngineOnly = OPERATORS.filter((op) => !enumerated.includes(op));
        expect(
            { inSchemaOnly, inEngineOnly },
            "Le schéma de profil et la table du moteur ont divergé.\n" +
                `  déclarables par un profil mais non évalués : ${inSchemaOnly.join(", ") || "—"}\n` +
                `  évalués mais refusés à la déclaration      : ${inEngineOnly.join(", ") || "—"}\n` +
                "Les deux fichiers : profiles/schemas/style.schema.json (enum) et " +
                "packages/core/src/kernel/geojson/style-operators.ts (table)."
        ).toEqual({ inSchemaOnly: [], inEngineOnly: [] });
    });

    // 🛑 The threshold of 3 is arbitrary and it is PROVEN, not assumed: under
    // 3, a legitimate array like `["<", ">"]` (an interval's bounds) would
    // turn red; above, a partial copy would pass — and precisely a PARTIAL
    // copy, the 8-of-16 one, cost the most of the three.
    //
    // ⚠️ Perimeter: the `src/` only, not the `__tests__/`. Measured on
    // 17/08/2026 — three test files legitimately enumerate the operators to
    // exercise them one by one (`s14-style-rules-operators`,
    // `s14-styles-anomalies-lock`, `style-validator-rules`). Including them
    // would turn the guard red on files whose enumeration IS the reason to
    // exist. What this perimeter leaves out is logged as a finding, not forgotten.
    it("aucune 4ᵉ copie manuscrite dans les sources", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles()) {
            if (path.resolve(file) === path.resolve(CANONICAL)) continue;
            const src = stripComments(fs.readFileSync(file, "utf8"));
            // An array literal, no nested array — sufficient: an operator
            // list is flat by nature.
            for (const literal of src.match(/\[[^[\]]*\]/g) || []) {
                const strings = [...literal.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
                const hits = new Set(strings.filter((s) => OPERATORS.includes(s)));
                if (hits.size >= 3) {
                    offenders.push(
                        `${path.relative(REPO_ROOT, file).split(path.sep).join("/")} → [${[...hits].join(", ")}]`
                    );
                }
            }
        }
        expect(
            offenders,
            `Liste(s) d'opérateurs réécrite(s) à la main hors du module canonique :\n  ${offenders.join("\n  ")}\n` +
                "Dériver de `Object.keys(STYLE_OPERATORS)` " +
                "(kernel/geojson/style-operators.js), comme le fait style-validator-rules.ts. " +
                "Une copie PARTIELLE est le cas dangereux : elle rend un comportement " +
                "différent selon le point d'appel, et rien ne la signale."
        ).toEqual([]);
    });
});
