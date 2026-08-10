/**
 * @file prototype-pollution-sinks.guard.test.js
 * @description Test-garde — la blocklist anti-prototype-pollution reste UNIQUE, et les
 * sinks qui l'appliquent restent identifiés.
 *
 * Pourquoi ce garde existe (S13.2, optimisation KERNEL, 18/07/2026)
 * -----------------------------------------------------------------
 * La même liste de 3 clés a vécu en **4 copies divergentes** — `built-in/config/storage`
 * (Array + fonction logueuse), `utils/general/object-utils` (Array, silencieuse),
 * `utils/general/general-utils` — aujourd'hui `utils/general/utils-base` (STRUCT S6) — (Array
 * déclarée DANS le corps récursif de `deepMerge`,
 * donc réallouée à chaque nœud) et `adapters/maplibre/maplibre-style-converter` (Set).
 * Trois sur quatre bloquaient en silence.
 *
 * Le coût de cette dispersion n'est pas théorique : le trou du S5 était un sink qu'une
 * campagne précédente n'avait simplement pas atteint, et le CHANGELOG du S5 annonçait
 * « 4ᵉ copie supprimée » alors qu'il en restait quatre — `maplibre-style-converter`
 * n'avait jamais été comptée. Un décompte à la main ne converge pas ; celui-ci, si.
 *
 * Ce que ce fichier verrouille, et pourquoi chaque verrou :
 *  1. **Anti-recopie** — aucune 5ᵉ copie. C'est le verrou de valeur : sans lui, tout le
 *     reste se re-disperse au premier « je ne veux pas créer d'import ici ».
 *  2. **Inventaire des sinks** — la liste des fichiers qui importent le garde est
 *     explicite, donc en ajouter un oblige à y penser.
 *  3. **Contenu de la blocklist** — personne ne retire une clé en silence. C'est le
 *     revers d'avoir une source unique : elle affaiblit tout d'un coup.
 *  4. **Le gate est vert** — `check-dynamic-key-writes.cjs` exécuté en process, pour
 *     qu'un `npm test` suffise à le voir tomber.
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

/** Files expected to apply the canonical guard. Adding one is a deliberate act. */
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

    // ⚠️ Timeout explicite : cette assertion parse ~473 fichiers TypeScript en AST, dans
    // le process de test. En isolé c'est ~0,4 s ; sous la charge de la suite complète
    // (18 packages en parallèle) elle dépassait les 10 s par défaut et rendait le
    // pipeline rouge par intermittence — le motif exact que ce sprint corrige ailleurs.
    // L'application réelle du gate, elle, passe par ses 3 points de câblage (ci:local,
    // ci.yml, pre-commit) ; cette assertion n'est qu'une commodité pour qu'un `npm test`
    // seul le fasse remonter.
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
