/**
 * Config-contract Phase C / C4 — B5 layers.json (index + templates): per-value validation.
 *
 * Read path: the modular profile loader reads config/core/layers.json through two
 * pure, exported seams in config/profile-loader-helpers.ts:
 *   - extractRawLayers(payload)       → the layers[] array (id/configFile/layerManagerId/label/order/defaultVisible)
 *   - expandLayerTemplates(reg, file) → layerTemplates[] expanded into inline LayerRefs
 *   - validateFiles / validateFilesModules → the profile.json Files manifest (incl. layersFile)
 * The downstream HTTP fetch of each {id}_config.json (profile-loader.ts:257-297) and the
 * layerManager order sort (layer-manager-api.ts:359,463) are integration/DOM and are
 * exercised by e2e/cfg-c4 — here we lock the index wiring.
 *
 * Consumer: packages/core/src/kernel/config/profile-loader-helpers.ts. Inventory B5.
 * Source of truth: profiles/_reference/config/core/layers.json + profile.json.
 */

import {
    extractRawLayers,
    expandLayerTemplates,
    validateFiles,
    validateFilesModules,
} from "../../src/kernel/config/profile-loader-helpers.js";
import { REFERENCE_LAYERS, REFERENCE_PROFILE, clone } from "./_helpers/config-harness.js";

describe("config B5 — layers.json layers[] (extractRawLayers)", () => {
    it("reference fixture: extracts the single layer reference with all keys", () => {
        const layers = extractRawLayers(clone(REFERENCE_LAYERS));
        expect(layers).toHaveLength(1);
        expect(layers[0]).toMatchObject({
            id: "reference-points",
            configFile: "layers/reference-points/reference-points_config.json",
            layerManagerId: "section-poi",
            label: "Points de référence",
            order: 1,
            defaultVisible: true,
        });
    });

    it("a bare array payload is returned as-is", () => {
        const arr = [{ id: "a" }, { id: "b" }];
        expect(extractRawLayers(arr)).toEqual(arr);
    });

    it("null / payload without layers[] → null", () => {
        expect(extractRawLayers(null)).toBeNull();
        expect(extractRawLayers({ nope: true })).toBeNull();
    });
});

describe("config B5 — layers.json layerTemplates[] (expandLayerTemplates)", () => {
    it("reference fixture: 1 regular + 2 expanded instances", () => {
        const expanded = expandLayerTemplates(
            [{ id: "reference-points" }],
            clone(REFERENCE_LAYERS)
        );
        expect(expanded).toHaveLength(3);
        expect(expanded[0]).toEqual({ id: "reference-points" }); // regular layers kept first
        expect(expanded.map((l) => l.id)).toEqual([
            "reference-points",
            "riviere-nord",
            "riviere-sud",
        ]);
    });

    it("each instance inherits layerManagerId from its template", () => {
        const expanded = expandLayerTemplates([], clone(REFERENCE_LAYERS));
        expect(expanded.every((l) => l.layerManagerId === "section-hydro")).toBe(true);
    });

    it("instance inlineConfig merges template + id/label + data.directory(template)+file(dataFile)", () => {
        const expanded = expandLayerTemplates([], clone(REFERENCE_LAYERS));
        const nord = expanded.find((l) => l.id === "riviere-nord");
        expect(nord.inlineConfig).toMatchObject({
            id: "riviere-nord",
            label: "Rivière Nord",
            geometry: "line", // from template
            data: { directory: "layers/rivieres/data", file: "riviere-nord.geojson" },
        });
        // template's styles/table/clustering blocks carried into every instance
        expect(nord.inlineConfig.styles).toMatchObject({
            directory: "styles",
            default: "defaut.json",
        });
        expect(nord.inlineConfig.clustering).toEqual({ enabled: false });
    });

    it("per-instance overrides win over the template (zIndex)", () => {
        const file = clone(REFERENCE_LAYERS);
        file.layerTemplates[0].template.zIndex = 5;
        file.layerTemplates[0].instances[0].zIndex = 99; // override
        const expanded = expandLayerTemplates([], file);
        const nord = expanded.find((l) => l.id === "riviere-nord");
        expect(nord.inlineConfig.zIndex).toBe(99);
    });

    it("template without data.directory → instance data.directory defaults to 'data'", () => {
        const file = clone(REFERENCE_LAYERS);
        delete file.layerTemplates[0].template.data;
        const expanded = expandLayerTemplates([], file);
        const nord = expanded.find((l) => l.id === "riviere-nord");
        expect(nord.inlineConfig.data).toEqual({ directory: "data", file: "riviere-nord.geojson" });
    });

    it("no layerTemplates → regular layers returned unchanged", () => {
        const expanded = expandLayerTemplates([{ id: "x" }], { layers: [] });
        expect(expanded).toEqual([{ id: "x" }]);
    });

    it("malformed template (instances not an array) → skipped, no throw", () => {
        const file = { layerTemplates: [{ templateId: "bad", template: {}, instances: "oops" }] };
        expect(expandLayerTemplates([{ id: "x" }], file)).toEqual([{ id: "x" }]);
    });
});

describe("config B5 — profile.json Files manifest (validateFiles)", () => {
    it("reference fixture Files manifest (featuresFile + layersFile + modules) emits no warning", () => {
        const warnings = [];
        validateFiles(clone(REFERENCE_PROFILE.Files), (m) => warnings.push(m));
        expect(warnings).toEqual([]);
    });

    it("non-string companion path → warning", () => {
        const warnings = [];
        validateFiles({ layersFile: 42 }, (m) => warnings.push(m));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("layersFile");
    });

    it("validateFilesModules: non-object map and non-string path both warn", () => {
        const w1 = [];
        validateFilesModules([], (m) => w1.push(m));
        expect(w1).toHaveLength(1);
        const w2 = [];
        validateFilesModules({ storage: 1 }, (m) => w2.push(m));
        expect(w2[0]).toContain("storage");
    });
});
