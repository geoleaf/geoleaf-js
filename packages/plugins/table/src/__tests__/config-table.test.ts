/**
 * Config-contract — `modules.table.*` namespace (table-api.ts / table-layer.ts).
 *
 * Ported from the core suite (`__tests__/config/s11-table-config.test.js`).
 * Adaptation: the plugin reads its config from `GeoLeaf.Config.get("modules.table")`
 * (the core read `Config.get("tableConfig")`) — so the core `_helpers/config-harness.js`
 * is replaced by the local `setTableConfig` seam helper (no cross-package test dep,
 * Plugin Contract v1 / INV-CONFIG). The merge order is
 * defaults < `modules.table` < `options.config`.
 *
 * `Table.init` reads `getPluginConfig()` (built-in defaults merged with `modules.table`),
 * then:
 *   - returns early if !enabled                       → no panel created
 *   - calls TablePanel.create(map, _config)
 *   - calls show() when defaultVisible                → 'gl-is-visible' on container
 * maxRowsPerLayer has a real downstream effect in getLayerFeatures (table-layer.ts).
 * pageSize / virtualScrolling are merged but never read at runtime (ANO-038/039).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetGeoLeaf, setTableConfig } from "./_helpers/geoleaf-global.js";
import { Table } from "../table-api.js";
import { tableState } from "../table-state.js";
import { TablePanel } from "../panel.js";
import { getLayerFeatures } from "../table-layer.js";

const fakeMap = () => ({ on: vi.fn() });

describe("config — modules.table (table-api.ts / table-layer.ts)", () => {
    let createSpy;
    beforeEach(() => {
        resetGeoLeaf();
        tableState._container = null;
        tableState._isVisible = false;
        tableState._config = null;
        tableState._map = null;
        // Stub the panel factory so init() does not build the real DOM panel;
        // return a fresh element so show() can toggle its visibility class.
        createSpy = vi
            .spyOn(TablePanel, "create")
            .mockImplementation(() => document.createElement("div"));
    });
    afterEach(() => {
        resetGeoLeaf();
        vi.restoreAllMocks();
    });

    // ── modules.table.enabled — module gate ───────────────────────────────────
    describe("modules.table.enabled", () => {
        it("default (absent) → enabled, panel created", () => {
            setTableConfig({});
            Table.init({ map: fakeMap() });
            expect(tableState._config.enabled).toBe(true);
            expect(createSpy).toHaveBeenCalledTimes(1);
        });
        it("false → early return, no panel created", () => {
            setTableConfig({ enabled: false });
            Table.init({ map: fakeMap() });
            expect(tableState._config.enabled).toBe(false);
            expect(createSpy).not.toHaveBeenCalled();
            expect(tableState._container).toBeNull();
        });
    });

    // ── modules.table.defaultVisible — open-on-init ───────────────────────────
    describe("modules.table.defaultVisible", () => {
        it("true → container shown (gl-is-visible)", () => {
            setTableConfig({ defaultVisible: true });
            Table.init({ map: fakeMap() });
            expect(tableState._container.classList.contains("gl-is-visible")).toBe(true);
        });
        it("false (default) → container not shown", () => {
            setTableConfig({ defaultVisible: false });
            Table.init({ map: fakeMap() });
            expect(tableState._container.classList.contains("gl-is-visible")).toBe(false);
        });
    });

    // ── config merge order: defaults < global modules.table < options.config ──
    describe("config resolution / merge order", () => {
        it("global modules.table overrides the built-in default", () => {
            setTableConfig({ maxRowsPerLayer: 5000 });
            Table.init({ map: fakeMap() });
            expect(tableState._config.maxRowsPerLayer).toBe(5000);
        });
        it("absent maxRowsPerLayer → default 1000", () => {
            setTableConfig({});
            Table.init({ map: fakeMap() });
            expect(tableState._config.maxRowsPerLayer).toBe(1000);
        });
        it("options.config overrides the global modules.table", () => {
            setTableConfig({ maxRowsPerLayer: 5000 });
            Table.init({ map: fakeMap(), config: { maxRowsPerLayer: 7 } });
            expect(tableState._config.maxRowsPerLayer).toBe(7);
        });
        it("title / enableExportButton / resizable / heights are merged into _config", () => {
            setTableConfig({
                title: "Tableau",
                enableExportButton: false,
                resizable: false,
                defaultHeight: "50%",
                minHeight: "25%",
                maxHeight: "75%",
            });
            Table.init({ map: fakeMap() });
            expect(tableState._config).toMatchObject({
                title: "Tableau",
                enableExportButton: false,
                resizable: false,
                defaultHeight: "50%",
                minHeight: "25%",
                maxHeight: "75%",
            });
            // The resolved config is the object handed to the panel factory.
            expect(createSpy).toHaveBeenCalledWith(expect.anything(), tableState._config);
        });
    });

    // ── modules.table.maxRowsPerLayer — real downstream effect ────────────────
    describe("modules.table.maxRowsPerLayer (table-layer.ts getLayerFeatures)", () => {
        afterEach(() => {
            const g = globalThis;
            if (g.GeoLeaf) delete g.GeoLeaf.GeoJSON;
        });
        it("caps the returned features to maxRowsPerLayer", () => {
            tableState._config = { maxRowsPerLayer: 2 };
            const g = globalThis;
            g.GeoLeaf = g.GeoLeaf || {};
            g.GeoLeaf.GeoJSON = {
                getLayerData: () => ({ features: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }),
            };
            expect(getLayerFeatures("layer-x")).toHaveLength(2);
        });
        it("returns all features when under the cap", () => {
            tableState._config = { maxRowsPerLayer: 10 };
            const g = globalThis;
            g.GeoLeaf = g.GeoLeaf || {};
            g.GeoLeaf.GeoJSON = { getLayerData: () => ({ features: [{ id: 1 }, { id: 2 }] }) };
            expect(getLayerFeatures("layer-x")).toHaveLength(2);
        });
    });

    // ── orphans: present in config, no runtime consumer (regression-lock todo) ─
    it.todo(
        "ANO-038 modules.table.pageSize — merged into _config but no runtime consumer; wire pagination then test"
    );
    it.todo(
        "ANO-039 modules.table.virtualScrolling — merged into _config but no runtime consumer; implement virtual scroll then test"
    );

    // ── reference fixture resolves end-to-end ─────────────────────────────────
    it("reference fixture modules.table resolves end-to-end", () => {
        setTableConfig({
            enabled: true,
            defaultVisible: true,
            pageSize: 25,
            maxRowsPerLayer: 5000,
            virtualScrolling: false,
            defaultHeight: "50%",
            minHeight: "25%",
            maxHeight: "75%",
            resizable: true,
            title: "Tableau",
        });
        Table.init({ map: fakeMap() });
        expect(tableState._config).toMatchObject({
            enabled: true,
            defaultVisible: true,
            pageSize: 25,
            maxRowsPerLayer: 5000,
            virtualScrolling: false,
            defaultHeight: "50%",
            minHeight: "25%",
            maxHeight: "75%",
            resizable: true,
            title: "Tableau",
        });
        // defaultVisible:true in the fixture → panel opened.
        expect(tableState._container.classList.contains("gl-is-visible")).toBe(true);
    });
});
