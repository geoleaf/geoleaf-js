/**
 * Branch-coverage companion for src/renderer.ts
 * Covers: render, createTableHead, createTableBody, createTableRow,
 *         updateSelection, _flushEventCleanups, destroy
 *
 * Ported from the core suite (`__tests__/table/table-renderer-branches.test.js`).
 * Adaptation: import paths point at the plugin's flat `src/` layout; the GeoJSON
 * seam is driven on the runtime `_g.GeoLeaf.GeoJSON` namespace (the core read it
 * through `GeoJSONShared`; the plugin reads `_g.GeoLeaf.GeoJSON.getLayerById`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../utils/dom-helpers.js", () => ({
    $create: vi.fn((tag, props) => {
        const el = document.createElement(tag);
        if (props) Object.assign(el, props);
        return el;
    }),
}));
vi.mock("../utils/events.js", () => ({
    events: {
        on: vi.fn(() => 999),
        off: vi.fn(),
    },
}));
vi.mock("../table-seam.js", () => ({
    TableContract: {
        sortByField: vi.fn(),
    },
}));
vi.mock("../feature-id.js", () => ({
    resetSyntheticIdCounter: vi.fn(),
    getFeatureId: vi.fn((f) => f?.id ?? f?.properties?.id ?? "unknown"),
}));
vi.mock("../format-value.js", () => ({
    formatValue: vi.fn((v) => String(v ?? "")),
}));
vi.mock("../event-cleanups.js", () => ({
    _eventCleanups: [],
}));
vi.mock("../table-renderer-virtual-scroll.js", () => ({
    // ⚠️ STRUCT S8 — `VIRTUAL_THRESHOLD` a suivi les 2 autres constantes de scroll
    // virtuel dans ce module. Le stub à 500 reste ici : c'est lui qui force le rendu
    // NON virtuel dans ces cas de branche.
    VIRTUAL_THRESHOLD: 500,
    createTableBodyVirtual: vi.fn(() => document.createElement("tbody")),
    initVirtualState: vi.fn(),
    setupVirtualScroll: vi.fn(),
}));
vi.mock("../selection-actions.js", () => ({
    handleRowSelection: vi.fn(),
    toggleAllRows: vi.fn(),
    updateToolbarButtonsState: vi.fn(),
}));

import { TableRenderer as _TableRenderer } from "../renderer.js";
import { _g } from "../table-state.js";
import { events } from "../utils/events.js";
import { _eventCleanups } from "../event-cleanups.js";
import {
    createTableBodyVirtual,
    initVirtualState,
    setupVirtualScroll,
} from "../table-renderer-virtual-scroll.js";

function makeContainer() {
    const div = document.createElement("div");
    const table = document.createElement("table");
    table.className = "gl-table-panel__table";
    div.appendChild(table);
    return div;
}

function makeFeature(id, props = {}) {
    return { id, properties: { id, name: `Feature ${id}`, ...props } };
}

describe("table/renderer.ts — branch coverage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _eventCleanups.length = 0;
        document.body.innerHTML = "";
        _g.GeoLeaf = {};
        _g.GeoLeaf.GeoJSON = {
            getLayerById: vi.fn(() => null),
        };
    });

    // ── _flushEventCleanups ─────────────────────────────────────────────
    describe("_flushEventCleanups", () => {
        it("calls function cleanups", () => {
            const fn = vi.fn();
            _eventCleanups.push(fn);
            _TableRenderer._flushEventCleanups();
            expect(fn).toHaveBeenCalled();
            expect(_eventCleanups.length).toBe(0);
        });

        it("calls events.off for numeric cleanups", () => {
            _eventCleanups.push(42);
            _TableRenderer._flushEventCleanups();
            expect(events.off).toHaveBeenCalledWith(42);
        });

        it("handles function cleanup error silently", () => {
            _eventCleanups.push(() => {
                throw new Error("cleanup fail");
            });
            _TableRenderer._flushEventCleanups();
            expect(_eventCleanups.length).toBe(0);
        });

        it("handles events.off error silently", () => {
            events.off.mockImplementation(() => {
                throw new Error("off fail");
            });
            _eventCleanups.push(99);
            _TableRenderer._flushEventCleanups();
            expect(_eventCleanups.length).toBe(0);
        });
    });

    // ── destroy ─────────────────────────────────────────────────────────
    describe("destroy", () => {
        it("flushes all cleanups", () => {
            const fn = vi.fn();
            _eventCleanups.push(fn);
            _TableRenderer.destroy();
            expect(fn).toHaveBeenCalled();
        });
    });

    // ── render ──────────────────────────────────────────────────────────
    describe("render", () => {
        it("returns early for null container", () => {
            _TableRenderer.render(null, {});
        });

        it("returns early when table element not found", () => {
            const container = document.createElement("div");
            _TableRenderer.render(container, { layerId: "lyr" });
        });

        it("clears table when no layerId", () => {
            const container = makeContainer();
            _TableRenderer.render(container, {
                layerId: null,
                features: [],
                selectedIds: new Set(),
                sortState: {},
            });
            const table = container.querySelector(".gl-table-panel__table");
            expect(table.innerHTML).toBe("");
        });

        it("warns and clears when no column config", () => {
            _g.GeoLeaf.GeoJSON.getLayerById.mockReturnValue({ config: {} });
            const container = makeContainer();
            _TableRenderer.render(container, {
                layerId: "lyr1",
                features: [],
                selectedIds: new Set(),
                sortState: {},
            });
        });

        it("renders table with columns and features", () => {
            _g.GeoLeaf.GeoJSON.getLayerById.mockReturnValue({
                config: {
                    table: {
                        columns: [
                            { field: "name", label: "Name", sortable: true },
                            { field: "count", label: "Count", type: "number", sortable: false },
                        ],
                    },
                },
            });
            const container = makeContainer();
            const features = [makeFeature("1", { name: "A", count: 10 })];
            _TableRenderer.render(container, {
                layerId: "lyr2",
                features,
                selectedIds: new Set(),
                sortState: { field: "name", direction: "asc" },
            });
            const table = container.querySelector(".gl-table-panel__table");
            expect(table.querySelector("thead")).toBeTruthy();
            expect(table.querySelector("tbody")).toBeTruthy();
        });

        it("renders virtual scroll for large datasets", () => {
            const manyFeatures = Array.from({ length: 600 }, (_, i) => makeFeature(String(i)));
            _g.GeoLeaf.GeoJSON.getLayerById.mockReturnValue({
                config: { table: { columns: [{ field: "name", label: "Name" }] } },
            });
            const container = makeContainer();
            _TableRenderer.render(container, {
                layerId: "lyr3",
                features: manyFeatures,
                selectedIds: new Set(),
                sortState: {},
            });
            expect(createTableBodyVirtual).toHaveBeenCalled();
            expect(initVirtualState).toHaveBeenCalled();
            expect(setupVirtualScroll).toHaveBeenCalled();
        });

        it("renders sort icon desc", () => {
            _g.GeoLeaf.GeoJSON.getLayerById.mockReturnValue({
                config: { table: { columns: [{ field: "name", label: "Name" }] } },
            });
            const container = makeContainer();
            _TableRenderer.render(container, {
                layerId: "lyr4",
                features: [makeFeature("1")],
                selectedIds: new Set(),
                sortState: { field: "name", direction: "desc" },
            });
            const th = container.querySelector(".is-sorted-desc");
            expect(th).toBeTruthy();
        });

        it("renders unsorted icon for non-active sort field", () => {
            _g.GeoLeaf.GeoJSON.getLayerById.mockReturnValue({
                config: { table: { columns: [{ field: "name", label: "Name" }] } },
            });
            const container = makeContainer();
            _TableRenderer.render(container, {
                layerId: "lyr5",
                features: [makeFeature("1")],
                selectedIds: new Set(),
                sortState: { field: "other", direction: "asc" },
            });
        });

        it("applies column width when specified", () => {
            _g.GeoLeaf.GeoJSON.getLayerById.mockReturnValue({
                config: { table: { columns: [{ field: "name", label: "Name", width: "200px" }] } },
            });
            const container = makeContainer();
            _TableRenderer.render(container, {
                layerId: "lyr6",
                features: [makeFeature("1")],
                selectedIds: new Set(),
                sortState: {},
            });
        });

        it("marks selected rows", () => {
            _g.GeoLeaf.GeoJSON.getLayerById.mockReturnValue({
                config: { table: { columns: [{ field: "name", label: "Name" }] } },
            });
            const container = makeContainer();
            _TableRenderer.render(container, {
                layerId: "lyr7",
                features: [makeFeature("sel1")],
                selectedIds: new Set(["sel1"]),
                sortState: {},
            });
            const row = container.querySelector("tr[data-feature-id='sel1']");
            expect(row?.classList.contains("gl-is-selected")).toBe(true);
        });

        it("adds number class for number columns", () => {
            _g.GeoLeaf.GeoJSON.getLayerById.mockReturnValue({
                config: {
                    table: { columns: [{ field: "count", label: "Count", type: "number" }] },
                },
            });
            const container = makeContainer();
            _TableRenderer.render(container, {
                layerId: "lyr8",
                features: [makeFeature("1", { count: 42 })],
                selectedIds: new Set(),
                sortState: {},
            });
            const td = container.querySelector(".gl-table-panel__td--number");
            expect(td).toBeTruthy();
        });
    });

    // ── updateSelection ─────────────────────────────────────────────────
    describe("updateSelection", () => {
        it("returns early when no tbody", () => {
            const container = document.createElement("div");
            _TableRenderer.updateSelection(container, new Set());
        });

        it("toggles selection class on rows", () => {
            const container = makeContainer();
            const tbody = document.createElement("tbody");
            const tr1 = document.createElement("tr");
            tr1.setAttribute("data-feature-id", "a");
            const cb1 = document.createElement("input");
            cb1.type = "checkbox";
            cb1.className = "gl-table-panel__checkbox";
            tr1.appendChild(cb1);
            tbody.appendChild(tr1);
            container.querySelector(".gl-table-panel__table").appendChild(tbody);
            _TableRenderer.updateSelection(container, new Set(["a"]));
            expect(tr1.classList.contains("gl-is-selected")).toBe(true);
            expect(cb1.checked).toBe(true);
        });

        it("updates checkbox-all state", () => {
            const container = makeContainer();
            const table = container.querySelector(".gl-table-panel__table");
            const thead = document.createElement("thead");
            const cbAll = document.createElement("input");
            cbAll.className = "gl-table-panel__checkbox-all";
            thead.appendChild(cbAll);
            table.appendChild(thead);
            const tbody = document.createElement("tbody");
            const tr1 = document.createElement("tr");
            tr1.setAttribute("data-feature-id", "x");
            const cb = document.createElement("input");
            cb.className = "gl-table-panel__checkbox";
            tr1.appendChild(cb);
            tbody.appendChild(tr1);
            table.appendChild(tbody);
            _TableRenderer.updateSelection(container, new Set(["x"]));
            expect(cbAll.checked).toBe(true);
        });

        it("sets indeterminate for partial selection", () => {
            const container = makeContainer();
            const table = container.querySelector(".gl-table-panel__table");
            const thead = document.createElement("thead");
            const cbAll = document.createElement("input");
            cbAll.className = "gl-table-panel__checkbox-all";
            thead.appendChild(cbAll);
            table.appendChild(thead);
            const tbody = document.createElement("tbody");
            for (const id of ["r1", "r2"]) {
                const tr = document.createElement("tr");
                tr.setAttribute("data-feature-id", id);
                const cb = document.createElement("input");
                cb.className = "gl-table-panel__checkbox";
                tr.appendChild(cb);
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            _TableRenderer.updateSelection(container, new Set(["r1"]));
            expect(cbAll.indeterminate).toBe(true);
        });
    });
});
