/**
 * Unit tests — modules/utils/general/poi-to-feature.ts (shared PoiLike→Feature).
 * Covers host-layer render parity: flat category/subcategory (both casings),
 * nested `attributes` verbatim, dynamic-field hoist, id on feature.id +
 * properties.id, [lng,lat] geometry, and the null guards (missing id / geometry).
 * Relocated from plugin-addpoi (S9 D5) — now imported by addpoi + storage.
 */

import { poiToFeature } from "../../src/utils/general/poi-to-feature.js";

describe("poi-to-feature — poiToFeature", () => {
    /** Form-produced POI (mirrors data-mapper.formToPoiRecord output). */
    const makePoi = (overrides = {}) => ({
        id: "user-poi-1700000000000",
        title: "Chez Test",
        description: "A description",
        geometry: { type: "Point", coordinates: [55.45, -20.88] }, // [lng, lat]
        latlng: [-20.88, 55.45], // [lat, lng]
        attributes: {
            categoryId: "eclairage",
            subCategoryId: "candelabres",
            photo: "https://example.test/p.jpg",
            tags: ["LED", "actif"],
        },
        layerId: "candelabres",
        ...overrides,
    });

    it("duplicates id on feature.id and properties.id (String)", () => {
        const f = poiToFeature(makePoi({ id: 42 }));
        expect(f.id).toBe("42");
        expect(f.properties.id).toBe("42");
    });

    it("hoists category flat and emits BOTH sub-category casings", () => {
        const f = poiToFeature(makePoi());
        expect(f.properties.categoryId).toBe("eclairage");
        expect(f.properties.subcategoryId).toBe("candelabres"); // tourism GPU + popup
        expect(f.properties.subCategoryId).toBe("candelabres"); // candelabres
    });

    it("hoists dynamic attributes flat for properties.<field> configs", () => {
        const f = poiToFeature(makePoi());
        expect(f.properties.photo).toBe("https://example.test/p.jpg");
        expect(f.properties.tags).toEqual(["LED", "actif"]);
    });

    it("keeps a nested attributes bag verbatim (feature-info + tag filter)", () => {
        const f = poiToFeature(makePoi());
        expect(f.properties.attributes).toEqual({
            categoryId: "eclairage",
            subCategoryId: "candelabres",
            photo: "https://example.test/p.jpg",
            tags: ["LED", "actif"],
        });
    });

    it("maps title to properties.name and properties.title", () => {
        const f = poiToFeature(makePoi());
        expect(f.properties.name).toBe("Chez Test");
        expect(f.properties.title).toBe("Chez Test");
    });

    it("prefers the form-built geometry ([lng,lat] order preserved)", () => {
        const f = poiToFeature(makePoi());
        expect(f.type).toBe("Feature");
        expect(f.geometry).toEqual({ type: "Point", coordinates: [55.45, -20.88] });
    });

    it("falls back to latlng ([lat,lng]) → [lng,lat] when geometry is absent", () => {
        const f = poiToFeature(makePoi({ geometry: undefined }));
        expect(f.geometry).toEqual({ type: "Point", coordinates: [55.45, -20.88] });
    });

    it("returns null when id is missing", () => {
        expect(poiToFeature(makePoi({ id: undefined }))).toBeNull();
        expect(poiToFeature(makePoi({ id: "" }))).toBeNull();
    });

    it("returns null when neither geometry nor valid latlng resolves", () => {
        expect(poiToFeature(makePoi({ geometry: undefined, latlng: undefined }))).toBeNull();
    });

    it("explicit category keys win over any hoisted collision", () => {
        // A stray flat `categoryId` inside attributes must not leak through the hoist.
        const f = poiToFeature(
            makePoi({ attributes: { categoryId: "eclairage", subCategoryId: "candelabres" } })
        );
        // Only the explicit flat values (no undefined overwrite from the hoist loop).
        expect(f.properties.categoryId).toBe("eclairage");
        expect(f.properties.subCategoryId).toBe("candelabres");
    });
});
