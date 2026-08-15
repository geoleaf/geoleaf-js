/**
 * Config-contract Phase C / C2 — B3 ui.json: layerManagerConfig.*
 *
 * Per-value verification of `_applyLayerManagerConfig(lmConfig, options)`, the
 * pure helper the LayerManager calls to fold layerManagerConfig into its module
 * options (layer-manager-api.ts:248-255 → here). Pure function = cleanest unit
 * surface (no global Config, no map, no DOM).
 *
 * Consumer: packages/core/src/kernel/layer-manager/layer-manager-helpers.ts.
 * Inventory B3 (52 keys family).
 */

import { REFERENCE_UI } from "./_helpers/config-harness.js";
import { _applyLayerManagerConfig } from "../../src/kernel/layer-manager/layer-manager-helpers.js";

describe("config B3 — layerManagerConfig (layer-manager-helpers.ts)", () => {
    // ── title ────────────────────────────────────────────────────────────────
    describe("layerManagerConfig.title", () => {
        it("title → options.title", () => {
            const options = {};
            _applyLayerManagerConfig({ title: "Couches" }, options);
            expect(options.title).toBe("Couches");
        });
        it("absent title → options.title untouched", () => {
            const options = { title: "Pre" };
            _applyLayerManagerConfig({}, options);
            expect(options.title).toBe("Pre");
        });
    });

    // ── collapsedByDefault → options.collapsed ────────────────────────────────
    describe("layerManagerConfig.collapsedByDefault", () => {
        it("true → options.collapsed === true", () => {
            const options = {};
            _applyLayerManagerConfig({ collapsedByDefault: true }, options);
            expect(options.collapsed).toBe(true);
        });
        it("false → options.collapsed === false", () => {
            const options = { collapsed: true };
            _applyLayerManagerConfig({ collapsedByDefault: false }, options);
            expect(options.collapsed).toBe(false);
        });
        it("non-boolean (absent) → options.collapsed untouched", () => {
            const options = { collapsed: true };
            _applyLayerManagerConfig({}, options);
            expect(options.collapsed).toBe(true);
        });
    });

    // ── sections (array, sorted by order) + sections[].* ──────────────────────
    describe("layerManagerConfig.sections", () => {
        it("sections are sorted by ascending order", () => {
            const options = {};
            _applyLayerManagerConfig(
                {
                    sections: [
                        { id: "b", label: "B", order: 2 },
                        { id: "a", label: "A", order: 1 },
                    ],
                },
                options
            );
            expect(options.sections.map((s) => s.id)).toEqual(["a", "b"]);
        });

        it("each section keeps id/label/order/collapsedByDefault and gets items:[]", () => {
            const options = {};
            _applyLayerManagerConfig(
                { sections: [{ id: "a", label: "A", order: 1, collapsedByDefault: true }] },
                options
            );
            expect(options.sections[0]).toEqual({
                id: "a",
                label: "A",
                order: 1,
                collapsedByDefault: true,
                items: [],
            });
        });

        it("sections[].collapsedByDefault is carried through per-section", () => {
            const options = {};
            _applyLayerManagerConfig(
                {
                    sections: [
                        { id: "a", order: 1, collapsedByDefault: false },
                        { id: "b", order: 2, collapsedByDefault: true },
                    ],
                },
                options
            );
            const byId = Object.fromEntries(
                options.sections.map((s) => [s.id, s.collapsedByDefault])
            );
            expect(byId).toEqual({ a: false, b: true });
        });

        it("empty/absent sections → options.sections is not created (early return)", () => {
            const options = {};
            _applyLayerManagerConfig({ sections: [] }, options);
            expect(options.sections).toBeUndefined();
        });

        it("existing section without label is enriched from config (upsert by id)", () => {
            const options = { sections: [{ id: "a", items: [] }] };
            _applyLayerManagerConfig(
                { sections: [{ id: "a", label: "Alpha", order: 1 }] },
                options
            );
            const a = options.sections.find((s) => s.id === "a");
            expect(a.label).toBe("Alpha");
            // No duplicate inserted for the same id.
            expect(options.sections.filter((s) => s.id === "a")).toHaveLength(1);
        });
    });

    // ── B-251 — sections pre-created by `_registerGeoJsonLayer` ───────────────
    // The runtime order is: layers register FIRST (implicitly creating their
    // section with the generic i18n label, order 10 and no collapsedByDefault),
    // and only then does init() fold the config in. Every case above starts from
    // empty options, i.e. the path that never happens in the app.
    describe("existing section pre-created by _registerGeoJsonLayer", () => {
        /** Shape `_registerGeoJsonLayer` pushes when the section id is unknown. */
        const preCreated = (id) => ({
            id,
            label: "Couches GeoJSON",
            order: 10,
            items: [{ id: "layer-1", label: "Layer 1" }],
        });

        it("config label overrides the generic label already set", () => {
            const options = { sections: [preCreated("data-tourism")] };
            _applyLayerManagerConfig(
                { sections: [{ id: "data-tourism", label: "Données touristiques", order: 1 }] },
                options
            );
            expect(options.sections[0].label).toBe("Données touristiques");
        });

        it("config collapsedByDefault lands on the existing section (accordion flag)", () => {
            const options = { sections: [preCreated("data-conservation")] };
            _applyLayerManagerConfig(
                {
                    sections: [
                        {
                            id: "data-conservation",
                            label: "Environnement",
                            collapsedByDefault: true,
                        },
                    ],
                },
                options
            );
            // render-sections.ts keys the accordion off `typeof … === "boolean"`.
            expect(typeof options.sections[0].collapsedByDefault).toBe("boolean");
            expect(options.sections[0].collapsedByDefault).toBe(true);
        });

        it("collapsedByDefault:false is propagated too (open accordion, not absent)", () => {
            const options = { sections: [preCreated("data-tourism")] };
            _applyLayerManagerConfig(
                { sections: [{ id: "data-tourism", collapsedByDefault: false }] },
                options
            );
            expect(options.sections[0].collapsedByDefault).toBe(false);
        });

        it("config order replaces the hardcoded 10 and drives the final sort", () => {
            const options = {
                sections: [preCreated("data-conservation"), preCreated("data-tourism")],
            };
            _applyLayerManagerConfig(
                {
                    sections: [
                        { id: "data-tourism", order: 1 },
                        { id: "data-conservation", order: 3 },
                    ],
                },
                options
            );
            expect(options.sections.map((s) => s.id)).toEqual([
                "data-tourism",
                "data-conservation",
            ]);
        });

        it("already-registered items survive the merge", () => {
            const options = { sections: [preCreated("data-tourism")] };
            _applyLayerManagerConfig(
                { sections: [{ id: "data-tourism", label: "Données touristiques", order: 1 }] },
                options
            );
            expect(options.sections[0].items).toEqual([{ id: "layer-1", label: "Layer 1" }]);
        });

        it("a section absent from the config keeps its implicit defaults", () => {
            const options = { sections: [preCreated("geojson-default")] };
            _applyLayerManagerConfig(
                { sections: [{ id: "data-tourism", label: "Données touristiques", order: 1 }] },
                options
            );
            const orphan = options.sections.find((s) => s.id === "geojson-default");
            expect(orphan.label).toBe("Couches GeoJSON");
            expect(orphan.collapsedByDefault).toBeUndefined();
        });
    });

    // ── reference fixture resolves end-to-end ─────────────────────────────────
    it("reference fixture layerManagerConfig resolves end-to-end", () => {
        const options = {};
        _applyLayerManagerConfig(REFERENCE_UI.layerManagerConfig, options);
        expect(options.title).toBe("Couches");
        expect(options.collapsed).toBe(true);
        // Fixture declares data-secondary(order 2) before data-primary(order 1):
        // the helper sorts them by order.
        expect(options.sections.map((s) => s.id)).toEqual(["data-primary", "data-secondary"]);
    });
});
