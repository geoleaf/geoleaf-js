/*!
 * @geoleaf-plugins/measure — dictionary parity
 * © 2026 Mattieu Pottier — MIT License
 *
 * Added at PLUGINS S5. The CDC §2.11 requires "mêmes clés partout, FR = fallback", but
 * nothing enforced it: adding a key to one locale and forgetting the other five left the
 * raw key rendered in the UI, and only a native speaker of the missed language would
 * notice. This suite is that enforcement.
 */
import { describe, it, expect } from "vitest";
import lang_fr from "../lang/lang-fr.js";
import lang_en from "../lang/lang-en.js";
import lang_de from "../lang/lang-de.js";
import lang_es from "../lang/lang-es.js";
import lang_it from "../lang/lang-it.js";
import lang_pt from "../lang/lang-pt.js";

/** FR is the reference: the CDC designates it as the fallback dictionary. */
const REFERENCE = lang_fr;

const OTHERS: Record<string, Record<string, string>> = {
    en: lang_en,
    de: lang_de,
    es: lang_es,
    it: lang_it,
    pt: lang_pt,
};

describe("measure dictionaries", () => {
    it.each(Object.keys(OTHERS))("%s declares exactly the same keys as fr", (locale) => {
        const refKeys = Object.keys(REFERENCE).sort();
        const keys = Object.keys(OTHERS[locale]).sort();
        expect(keys).toEqual(refKeys);
    });

    it.each(Object.keys(OTHERS))("%s leaves no value empty", (locale) => {
        const empty = Object.entries(OTHERS[locale])
            .filter(([, value]) => value.trim() === "")
            .map(([key]) => key);
        expect(empty).toEqual([]);
    });

    it("fr leaves no value empty", () => {
        const empty = Object.entries(REFERENCE)
            .filter(([, value]) => value.trim() === "")
            .map(([key]) => key);
        expect(empty).toEqual([]);
    });

    it("carries the aria label the annotation delete button resolves", () => {
        // Pinned because it was hardcoded French in the DOM until PLUGINS S5.
        for (const [locale, dict] of Object.entries({ fr: REFERENCE, ...OTHERS })) {
            expect(dict["measure.aria.deleteAnnotation"], locale).toBeTruthy();
        }
    });
});
