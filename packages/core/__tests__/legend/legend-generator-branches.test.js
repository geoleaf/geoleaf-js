/**
 * Branch-coverage companion for src/capabilities/legend/legend-generator.ts
 * Covers: generateLegendFromStyle, generateLegendItem, generatePointSymbol,
 *         generateLineSymbol, generatePolygonSymbol, getIconFromTaxonomy,
 *         shouldUseIcons, resolveRuleIcons, and all helper functions.
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: {
        getIconsConfig: vi.fn(() => null),
        getCategories: vi.fn(() => null),
    },
}));
vi.mock("../../src/utils/general/utils-base.js", () => ({
    compareByOrder: vi.fn((a, b) => (a.order ?? 999) - (b.order ?? 999)),
}));
import { LegendGenerator } from "../../src/capabilities/legend/legend-generator.js";
import { Config } from "../../src/kernel/config/config-primitives.js";

describe("legend-generator.ts — branch coverage", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // Reset to defaults
        Config.getIconsConfig.mockReturnValue(null);
        Config.getCategories.mockReturnValue(null);
        // F5: `_getCategories()` reads `GeoLeaf.Taxonomy.getCategories("poi-cat")`.
        // Lot 2: `shouldUseIcons()` reads `GeoLeaf.Taxonomy.getIcons()`.
        // Delegate both to the `Config.*` mocks so the existing
        // `Config.*.mockReturnValue(...)` setups drive the resolver/gate.
        globalThis.GeoLeaf = {
            Taxonomy: {
                getCategories: () => Config.getCategories(),
                getIcons: () => Config.getIconsConfig(),
            },
        };
    });

    // ── generateLegendFromStyle ───────────────────────────────────

    describe("generateLegendFromStyle", () => {
        it("returns null when styleData is null", () => {
            expect(LegendGenerator.generateLegendFromStyle(null, "point", null)).toBeNull();
        });

        it("returns null when styleData is undefined", () => {
            expect(LegendGenerator.generateLegendFromStyle(undefined, "point", null)).toBeNull();
        });

        it("returns legend data with title from label", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                { label: "My Style", style: { color: "#f00" } },
                "point",
                null
            );
            expect(result).not.toBeNull();
            expect(result.title).toBe("My Style");
            expect(result.version).toBe("1.2.0");
        });

        it("uses 'Sans titre' when no label", () => {
            const result = LegendGenerator.generateLegendFromStyle({ style: {} }, "point", null);
            expect(result.title).toBe("Sans titre");
        });

        it("processes styleRules array with legend properties", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Test",
                    style: { fillColor: "#000" },
                    styleRules: [
                        { style: { fillColor: "#f00" }, legend: { label: "Red", order: 1 } },
                        { style: { fillColor: "#0f0" }, legend: { label: "Green", order: 2 } },
                    ],
                },
                "polygon",
                null
            );
            expect(result.sections.length).toBe(1);
            expect(result.sections[0].items.length).toBe(2);
        });

        it("skips rules without legend property", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Test",
                    styleRules: [
                        { style: { fillColor: "#f00" } }, // no legend
                        { style: { fillColor: "#0f0" }, legend: { label: "Green" } },
                    ],
                },
                "polygon",
                null
            );
            expect(result.sections[0].items.length).toBe(1);
        });

        it("builds fallback item when no styleRules but has style+legend", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Fallback Test",
                    style: { fillColor: "#123" },
                    legend: { label: "Base Legend", order: 0 },
                },
                "polygon",
                null
            );
            expect(result.sections.length).toBe(1);
            expect(result.sections[0].items[0].label).toBe("Base Legend");
        });

        it("does not build fallback when styleRules produced items", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Filled",
                    style: { fillColor: "#000" },
                    legend: { label: "Base" },
                    styleRules: [{ style: { fillColor: "#f00" }, legend: { label: "Rule1" } }],
                },
                "polygon",
                null
            );
            expect(result.sections[0].items.length).toBe(1);
            expect(result.sections[0].items[0].label).toBe("Rule1");
        });

        it("returns empty sections when no items produced", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                { label: "Empty" },
                "point",
                null
            );
            expect(result.sections.length).toBe(0);
        });
    });

    // ── generateLegendItem ────────────────────────────────────────

    describe("generateLegendItem", () => {
        it("returns null when style is null", () => {
            expect(
                LegendGenerator.generateLegendItem(
                    null,
                    { label: "X" },
                    "point",
                    null,
                    null,
                    null,
                    ""
                )
            ).toBeNull();
        });

        it("returns null when legend is null", () => {
            expect(
                LegendGenerator.generateLegendItem(
                    { color: "#000" },
                    null,
                    "point",
                    null,
                    null,
                    null,
                    ""
                )
            ).toBeNull();
        });

        it("merges with baseStyle when provided", () => {
            const item = LegendGenerator.generateLegendItem(
                { fillColor: "#f00" },
                { label: "Merged" },
                "polygon",
                { color: "#000", weight: 1 },
                null,
                null,
                ""
            );
            expect(item).not.toBeNull();
            expect(item.label).toBe("Merged");
        });

        it("uses 'Sans label' when legend.label is missing", () => {
            const item = LegendGenerator.generateLegendItem(
                { color: "#000" },
                {},
                "point",
                null,
                null,
                null,
                ""
            );
            expect(item.label).toBe("Sans label");
        });

        it("defaults order to 999 when missing", () => {
            const item = LegendGenerator.generateLegendItem(
                { color: "#000" },
                { label: "Test" },
                "point",
                null,
                null,
                null,
                ""
            );
            expect(item.order).toBe(999);
        });

        it("includes description when present", () => {
            const item = LegendGenerator.generateLegendItem(
                { color: "#000" },
                { label: "Test", description: "A description" },
                "point",
                null,
                null,
                null,
                ""
            );
            expect(item.description).toBe("A description");
        });
    });

    // ── Geometry symbol generators ────────────────────────────────

    describe("symbol generation by geometry", () => {
        it("generates point symbol", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Points",
                    styleRules: [
                        {
                            style: { fillColor: "#f00", radius: 8, fillOpacity: 0.5 },
                            legend: { label: "P1" },
                        },
                    ],
                },
                "point",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.type).toBe("circle");
            expect(sym.radius).toBe(8);
        });

        it("generates line symbol with casing", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Lines",
                    styleRules: [
                        {
                            style: {
                                stroke: { color: "#00f", widthPx: 4, opacity: 0.8 },
                                casing: { enabled: true, color: "#000", widthPx: 2, opacity: 0.5 },
                            },
                            legend: { label: "L1" },
                        },
                    ],
                },
                "line",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.type).toBe("line");
            expect(sym.outlineColor).toBe("#000");
        });

        it("generates line symbol with dashed pattern (5, 5)", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Dashed",
                    styleRules: [
                        {
                            style: { color: "#00f", dashArray: "5, 5" },
                            legend: { label: "D1" },
                        },
                    ],
                },
                "line",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.style).toBe("dashed");
        });

        it("generates line symbol with dotted pattern (1, 3)", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Dotted",
                    styleRules: [
                        {
                            style: { color: "#00f", dashArray: "1, 3" },
                            legend: { label: "Dot" },
                        },
                    ],
                },
                "line",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.style).toBe("dotted");
        });

        it("generates line symbol with stroke-level dashArray", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "StrokeDash",
                    styleRules: [
                        {
                            style: { stroke: { color: "#00f", dashArray: "10, 10" } },
                            legend: { label: "SD" },
                        },
                    ],
                },
                "line",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.style).toBe("dashed");
        });

        it("generates polygon symbol with fill pattern", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Polygons",
                    styleRules: [
                        {
                            style: {
                                fillColor: "#0f0",
                                fillOpacity: 0.3,
                                fillPattern: "hatch",
                                hatch: { angle: 45 },
                                fill: { opacity: 0.4 },
                                stroke: { dashArray: "3, 3" },
                            },
                            legend: { label: "Poly" },
                        },
                    ],
                },
                "polygon",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.type).toBe("polygon");
            expect(sym.fillPattern).toBe("hatch");
        });

        it("handles unknown geometry type as point fallback", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Unknown",
                    styleRules: [{ style: { fillColor: "#abc" }, legend: { label: "U" } }],
                },
                "unknown-type",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.type).toBe("circle");
        });
    });

    // ── Point symbol details ──────────────────────────────────────

    describe("point symbol details", () => {
        function getPointSymbol(style) {
            const result = LegendGenerator.generateLegendFromStyle(
                { label: "P", styleRules: [{ style, legend: { label: "X" } }] },
                "point",
                null
            );
            return result.sections[0].items[0].symbol;
        }

        it("uses size when radius is missing", () => {
            const sym = getPointSymbol({ size: 12 });
            expect(sym.radius).toBe(12);
        });

        it("defaults radius to 6 when only legacy sizePx present (sizePx no longer used)", () => {
            const sym = getPointSymbol({ sizePx: 20 });
            expect(sym.radius).toBe(6);
        });

        it("defaults radius to 6", () => {
            const sym = getPointSymbol({});
            expect(sym.radius).toBe(6);
        });

        it("uses fill.color when no fillColor/color", () => {
            const sym = getPointSymbol({ fill: { color: "#abc", opacity: 0.7 } });
            expect(sym.fillColor).toBe("#abc");
            expect(sym.fillOpacity).toBe(0.7);
        });

        it("uses stroke properties for border", () => {
            const sym = getPointSymbol({ stroke: { color: "#999", widthPx: 3, opacity: 0.5 } });
            expect(sym.color).toBe("#999");
            expect(sym.weight).toBe(3);
            expect(sym.opacity).toBe(0.5);
        });

        it("applies icon from style.useIcon + style.iconId", () => {
            const sym = getPointSymbol({ useIcon: true, iconId: "#my-icon" });
            expect(sym.icon).toBe("#my-icon");
        });
    });

    // ── Icon resolution with taxonomy ─────────────────────────────

    describe("icon resolution", () => {
        it("resolves icon from taxonomy subcategory field", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            Config.getCategories.mockReturnValue({
                CULTURES: {
                    svgId: "culture-icon",
                    subcategories: {
                        MUSEE: { svgId: "musee-icon" },
                    },
                },
            });

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Icons",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Museum" },
                            when: { field: "properties.subCategoryId", value: "MUSEE" },
                        },
                    ],
                },
                "point",
                {
                    categories: {
                        CULTURES: {
                            svgId: "culture-icon",
                            subcategories: { MUSEE: { svgId: "musee-icon" } },
                        },
                    },
                    icons: { symbolPrefix: "poi-" },
                }
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toContain("musee-icon");
        });

        it("resolves icon from taxonomy category field", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            Config.getCategories.mockReturnValue({
                HEBERGEMENT: { svgId: "hotel-icon", subcategories: {} },
            });

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Icons",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Hotels" },
                            when: { field: "properties.categoryId", value: "HEBERGEMENT" },
                        },
                    ],
                },
                "point",
                {
                    categories: { HEBERGEMENT: { svgId: "hotel-icon" } },
                    icons: { symbolPrefix: "poi-" },
                }
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toContain("hotel-icon");
        });

        it("resolves icon from condition object", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            Config.getCategories.mockReturnValue({
                CULTURES: { svgId: "cult", subcategories: { MUSEE: { svgId: "mus" } } },
            });

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Cond",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Museum" },
                            condition: { categoryId: "CULTURES", subCategoryId: "MUSEE" },
                        },
                    ],
                },
                "point",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toBeDefined();
        });

        /**
         * B.36(a) — the sub → parent fallback of `_resolveIconId`. Both halves were
         * UNPROTECTED before this lot: inverting the priority was caught by the two
         * tests above, but DROPPING the parent fallback (either when the sub exists
         * without an `svgId`, or when the sub key does not resolve at all) passed the
         * whole suite. Written before routing the chain through the taxonomy resolver
         * `resolveCategoryEntry`, so the routing is protected.
         *
         * Both use `condition` rather than `when`, which keeps `getIconFromTaxonomy`
         * (the second, `when`-only channel) out of the picture: what is measured here
         * really is the `resolveRuleIcons` chain.
         */
        it("a sub-category WITHOUT svgId falls back to the parent category icon", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            const categories = {
                CULTURES: { svgId: "cult-icon", subcategories: { MUSEE: { label: "Musée" } } },
            };
            Config.getCategories.mockReturnValue(categories);

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "SubWithoutSvg",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Musée" },
                            condition: { categoryId: "CULTURES", subCategoryId: "MUSEE" },
                        },
                    ],
                },
                "point",
                { categories, icons: { symbolPrefix: "poi-" } }
            );
            expect(result.sections[0].items[0].symbol.icon).toBe("poi-cult-icon");
        });

        it("an UNKNOWN sub-category falls back to the parent category icon", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            const categories = {
                CULTURES: { svgId: "cult-icon", subcategories: { MUSEE: { svgId: "mus-icon" } } },
            };
            Config.getCategories.mockReturnValue(categories);

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "UnknownSub",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Inconnue" },
                            condition: { categoryId: "CULTURES", subCategoryId: "INCONNUE" },
                        },
                    ],
                },
                "point",
                { categories, icons: { symbolPrefix: "poi-" } }
            );
            expect(result.sections[0].items[0].symbol.icon).toBe("poi-cult-icon");
        });

        it("resolves icon from fclass mapping (via taxonomyData.fieldMappings)", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            Config.getCategories.mockReturnValue({
                CULTURES: {
                    svgId: "cult",
                    subcategories: { "SITE ARCHEOLOGIQUE": { svgId: "archeo" } },
                },
            });

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Fclass",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Archeo" },
                            when: { field: "fclass", value: "archaeological" },
                        },
                    ],
                },
                "point",
                // RM-P2 #2: the fclass → category mapping is config-driven now.
                {
                    fieldMappings: {
                        fclass: {
                            archaeological: {
                                categoryId: "CULTURES",
                                subCategoryId: "SITE ARCHEOLOGIQUE",
                            },
                        },
                    },
                }
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toBeDefined();
        });

        it("does not use icons when the icons config disables showOnMap", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: false });

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "NoIcons",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "NI" },
                            when: { field: "categoryId", value: "X" },
                        },
                    ],
                },
                "point",
                { categories: { X: { svgId: "x-icon" } } }
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toBeUndefined();
        });

        it("handles a minimal styleRule without an icons config", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "NullShared",
                    styleRules: [{ style: { fillColor: "#f00" }, legend: { label: "NS" } }],
                },
                "point",
                null
            );
            expect(result).not.toBeNull();
        });

        it("handles case-insensitive category lookup", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            Config.getCategories.mockReturnValue({
                Hebergement: { svgId: "hotel-icon", subcategories: {} },
            });

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "CI",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "CI" },
                            when: { field: "categoryId", value: "hebergement" },
                        },
                    ],
                },
                "point",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toBeDefined();
        });

        it("infers categoryId from subCategoryId when category not given", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            Config.getCategories.mockReturnValue({
                CULTURES: {
                    svgId: "cult",
                    subcategories: { MUSEE: { svgId: "mus-icon" } },
                },
            });

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Infer",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Infer" },
                            condition: { subCategoryId: "MUSEE" },
                        },
                    ],
                },
                "point",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toBeDefined();
        });

        it("returns no icon when categories config is empty", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            Config.getCategories.mockReturnValue({});

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Empty",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "E" },
                            when: { field: "categoryId", value: "X" },
                        },
                    ],
                },
                "point",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toBeUndefined();
        });

        it("uses condition.category and condition.subCategory aliases", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            Config.getCategories.mockReturnValue({
                CULTURES: { svgId: "cult", subcategories: { archeo: { svgId: "arch" } } },
            });

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Alias",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Alias" },
                            condition: { category: "CULTURES", subCategory: "archeo" },
                        },
                    ],
                },
                "point",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toBeDefined();
        });

        /**
         * B.36(b)+(c) — `_applyPointIcon` runs TWO channels over the same category
         * table, and they are complementary, not redundant. These two tests pin the
         * exact inputs on which the second one is the only one that answers, so a
         * future "they look like duplicates, fuse them" goes red instead of silently
         * dropping icons.
         */
        it("(c) the two cross-category scans are NOT interchangeable — svgId decides", () => {
            // Two categories declare the same sub-category key. The FIRST carries no
            // svgId anywhere, the SECOND does.
            //  - channel 1 (`_inferCategoryId`) stops at the FIRST match → resolves nothing;
            //  - channel 2 (`_findSubcategoryIcon`) keeps scanning until a sub has an
            //    svgId → resolves the second.
            // Fuse the two loops and this icon disappears.
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            const categories = {
                A_SANS_ICONE: { subcategories: { MUSEE: { label: "Musée (A)" } } },
                B_AVEC_ICONE: { svgId: "cat-b", subcategories: { MUSEE: { svgId: "musee-b" } } },
            };
            Config.getCategories.mockReturnValue(categories);

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "TwinScans",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Musée" },
                            when: { field: "properties.subCategoryId", value: "MUSEE" },
                        },
                    ],
                },
                "point",
                { categories, icons: { symbolPrefix: "poi-" } }
            );
            expect(result.sections[0].items[0].symbol.icon).toBe("poi-musee-b");
        });

        it("(b) `attributes.*` fields are covered by the second channel ONLY", () => {
            // `_FIELD_CATEGORY_MAP` declares the eight `properties.*` / bare spellings
            // and NOT the `attributes.*` ones, so channel 1 resolves nothing here;
            // `getIconFromTaxonomy` is what answers. The two channels have disjoint
            // field coverage — neither is "the right one", the composition is.
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            const categories = { CULTURES: { svgId: "cult-icon" } };
            Config.getCategories.mockReturnValue(categories);

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "AttributesField",
                    styleRules: [
                        {
                            style: { fillColor: "#f00" },
                            legend: { label: "Culture" },
                            when: { field: "attributes.categoryId", value: "CULTURES" },
                        },
                    ],
                },
                "point",
                { categories, icons: { symbolPrefix: "poi-" } }
            );
            expect(result.sections[0].items[0].symbol.icon).toBe("poi-cult-icon");
        });

        it("taxonomy lookup returns null when no rule.when", () => {
            Config.getIconsConfig.mockReturnValue({ showOnMap: true });
            Config.getCategories.mockReturnValue({ X: { svgId: "x" } });

            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "NoWhen",
                    styleRules: [{ style: { fillColor: "#f00" }, legend: { label: "NW" } }],
                },
                "point",
                { categories: { X: { svgId: "x" } } }
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.icon).toBeUndefined();
        });
    });

    // ── Line symbol edge cases ────────────────────────────────────

    describe("line symbol edge cases", () => {
        it("no casing when casing.enabled is false", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "NoCasing",
                    styleRules: [
                        {
                            style: {
                                stroke: { color: "#f00" },
                                casing: { enabled: false, color: "#000" },
                            },
                            legend: { label: "NC" },
                        },
                    ],
                },
                "line",
                null
            );
            const sym = result.sections[0].items[0].symbol;
            expect(sym.outlineColor).toBeUndefined();
        });

        it("dotted pattern 2, 4", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Dotted2",
                    styleRules: [
                        { style: { color: "#f00", dashArray: "2, 4" }, legend: { label: "D" } },
                    ],
                },
                "line",
                null
            );
            expect(result.sections[0].items[0].symbol.style).toBe("dotted");
        });

        it("custom dash pattern stays solid", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Custom",
                    styleRules: [
                        { style: { color: "#f00", dashArray: "8, 3, 2" }, legend: { label: "C" } },
                    ],
                },
                "line",
                null
            );
            expect(result.sections[0].items[0].symbol.style).toBe("solid");
        });
    });

    // ── Polygon symbol edge cases ─────────────────────────────────

    describe("polygon symbol edge cases", () => {
        it("uses fill.color fallback", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "FillFallback",
                    styleRules: [
                        {
                            style: { fill: { color: "#abc" } },
                            legend: { label: "FF" },
                        },
                    ],
                },
                "polygon",
                null
            );
            expect(result.sections[0].items[0].symbol.fillColor).toBe("#abc");
        });

        it("uses style.opacity over fill.opacity", () => {
            const result = LegendGenerator.generateLegendFromStyle(
                {
                    label: "Opacity",
                    styleRules: [
                        {
                            style: { fillColor: "#f00", opacity: 0.3, fill: { opacity: 0.9 } },
                            legend: { label: "O" },
                        },
                    ],
                },
                "polygon",
                null
            );
            expect(result.sections[0].items[0].symbol.opacity).toBe(0.3);
        });
    });
});
