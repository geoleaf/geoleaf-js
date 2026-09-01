/**
 * @geoleaf-plugins/navigation — i18n dictionary shape
 *
 * The two dictionaries must declare the SAME key set. A key present on one side only does not
 * fail: `GeoLeaf.I18n.getLabel` indexes the merged table and silently falls back, so the string
 * renders in the other language and nobody notices until a user does.
 *
 * The keys must also be FLAT and dotted. `getLabel` never splits on ".", so a nested dictionary
 * resolves to nothing — that is audit C-5, and it is the reason the source files carry a
 * `satisfies Record<string, string>` that this test would not catch on its own.
 */
import { describe, it, expect } from "vitest";
import fr from "../lang/lang-fr.js";
import en from "../lang/lang-en.js";

describe("@geoleaf-plugins/navigation — dictionaries", () => {
    it("is not measuring an empty corpus", () => {
        // Both files could export `{}` and every assertion below would pass.
        expect(Object.keys(fr).length).toBeGreaterThan(0);
    });

    it("declares the same key set in both languages", () => {
        expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    });

    it("carries only flat, dotted keys prefixed by the plugin id", () => {
        for (const k of Object.keys(fr)) {
            expect(k.startsWith("navigation.")).toBe(true);
            expect(typeof (fr as Record<string, unknown>)[k]).toBe("string");
            expect(typeof (en as Record<string, unknown>)[k]).toBe("string");
        }
    });
});
