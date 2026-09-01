/**
 * Guard — the events seam is a constant module export, and NO fallback may rest on its absence.
 *
 * ## Why this guard exists, and what it watches now
 *
 * Call sites in this package used to be written `if (events) { … } else { … }`. In production
 * the condition is always true: `events` is an object literal exported at module scope, so the
 * `else` branch never ran. Test suites that neutralised the seam once made those fallbacks look
 * covered — a fiction; once the suites mocked the seam faithfully the fallbacks were covered by
 * nothing and their removal broke no test.
 *
 * The decision this file was built to inform was taken on 25/08/2026: all twelve premise-
 * dependent sites were removed — the three `if (events)` sites this guard originally pinned,
 * plus nine twins spelled against the raw import name, which the original regex could not see
 * (no word boundary splits the underscore). The guard now watches BOTH spellings, and the
 * pinned list is empty: any new fallback, in either spelling, is written against a premise the
 * first two assertions prove unnecessary — it must show up here and be decided, not slip in.
 *
 * ⚠️ **Do not spell the neutralisation motif in prose here.** Quoting it makes this file
 * indistinguishable from a real neutralisation for any completeness grep — the trap that
 * produced a false positive three times in one lot.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { events } from "../utils/events.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("events seam — the premise the fallbacks rest on", () => {
    it("is a live object at module scope, with the members its callers use", () => {
        expect(events).toBeTruthy();
        expect(typeof events).toBe("object");
        expect(typeof events.on).toBe("function");
        expect(typeof events.off).toBe("function");
    });

    it("is a CONSTANT export — no code path can make it null", () => {
        // The property the fallbacks rest on, read where it is decided rather than inferred
        // from behaviour: the seam is declared `export const … = { … }`, an object literal at
        // module scope. There is no assignment, no conditional construction, no re-export that
        // could yield undefined.
        const src = fs.readFileSync(path.join(SRC, "utils", "events.ts"), "utf8");

        expect(
            /export\s+const\s+events\s*=\s*\{/.test(src),
            "le seam n'est plus un littéral d'objet exporté en constante — la propriété sur " +
                "laquelle reposent les trois replis vient de changer de nature, et la décision " +
                "de les retirer doit être reprise avec cette mesure-ci."
        ).toBe(true);

        // No later re-assignment of the binding, which `const` forbids but a re-export could
        // route around.
        expect(/\bevents\s*=/.test(src.replace(/export\s+const\s+events\s*=/, ""))).toBe(false);
    });

    it("names the call sites that depend on the premise — so the decision has its list", () => {
        const files: string[] = [];
        const walk = (dir: string): void => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (!["__tests__", "__mocks__", "node_modules", "dist"].includes(e.name)) {
                        walk(p);
                    }
                } else if (e.name.endsWith(".ts")) {
                    files.push(p);
                }
            }
        };
        walk(SRC);

        // Anti-vacuity: a walk that found nothing would make the count below meaningless.
        expect(files.length).toBeGreaterThan(5);

        const guarded = files
            .filter((f) => /\bif\s*\(\s*_?events\s*\)/.test(fs.readFileSync(f, "utf8")))
            .map((f) => path.relative(SRC, f))
            .sort();

        // Empty since 25/08/2026, when the twelve premise-dependent sites were removed. A NEW
        // fallback would be written against a premise this very file proves unnecessary — it
        // must appear in this list and be decided, not slip in silently.
        expect(guarded).toEqual([]);
    });
});
