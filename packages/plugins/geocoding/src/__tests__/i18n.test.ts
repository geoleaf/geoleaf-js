/**
 * Test suite: plugin-geocoding i18n dictionaries — audit C-5
 *
 * C-5: the plugin shipped NESTED dictionaries (`{ geocoding: { control: {…} } }`)
 * while the core i18n table is FLAT — `getLabel` indexes the merged table directly
 * and never splits on ".". Every key resolved to nothing, and the hardcoded French
 * fallback of `t(key, fallback)` masked it: French in every locale, and a raw key
 * (`aria-label="geocoding.toolbar.button"`) on the mobile toolbar button, which has
 * no fallback at all.
 *
 * What made C-5 invisible was that no test exercised the seam that actually broke:
 * "is the key the code asks for the key the dictionary provides?". `control.test.ts`
 * asserted the French fallback without ever mounting `GeoLeaf.I18n.getLabel`, so it
 * stayed green on the broken code — and would have stayed green after the fix.
 *
 * These tests exercise that seam. They fail if a dictionary goes back to a nested
 * shape, drops a key, or typos one.
 *
 * Shape across the whole monorepo is additionally gated by
 * `scripts/check-i18n-dict-shape.cjs` (npm run check-i18n-shape).
 */

import { describe, it, expect } from "vitest";

import langFr from "../lang/lang-fr.js";
import langEn from "../lang/lang-en.js";
import langEs from "../lang/lang-es.js";
import langPt from "../lang/lang-pt.js";
import langIt from "../lang/lang-it.js";
import langDe from "../lang/lang-de.js";

/**
 * Every key the plugin asks the core for.
 * Sources: `control.ts` (via `t()`) and `entry.ts` (`labelKey`).
 * `geocoding.toolbar.button` is the one with NO fallback — `mobile-toolbar-pill.ts`
 * calls `getLabel` bare, so an unresolved key is rendered verbatim to the user.
 */
const REQUESTED_KEYS = [
    "geocoding.toolbar.button",
    "geocoding.control.placeholder",
    "geocoding.control.searchAriaLabel",
    "geocoding.control.submitAriaLabel",
    "geocoding.control.clearAriaLabel",
] as const;

const DICTS: Array<[string, Record<string, unknown>]> = [
    ["fr", langFr],
    ["en", langEn],
    ["es", langEs],
    ["pt", langPt],
    ["it", langIt],
    ["de", langDe],
];

describe("geocoding i18n dictionaries (C-5)", () => {
    it.each(DICTS)("lang-%s provides every key the code requests, flat", (_code, dict) => {
        for (const key of REQUESTED_KEYS) {
            expect(typeof dict[key]).toBe("string");
            expect((dict[key] as string).length).toBeGreaterThan(0);
        }
    });

    it.each(DICTS)("lang-%s is flat — no nested object would ever resolve", (_code, dict) => {
        for (const value of Object.values(dict)) {
            expect(typeof value).toBe("string");
        }
    });

    it.each(DICTS)("lang-%s declares no key beyond what the code requests", (_code, dict) => {
        expect(Object.keys(dict).sort()).toEqual([...REQUESTED_KEYS].sort());
    });

    it("English is actually English — the C-5 symptom was French leaking into en", () => {
        expect(langEn["geocoding.toolbar.button"]).toBe("Address search");
        expect(langEn["geocoding.control.placeholder"]).toBe("Search for an address…");
        // The exact bug: `en` silently served the French string.
        expect(langEn["geocoding.control.placeholder"]).not.toBe(
            langFr["geocoding.control.placeholder"]
        );
    });

    it("every locale differs from French on the placeholder", () => {
        for (const [code, dict] of DICTS) {
            if (code === "fr") continue;
            expect(dict["geocoding.control.placeholder"]).not.toBe(
                langFr["geocoding.control.placeholder"]
            );
        }
    });
});
