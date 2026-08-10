/**
 */
/* Phase 5.21 - legend-generator */

const Log = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }));
const Config = vi.hoisted(() => ({ getIconsConfig: vi.fn(() => ({ showOnMap: true })) }));
vi.mock("../../src/utils/log/index.js", () => ({ Log }));
vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config,
}));
vi.mock("../../src/utils/general/utils-base.js", () => ({
    compareByOrder: (a, b) => (a.order || 0) - (b.order || 0),
}));
vi.mock("../../src/kernel/shared/poi-state.js", () => ({
    POIShared: { state: { poiConfig: { showIconsOnMap: true } } },
}));

import { LegendGenerator } from "../../src/capabilities/legend/legend-generator.ts";

describe("legend/legend-generator (Phase 5.21)", () => {
    beforeEach(() => {
        // F5: `_getCategories()` reads `GeoLeaf.Taxonomy.getCategories("poi-cat")`.
        // Lot 2: `shouldUseIcons()` reads `GeoLeaf.Taxonomy.getIcons()`.
        // Delegate both to the `Config.*` mocks the tests configure inline.
        globalThis.GeoLeaf = {
            Taxonomy: {
                getCategories: () => Config.getCategories?.() ?? null,
                getIcons: () => Config.getIconsConfig?.() ?? null,
            },
        };
    });

    it("generateLegendFromStyle returns null when styleData missing", () => {
        expect(LegendGenerator.generateLegendFromStyle(null, "point", null)).toBeNull();
        expect(LegendGenerator.generateLegendFromStyle(undefined, "point", {})).toBeNull();
    });

    it("generateLegendFromStyle returns legend data with title and sections", () => {
        const styleData = {
            id: "s1",
            label: "Style 1",
            description: "Desc",
            styleRules: [{ style: {}, legend: { label: "Item 1", order: 1 } }],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", null);
        expect(result).not.toBeNull();
        expect(result.title).toBe("Style 1");
        expect(result.sections).toBeDefined();
        expect(Array.isArray(result.sections)).toBe(true);
    });

    it("generateLegendFromStyle uses default title and description when missing", () => {
        const styleData = { styleRules: [{ style: {}, legend: { label: "Item", order: 0 } }] };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", null);
        expect(result.title).toBe("Sans titre");
        expect(result.description).toBe("");
    });

    it("generateLegendFromStyle line geometry uses generateLineSymbol", () => {
        const styleData = {
            styleRules: [
                { style: { color: "#f00", weight: 2 }, legend: { label: "Line", order: 0 } },
            ],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "line", null);
        expect(result).not.toBeNull();
        expect(result.sections[0].items[0].symbol).toBeDefined();
    });

    it("generateLegendFromStyle polygon geometry uses generatePolygonSymbol", () => {
        const styleData = {
            styleRules: [{ style: { fillColor: "#ccc" }, legend: { label: "Poly", order: 0 } }],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "polygon", null);
        expect(result).not.toBeNull();
        expect(result.sections[0].items[0].symbol).toBeDefined();
    });

    it("generateLegendFromStyle fallback when no styleRules but style and legend", () => {
        const styleData = {
            style: { fillColor: "#aaa" },
            legend: { label: "Fallback", order: 0 },
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", null);
        expect(result).not.toBeNull();
        expect(result.sections.length).toBe(1);
        expect(result.sections[0].items[0].label).toBe("Fallback");
    });

    it("generateLegendFromStyle uses taxonomy symbolPrefix when provided", () => {
        const styleData = {
            styleRules: [{ style: {}, legend: { label: "L", order: 0 } }],
        };
        const taxonomy = { icons: { symbolPrefix: "custom-" } };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", taxonomy);
        expect(result).not.toBeNull();
    });

    it("generateLegendFromStyle skips rule without legend and warns", () => {
        const styleData = {
            styleRules: [{ style: {}, legend: { label: "A", order: 0 } }, { style: {} }],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", null);
        expect(result.sections[0].items).toHaveLength(1);
        expect(Log.debug).toHaveBeenCalled();
    });

    it("generateLegendFromStyle default geometry uses point symbol", () => {
        const styleData = {
            styleRules: [{ style: {}, legend: { label: "L", order: 0 } }],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "unknown", null);
        expect(result).not.toBeNull();
        expect(result.sections[0].items[0].symbol).toBeDefined();
    });

    it("generateLegendFromStyle with taxonomy categories and subCategoryId", () => {
        const styleData = {
            styleRules: [
                {
                    style: {},
                    legend: { label: "Sub", order: 0 },
                    when: { field: "properties.subCategoryId", value: "MUSEE" },
                },
            ],
        };
        const taxonomy = {
            categories: {
                CULTURES: { subcategories: { MUSEE: { svgId: "museum" } } },
            },
            icons: { symbolPrefix: "cat-" },
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", taxonomy);
        expect(result).not.toBeNull();
    });

    it("generateLegendFromStyle with taxonomy categoryId", () => {
        const styleData = {
            styleRules: [
                {
                    style: {},
                    legend: { label: "Cat", order: 0 },
                    when: { field: "properties.categoryId", value: "CULTURES" },
                },
            ],
        };
        const taxonomy = {
            categories: { CULTURES: { svgId: "culture" } },
            icons: { symbolPrefix: "cat-" },
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", taxonomy);
        expect(result).not.toBeNull();
    });

    it("resolves fclass mapping (museum) from taxonomyData.fieldMappings (RM-P2 #2)", () => {
        Config.getCategories = vi.fn(() => ({
            CULTURES: { svgId: "culture", subcategories: { MUSEE: { svgId: "museum" } } },
        }));
        const styleData = {
            styleRules: [
                {
                    style: {},
                    legend: { label: "Museum", order: 0 },
                    when: { field: "properties.fclass", value: "museum" },
                },
            ],
        };
        // The attribute → category mapping now lives in the profile taxonomy config,
        // not a hardcoded core const.
        const taxonomy = {
            fieldMappings: {
                fclass: { museum: { categoryId: "CULTURES", subCategoryId: "MUSEE" } },
            },
            icons: { symbolPrefix: "cat-" },
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", taxonomy);
        expect(result).not.toBeNull();
        expect(result.sections[0].items[0].symbol.icon).toBe("cat-museum");
    });

    it("does NOT resolve fclass mappings from the core when fieldMappings is absent (generic core)", () => {
        Config.getCategories = vi.fn(() => ({
            CULTURES: { svgId: "culture", subcategories: { MUSEE: { svgId: "museum" } } },
        }));
        const styleData = {
            styleRules: [
                {
                    style: {},
                    legend: { label: "Museum", order: 0 },
                    when: { field: "properties.fclass", value: "museum" },
                },
            ],
        };
        // No fieldMappings → the former hardcoded tourism mapping is gone; the core
        // carries no domain data, so the fclass value resolves no category icon.
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", {
            icons: { symbolPrefix: "cat-" },
        });
        expect(result).not.toBeNull();
        expect(result.sections[0].items[0].symbol.icon).toBeUndefined();
    });

    it("generateLegendFromStyle point with useIcon and iconId in style", () => {
        const styleData = {
            styleRules: [
                {
                    style: { useIcon: true, iconId: "poi-museum" },
                    legend: { label: "Icon", order: 0 },
                },
            ],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", null);
        expect(result.sections[0].items[0].symbol.icon).toBe("poi-museum");
    });

    it("generateLegendFromStyle line with stroke casing and dashArray", () => {
        const styleData = {
            styleRules: [
                {
                    style: {
                        stroke: {
                            color: "#f00",
                            opacity: 0.8,
                            casing: { enabled: true, color: "#000" },
                        },
                        dashArray: "5, 5",
                    },
                    legend: { label: "Dashed", order: 0 },
                },
            ],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "line", null);
        expect(result.sections[0].items[0].symbol.type).toBe("line");
        expect(result.sections[0].items[0].symbol.style).toBe("dashed");
    });

    it("generateLegendFromStyle polygon with fillPattern and hatch", () => {
        const styleData = {
            styleRules: [
                {
                    style: {
                        fillColor: "#eee",
                        fillPattern: { enabled: true, type: "diagonal" },
                        hatch: { enabled: true },
                    },
                    legend: { label: "Pattern", order: 0 },
                },
            ],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "polygon", null);
        expect(result.sections[0].items[0].symbol.fillPattern).toBeDefined();
        expect(result.sections[0].items[0].symbol.hatch).toBeDefined();
    });

    it("generateLegendFromStyle item with description", () => {
        const styleData = {
            styleRules: [
                {
                    style: {},
                    legend: { label: "Item", order: 0, description: "Description text" },
                },
            ],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", null);
        expect(result.sections[0].items[0].description).toBe("Description text");
    });

    it("generateLegendFromStyle with rule.condition categoryId subCategoryId", () => {
        Config.getCategories = vi.fn(() => ({
            CAT: { svgId: "i", subcategories: { SUB: { svgId: "sub" } } },
        }));
        const styleData = {
            styleRules: [
                {
                    style: {},
                    legend: { label: "X", order: 0 },
                    condition: { categoryId: "CAT", subCategoryId: "SUB" },
                },
            ],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "point", null);
        expect(result).not.toBeNull();
    });

    it("generateLegendFromStyle line with dotted dashArray", () => {
        const styleData = {
            styleRules: [
                {
                    style: { stroke: { color: "#f00" }, dashArray: "2, 4" },
                    legend: { label: "Dotted", order: 0 },
                },
            ],
        };
        const result = LegendGenerator.generateLegendFromStyle(styleData, "line", null);
        expect(result.sections[0].items[0].symbol.style).toBe("dotted");
    });
});
