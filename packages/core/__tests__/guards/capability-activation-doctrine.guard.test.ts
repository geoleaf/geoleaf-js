/**
 * Guard CAD — every in-core capability's default-activation choice follows a WRITTEN doctrine,
 * so the next capability cannot arrive without passing in front of it.
 *
 * ## The doctrine, in two sentences
 *
 * An INTERFACE capability — one that presents data already there (controls, panels, symbols,
 * URL state) — is active by default: `enableWhenAbsent: true`. A capability that CONSUMES a
 * resource the profile did not already pay for — network fetches of its own, device storage,
 * a service worker — is opt-in: it activates only when a profile asks. The line between the
 * two is the RESOURCE, not the rendering: presenting costs nothing a profile didn't already
 * spend, consuming does.
 *
 * ## Why a rule and not eighteen verdicts
 *
 * Reviewing the existing declarations one by one would have produced eighteen judgments that
 * nothing replays: the nineteenth capability would ship without passing in front of anyone.
 * A written rule plus a named-exceptions list is the same review made repeatable — this guard
 * IS the review, and a new capability directory fails CAD-01 until someone classifies it here
 * with its motive.
 *
 * ## The named exceptions, each with the motive that earned it
 *
 *   - `branding` is interface-shaped yet OPT-IN: it does not present existing data, it ADDS
 *     content (a text overlay) that no profile asked for. Default-on would print something on
 *     every map that never configured it. The distinction is additive-content vs presentation.
 *   - `vector-tiles` declares NO module gate at all: activation is decided per LAYER
 *     (`data.vectorTiles` on the layer definition), which is the honest shape — there is no
 *     meaningful map-wide answer to "use tiles?". Its capability sheet records the same fact.
 *
 * ## The rules
 *
 *   CAD-01  Every capability directory is classified in exactly one list below. An unlisted
 *           directory is the guard's whole point: the new arrival must be judged.
 *   CAD-02  INTERFACE capabilities declare `enableWhenAbsent: true` somewhere in their
 *           sources; CONSUMER capabilities never do; UNGATED ones declare no gate flag at all.
 *   CAD-03  The corpus cannot be empty or implausibly small — a broken glob must not read as
 *           a clean repository. Same class as MFC-03.
 *
 * ⚠️ The flag is matched in CODE, never in comments. The raw grep returns 42 occurrences of
 * the token where only 18 are declarations — every capability documents the field before
 * declaring it. Stripping comments first is what makes 18 the true count; asserting on the
 * raw text would freeze the documentation style instead of the behavior.
 *
 * ## Mutation proof — replay before trusting this guard
 *
 * Adding `enableWhenAbsent: true` to `pwa-capability.ts` must turn CAD-02 red naming `pwa`;
 * creating `src/capabilities/__fake22__/` with any .ts must turn CAD-01 red naming it.
 * Both seen red on 2026-08-18 at introduction, then restored byte-identical.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CAPABILITIES_DIR = resolve(__dirname, "../../src/capabilities");

/** Interface capabilities — present what is already there; active by default. */
const INTERFACE = new Set([
    "cluster",
    "coordinates",
    "feature-info",
    "filter",
    "geolocation",
    "labels",
    "language-switcher",
    "legend",
    "permalink",
    "profile-switcher",
    "route",
    "scale",
    "taxonomy",
    "theme-palette",
    "theme-selector",
    "theme-toggle",
    "toast-renderer",
]);

/** Resource consumers — network, storage, workers; opt-in by a profile. */
const CONSUMER = new Set(["offline", "pwa"]);

/** Named exceptions — each carries its motive in the header above. */
const EXCEPTIONS = new Set([
    "branding", // additive content, not presentation → opt-in despite being UI-shaped
    "vector-tiles", // no module gate at all — activation is per layer, by design
]);

/**
 * Strips block and line comments so the flag is matched in code only.
 *
 * This is the 42→18 trap from the measurement: every capability documents
 * `enableWhenAbsent` in prose before declaring it, so a raw text search counts
 * documentation as declarations.
 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** True when any non-test source of the directory declares `enableWhenAbsent: true` in code. */
function declaresDefaultOn(dir: string): boolean {
    const walk = (d: string): string[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) => {
            if (e.isDirectory()) {
                return e.name === "__tests__" || e.name === "__mocks__"
                    ? []
                    : walk(join(d, e.name));
            }
            return e.name.endsWith(".ts") && !/\.(test|spec)\./.test(e.name)
                ? [join(d, e.name)]
                : [];
        });
    return walk(dir).some((f) =>
        /enableWhenAbsent:\s*true/.test(stripComments(readFileSync(f, "utf8")))
    );
}

describe("capability activation doctrine (CAD)", () => {
    const dirs = readdirSync(CAPABILITIES_DIR).filter((n) =>
        statSync(join(CAPABILITIES_DIR, n)).isDirectory()
    );

    it("CAD-03 — the corpus is plausibly complete", () => {
        // The repository ships 21 capabilities; anything far below signals a broken path,
        // not a cleaned-up repository.
        expect(dirs.length).toBeGreaterThanOrEqual(20);
    });

    it("CAD-01 — every capability is classified, exactly once", () => {
        const unlisted = dirs.filter(
            (d) => !INTERFACE.has(d) && !CONSUMER.has(d) && !EXCEPTIONS.has(d)
        );
        expect(
            unlisted,
            `unclassified capability directory(ies): ${unlisted.join(", ")} — a new capability ` +
                `must be judged against the activation doctrine (interface → default-on, ` +
                `resource consumer → opt-in) and added to the matching list WITH ITS MOTIVE.`
        ).toEqual([]);

        const doubly = dirs.filter(
            (d) =>
                (INTERFACE.has(d) && CONSUMER.has(d)) ||
                (INTERFACE.has(d) && EXCEPTIONS.has(d)) ||
                (CONSUMER.has(d) && EXCEPTIONS.has(d))
        );
        expect(doubly, `classified twice: ${doubly.join(", ")}`).toEqual([]);

        // Lists must not carry ghosts either — a renamed directory would otherwise leave its
        // old name classified forever, and the count would read as coverage.
        const ghosts = [...INTERFACE, ...CONSUMER, ...EXCEPTIONS].filter((d) => !dirs.includes(d));
        expect(ghosts, `classified but absent from disk: ${ghosts.join(", ")}`).toEqual([]);
    });

    it("CAD-02 — the declaration matches the classification", () => {
        const wrong: string[] = [];
        for (const d of dirs) {
            const on = declaresDefaultOn(join(CAPABILITIES_DIR, d));
            if (INTERFACE.has(d) && !on)
                wrong.push(`${d} (interface, expected enableWhenAbsent: true)`);
            if (CONSUMER.has(d) && on) wrong.push(`${d} (consumer, must stay opt-in)`);
            if (EXCEPTIONS.has(d) && on)
                wrong.push(`${d} (named exception, must stay opt-in/ungated)`);
        }
        expect(wrong, wrong.join(" · ")).toEqual([]);
    });
});
