/*!
 * Tests — the library OWNS its `form.*` labels
 *
 * 🛑 THE CENTRAL GUARD IS THE "HOSTLESS" ONE. Before this work, `_getLabel`
 * fell back to the RAW KEY: a host loading the lib alone showed
 * `form.error.imageSize` to the user. The tests below therefore run
 * **without `globalThis.GeoLeaf`**, precisely the case nobody covered.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { builtinLabel, builtinLangs, FALLBACK_LANG } from "../lang/index.js";
import { _getLabel } from "../helpers.js";
// ⚠️ Prefixed `L_`: the Italian locale would import under the name `it`,
// already vitest's test function. The collision breaks the parser, not the test.
import L_fr from "../lang/lang-fr.js";
import L_en from "../lang/lang-en.js";
import L_es from "../lang/lang-es.js";
import L_de from "../lang/lang-de.js";
import L_it from "../lang/lang-it.js";
import L_pt from "../lang/lang-pt.js";

const ALL = { fr: L_fr, en: L_en, es: L_es, de: L_de, it: L_it, pt: L_pt };
const fr = L_fr;
const en = L_en;
const de = L_de;

beforeEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
});
afterEach(() => {
    delete (globalThis as Record<string, unknown>).GeoLeaf;
});

// --- the catalogue itself ----------------------------------------------------------

describe("Le catalogue intégré", () => {
    it("porte les six locales du dépôt", () => {
        expect(builtinLangs().sort()).toEqual(["de", "en", "es", "fr", "it", "pt"]);
    });

    it("🛑 les six locales sont à PARITÉ STRICTE de clés", () => {
        // A locale losing a key returns a label in another language —
        // readable, but a silent drift better seen here.
        const refs = Object.keys(fr).sort();
        for (const [loc, dict] of Object.entries(ALL)) {
            expect(Object.keys(dict).sort(), `locale ${loc}`).toEqual(refs);
        }
    });

    it("aucune valeur vide, aucune valeur égale à sa clé", () => {
        for (const [loc, dict] of Object.entries(ALL)) {
            for (const [k, v] of Object.entries(dict)) {
                expect(v.length, `${loc}/${k}`).toBeGreaterThan(0);
                expect(v, `${loc}/${k}`).not.toBe(k);
            }
        }
    });

    it("ne contient QUE des clés `form.*` — la lib ne s'approprie rien d'autre", () => {
        for (const k of Object.keys(fr)) expect(k).toMatch(/^form\./);
    });

    it("les locales portent des textes RÉELLEMENT distincts", () => {
        // Counter-check against a generation that copied the French everywhere.
        const k = "form.error.imageSize";
        expect(fr[k]).toBeDefined();
        expect(new Set([fr[k], en[k], de[k]]).size).toBeGreaterThan(1);
    });
});

// --- resolution --------------------------------------------------------------------

describe("builtinLabel — la résolution", () => {
    it("rend le libellé de la locale demandée", () => {
        const k = Object.keys(fr)[0]!;
        expect(builtinLabel(k, "en")).toBe(en[k]);
    });

    it("🛑 se rabat sur le français pour une locale INCONNUE, pas sur la clé", () => {
        const k = Object.keys(fr)[0]!;
        expect(builtinLabel(k, "zz")).toBe(fr[k]);
        expect(FALLBACK_LANG).toBe("fr");
    });

    it("rend undefined pour une clé inconnue partout", () => {
        expect(builtinLabel("form.jamais.vue", "fr")).toBeUndefined();
    });
});

// --- _getLabel: the priority order --------------------------------------------------

describe("_getLabel — l'ordre : hôte, catalogue, clé", () => {
    it("🛑 SANS AUCUN HÔTE, rend un vrai libellé — plus la clé brute", () => {
        // The defect this fixes, in its exact form: the lib loaded alone.
        const k = "form.error.imageSize";
        const out = _getLabel(k);
        expect(out).not.toBe(k);
        expect(out).toBe(fr[k]);
    });

    it("🛑 L'HÔTE GARDE LE DERNIER MOT sur ses libellés", () => {
        (globalThis as Record<string, unknown>).GeoLeaf = {
            I18n: { getLabel: () => "Libellé de l'intégrateur" },
        };
        expect(_getLabel("form.error.imageSize")).toBe("Libellé de l'intégrateur");
    });

    it("🛑 un hôte qui rend LA CLÉ n'empêche pas le catalogue de répondre", () => {
        // `GeoLeaf.I18n.getLabel` returns the key when it does not know it —
        // its contract. Without this case, the built-in catalogue would NEVER
        // be reached once a host is there, and the work would have changed
        // nothing for the repo's two plugins.
        (globalThis as Record<string, unknown>).GeoLeaf = {
            I18n: { getLabel: (k: string) => k },
        };
        const k = "form.error.imageSize";
        expect(_getLabel(k)).toBe(fr[k]);
    });

    it("suit la langue active déclarée par l'hôte", () => {
        (globalThis as Record<string, unknown>).GeoLeaf = {
            I18n: { getLabel: (k: string) => k, getActiveLang: () => "en" },
        };
        const k = "form.error.imageSize";
        expect(_getLabel(k)).toBe(en[k]);
    });

    it("rend la clé quand personne ne la connaît", () => {
        expect(_getLabel("form.jamais.vue")).toBe("form.jamais.vue");
    });

    it("un hôte qui rend une chaîne VIDE ne masque pas le catalogue", () => {
        (globalThis as Record<string, unknown>).GeoLeaf = { I18n: { getLabel: () => "" } };
        const k = "form.error.imageSize";
        expect(_getLabel(k)).toBe(fr[k]);
    });
});

// --- real coverage -----------------------------------------------------------------

describe("La couverture du catalogue", () => {
    it("🛑 CHAQUE clé `form.*` utilisée par la lib est déclarée", async () => {
        // The guard preventing the regression: a component introducing a new
        // key without adding it to the catalogue turns this test red, instead
        // of showing the raw key to the user — which happened twice before.
        const mods = import.meta.glob("../types/*.ts", { query: "?raw", import: "default" });
        const keys = new Set<string>();
        for (const load of Object.values(mods)) {
            const src = (await load()) as string;
            for (const m of src.matchAll(/"(form\.[A-Za-z0-9_.]+)"/g)) keys.add(m[1]!);
        }
        expect(keys.size).toBeGreaterThan(30); // témoin anti-relevé-vide
        const missing = [...keys].filter((k) => !(k in fr));
        expect(missing).toEqual([]);
    });
});
