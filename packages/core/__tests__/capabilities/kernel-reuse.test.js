/**
 * The 4 capability → kernel edges.
 *
 * Four capabilities consume a kernel primitive instead of reimplementing it.
 * Each switch was made by a distinct sprint — legend → taxonomy/resolver,
 * scale → scale-utils, vector-tiles → adapter, proximity → haversine — and NO
 * guardrail held them.
 *
 * Why the existing gates do not suffice: `check-orphan-exports` and knip look
 * for exports WITHOUT consumers. Yet `scaleAtZoom` (scale-utils.ts, :190)
 * and `resolveCategoryKey` (resolver.ts, :137) also have callers INTERNAL
 * to their own module. A capability re-forking the formula next door would
 * thus leave them perfectly green. The `no-restricted-syntax` ESLint rule set
 * at the same time only catches literal copy-paste of the constants.
 *
 * This file catches the rest: each test computes its expectation WITH the
 * kernel primitive, never with a hardcoded value. A re-fork drifting
 * numerically — even a hair, even spelled differently — turns red here.
 */

const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

// `.js` specifier as the app does (cf. scale-control.test.js's header): under
// pool:forks + tsx, a `require(".ts")` loads a separate CJS instance whose
// coverage does not merge with the app's ESM instance.
const { ScaleControl } = await import("../../src/capabilities/scale/scale-control.js");
const { scaleAtZoom, zoomAtScale } = await import("../../src/utils/general/scale-utils.js");
const { LegendGenerator } = await import("../../src/capabilities/legend/legend-generator.js");
const { resolveCategoryKey } = await import("../../src/capabilities/taxonomy/resolver.js");
const { createProximityCircle } =
    await import("../../src/capabilities/filter/panel/proximity/proximity-circle.js");
const { haversineDistance, EARTH_RADIUS_M } = await import("../../src/utils/geo/haversine.js");
const { buildVtLayerData } =
    await import("../../src/capabilities/vector-tiles/vector-tiles-layer-data.js");

describe("arête 1/4 — scale → modules/utils/general/scale-utils (S6)", () => {
    const LAT = 48.8;
    let control;

    beforeEach(() => {
        control = Object.create(ScaleControl);
        control._map = { getCenter: () => ({ lat: LAT, lng: 2.3 }) };
    });

    it("_calculateScale EST scaleAtZoom, pas une copie qui lui ressemble", () => {
        for (const [z, lat] of [
            [0, 0],
            [5, 0],
            [10, LAT],
            [14, LAT],
            [17, 45.2],
            [22, 60],
            [8, -33.9],
        ]) {
            expect(control._calculateScale(z, lat)).toBe(scaleAtZoom(z, lat));
        }
    });

    it("_calculateZoomFromScale boucle sur ces deux primitives — l'aller-retour ferme", () => {
        // The damped solver starts from `zoomAtScale` then refines until
        // |gap| < 1: equality with the analytic primitive thus cannot be
        // demanded. What is demanded, and breaks at the first re-fork of the
        // formula BEFORE or AFTER, is that the scale the kernel re-computes
        // at the found zoom lands back on the target.
        //
        // The bound is not a wet-finger tolerance, it is the sum of the
        // solver's two ASSUMED imprecisions (scale-control.ts):
        //   - its stop criterion, |gap| < 1;
        //   - the zoom rounding to 4 decimals, which moves the scale by a
        //     factor 2^5e-5 - 1 ≈ 3.5e-5 relative.
        // A re-fork of the formula would drift far beyond that.
        const bound = (target) => 1 + target * 3.5e-5;
        for (const target of [1000, 25_000, 250_000, 2_000_000]) {
            const zoom = control._calculateZoomFromScale(target);
            expect(zoom).toBeGreaterThanOrEqual(0);
            expect(zoom).toBeLessThanOrEqual(22);
            expect(Math.abs(scaleAtZoom(zoom, LAT) - target)).toBeLessThan(bound(target));
        }
    });

    it("l'amorce du solveur est bien la primitive inverse du kernel", () => {
        // `zoomAtScale` is `scaleAtZoom`'s inverse: verifying it here
        // guarantees the pair the capability consumes stays coherent,
        // independently of the solver.
        //
        // The round trip is NOT exact, and that is intended: `scaleAtZoom`
        // rounds its result to the integer (scale-utils.ts, "rounded to an
        // integer"). The residue is thus ~0.72/scale in zoom — measured
        // 1.2e-8 at z=3 and 1.3e-3 at z=22, exactly the 1/scale law.
        // `1.5/scale` bounds it everywhere. Any drift that is NOT this
        // rounding leaves the bound.
        for (const z of [3, 7, 11, 16, 20, 22]) {
            const scale = scaleAtZoom(z, LAT);
            expect(Math.abs(zoomAtScale(scale, LAT) - z)).toBeLessThan(1.5 / scale);
        }
    });
});

describe("arête 2/4 — legend → capabilities/taxonomy/resolver (S4)", () => {
    // `resolveCategoryKey`'s 4 branches: exact key, UPPER variant, lower
    // variant, then case-insensitive sweep. A re-forked matcher implementing
    // only strict equality would pass the 1st case and fail the other 3.
    const CATEGORIES = {
        CULTURES: { svgId: "culture" },
        nature: { svgId: "tree" },
        PatriMoine: { svgId: "castle" },
    };
    const PREFIX = "cat-";

    /** Generates the legend item of a rule bound to `value`, and returns its icon. */
    function iconFor(value) {
        const styleData = {
            styleRules: [
                {
                    style: {},
                    legend: { label: "L", order: 0 },
                    when: { field: "properties.categoryId", value },
                },
            ],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", {
            categories: CATEGORIES,
            icons: { symbolPrefix: PREFIX },
        });
        return result?.sections?.[0]?.items?.[0]?.symbol?.icon ?? null;
    }

    beforeEach(() => {
        globalThis.GeoLeaf = {
            Taxonomy: {
                getCategories: () => CATEGORIES,
                getIcons: () => ({ showOnMap: true }),
            },
        };
    });

    afterEach(() => {
        delete globalThis.GeoLeaf;
    });

    it.each([
        ["clé exacte", "CULTURES"],
        ["variante MAJUSCULE", "NATURE"],
        ["variante minuscule", "cultures"],
        ["balayage insensible à la casse", "patrimoine"],
    ])("%s : legend résout la même clé que le resolver", (_label, value) => {
        // Expectation DERIVED from the kernel — never hardcoded: what makes
        // the test insensitive to the value and sensitive to the divergence.
        const key = resolveCategoryKey(CATEGORIES, value);
        expect(key).not.toBeNull();
        expect(iconFor(value)).toBe(PREFIX + CATEGORIES[key].svgId);
    });

    it("une valeur inconnue ne produit pas d'icône, des deux côtés", () => {
        expect(resolveCategoryKey(CATEGORIES, "inexistant")).toBeNull();
        expect(iconFor("inexistant")).toBeNull();
    });
});

describe("arête 3/4 — vector-tiles → adapters/maplibre (socle B.1)", () => {
    const DEF = { geometry: "polygon", legends: { title: "T" }, paint: { "fill-color": "#f00" } };

    /** @returns the layer entry the capability builds. */
    function entry() {
        return buildVtLayerData({
            layerId: "lyr",
            layerLabel: "Layer",
            def: DEF,
            vtLayerName: "src-layer",
            tileUrl: "https://example.test/{z}/{x}/{y}.pbf",
            styleData: null,
            createdSubIds: ["lyr__0"],
            layerBasePath: "/base",
        });
    }

    it("la capacité produit des DONNÉES de couche, jamais un rendu", () => {
        const e = entry();
        expect(e.isVectorTile).toBe(true);
        expect(e.layer).toBeNull(); // aucun objet de couche moteur
        expect(e.features).toEqual([]);
    });

    it("elle transmet la déclaration telle quelle, sans résoudre de paint", () => {
        const e = entry();
        // `config` IS the original def (same reference): nothing was computed in passing.
        expect(e.config).toBe(DEF);
        // No resolved render key climbs into the entry — paint resolution
        // belongs to `adapters/maplibre/maplibre-vector-tiles.ts` (helper
        // `resolveVtSubLayerPaint`), not here.
        for (const forbidden of ["paint", "layout", "filter", "source-layer"]) {
            expect(Object.keys(e)).not.toContain(forbidden);
        }
        // The sub-layer ids are the ones the ADAPTER returned, taken as-is.
        expect(e._maplibreSubLayerIds).toEqual(["lyr__0"]);
    });
});

describe("arête 4/4 — proximity → modules/utils/geo/haversine (S10)", () => {
    const CENTER = { lat: 48.8566, lng: 2.3522 };

    /** Captures the polygon the capability pushes to the adapter. */
    function polygonFor(radiusMetres, center = CENTER) {
        let captured = null;
        const map = {
            hasLayer: () => false,
            removeLayer: vi.fn(),
            addGeoJSONLayer: (_id, fc) => {
                captured = fc.features[0];
            },
            getMarkerHandle: () => null,
        };
        createProximityCircle(center, radiusMetres, map);
        return captured;
    }

    it("le cercle DESSINÉ et le prédicat qui FILTRE tiennent sur la même Terre", () => {
        // The assertion that makes a radius re-fork impossible: the vertices
        // are measured with `haversineDistance`, the very function
        // `predicate.ts` uses to decide what passes the filter. Before, the
        // capability carried its own 6371008.8 and the two boundaries
        // differed by 1.4 ppm.
        for (const radius of [500, 10_000, 100_000]) {
            const poly = polygonFor(radius);
            const ring = poly.geometry.coordinates[0];
            expect(ring.length).toBe(65); // 64 pas + fermeture
            for (const [lng, lat] of ring) {
                expect(haversineDistance(CENTER, { lat, lng })).toBeCloseTo(radius, 3);
            }
        }
    });

    it("aux hautes latitudes aussi — là où une formule approchée dériverait", () => {
        const center = { lat: 71.0, lng: 25.8 };
        const ring = polygonFor(50_000, center).geometry.coordinates[0];
        for (const [lng, lat] of ring) {
            expect(haversineDistance(center, { lat, lng })).toBeCloseTo(50_000, 3);
        }
    });

    it("la constante consommée est celle du kernel, pas une locale", () => {
        expect(EARTH_RADIUS_M).toBe(6_371_000);
    });
});
