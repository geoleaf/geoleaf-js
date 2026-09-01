/**
 * @file prototype-pollution-sinks.guard.test.js
 * @description Guard test — the anti-prototype-pollution blocklist stays UNIQUE, and the
 * sinks qui l'appliquent restent identifiés.
 *
 * Why this guard exists (18/07/2026)
 * -----------------------------------------------------------------
 * The same 3-key list lived in **4 divergent copies** —
 * `built-in/config/storage` (Array + logging function),
 * `utils/general/object-utils` (Array, silent),
 * `utils/general/general-utils` — today `utils/general/utils-base` — (Array
 * declared INSIDE `deepMerge`'s recursive body, hence reallocated at every
 * node) and `adapters/maplibre/maplibre-style-converter` (Set). Three of
 * four blocked silently.
 *
 * The dispersion's cost is not theoretical: an earlier hole was a sink a
 * previous campaign had simply not reached, and the CHANGELOG announced "4th
 * copy deleted" while four remained — `maplibre-style-converter` had never
 * been counted. A hand tally does not converge; this one does.
 *
 * What this file locks, and why each lock:
 *  1. **Anti-recopy** — no 5th copy. The value lock: without it, everything
 *     else re-disperses at the first "I don't want to create an import here".
 *  2. **Sink inventory** — the list of files importing the guard is
 *     explicit, so adding one forces thinking about it.
 *  3. **Blocklist content** — nobody removes a key silently. The flip side
 *     of a single source: it weakens everything at once.
 *  4. **The gate is green** — `check-dynamic-key-writes.cjs` run in-process,
 *     so a bare `npm test` suffices to see it fall.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
    isUnsafeKey,
    hasUnsafeSegment,
    UNSAFE_KEY_LIST,
} from "../../src/utils/general/object-path-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SRC = path.join(REPO_ROOT, "packages", "core", "src");
const GUARD_FILE = path.join(SRC, "utils", "general", "object-path-guard.ts");

/**
 * Files expected to apply the canonical guard. Adding one is a deliberate act.
 *
 * ⚠️ This list is an INVENTORY, not a sample: the reciprocal assertion below
 * refuses that a guard importer not appear in it. The grouping comment is
 * each entry's useful half — it says WHICH untrusted data transits, which a
 * glob of the importers would not say.
 */
const EXPECTED_SINK_FILES = [
    // Untrusted profile JSON lands here — the config write paths.
    "kernel/config/storage.ts",
    "kernel/config/geoleaf-config/module-config.ts",
    "kernel/config/profile-loader.ts",
    "kernel/config/profile-loader-helpers.ts",
    // Public path/merge utilities, reachable from integrator code.
    "utils/general/object-utils.ts",
    "utils/general/utils-base.ts", // ex-`general-utils.ts`, renommé au STRUCT S6 (N3)
    // Style JSON → MapLibre paint objects.
    "adapters/maplibre/maplibre-style-converter.ts",
    // Feature properties → DOM widgets: the keys come from the served
    // GeoJSON, and the copied object leaves in a `CustomEvent`. A `__proto__`
    // key would be invisible to `Object.keys()` there.
    "capabilities/feature-info/render/widget-dispatch.ts",
    // Layer ids from the profile (`JSON.parse`) aggregated into a per-layer report.
    "capabilities/offline/db/indexeddb.ts",
    // Same, reread from the LOCAL store — written by several code versions,
    // and it survives deployments: "local" is not "trusted".
    "capabilities/offline/report/pull-state.ts",
    // Profile property names copied into the HTTP body pushed upstream.
    "capabilities/offline/write/push-engine.ts",
];

function walkTs(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkTs(full, out);
        else if (entry.name.endsWith(".ts")) out.push(full);
    }
    return out;
}

describe("@security garde d'inventaire — blocklist anti-prototype-pollution", () => {
    it("est la SEULE déclaration de blocklist du core (pas de 5e copie)", () => {
        // Any array/Set literal that spells "__proto__" is a blocklist being reborn.
        // Narrow on purpose: a mere mention of the string (a test fixture, a doc
        // comment, an `isUnsafeKey("__proto__")` call) is not a declaration.
        const offenders = [];
        for (const file of walkTs(SRC)) {
            if (path.resolve(file) === path.resolve(GUARD_FILE)) continue;
            const src = fs.readFileSync(file, "utf8");
            const declares =
                /\[\s*["']__proto__["']\s*,/.test(src) ||
                /new Set\(\s*\[\s*["']__proto__["']/.test(src);
            if (declares) offenders.push(path.relative(REPO_ROOT, file).split(path.sep).join("/"));
        }
        expect(
            offenders,
            `Blocklist redéclarée hors du module canonique :\n  ${offenders.join("\n  ")}\n` +
                "Importer `isUnsafeKey`/`hasUnsafeSegment` depuis " +
                "utils/general/object-path-guard.js. Ce module n'a AUCUN import, " +
                "donc il est importable depuis n'importe quelle couche sans créer d'arête."
        ).toEqual([]);
    });

    it("est appliquée par chacun des sinks recensés", () => {
        const missing = EXPECTED_SINK_FILES.filter((rel) => {
            const src = fs.readFileSync(path.join(SRC, rel), "utf8");
            return !src.includes("object-path-guard.js");
        });
        expect(
            missing,
            `Ces sinks n'importent plus le garde canonique :\n  ${missing.join("\n  ")}`
        ).toEqual([]);
    });

    // ⚠️ The RECIPROCAL assertion of the previous one, and it is what makes
    // the constant an inventory. Without it, `EXPECTED_SINK_FILES` only
    // guarantees an inclusion: "the 7 listed import the guard" came out
    // green while 11 files imported it. The gap of 4 stayed visible ten days
    // — and it only showed when looked for.
    //
    // 🛑 Why a HAND-WRITTEN list and not a glob of the importers: deriving
    // the expected list from the same source as the observed one makes the
    // assertion tautological — it could NEVER turn red again. The
    // "structural green" CLAUDE.md forbids. The constant thus keeps its own
    // value: it says WHY each sink is a sink (the grouping comments), which
    // a glob does not say.
    it("recense chaque importateur du garde (réciproque — pas d'ajout silencieux)", () => {
        // A real import, not a mention: two files cite the module in a
        // `{@link module:…}` on top of importing it, and a mention alone does
        // not make a sink.
        const IMPORTS_GUARD = /from\s+["'][^"']*object-path-guard\.js["']/;
        const listed = new Set(EXPECTED_SINK_FILES);
        const unlisted = [];
        for (const file of walkTs(SRC)) {
            if (path.resolve(file) === path.resolve(GUARD_FILE)) continue;
            if (!IMPORTS_GUARD.test(fs.readFileSync(file, "utf8"))) continue;
            const rel = path.relative(SRC, file).split(path.sep).join("/");
            if (!listed.has(rel)) unlisted.push(rel);
        }
        expect(
            unlisted,
            `Ces fichiers importent le garde sans figurer dans EXPECTED_SINK_FILES :\n  ${unlisted.join("\n  ")}\n` +
                "Les ajouter à la constante, AVEC le commentaire disant quelle donnée non " +
                "fiable y transite — c'est ce commentaire qui fait la valeur de l'inventaire."
        ).toEqual([]);
    });

    it("contient exactement les 3 clés dangereuses", () => {
        // Single source ⇒ removing one entry weakens every sink at once, silently.
        expect([...UNSAFE_KEY_LIST].sort()).toEqual(["__proto__", "constructor", "prototype"]);
    });

    it("refuse les 3 clés et laisse passer les clés légitimes", () => {
        for (const key of UNSAFE_KEY_LIST) expect(isUnsafeKey(key)).toBe(true);
        for (const key of ["poi", "filters", "basemaps", "__protot", "proto", ""]) {
            expect(isUnsafeKey(key)).toBe(false);
        }
    });

    it("hasUnsafeSegment couvre le dernier segment (le trou du S5)", () => {
        expect(hasUnsafeSegment(["__proto__"])).toBe(true); // single segment, no descent
        expect(hasUnsafeSegment(["a", "b", "__proto__"])).toBe(true); // last one
        expect(hasUnsafeSegment(["__proto__", "a"])).toBe(true); // first one
        expect(hasUnsafeSegment(["a", "b", "c"])).toBe(false);
        expect(hasUnsafeSegment([])).toBe(false);
    });

    // ⚠️ Explicit timeout: this assertion parses ~473 TypeScript files as
    // AST, in the test process. Isolated it is ~0.4 s; under the full
    // suite's load (18 packages in parallel) it exceeded the default 10 s
    // and turned the pipeline red intermittently — the exact motive fixed
    // elsewhere. The gate's real application goes through its 3 wiring
    // points (ci:local, ci.yml, pre-commit); this assertion is only a
    // convenience so a bare `npm test` surfaces it.
    it("le gate check-dynamic-key-writes est vert", () => {
        const require_ = createRequire(import.meta.url);
        const { collectFindings } = require_(
            path.join(REPO_ROOT, "scripts", "check-dynamic-key-writes.cjs")
        );
        const baseline = JSON.parse(
            fs.readFileSync(
                path.join(REPO_ROOT, "scripts", "check-dynamic-key-writes.baseline.json"),
                "utf8"
            )
        );
        const known = new Set(baseline.sinks);
        const fresh = collectFindings()
            .filter((f) => !known.has(f.key))
            .map((f) => `${f.file}:${f.line} (${f.fn})`);
        expect(
            fresh,
            `Écriture(s) à clé dynamique non gardée(s) et hors baseline :\n  ${fresh.join("\n  ")}`
        ).toEqual([]);
    }, 60_000);
});
