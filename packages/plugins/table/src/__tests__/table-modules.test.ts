/**
 * Module-surface + panel + renderer coverage.
 *
 * Ported from the core suite (`__tests__/table/table-modules.test.js`), split for
 * the 700-line cap: this file keeps the module-export, `panel` and `renderer`
 * describes; the large `table-api` describe lives in `table-api.test.ts` and
 * `table-api-branches.test.ts`.
 *
 * Adaptation: no `index.ts` barrel exists in the plugin — the export checks now
 * import the symbols from their flat modules (`../panel.js`, `../sort.js`,
 * `../export.js`, `../renderer.js`). The GeoJSON seam moved from the
 * `geojson/shared.js` module mock onto `_g.GeoLeaf.GeoJSON.getLayerById`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    getLayerById: vi.fn(() => null),
    contract: {
        register: vi.fn(),
        setLayer: vi.fn(),
        zoomToSelection: vi.fn(),
        highlightSelection: vi.fn(),
        exportSelection: vi.fn(),
        toggle: vi.fn(),
        show: vi.fn(),
        getSelectedIds: vi.fn(() => []),
        setSelection: vi.fn(),
        clearSelection: vi.fn(),
        sortByField: vi.fn(),
        updateToolbarButtons: vi.fn(),
    },
}));

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../utils/dom-helpers.js", () => ({
    $create: (tag, attrs = {}) => {
        const el = document.createElement(tag);
        if (attrs.className) el.className = attrs.className;
        if (attrs.type) el.setAttribute("type", attrs.type);
        if (attrs.checked !== undefined) el.checked = attrs.checked;
        if (attrs.colSpan) el.setAttribute("colSpan", String(attrs.colSpan));
        if (attrs.title) el.title = attrs.title;
        return el;
    },
}));
vi.mock("../utils/events.js", () => ({ events: null }));
vi.mock("../table-seam.js", () => ({ TableContract: h.contract }));

import { TablePanel } from "../panel.js";
import { TableRenderer } from "../renderer.js";
import { sortInPlace, nextSortState } from "../sort.js";
import { resolveFeatureId, buildGeoJSONCollection, downloadGeoJSON } from "../export.js";
import { _g } from "../table-state.js";

const { getLayerById } = h;

describe("modules/table/index (barrel)", () => {
    it("exports TablePanel, sortInPlace, nextSortState, resolveFeatureId, buildGeoJSONCollection, downloadGeoJSON", () => {
        expect(typeof TablePanel).toBe("object");
        expect(typeof sortInPlace).toBe("function");
        expect(typeof nextSortState).toBe("function");
        expect(typeof resolveFeatureId).toBe("function");
        expect(typeof buildGeoJSONCollection).toBe("function");
        expect(typeof downloadGeoJSON).toBe("function");
        if (TableRenderer != null) expect(typeof TableRenderer).toBe("object");
    });

    it("sortInPlace and nextSortState work", () => {
        const arr = [{ a: 2 }, { a: 1 }];
        sortInPlace(arr, { field: "a", direction: "asc" }, (o, p) => o[p]);
        expect(arr[0].a).toBe(1);
        expect(arr[1].a).toBe(2);
        const next = nextSortState({ field: "x", direction: "asc" }, "x");
        expect(next.direction).toBe("desc");
    });

    it("sortInPlace handles null values (both null, valA null, valB null)", () => {
        // both null — no change expected, just no throw
        const arr1 = [{ a: null }, { a: null }];
        sortInPlace(arr1, { field: "a", direction: "asc" }, (o, p) => o[p]);
        expect(arr1).toHaveLength(2);

        // valA null (asc): null sorts to end
        const arr2asc = [{ a: null }, { a: 1 }];
        sortInPlace(arr2asc, { field: "a", direction: "asc" }, (o, p) => o[p]);
        expect(arr2asc.at(-1).a).toBeNull();

        // valA null (desc): null sorts to front
        const arr2desc = [{ a: null }, { a: 1 }];
        sortInPlace(arr2desc, { field: "a", direction: "desc" }, (o, p) => o[p]);
        expect(arr2desc[0].a).toBeNull();

        // valB null (asc): non-null value sorts before null
        const arr3asc = [{ a: 5 }, { a: null }];
        sortInPlace(arr3asc, { field: "a", direction: "asc" }, (o, p) => o[p]);
        expect(arr3asc[0].a).toBe(5);
        expect(arr3asc[1].a).toBeNull();

        // valB null (desc): null sorts before non-null in desc
        const arr3desc = [{ a: 5 }, { a: null }];
        sortInPlace(arr3desc, { field: "a", direction: "desc" }, (o, p) => o[p]);
        expect(arr3desc[0].a).toBeNull();
    });

    it("resolveFeatureId and buildGeoJSONCollection work", () => {
        expect(resolveFeatureId({ id: "f1" }, 0)).toBe("f1");
        expect(resolveFeatureId({ properties: {} }, 0)).toBe("__gl_row_0");
        const fc = buildGeoJSONCollection([{ properties: { n: 1 }, geometry: null }]);
        expect(fc.type).toBe("FeatureCollection");
        expect(fc.features).toHaveLength(1);
    });
});

describe("modules/table/panel", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        _g.GeoLeaf = {};
        _g.GeoLeaf.GeoJSON = { getAllLayers: () => [], getLayerById: () => null };
    });

    it("create returns an HTMLElement and does not throw", () => {
        const map = {};
        const config = { defaultHeight: "40%", resizable: false, enableExportButton: false };
        const container = TablePanel.create(map, config);
        expect(container).toBeInstanceOf(HTMLElement);
    });

    it("refreshLayerSelector does nothing when no select found", () => {
        expect(() => TablePanel.refreshLayerSelector()).not.toThrow();
    });

    it("updateToolbarButtons toggles toolbar button disabled state by selection count", () => {
        // The core suite asserted a delegation to `TableContract.updateToolbarButtons`
        // that the panel never performs — it only "passed" there because the method
        // was not reachable on the core barrel object, so the `typeof === "function"`
        // guard skipped the assertion. The plugin exposes the method, so this verifies
        // its real behaviour: it flips the toolbar buttons' `disabled` flag.
        const mk = (name: string) => {
            const b = document.createElement("button");
            b.setAttribute("data-table-btn", name);
            document.body.appendChild(b);
            return b;
        };
        const zoom = mk("zoom");
        const highlight = mk("highlight");
        const exportBtn = mk("export");
        expect(typeof TablePanel.updateToolbarButtons).toBe("function");
        TablePanel.updateToolbarButtons(0);
        expect(zoom.disabled).toBe(true);
        expect(highlight.disabled).toBe(true);
        expect(exportBtn.disabled).toBe(true);
        TablePanel.updateToolbarButtons(2);
        expect(zoom.disabled).toBe(false);
        expect(highlight.disabled).toBe(false);
        expect(exportBtn.disabled).toBe(false);
    });
});

describe("modules/table/renderer", () => {
    beforeEach(() => {
        _g.GeoLeaf = {};
        _g.GeoLeaf.GeoJSON = { getLayerById };
        getLayerById.mockReturnValue(null);
    });

    it("render does nothing when container is null", () => {
        expect(() => {
            TableRenderer.render(null, {
                layerId: "ly1",
                features: [],
                selectedIds: new Set(),
                sortState: {},
                config: {},
            });
        }).not.toThrow();
    });

    it("render does nothing when container has no .gl-table-panel__table", () => {
        const container = document.createElement("div");
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [],
            selectedIds: new Set(),
            sortState: {},
            config: {},
        });
        expect(container.querySelector(".gl-table-panel__table")).toBeFalsy();
    });

    it("render clears table when layerId is null", () => {
        const container = document.createElement("div");
        const wrapper = document.createElement("div");
        wrapper.className = "gl-table-panel__wrapper";
        const table = document.createElement("table");
        table.className = "gl-table-panel__table";
        wrapper.appendChild(table);
        container.appendChild(wrapper);
        expect(() => {
            TableRenderer.render(container, {
                layerId: null,
                features: [],
                selectedIds: new Set(),
                sortState: {},
                config: {},
            });
        }).not.toThrow();
    });

    it("render handles layerConfig with no columns", () => {
        const container = document.createElement("div");
        const wrapper = document.createElement("div");
        wrapper.className = "gl-table-panel__wrapper";
        const table = document.createElement("table");
        table.className = "gl-table-panel__table";
        wrapper.appendChild(table);
        container.appendChild(wrapper);
        getLayerById.mockReturnValue({ config: { table: {} } });
        expect(() => {
            TableRenderer.render(container, {
                layerId: "ly1",
                features: [],
                selectedIds: new Set(),
                sortState: {},
                config: {},
            });
        }).not.toThrow();
    });

    it("updateSelection runs without throw when container has table tbody", () => {
        const container = document.createElement("div");
        const table = document.createElement("table");
        table.className = "gl-table-panel__table";
        const tbody = document.createElement("tbody");
        const tr = document.createElement("tr");
        tr.dataset.featureId = "f1";
        const td = document.createElement("td");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "gl-table-panel__checkbox";
        td.appendChild(cb);
        tr.appendChild(td);
        tbody.appendChild(tr);
        table.appendChild(tbody);
        container.appendChild(table);
        const selectedIds = new Set(["f1"]);
        expect(() => TableRenderer.updateSelection(container, selectedIds)).not.toThrow();
    });

    it("destroy exists and does not throw", () => {
        if (typeof TableRenderer.destroy === "function") {
            expect(() => TableRenderer.destroy()).not.toThrow();
        }
    });
});
