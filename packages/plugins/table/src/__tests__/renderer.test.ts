/**
 * Tests for GeoLeaf._TableRenderer module.
 *
 * Ported from the core suite (`__tests__/table/renderer.test.js`).
 * Adaptation: import/mock paths point at the plugin's flat `src/` layout; the
 * GeoJSON seam (`GeoJSONShared` in core) is no longer a module to mock — the
 * plugin reads it off `_g.GeoLeaf.GeoJSON` at call time, so the stub data the old
 * `mockGeoJSONShared` provided is injected on `_g.GeoLeaf.GeoJSON.getLayerById`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _g } from "../table-state.js";

// Hoisted mocks so vi.mock factories can reference them
const { mockLogFns, mockGeoJSONShared, mockTableContract } = vi.hoisted(() => ({
    mockLogFns: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    mockGeoJSONShared: {
        getLayerById: vi.fn(),
    },
    mockTableContract: {
        sortByField: vi.fn(),
        getSelectedIds: vi.fn().mockReturnValue([]),
        setSelection: vi.fn(),
        clearSelection: vi.fn(),
        updateToolbarButtons: vi.fn(),
    },
}));

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: mockLogFns,
}));
vi.mock("../table-seam.js", () => ({ TableContract: mockTableContract }));
vi.mock("../utils/events.js", () => ({
    events: {
        on: vi.fn((el, evt, cb, capture) => {
            el.addEventListener(evt, cb, !!capture);
            return () => el.removeEventListener(evt, cb);
        }),
        off: vi.fn(),
    },
}));

describe("GeoLeaf._TableRenderer", () => {
    let TableRenderer;
    let container;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Restore defaults after clearAllMocks
        mockTableContract.getSelectedIds.mockReturnValue([]);

        // Reset DOM
        document.body.innerHTML = "";

        // Create container with table
        container = document.createElement("div");
        container.className = "gl-table-panel";
        const table = document.createElement("table");
        table.className = "gl-table-panel__table";
        container.appendChild(table);
        document.body.appendChild(container);

        // Suppress console logs from the module
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});

        // Install the runtime seam: the plugin reads GeoJSON off _g.GeoLeaf.* at
        // call time. Reset then re-install (alias getLayerData → getLayerById so
        // inner beforeEach setups work, mirroring the core test).
        _g.GeoLeaf = {};
        _g.GeoLeaf.Log = mockLogFns;
        _g.GeoLeaf.GeoJSON = {
            getLayerById: mockGeoJSONShared.getLayerById,
            getLayerData: mockGeoJSONShared.getLayerById,
        };
        _g.GeoLeaf.Table = mockTableContract;

        // Clear module cache and load fresh
        vi.resetModules();

        // Load the module — capture named export directly (module doesn't self-register on global)
        const m = await import("../renderer.js");
        TableRenderer = m.TableRenderer;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("render()", () => {
        const mockLayerConfig = {
            table: {
                columns: [
                    { field: "properties.title", label: "Title" },
                    { field: "properties.category", label: "Category" },
                    { field: "properties.rating", label: "Rating", type: "number" },
                ],
            },
        };

        const mockFeatures = [
            { id: "f1", properties: { title: "Place 1", category: "Restaurant", rating: 4.5 } },
            { id: "f2", properties: { title: "Place 2", category: "Hotel", rating: 3.8 } },
        ];

        beforeEach(() => {
            _g.GeoLeaf.GeoJSON.getLayerData.mockReturnValue({
                config: mockLayerConfig,
            });
        });

        it("should render table with header and body", () => {
            TableRenderer.render(container, {
                layerId: "test-layer",
                features: mockFeatures,
                selectedIds: new Set(),
                sortState: { field: null, direction: null },
                config: {},
            });

            const thead = container.querySelector("thead");
            const tbody = container.querySelector("tbody");

            expect(thead).toBeTruthy();
            expect(tbody).toBeTruthy();
        });

        it("should render correct number of rows", () => {
            TableRenderer.render(container, {
                layerId: "test-layer",
                features: mockFeatures,
                selectedIds: new Set(),
                sortState: {},
                config: {},
            });

            const rows = container.querySelectorAll("tbody tr");
            expect(rows.length).toBe(2);
        });

        it("should render column headers", () => {
            TableRenderer.render(container, {
                layerId: "test-layer",
                features: mockFeatures,
                selectedIds: new Set(),
                sortState: {},
                config: {},
            });

            const headers = container.querySelectorAll("thead th");
            // +1 for checkbox column
            expect(headers.length).toBe(4);
        });

        it("should mark selected rows", () => {
            TableRenderer.render(container, {
                layerId: "test-layer",
                features: mockFeatures,
                selectedIds: new Set(["f1"]),
                sortState: {},
                config: {},
            });

            const row = container.querySelector('tr[data-feature-id="f1"]');
            expect(row.classList.contains("gl-is-selected")).toBe(true);
        });

        it("should clear table when no layerId", () => {
            TableRenderer.render(container, {
                layerId: null,
                features: mockFeatures,
                selectedIds: new Set(),
                sortState: {},
                config: {},
            });

            const table = container.querySelector(".gl-table-panel__table");
            expect(table.innerHTML).toBe("");
        });

        it("should handle null container", () => {
            expect(() => TableRenderer.render(null, {})).not.toThrow();
            expect(_g.GeoLeaf.Log.error).toHaveBeenCalled();
        });

        it("should handle missing table element", () => {
            const emptyContainer = document.createElement("div");

            expect(() =>
                TableRenderer.render(emptyContainer, {
                    layerId: "test",
                    features: [],
                    selectedIds: new Set(),
                    sortState: {},
                    config: {},
                })
            ).not.toThrow();
        });

        it("should show sort indicator for sorted column", () => {
            TableRenderer.render(container, {
                layerId: "test-layer",
                features: mockFeatures,
                selectedIds: new Set(),
                sortState: { field: "properties.title", direction: "asc" },
                config: {},
            });

            const sortedHeader = container.querySelector(".is-sorted-asc");
            expect(sortedHeader).toBeTruthy();
        });
    });

    describe("updateSelection()", () => {
        beforeEach(() => {
            // Create a table with rows
            const table = container.querySelector(".gl-table-panel__table");
            table.innerHTML = `
                <tbody>
                    <tr data-feature-id="f1">
                        <td><input type="checkbox" class="gl-table-panel__checkbox"></td>
                    </tr>
                    <tr data-feature-id="f2">
                        <td><input type="checkbox" class="gl-table-panel__checkbox"></td>
                    </tr>
                </tbody>
            `;
        });

        it("should add is-selected class to selected rows", () => {
            TableRenderer.updateSelection(container, new Set(["f1"]));

            const row1 = container.querySelector('tr[data-feature-id="f1"]');
            const row2 = container.querySelector('tr[data-feature-id="f2"]');

            expect(row1.classList.contains("gl-is-selected")).toBe(true);
            expect(row2.classList.contains("gl-is-selected")).toBe(false);
        });

        it("should check checkboxes for selected rows", () => {
            TableRenderer.updateSelection(container, new Set(["f1"]));

            const checkbox1 = container.querySelector(
                'tr[data-feature-id="f1"] .gl-table-panel__checkbox'
            );
            const checkbox2 = container.querySelector(
                'tr[data-feature-id="f2"] .gl-table-panel__checkbox'
            );

            expect(checkbox1.checked).toBe(true);
            expect(checkbox2.checked).toBe(false);
        });

        it("should handle empty selection", () => {
            // First select
            TableRenderer.updateSelection(container, new Set(["f1"]));
            // Then clear
            TableRenderer.updateSelection(container, new Set());

            const row1 = container.querySelector('tr[data-feature-id="f1"]');
            expect(row1.classList.contains("is-selected")).toBe(false);
        });
    });
});
