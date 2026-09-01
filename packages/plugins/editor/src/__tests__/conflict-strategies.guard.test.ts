/**
 * Guard — the conflict strategy vocabulary has ONE source, and no second speller.
 *
 * ## What went wrong before, and why nothing was red
 *
 * The vocabulary lived in three places, in three syntactic forms: a union type, the same union
 * re-spelled in the configuration surface, and an array literal in the validator. They agreed —
 * by coincidence, not by construction.
 *
 * 🛑 **The failure was ORIENTED.** Adding a fourth strategy to the union made no test red: the
 * validator kept rejecting the new value and resetting it, while the resolution code handled it
 * fine. The integrator saw a profile value silently reset, with no visible link to the cause.
 * **The copy that VALIDATES is the dangerous one — it decides, and it is the one nobody
 * remembers.**
 *
 * ## The two halves this guard holds
 *
 * ① The validator accepts exactly the source vocabulary, member for member — derived, not
 *    re-listed here either, so a fourth strategy is covered the day it is added.
 * ② **No other source file spells the vocabulary again.** Without this half the first half
 *    passes forever while a fourth copy grows somewhere else, which is precisely the state this
 *    plugin was in.
 *
 * ⚠️ **This guard found a FOURTH copy the day it was written, and the register entry did not
 * name it**: the dispatcher itself, as a chain of `if` ending in a fallback. A fourth strategy
 * fell through to the prompt silently — the same oriented failure as the validator's, at the
 * point where the decision is actually executed. It is now a `Record` keyed by the derived
 * union, so the compiler refuses an incomplete one, and this test exempts it **on that
 * structure** rather than on a promise.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    CONFLICT_STRATEGIES,
    DEFAULT_CONFLICT_STRATEGY,
} from "../persistence/conflict-strategies.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Config read by `getEditorConfig()` through the host bridge. */
const mockConfig: Record<string, unknown> = {};
vi.mock("@geoleaf/host-runtime", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("@geoleaf/host-runtime");
    return {
        ...actual,
        coreConfigGet: (key: string, fallback: unknown) => mockConfig[key] ?? fallback,
        getGeoLeaf: () => ({}),
    };
});

const { getEditorConfig } = await import("../config.js");

/**
 * Strips comments so the default-position guard reads CODE only.
 *
 * 🛑 It was written because the guard fired on its first run against a French prose line that
 * explains the default — a true statement, not a second declaration. Prose that spells the
 * default can still drift, but that is the documentation problem, not the divergence this guard
 * exists to refuse; conflating the two would make the guard cry wolf on every explanation and it
 * would be relaxed away within a sprint.
 *
 * ⚠️ Deliberate limit: string literals are NOT tracked, so a `//` inside a string blinds the rest
 * of that line. Accepted here — the corpus is one plugin's sources and the shapes hunted are
 * assignments, not URLs. Widen the corpus and this shortcut must be revisited.
 *
 * @param {string} text - Source text.
 * @returns {string} The same text with comment spans replaced by spaces.
 */
function stripComments(text) {
    let out = "";
    let block = false;
    for (let i = 0; i < text.length; i++) {
        if (block) {
            if (text[i] === "*" && text[i + 1] === "/") {
                block = false;
                i++;
            }
            continue;
        }
        if (text[i] === "/" && text[i + 1] === "*") {
            block = true;
            i++;
            continue;
        }
        if (text[i] === "/" && text[i + 1] === "/") {
            while (i < text.length && text[i] !== "\n") i++;
            out += "\n";
            continue;
        }
        out += text[i];
    }
    return out;
}

describe("conflict strategies — one source", () => {
    beforeEach(() => {
        for (const k of Object.keys(mockConfig)) delete mockConfig[k];
    });

    it("the source is not empty — otherwise every assertion below guards nothing", () => {
        expect(CONFLICT_STRATEGIES.length).toBeGreaterThanOrEqual(3);
        expect(CONFLICT_STRATEGIES).toContain(DEFAULT_CONFLICT_STRATEGY);
    });

    it.each([...CONFLICT_STRATEGIES])("the validator accepts %s", (strategy) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mockConfig["modules.editor"] = { persistence: { conflictResolution: strategy } };
        const cfg = getEditorConfig();
        warn.mockRestore();
        expect(
            cfg.persistence?.conflictResolution,
            `« ${strategy} » est dans le vocabulaire source mais le validateur l'a refusé — ` +
                `c'est exactement le désalignement que cette source unique existe pour rendre ` +
                `impossible : la copie qui VALIDE décide, et elle décidait seule.`
        ).toBe(strategy);
    });

    it("an unknown strategy is refused, reset to the declared default, and the message LISTS what is known", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mockConfig["modules.editor"] = { persistence: { conflictResolution: "merge-by-hand" } };
        const cfg = getEditorConfig();
        const said = warn.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
        warn.mockRestore();

        expect(cfg.persistence?.conflictResolution).toBe(DEFAULT_CONFLICT_STRATEGY);
        // Naming the accepted values is what turns "your value was reset" into something the
        // integrator can act on without reading the source.
        for (const known of CONFLICT_STRATEGIES) expect(said).toContain(known);
    });

    it("NO other source file re-spells the vocabulary", () => {
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

        // Anti-vacuity: a walk that found nothing would make the assertion below vacuously true.
        expect(files.length).toBeGreaterThan(10);

        const SOURCE = path.join(SRC, "persistence", "conflict-strategies.ts");
        const DISPATCHER = path.join(SRC, "persistence", "conflict-resolution.ts");

        const spellers = files.filter((f) => {
            if (f === SOURCE) return false;
            const text = fs.readFileSync(f, "utf8");
            // A "spelling" is the whole vocabulary quoted in one file — one member alone is a
            // legitimate use (a default, a branch), the SET is a copy.
            if (!CONFLICT_STRATEGIES.every((s) => text.includes(`"${s}"`))) return false;

            // 🛑 The dispatcher is the ONE legitimate exception, and the exemption is CHECKED
            // rather than asserted: its enumeration is a `Record` keyed by the derived union, so
            // the compiler refuses an incomplete one. That is not a copy — it is a projection
            // that cannot diverge. Revert it to a chain of `if` and this test reds again, which
            // is the whole point: the exemption falls with its cause.
            // ⚠️ Anchored on `: Record<` and not `Record<` anywhere, and that
            // is not fussiness: `Partial<Record<ConflictStrategy, …>>` contains
            // the substring yet would make exhaustiveness OPTIONAL — the exact
            // regression this exemption must refuse. Measured: the first
            // witness, written without the anchor, let precisely that mutation through.
            if (f === DISPATCHER && /:\s*Record<\s*ConflictStrategy\s*,/.test(text)) return false;

            return true;
        });

        expect(
            spellers.map((f) => path.relative(SRC, f)),
            `Le vocabulaire est ré-épelé en entier hors de sa source. C'est la quatrième copie, ` +
                `et elle divergera comme les trois premières : importer depuis ` +
                `\`persistence/conflict-strategies.js\` au lieu de recopier.`
        ).toEqual([]);
    });

    // 🛑 The test above stops at the VOCABULARY, deliberately — "a lone member
    // is a legitimate use". That written limit was right, and it still let the
    // costliest class through: a lone member in a DEFAULT position is not a
    // use, it is a second declaration of the default. Measured on 19/08/2026 —
    // two sites still spelled it, one in the file that already IMPORTS the
    // constant and uses it three lines below for the reset. The vocabulary
    // guard could not see them: they cite only one member.
    it("NO source file re-declares the DEFAULT — a lone member in a default position is a copy", () => {
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
        expect(files.length).toBeGreaterThan(10);

        const SOURCE = path.join(SRC, "persistence", "conflict-strategies.ts");
        // Two shapes, and they are the two that were actually found: a `??` fallback, and a
        // `conflictResolution:` entry in a defaults object.
        const shapes = CONFLICT_STRATEGIES.flatMap((s) => [
            `?? "${s}"`,
            `conflictResolution: "${s}"`,
        ]);
        const offenders = files
            .filter((f) => f !== SOURCE)
            .filter((f) => {
                const text = stripComments(fs.readFileSync(f, "utf8"));
                return shapes.some((sh) => text.includes(sh));
            })
            .map((f) => path.relative(SRC, f));

        expect(
            offenders,
            `Le défaut est re-déclaré en littéral hors de sa source. Deux déclarations d'un ` +
                `même défaut ne divergent pas bruyamment : l'une change, l'autre reste, et la ` +
                `configuration livrée cesse de correspondre à sa documentation sans qu'aucun ` +
                `test ne rougisse. Importer \`DEFAULT_CONFLICT_STRATEGY\`.`
        ).toEqual([]);
    });
});
