/**
 * Unit — `layerGeometry`, the SINGLE resolution of the `geometry` /
 * `geometryType` alias.
 *
 * 🛑 WHY THIS HELPER EXISTS. The schema sets both keys as the same field
 * (`profiles/schemas/layer-config.schema.json:42` — "Root-level alias of
 * `geometry` […] do NOT migrate (ANO-007)"), but the repo read it in
 * **seven** ways: 3 sites resolved the alias by hand — with DIFFERENT
 * fallbacks, `"point"` for the legend and `"polygon"` for vector tiles —
 * and 4 read `geometryType` alone, i.e. the key **none** of the repo's 24
 * configs declares without the other.
 *
 * These tests pin the contract the seven sites now share.
 */
import { describe, it, expect } from "vitest";
import {
    layerGeometry,
    geometryKindToGeoJSONTypes,
} from "../../src/kernel/config/layer-geometry.js";

describe("layerGeometry — les deux orthographes du même champ", () => {
    it("lit `geometryType`", () => {
        expect(layerGeometry({ geometryType: "point" })).toBe("point");
    });

    it("lit `geometry` — la forme que 18 des 24 configs du dépôt utilisent SEULE", () => {
        expect(layerGeometry({ geometry: "polygon" })).toBe("polygon");
    });

    it("préfère `geometryType` quand les deux sont là", () => {
        // ⚠️ Theoretical tie-break: measured on 07/08/2026, **none** of the 6
        // configs declaring both declares them different. A disagreement is
        // a profile error and belongs to `validate:profiles`, not a silent
        // arbitration here.
        expect(layerGeometry({ geometry: "polygon", geometryType: "point" })).toBe("point");
    });
});

describe("layerGeometry — le repli est un PARAMÈTRE, pas une constante", () => {
    it("rend `null` par défaut quand aucune des deux clés n'est déclarée", () => {
        expect(layerGeometry({ label: "sans géométrie" })).toBeNull();
    });

    it("rend le repli fourni — c'est ce qui laisse à chaque site le sien", () => {
        // The legend falls back to "point", vector tiles to "polygon".
        // Collapsing both onto one value would have changed two subsystems' behaviour.
        expect(layerGeometry({}, "point")).toBe("point");
        expect(layerGeometry({}, "polygon")).toBe("polygon");
    });

    it("ne rend jamais une chaîne VIDE — elle traverse vers l'autre clé, puis vers le repli", () => {
        // `legend.ts` depends on it: its `layerInfo.geometryType` is
        // initialised to `""`, and a `??` would have stopped there. The
        // helper must behave like the `||` it replaces.
        expect(layerGeometry({ geometryType: "", geometry: "line" })).toBe("line");
        expect(layerGeometry({ geometryType: "", geometry: "" }, "point")).toBe("point");
    });
});

describe("layerGeometry — entrées hostiles", () => {
    it("tolère `null`, `undefined` et un non-objet", () => {
        expect(layerGeometry(null)).toBeNull();
        expect(layerGeometry(undefined)).toBeNull();
        expect(layerGeometry("point" as unknown as { geometry?: unknown })).toBeNull();
        expect(layerGeometry(null, "polygon")).toBe("polygon");
    });

    it("ignore une valeur non-textuelle plutôt que de la propager", () => {
        expect(layerGeometry({ geometryType: 42 })).toBeNull();
        expect(layerGeometry({ geometryType: 42, geometry: "point" })).toBe("point");
    });
});

/**
 * 🛑 TWO VOCABULARIES, and they had never met. The profile schema allows the lowercase
 * one and nothing else; the MapLibre adapter's fast path accepted GeoJSON names and
 * nothing else. Measured on 27/08/2026: **0 of the repo's 25 layer configs** ever reached
 * that path. These tests pin the translation, once, at its home.
 */
describe("geometryKindToGeoJSONTypes — les deux vocabulaires d'une même famille", () => {
    it("traduit le vocabulaire minuscule du schéma vers ses DEUX encodages", () => {
        expect([...geometryKindToGeoJSONTypes("polyline")].sort()).toEqual([
            "LineString",
            "MultiLineString",
        ]);
        expect([...geometryKindToGeoJSONTypes("point")].sort()).toEqual(["MultiPoint", "Point"]);
        expect([...geometryKindToGeoJSONTypes("polygon")].sort()).toEqual([
            "MultiPolygon",
            "Polygon",
        ]);
    });

    it("range `fill-extrusion` avec les polygones — c'est un rendu, pas une géométrie", () => {
        expect([...geometryKindToGeoJSONTypes("fill-extrusion")].sort()).toEqual([
            "MultiPolygon",
            "Polygon",
        ]);
    });

    it("garde un nom GeoJSON tel quel, sans l'élargir à sa famille", () => {
        expect([...geometryKindToGeoJSONTypes("Polygon")]).toEqual(["Polygon"]);
        expect([...geometryKindToGeoJSONTypes("MultiLineString")]).toEqual(["MultiLineString"]);
    });

    it("accepte une liste et en fait l'union", () => {
        const types = geometryKindToGeoJSONTypes(["polyline", "point"]);
        expect(types.has("LineString")).toBe(true);
        expect(types.has("Point")).toBe(true);
    });

    // Vide, jamais une supposition : deviner rendrait une couche comme quelque chose
    // qu'elle n'a jamais déclaré, et aucun appelant ne pourrait s'en apercevoir.
    it("rend un ensemble VIDE pour tout jeton que personne n'a défini", () => {
        for (const kind of ["hexagon", "", 42, null, undefined, {}, [null, 7]]) {
            expect(geometryKindToGeoJSONTypes(kind).size).toBe(0);
        }
    });
});
