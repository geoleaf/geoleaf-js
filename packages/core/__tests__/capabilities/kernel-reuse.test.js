/**
 * Les 4 arêtes capacité → kernel (CAPACITÉS S10.2).
 *
 * Quatre capacités consomment une primitive du kernel au lieu de la réimplémenter. Chaque
 * bascule a été faite par un sprint distinct — S4 (legend → taxonomy/resolver), S6 (scale →
 * scale-utils), socle B.1/S8 (vector-tiles → adaptateur), S10 (proximity → haversine) — et
 * AUCUN garde-fou ne les tenait.
 *
 * Pourquoi les gates existants n'y suffisent pas : `check-orphan-exports` et knip cherchent
 * des exports SANS consommateur. Or `scaleAtZoom` (scale-utils.ts:95, :190) et
 * `resolveCategoryKey` (resolver.ts:133, :137) ont aussi des appelants INTERNES à leur
 * propre module. Une capacité qui re-forkerait la formule à côté les laisserait donc
 * parfaitement verts. La règle ESLint `no-restricted-syntax` posée au même sprint n'attrape
 * que le copier-coller littéral des constantes.
 *
 * Ce fichier attrape le reste : chaque test calcule son attendu AVEC la primitive du kernel,
 * jamais avec une valeur écrite en dur. Un re-fork qui dérive numériquement — même d'un
 * chouïa, même en s'écrivant autrement — rougit ici.
 */

const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

// Spécifieur `.js` comme le fait l'app (cf. l'en-tête de scale-control.test.js) : sous
// pool:forks + tsx, un `require(".ts")` charge une instance CJS séparée dont la couverture
// ne fusionne pas avec l'instance ESM de l'app.
const { ScaleControl } = await import("../../src/capabilities/scale/scale-control.js");
const { scaleAtZoom, zoomAtScale } = await import("../../src/utils/general/scale-utils.js");
const { LegendGenerator } = await import("../../src/capabilities/legend/legend-generator.js");
const { resolveCategoryKey } = await import("../../src/capabilities/taxonomy/resolver.js");
const { createProximityCircle } = await import(
    "../../src/capabilities/filter/panel/proximity/proximity-circle.js"
);
const { haversineDistance, EARTH_RADIUS_M } = await import("../../src/utils/geo/haversine.js");
const { buildVtLayerData } = await import(
    "../../src/capabilities/vector-tiles/vector-tiles-layer-data.js"
);

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
        // Le solveur amorti part de `zoomAtScale` puis raffine jusqu'à |écart| < 1 : on ne
        // peut donc pas exiger l'égalité avec la primitive analytique. Ce qu'on exige, et
        // qui casse au premier re-fork de la formule AVANT ou APRÈS, c'est que l'échelle
        // re-calculée par le kernel au zoom trouvé retombe sur la cible.
        //
        // La borne n'est pas une tolérance choisie au doigt mouillé, c'est la somme des
        // deux imprécisions ASSUMÉES du solveur (scale-control.ts:424-440) :
        //   - son critère d'arrêt, |écart| < 1 ;
        //   - l'arrondi du zoom à 4 décimales, qui déplace l'échelle d'un facteur
        //     2^5e-5 - 1 ≈ 3,5e-5 en relatif.
        // Un re-fork de la formule dériverait de bien plus que ça.
        const bound = (target) => 1 + target * 3.5e-5;
        for (const target of [1000, 25_000, 250_000, 2_000_000]) {
            const zoom = control._calculateZoomFromScale(target);
            expect(zoom).toBeGreaterThanOrEqual(0);
            expect(zoom).toBeLessThanOrEqual(22);
            expect(Math.abs(scaleAtZoom(zoom, LAT) - target)).toBeLessThan(bound(target));
        }
    });

    it("l'amorce du solveur est bien la primitive inverse du kernel", () => {
        // `zoomAtScale` est l'inverse de `scaleAtZoom` : le vérifier ici garantit que le
        // couple consommé par la capacité reste cohérent, indépendamment du solveur.
        //
        // L'aller-retour n'est PAS exact, et c'est voulu : `scaleAtZoom` arrondit son
        // résultat à l'entier (scale-utils.ts:56, « rounded to an integer »). Le résidu
        // vaut donc ~0,72/scale en zoom — mesuré 1,2e-8 à z=3 et 1,3e-3 à z=22, soit
        // exactement la loi en 1/scale. `1.5/scale` la borne partout. Toute dérive qui ne
        // serait PAS cet arrondi sort de cette borne.
        for (const z of [3, 7, 11, 16, 20, 22]) {
            const scale = scaleAtZoom(z, LAT);
            expect(Math.abs(zoomAtScale(scale, LAT) - z)).toBeLessThan(1.5 / scale);
        }
    });
});

describe("arête 2/4 — legend → capabilities/taxonomy/resolver (S4)", () => {
    // Les 4 branches de `resolveCategoryKey` : clé exacte, variante MAJ, variante min,
    // puis balayage insensible à la casse. Un matcher re-forké qui n'implémenterait que
    // l'égalité stricte passerait le 1er cas et échouerait les 3 autres.
    const CATEGORIES = {
        CULTURES: { svgId: "culture" },
        nature: { svgId: "tree" },
        PatriMoine: { svgId: "castle" },
    };
    const PREFIX = "cat-";

    /** Génère l'item de légende d'une règle liée à `value`, et rend son icône. */
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
        // Attendu DÉRIVÉ du kernel — jamais écrit en dur : c'est ce qui rend le test
        // insensible à la valeur et sensible à la divergence.
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

    /** @returns l'entrée de couche construite par la capacité. */
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
        // `config` EST la def d'origine (même référence) : rien n'a été calculé au passage.
        expect(e.config).toBe(DEF);
        // Aucune clé de rendu résolue ne remonte dans l'entrée — la résolution de paint
        // appartient à `adapters/maplibre/maplibre-vector-tiles.ts` (helper
        // `resolveVtSubLayerPaint`), pas ici. Cf. backlog B.17.
        for (const forbidden of ["paint", "layout", "filter", "source-layer"]) {
            expect(Object.keys(e)).not.toContain(forbidden);
        }
        // Les ids de sous-couches sont ceux que l'ADAPTATEUR a rendus, repris tels quels.
        expect(e._maplibreSubLayerIds).toEqual(["lyr__0"]);
    });
});

describe("arête 4/4 — proximity → modules/utils/geo/haversine (S10)", () => {
    const CENTER = { lat: 48.8566, lng: 2.3522 };

    /** Capture le polygone que la capacité pousse à l'adaptateur. */
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
        // C'est l'assertion qui rend un re-fork du rayon impossible : les sommets sont
        // mesurés avec `haversineDistance`, la fonction même dont `predicate.ts` se sert
        // pour décider ce qui passe le filtre. Avant S10 la capacité portait son propre
        // 6371008.8 et les deux frontières différaient de 1,4 ppm.
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
