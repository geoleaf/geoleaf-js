/**
 * `scaleConfig` (scale denominators) → `minZoom`/`maxZoom` (zoom levels).
 *
 * The link that finally feeds the native bridge (`maplibre-primitives`
 * `zoomProps`): it stayed empty forever because `scaleConfig` is a SIBLING
 * of `defaultStyle`, hence outside the options builder's `Object.assign`s.
 * Result: the whole constraint ran in JS, and `visibility.ts`'s comment
 * asserted the opposite.
 */
import { buildSingleLayerAdapterOptions } from "../../src/kernel/geojson/loader/adapter-options.ts";

const Log = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const NO_CLUSTER = { shouldCluster: false };
const build = (styleData, refLat) =>
    buildSingleLayerAdapterOptions({}, styleData, NO_CLUSTER, "lyr", Log, undefined, refLat);

describe("adapter-options — scaleConfig → zoom natif (N-1b)", () => {
    it("convertit les bornes réelles de guyane (lat 4°N)", () => {
        // profiles/guyane-biodiversite/layers/cours_eau/styles/defaut.json
        const opts = build({ scaleConfig: { minScale: 9222148, maxScale: 2252 } }, 4);
        expect(opts.minZoom).toBeCloseTo(6, 2);
        expect(opts.maxZoom).toBeCloseTo(18, 2);
    });

    it("préserve l'ordre : minScale (vue large) → minZoom (zoom bas)", () => {
        // The subject's trap: minScale is the LARGEST number but the SMALLEST zoom.
        const opts = build({ scaleConfig: { minScale: 9222148, maxScale: 2252 } }, 4);
        expect(opts.minZoom).toBeLessThan(opts.maxZoom);
    });

    it("dépend de la latitude — même échelle, zoom différent", () => {
        const equateur = build({ scaleConfig: { minScale: 1000000 } }, 0);
        const nord = build({ scaleConfig: { minScale: 1000000 } }, 60);
        expect(equateur.minZoom).toBeGreaterThan(nord.minZoom);
    });

    it("ne pose aucune borne quand le style n'a pas de scaleConfig", () => {
        const opts = build({ defaultStyle: { fillColor: "#fff" } }, 4);
        expect(opts.minZoom).toBeUndefined();
        expect(opts.maxZoom).toBeUndefined();
    });

    it("ignore les bornes désactivées (null / 0) sans toucher à l'autre", () => {
        const opts = build({ scaleConfig: { minScale: 20000000, maxScale: 0 } }, -38);
        expect(opts.minZoom).toBeGreaterThan(0);
        expect(opts.maxZoom).toBeUndefined(); // 0 = contrainte désactivée
    });

    it("ne pose rien sans latitude de référence (headless : pas de map)", () => {
        // Better no constraint than one computed at a guessed latitude.
        const opts = buildSingleLayerAdapterOptions(
            {},
            { scaleConfig: { minScale: 9222148, maxScale: 2252 } },
            NO_CLUSTER,
            "lyr",
            Log
        );
        expect(opts.minZoom).toBeUndefined();
        expect(opts.maxZoom).toBeUndefined();
    });

    it("n'écrase pas visible/zIndex et laisse le style tranquille", () => {
        const opts = build(
            { scaleConfig: { minScale: 9222148 }, defaultStyle: { fillColor: "#abc" } },
            4
        );
        expect(opts.visible).toBe(true);
        expect(opts.fillColor).toBe("#abc");
        expect(opts.minZoom).toBeCloseTo(6, 2);
    });
});
