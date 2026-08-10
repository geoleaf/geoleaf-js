/**
 * Unit tests — `capabilities/filter/engine/field-access.ts` (couverture, gisement kernel).
 *
 * Fichier à 54 % : lecture d'attributs par chemin pointé, géométrie-agnostique, et centroïde
 * représentatif. Pur — aucune dépendance mockable (réutilise `getNestedValue`/`normalizeTags`
 * réels). On couvre les deux niveaux de résolution (racine puis `properties`), la normalisation
 * en tags, et toutes les branches de `featureCentroid` (GeoJSON imbriqué, repli POI, non-fini).
 */
import { describe, test, expect } from "vitest";

import {
    getFieldValue,
    getFieldTags,
    featureCentroid,
} from "../../../src/capabilities/filter/engine/field-access.js";

describe("getFieldValue", () => {
    test("chemin pointé depuis la racine", () => {
        expect(getFieldValue({ properties: { name: "x" } }, "properties.name")).toBe("x");
    });

    test("champ à la racine", () => {
        expect(getFieldValue({ title: "T" }, "title")).toBe("T");
    });

    test("champ nu résolu sous properties (repli)", () => {
        expect(getFieldValue({ properties: { fclass: "cafe" } }, "fclass")).toBe("cafe");
    });

    test("champ absent → null", () => {
        expect(getFieldValue({ properties: { a: 1 } }, "nope")).toBeNull();
    });

    test("champ vide → null", () => {
        expect(getFieldValue({ properties: { a: 1 } }, "")).toBeNull();
    });

    test("sans properties et absent → null", () => {
        expect(getFieldValue({}, "x")).toBeNull();
    });
});

describe("getFieldTags", () => {
    test("liste normalisée depuis un tableau", () => {
        expect(getFieldTags({ properties: { tags: ["a", "b"] } }, "tags")).toEqual(["a", "b"]);
    });

    test("liste normalisée depuis un scalaire", () => {
        expect(getFieldTags({ properties: { cat: "solo" } }, "cat")).toEqual(["solo"]);
    });
});

describe("featureCentroid", () => {
    test("géométrie Point [lng, lat]", () => {
        expect(featureCentroid({ geometry: { coordinates: [2.35, 48.85] } })).toEqual({
            lng: 2.35,
            lat: 48.85,
        });
    });

    test("coordonnées imbriquées (polygone) → première paire", () => {
        expect(
            featureCentroid({
                geometry: {
                    coordinates: [
                        [
                            [1, 2],
                            [3, 4],
                        ],
                    ],
                },
            })
        ).toEqual({ lng: 1, lat: 2 });
    });

    test("repli POI lat/lng", () => {
        expect(featureCentroid({ lat: 10, lng: 20 })).toEqual({ lat: 10, lng: 20 });
    });

    test("repli latitude/longitude (noms longs)", () => {
        expect(featureCentroid({ latitude: 5, longitude: 6 })).toEqual({ lat: 5, lng: 6 });
    });

    test("repli properties.latitude/longitude", () => {
        expect(featureCentroid({ properties: { latitude: 7, longitude: 8 } })).toEqual({
            lat: 7,
            lng: 8,
        });
    });

    test("aucune coordonnée → null", () => {
        expect(featureCentroid({ properties: {} })).toBeNull();
    });

    test("coordonnées non finies → null", () => {
        expect(featureCentroid({ lat: "abc", lng: "def" })).toBeNull();
    });

    test("géométrie à coordonnées vides → repli, puis null", () => {
        expect(featureCentroid({ geometry: { coordinates: [] } })).toBeNull();
    });
});
