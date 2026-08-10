/**
 * Phase 4.10 — src/renderer.ts (TableRenderer)
 *
 * Ported from the core suite (`__tests__/table/table-renderer.test.js`), split
 * for the 700-line cap: this file keeps the `TableRenderer` describe; the
 * `selection-actions` and `table-renderer-virtual-scroll` branch describes
 * live in `table-renderer-extra.test.ts`.
 *
 * Adaptation: deep core paths → plugin flat `src/`; the GeoJSON seam moved from a
 * `geojson/shared.js` module mock onto the runtime `_g.GeoLeaf.GeoJSON.getLayerById`
 * (the plugin reads `_g.GeoLeaf.GeoJSON?.getLayerById?.(layerId)`); shared mock
 * handles are declared via `vi.hoisted` so the `require()` → static `import` swap
 * keeps the factories TDZ-safe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    getLayerById: vi.fn(),
    setSelection: vi.fn(),
    clearSelection: vi.fn(),
    getSelectedIds: vi.fn(() => []),
    updateToolbarButtons: vi.fn(),
    sortByField: vi.fn(),
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
        return el;
    },
}));
vi.mock("../utils/events.js", () => ({ events: null }));
vi.mock("../table-seam.js", () => ({
    TableContract: {
        sortByField: h.sortByField,
        setSelection: h.setSelection,
        clearSelection: h.clearSelection,
        getSelectedIds: h.getSelectedIds,
        updateToolbarButtons: h.updateToolbarButtons,
    },
}));

import { TableRenderer } from "../renderer.js";
import { _g } from "../table-state.js";

const { getLayerById, setSelection, clearSelection, getSelectedIds, sortByField } = h;

describe("modules/table/renderer (Phase 4.10)", () => {
    let container;

    beforeEach(() => {
        container = document.createElement("div");
        const wrapper = document.createElement("div");
        wrapper.className = "gl-table-panel__wrapper";
        const table = document.createElement("table");
        table.className = "gl-table-panel__table";
        wrapper.appendChild(table);
        container.appendChild(wrapper);
        _g.GeoLeaf = {};
        _g.GeoLeaf.GeoJSON = { getLayerById };
        getLayerById.mockReset();
        getSelectedIds.mockReturnValue([]);
    });

    it("render does nothing when container is null", () => {
        expect(() =>
            TableRenderer.render(null, {
                layerId: "ly1",
                features: [],
                selectedIds: new Set(),
                sortState: {},
            })
        ).not.toThrow();
    });

    it("render clears table when layerId is null", () => {
        TableRenderer.render(container, {
            layerId: null,
            features: [],
            selectedIds: new Set(),
            sortState: {},
        });
        expect(container.querySelector("table").innerHTML).toBe("");
    });

    it("render creates thead and tbody with features", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ properties: { name: "A" }, id: "f1" }],
            selectedIds: new Set(),
            sortState: { field: null, direction: "asc" },
        });
        expect(container.querySelector("thead")).not.toBeNull();
        expect(container.querySelector("tbody").querySelectorAll("tr").length).toBe(1);
    });

    it("render creates sortable header with sortState asc/desc", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name", sortable: true }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [],
            selectedIds: new Set(),
            sortState: { field: "name", direction: "asc" },
        });
        const th = container.querySelector(".gl-table-panel__th--sortable");
        expect(th).not.toBeNull();
        expect(th.classList.contains("is-sorted-asc")).toBe(true);
    });

    it("render with sortState desc adds is-sorted-desc", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "x", label: "X" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [],
            selectedIds: new Set(),
            sortState: { field: "x", direction: "desc" },
        });
        expect(container.querySelector(".is-sorted-desc")).not.toBeNull();
    });

    it("render column with sortable false has no sortable class", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "x", label: "X", sortable: false }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [],
            selectedIds: new Set(),
            sortState: {},
        });
        expect(container.querySelector(".gl-table-panel__th--sortable")).toBeNull();
    });

    it("render column with width sets th style", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "x", label: "X", width: "100px" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [],
            selectedIds: new Set(),
            sortState: {},
        });
        const ths = container.querySelectorAll(".gl-table-panel__th");
        const dataTh = Array.from(ths).find((th) => th.style.width === "100px");
        expect(dataTh).not.toBeNull();
    });

    it("render with 200 features uses virtual scrolling", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        const features = Array.from({ length: 200 }, (_, i) => ({
            id: `f${i}`,
            properties: { name: `Row ${i}` },
        }));
        TableRenderer.render(container, {
            layerId: "ly1",
            features,
            selectedIds: new Set(),
            sortState: {},
        });
        const tbody = container.querySelector("tbody[data-virtual=true]");
        expect(tbody).not.toBeNull();
    });

    it("virtual scroll event updates visible rows", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        const features = Array.from({ length: 200 }, (_, i) => ({
            id: `f${i}`,
            properties: { name: `Row ${i}` },
        }));
        document.body.appendChild(container);
        try {
            TableRenderer.render(container, {
                layerId: "ly1",
                features,
                selectedIds: new Set(),
                sortState: {},
            });
            const wrapper = container.querySelector(".gl-table-panel__wrapper");
            Object.defineProperty(wrapper, "scrollTop", { value: 500, configurable: true });
            Object.defineProperty(wrapper, "clientHeight", { value: 400, configurable: true });
            wrapper.dispatchEvent(new Event("scroll", { bubbles: true }));
            const tbody = container.querySelector("tbody[data-virtual=true]");
            expect(tbody.querySelectorAll("tr").length).toBeGreaterThan(0);
        } finally {
            container.remove();
        }
    });

    it("render formats number and date column types", () => {
        getLayerById.mockReturnValue({
            config: {
                table: {
                    columns: [
                        { field: "properties.n", label: "Num", type: "number" },
                        { field: "properties.d", label: "Date", type: "date" },
                    ],
                },
            },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ id: "f1", properties: { n: 1000, d: "2024-01-15" } }],
            selectedIds: new Set(),
            sortState: {},
        });
        const tbody = container.querySelector("tbody");
        const trows = tbody.querySelectorAll("tr");
        expect(trows.length).toBe(1);
        const cells = trows[0].querySelectorAll("td");
        expect(cells[1].textContent).toMatch(/1/);
        expect(cells[1].classList.contains("gl-table-panel__td--number")).toBe(true);
    });

    it("render uses getFeatureId from properties.fid when no id", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ properties: { fid: "my-fid", name: "X" } }],
            selectedIds: new Set(),
            sortState: {},
        });
        const tr = container.querySelector("tr[data-feature-id]");
        expect(tr.getAttribute("data-feature-id")).toBe("my-fid");
    });

    it("render uses getFeatureId from properties.OBJECTID", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ properties: { OBJECTID: "obj-123", name: "X" } }],
            selectedIds: new Set(),
            sortState: {},
        });
        const tr = container.querySelector("tr[data-feature-id]");
        expect(tr.getAttribute("data-feature-id")).toBe("obj-123");
    });

    it("render uses getFeatureId from properties.osm_id", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ properties: { osm_id: "osm-456", name: "X" } }],
            selectedIds: new Set(),
            sortState: {},
        });
        const tr = container.querySelector("tr[data-feature-id]");
        expect(tr.getAttribute("data-feature-id")).toBe("osm-456");
    });

    it("render formatValue number NaN returns string", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "properties.x", label: "X", type: "number" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ id: "f1", properties: { x: "not-a-number" } }],
            selectedIds: new Set(),
            sortState: {},
        });
        const td = container.querySelector("tbody tr td:last-child");
        expect(td.textContent).toBe("not-a-number");
    });

    it("row click triggers handleRowSelection and setSelection", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ id: "f1", properties: { name: "A" } }],
            selectedIds: new Set(),
            sortState: {},
        });
        setSelection.mockClear();
        const tr = container.querySelector("tbody tr");
        tr.click();
        expect(setSelection).toHaveBeenCalledWith(["f1"], false);
    });

    it("row click when selected calls clearSelection", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ id: "f1", properties: { name: "A" } }],
            selectedIds: new Set(["f1"]),
            sortState: {},
        });
        clearSelection.mockClear();
        const tr = container.querySelector("tbody tr");
        tr.click();
        expect(clearSelection).toHaveBeenCalled();
    });

    it("checkbox change triggers setSelection", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ id: "f1", properties: { name: "A" } }],
            selectedIds: new Set(),
            sortState: {},
        });
        setSelection.mockClear();
        const cb = container.querySelector(".gl-table-panel__checkbox");
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        expect(setSelection).toHaveBeenCalled();
    });

    it("row click on checkbox cell does not double-call selection (rowClickHandler return)", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [{ id: "f1", properties: { name: "A" } }],
            selectedIds: new Set(),
            sortState: {},
        });
        setSelection.mockClear();
        const cb = container.querySelector(".gl-table-panel__checkbox");
        cb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(setSelection).not.toHaveBeenCalled();
    });

    it("checkbox uncheck calls setSelection with filtered ids", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [
                { id: "f1", properties: { name: "A" } },
                { id: "f2", properties: { name: "B" } },
            ],
            selectedIds: new Set(["f1", "f2"]),
            sortState: {},
        });
        setSelection.mockClear();
        getSelectedIds.mockReturnValue(["f1", "f2"]);
        const row1Cb = container.querySelector("tbody tr .gl-table-panel__checkbox");
        row1Cb.checked = false;
        row1Cb.dispatchEvent(new Event("change", { bubbles: true }));
        expect(setSelection).toHaveBeenCalledWith(["f2"], false);
    });

    it("updateSelection sets checkbox-all indeterminate when partial selection", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [
                { id: "f1", properties: { name: "A" } },
                { id: "f2", properties: { name: "B" } },
            ],
            selectedIds: new Set(),
            sortState: {},
        });
        TableRenderer.updateSelection(container, new Set(["f1"]));
        const checkboxAll = container.querySelector(".gl-table-panel__checkbox-all");
        expect(checkboxAll.checked).toBe(false);
        expect(checkboxAll.indeterminate).toBe(true);
    });

    it("updateSelection sets checkbox-all checked when all selected", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [
                { id: "f1", properties: { name: "A" } },
                { id: "f2", properties: { name: "B" } },
            ],
            selectedIds: new Set(),
            sortState: {},
        });
        TableRenderer.updateSelection(container, new Set(["f1", "f2"]));
        const checkboxAll = container.querySelector(".gl-table-panel__checkbox-all");
        expect(checkboxAll.checked).toBe(true);
        expect(checkboxAll.indeterminate).toBe(false);
    });

    it("sortable th click calls TableContract.sortByField", () => {
        sortByField.mockClear();
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [],
            selectedIds: new Set(),
            sortState: {},
        });
        const th = container.querySelector(".gl-table-panel__th--sortable");
        th.click();
        expect(sortByField).toHaveBeenCalledWith("name");
    });

    it("shift+click row triggers selectRange", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        document.body.appendChild(container);
        try {
            TableRenderer.render(container, {
                layerId: "ly1",
                features: [
                    { id: "f1", properties: { name: "A" } },
                    { id: "f2", properties: { name: "B" } },
                ],
                selectedIds: new Set(),
                sortState: {},
            });
            getSelectedIds.mockReturnValue(["f1"]);
            setSelection.mockClear();
            const rows = container.querySelectorAll("tbody tr");
            rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
            expect(setSelection).toHaveBeenCalledWith(["f1", "f2"], false);
        } finally {
            container.remove();
        }
    });

    it("toggleAllRows via checkbox-all selects all", () => {
        getLayerById.mockReturnValue({
            config: { table: { columns: [{ field: "name", label: "Name" }] } },
        });
        document.body.appendChild(container);
        try {
            TableRenderer.render(container, {
                layerId: "ly1",
                features: [
                    { id: "f1", properties: { name: "A" } },
                    { id: "f2", properties: { name: "B" } },
                ],
                selectedIds: new Set(),
                sortState: {},
            });
            setSelection.mockClear();
            const checkboxAll = container.querySelector(".gl-table-panel__checkbox-all");
            checkboxAll.checked = true;
            checkboxAll.dispatchEvent(new Event("change", { bubbles: true }));
            expect(setSelection).toHaveBeenCalledWith(["f1", "f2"], false);
        } finally {
            container.remove();
        }
    });

    it("destroy does not throw", () => {
        expect(() => TableRenderer.destroy()).not.toThrow();
    });

    // ── T22c — table/renderer.ts branch coverage ───────────────────
    it("render returns early when .gl-table-panel__table not found", () => {
        const c = document.createElement("div"); // no .gl-table-panel__table
        getLayerById.mockReturnValue({ config: { table: { columns: [{ field: "x" }] } } });
        expect(() =>
            TableRenderer.render(c, {
                layerId: "ly1",
                features: [],
                selectedIds: new Set(),
                sortState: {},
            })
        ).not.toThrow();
    });

    it("render clears table when layerConfig has no columns", () => {
        // getLayerById returns undefined after mockReset → layerConfig = null → !columns
        TableRenderer.render(container, {
            layerId: "ly1",
            features: [],
            selectedIds: new Set(),
            sortState: {},
        });
        expect(container.querySelector("table").innerHTML).toBe("");
    });

    it("_flushEventCleanups calls function cleanup items and clears array", () => {
        const fn = vi.fn();
        TableRenderer._eventCleanups.push(fn);
        TableRenderer._flushEventCleanups();
        expect(fn).toHaveBeenCalled();
        expect(TableRenderer._eventCleanups.length).toBe(0);
    });

    it("_flushEventCleanups swallows errors from function cleanup", () => {
        TableRenderer._eventCleanups.push(() => {
            throw new Error("cleanup error");
        });
        expect(() => TableRenderer._flushEventCleanups()).not.toThrow();
        expect(TableRenderer._eventCleanups.length).toBe(0);
    });

    it("_flushEventCleanups handles number cleanup items (events?.off no-op)", () => {
        TableRenderer._eventCleanups.push(42);
        expect(() => TableRenderer._flushEventCleanups()).not.toThrow();
        expect(TableRenderer._eventCleanups.length).toBe(0);
    });
});
