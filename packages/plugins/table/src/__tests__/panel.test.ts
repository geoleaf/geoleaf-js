/**
 * Tests pour le module GeoLeaf._TablePanel
 *
 * Ported from the core suite (`__tests__/table/panel.test.js`).
 * Adaptation: import paths point at the plugin's flat `src/` layout; the GeoJSON /
 * visibility seams are driven on the runtime `_g.GeoLeaf.*` namespace (panel.ts reads
 * `_g.GeoLeaf.GeoJSON.getAllLayers/getLayerById` and `_g.GeoLeaf._LayerVisibilityManager`).
 * The source stubbed `GeoJSONShared.getLayers()` (a `Map`) and `global.GeoLeaf.GeoJSON`;
 * here the same data is exposed through `getAllLayers` (Map → array) + `getLayerById`.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mocks so vi.mock factories and test assertions share the same vi.fn objects
const { mockTableFns, mockLogFns } = vi.hoisted(() => ({
    mockTableFns: {
        setLayer: vi.fn(),
        zoomToSelection: vi.fn(),
        highlightSelection: vi.fn(),
        exportSelection: vi.fn(),
        exportLayerAll: vi.fn(),
        toggle: vi.fn(),
        show: vi.fn(),
    },
    mockLogFns: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock("../table-seam.js", () => ({
    TableContract: mockTableFns,
}));
// ⚠️ ONE mock per specifier: `Log` and `tLabel` now come from the same barrel, so a
// second vi.mock("@geoleaf/host-runtime") would silently replace this one.
vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: mockLogFns,
    tLabel: vi.fn((key: string) => {
        const labels: Record<string, string> = {
            "ui.table.layer_placeholder": "Select a layer...",
            "aria.table.hide": "Hide table",
            "aria.table.show": "Show table",
            "aria.table.layerSelect": "Layer to display in the table",
            "ui.table.zoomToSelection": "Zoom to selection",
            "ui.table.highlight": "Highlight",
            "ui.table.exportSelection": "Export",
            "ui.table.exportLayer": "Layer",
            "placeholder.search.input": "Search...",
        };
        return labels[key] ?? key;
    }),
}));
vi.mock("../utils/events.js", () => ({
    events: {
        on: vi.fn((el, evtName, cb, capture) => {
            el.addEventListener(evtName, cb, !!capture);
            return () => el.removeEventListener(evtName, cb);
        }),
        off: vi.fn(),
    },
}));

import { TablePanel } from "../panel.js";
import { _g } from "../table-state.js";

/**
 * Installs the GeoJSON seam on `_g.GeoLeaf` from a Map of layers (the source's
 * data shape). `getAllLayers` yields `{ id, ...layerData }` entries; `getLayerById`
 * resolves a layer's data by id. Returns the vi.fn handles for assertions.
 */
function installGeoJSONSeam(layers: Map<string, any>) {
    const getAllLayers = vi.fn(() =>
        Array.from(layers.entries(), ([id, data]) => ({ id, ...data }))
    );
    const getLayerById = vi.fn((id: string) => layers.get(id) ?? null);
    _g.GeoLeaf.GeoJSON = { getAllLayers, getLayerById } as any;
    return { getAllLayers, getLayerById };
}

describe("GeoLeaf._TablePanel", () => {
    let mockMap: any;
    let mockConfig: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Clean up DOM between tests
        document.body.innerHTML = "";

        // Default layer data (source: layer1/layer2 both table.enabled, visible)
        const defaultLayers = new Map<string, any>([
            ["layer1", { label: "Layer 1", config: { table: { enabled: true } } }],
            ["layer2", { label: "Layer 2", config: { table: { enabled: true } } }],
        ]);

        // Mock map
        mockMap = {
            on: vi.fn(),
            off: vi.fn(),
        };

        // Mock config
        mockConfig = {
            defaultHeight: "40%",
            enableExportButton: true,
        };

        // Install runtime seams the plugin reads off the GeoLeaf namespace
        _g.GeoLeaf = {};
        _g.GeoLeaf.Log = mockLogFns;
        _g.GeoLeaf.Table = mockTableFns;
        installGeoJSONSeam(defaultLayers);
        _g.GeoLeaf._LayerVisibilityManager = {
            getVisibilityState: vi.fn(() => ({ current: true })),
        } as any;

        TablePanel._eventCleanups = [];
    });

    afterEach(() => {
        _g.GeoLeaf = {};
        document.body.innerHTML = "";
    });

    describe("Module Loading", () => {
        test("should be exported on GeoLeaf namespace", () => {
            expect(TablePanel).toBeDefined();
        });

        test("should have create method", () => {
            expect(typeof TablePanel.create).toBe("function");
        });

        test("should have updateToolbarButtons method", () => {
            expect(typeof TablePanel.updateToolbarButtons).toBe("function");
        });

        test("should have refreshLayerSelector method", () => {
            expect(typeof TablePanel.refreshLayerSelector).toBe("function");
        });
    });

    describe("create()", () => {
        test("should create panel container", () => {
            const container = TablePanel.create(mockMap, mockConfig);
            expect(container).toBeDefined();
            expect(container.className).toBe("gl-table-panel");
        });

        test("should set default height from config", () => {
            const container = TablePanel.create(mockMap, mockConfig);
            expect(container.style.height).toBe("40%");
        });

        test("should append container to body", () => {
            TablePanel.create(mockMap, mockConfig);
            const panel = document.querySelector(".gl-table-panel");
            expect(panel).not.toBeNull();
        });

        test("should create toolbar", () => {
            TablePanel.create(mockMap, mockConfig);
            const toolbar = document.querySelector(".gl-table-panel__toolbar");
            expect(toolbar).not.toBeNull();
        });

        test("should create table wrapper", () => {
            TablePanel.create(mockMap, mockConfig);
            const wrapper = document.querySelector(".gl-table-panel__wrapper");
            expect(wrapper).not.toBeNull();
        });

        test("should create table element", () => {
            TablePanel.create(mockMap, mockConfig);
            const table = document.querySelector(".gl-table-panel__table");
            expect(table).not.toBeNull();
        });

        test("should create toggle button", () => {
            TablePanel.create(mockMap, mockConfig);
            const toggleBtn = document.querySelector(".gl-table-panel__toggle-btn");
            expect(toggleBtn).not.toBeNull();
        });

        test("should reuse existing container", () => {
            const container1 = TablePanel.create(mockMap, mockConfig);
            // Need to reload module to test reuse properly - container exists in DOM
            const container2 = TablePanel.create(mockMap, mockConfig);
            // Both calls should return the same container (from DOM query)
            expect(container1.className).toBe(container2.className);
        });

        test("should log success message", () => {
            TablePanel.create(mockMap, mockConfig);
            expect(mockLogFns.info).toHaveBeenCalledWith(
                expect.stringContaining("Panel created successfully")
            );
        });
    });

    describe("Toolbar Elements", () => {
        beforeEach(() => {
            TablePanel.create(mockMap, mockConfig);
        });

        test("should create layer selector", () => {
            const selector = document.querySelector(".gl-table-panel__layer-selector");
            expect(selector).not.toBeNull();
        });

        test("should create select element", () => {
            const select = document.querySelector("[data-table-layer-select]");
            expect(select).not.toBeNull();
        });

        // Non-regression (backlog B.6): axe reported `select-name` as CRITICAL here —
        // `id` and `name` are not accessible names, and the placeholder <option> is the
        // control's VALUE, not its name. The two assertions are distinct failures: a
        // missing label, and a raw i18n key reaching the DOM (the defect S2 found on 8
        // sites). Neither is caught by asserting the attribute merely exists.
        // Non-regression: the toolbar labels were French string literals until the
        // orphan sweep — a table in `en` rendered « Surbrillance ». Asserting they are
        // non-empty would not catch the real failure mode, which is a RAW i18n KEY
        // reaching the DOM when a catalogue entry is missing (the defect S2 found ×8).
        test("toolbar buttons carry translated labels, never a raw i18n key", () => {
            const labels = [...document.querySelectorAll(".gl-table-panel__toolbar button")]
                .map((b) => (b.textContent ?? "").trim())
                .filter(Boolean);
            expect(labels.length).toBeGreaterThan(0);
            for (const l of labels) {
                expect(l).not.toMatch(/^(ui|aria)\.table\./);
            }
        });

        test("layer select carries a translated accessible name", () => {
            const select = document.querySelector("[data-table-layer-select]");
            const name = select?.getAttribute("aria-label");
            expect(name).toBeTruthy();
            expect(name).not.toBe("aria.table.layerSelect");
        });

        test("should create search input", () => {
            const search = document.querySelector("[data-table-search]");
            expect(search).not.toBeNull();
        });

        test("should create zoom button", () => {
            const zoomBtn = document.querySelector('[data-table-btn="zoom"]');
            expect(zoomBtn).not.toBeNull();
        });

        test("should create highlight button", () => {
            const highlightBtn = document.querySelector('[data-table-btn="highlight"]');
            expect(highlightBtn).not.toBeNull();
        });

        test("should create export button when enabled", () => {
            const exportBtn = document.querySelector('[data-table-btn="export"]');
            expect(exportBtn).not.toBeNull();
        });

        test("should not create export button when disabled", () => {
            document.body.innerHTML = "";
            mockConfig.enableExportButton = false;
            TablePanel.create(mockMap, mockConfig);
            const exportBtn = document.querySelector('[data-table-btn="export"]');
            expect(exportBtn).toBeNull();
        });

        test("should disable buttons initially", () => {
            const zoomBtn = document.querySelector('[data-table-btn="zoom"]') as HTMLButtonElement;
            const highlightBtn = document.querySelector(
                '[data-table-btn="highlight"]'
            ) as HTMLButtonElement;
            expect(zoomBtn.disabled).toBe(true);
            expect(highlightBtn.disabled).toBe(true);
        });
    });

    describe("Layer Selector", () => {
        beforeEach(() => {
            TablePanel.create(mockMap, mockConfig);
        });

        test("should have default option", () => {
            const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
            expect(select.options[0].textContent).toBe("Select a layer...");
        });

        test("should call setLayer on change", () => {
            const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;

            // Add an option
            const option = document.createElement("option");
            option.value = "layer1";
            select.appendChild(option);

            // Trigger change
            select.value = "layer1";
            select.dispatchEvent(new Event("change"));

            expect(mockTableFns.setLayer).toHaveBeenCalledWith("layer1");
        });
    });

    describe("Button Interactions", () => {
        beforeEach(() => {
            TablePanel.create(mockMap, mockConfig);
        });

        test("should call zoomToSelection on zoom button click", () => {
            const zoomBtn = document.querySelector('[data-table-btn="zoom"]') as HTMLButtonElement;
            zoomBtn.disabled = false;
            zoomBtn.click();
            expect(mockTableFns.zoomToSelection).toHaveBeenCalled();
        });

        test("should call highlightSelection on highlight button click", () => {
            const highlightBtn = document.querySelector(
                '[data-table-btn="highlight"]'
            ) as HTMLButtonElement;
            highlightBtn.disabled = false;
            highlightBtn.click();
            expect(mockTableFns.highlightSelection).toHaveBeenCalled();
        });

        test("should toggle gl-is-active class on highlight button", () => {
            const highlightBtn = document.querySelector(
                '[data-table-btn="highlight"]'
            ) as HTMLButtonElement;
            highlightBtn.disabled = false;

            highlightBtn.click();
            expect(highlightBtn.classList.contains("gl-is-active")).toBe(true);

            highlightBtn.click();
            expect(highlightBtn.classList.contains("gl-is-active")).toBe(false);
        });

        test("should open dropdown on export button click", () => {
            const exportBtn = document.querySelector(
                '[data-table-btn="export"]'
            ) as HTMLButtonElement;
            exportBtn.disabled = false;
            exportBtn.click();
            const group = exportBtn.closest(".gl-table-export-group") as HTMLElement;
            expect(group.classList.contains("gl-is-open")).toBe(true);
        });

        test("should call exportSelection with format on dropdown item click", () => {
            const exportBtn = document.querySelector(
                '[data-table-btn="export"]'
            ) as HTMLButtonElement;
            exportBtn.disabled = false;
            exportBtn.click();
            const group = exportBtn.closest(".gl-table-export-group") as HTMLElement;
            const firstItem = group.querySelector(
                ".gl-table-export-dropdown__item"
            ) as HTMLButtonElement;
            firstItem.click();
            expect(mockTableFns.exportSelection).toHaveBeenCalledWith("geojson");
        });
    });

    describe("Toggle Button", () => {
        beforeEach(() => {
            TablePanel.create(mockMap, mockConfig);
        });

        test("should have toggle button", () => {
            const toggleBtn = document.querySelector(".gl-table-panel__toggle-btn");
            expect(toggleBtn).not.toBeNull();
        });

        test("should have aria-label", () => {
            const toggleBtn = document.querySelector(".gl-table-panel__toggle-btn");
            expect(toggleBtn?.getAttribute("aria-label")).toBe("Hide table");
        });

        test("should call Table.toggle on click", () => {
            const toggleBtn = document.querySelector(
                ".gl-table-panel__toggle-btn"
            ) as HTMLButtonElement;
            toggleBtn.click();
            expect(mockTableFns.toggle).toHaveBeenCalled();
        });
    });

    describe("updateToolbarButtons()", () => {
        beforeEach(() => {
            TablePanel.create(mockMap, mockConfig);
        });

        test("should enable buttons when selection exists", () => {
            TablePanel.updateToolbarButtons(5);

            const zoomBtn = document.querySelector('[data-table-btn="zoom"]') as HTMLButtonElement;
            const highlightBtn = document.querySelector(
                '[data-table-btn="highlight"]'
            ) as HTMLButtonElement;
            const exportBtn = document.querySelector(
                '[data-table-btn="export"]'
            ) as HTMLButtonElement;

            expect(zoomBtn.disabled).toBe(false);
            expect(highlightBtn.disabled).toBe(false);
            expect(exportBtn.disabled).toBe(false);
        });

        test("should disable buttons when no selection", () => {
            TablePanel.updateToolbarButtons(0);

            const zoomBtn = document.querySelector('[data-table-btn="zoom"]') as HTMLButtonElement;
            const highlightBtn = document.querySelector(
                '[data-table-btn="highlight"]'
            ) as HTMLButtonElement;
            const exportBtn = document.querySelector(
                '[data-table-btn="export"]'
            ) as HTMLButtonElement;

            expect(zoomBtn.disabled).toBe(true);
            expect(highlightBtn.disabled).toBe(true);
            expect(exportBtn.disabled).toBe(true);
        });

        test("should disable buttons when no selection after enabling", () => {
            TablePanel.updateToolbarButtons(5);
            TablePanel.updateToolbarButtons(0);

            const zoomBtn = document.querySelector('[data-table-btn="zoom"]') as HTMLButtonElement;
            expect(zoomBtn.disabled).toBe(true);
        });
    });

    describe("refreshLayerSelector()", () => {
        beforeEach(() => {
            TablePanel.create(mockMap, mockConfig);
        });

        test("should clear and repopulate options", () => {
            const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;

            // Add some options
            const opt1 = document.createElement("option");
            opt1.value = "test1";
            select.appendChild(opt1);

            TablePanel.refreshLayerSelector();

            // Should still have at least the default option
            expect(select.options.length).toBeGreaterThanOrEqual(1);
        });

        test("should preserve current selection", () => {
            const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;

            // Add option and select it
            const opt = document.createElement("option");
            opt.value = "layer1";
            opt.textContent = "Layer 1";
            select.appendChild(opt);
            select.value = "layer1";

            TablePanel.refreshLayerSelector();

            expect(select.value).toBe("layer1");
        });

        test("should log info message", () => {
            TablePanel.refreshLayerSelector();
            expect(mockLogFns.info).toHaveBeenCalledWith(
                expect.stringContaining("Layer selector refreshed"),
                expect.anything(),
                expect.anything()
            );
        });

        test("should handle missing select element", () => {
            document.body.innerHTML = "";
            expect(() => TablePanel.refreshLayerSelector()).not.toThrow();
        });
    });

    describe("Search Functionality", () => {
        beforeEach(() => {
            TablePanel.create(mockMap, mockConfig);

            // Create table with rows for testing
            const table = document.querySelector(".gl-table-panel__table") as HTMLElement;
            const tbody = document.createElement("tbody");

            const row1 = document.createElement("tr");
            const cell1 = document.createElement("td");
            cell1.textContent = "Apple";
            row1.appendChild(cell1);
            tbody.appendChild(row1);

            const row2 = document.createElement("tr");
            const cell2 = document.createElement("td");
            cell2.textContent = "Banana";
            row2.appendChild(cell2);
            tbody.appendChild(row2);

            table.appendChild(tbody);
        });

        test("should filter rows based on search text", () => {
            vi.useFakeTimers();
            const searchInput = document.querySelector("[data-table-search]") as HTMLInputElement;

            searchInput.value = "apple";
            searchInput.dispatchEvent(new Event("input"));

            // Advance past debounce
            vi.advanceTimersByTime(350);
            vi.useRealTimers();

            const rows = document.querySelectorAll(".gl-table-panel__table tbody tr");
            const visibleRows = Array.from(rows).filter(
                (row) => (row as HTMLElement).style.display !== "none"
            );
            expect(visibleRows.length).toBe(1);
        });

        test("should show all rows when search is empty", () => {
            vi.useFakeTimers();
            const searchInput = document.querySelector("[data-table-search]") as HTMLInputElement;

            searchInput.value = "";
            searchInput.dispatchEvent(new Event("input"));

            // Advance past debounce
            vi.advanceTimersByTime(350);
            vi.useRealTimers();

            const rows = document.querySelectorAll(".gl-table-panel__table tbody tr");
            const visibleRows = Array.from(rows).filter(
                (row) => (row as HTMLElement).style.display !== "none"
            );
            expect(visibleRows.length).toBe(2);
        });
    });

    describe("Edge Cases", () => {
        test("should handle missing GeoJSON module", () => {
            _g.GeoLeaf.GeoJSON = null as any;

            // Should not throw
            expect(() => TablePanel.create(mockMap, mockConfig)).not.toThrow();
        });

        test("should handle missing Table module", () => {
            _g.GeoLeaf.Table = null as any;

            TablePanel.create(mockMap, mockConfig);
            const zoomBtn = document.querySelector('[data-table-btn="zoom"]') as HTMLButtonElement;

            // Should not throw when clicking
            expect(() => zoomBtn.click()).not.toThrow();
        });

        test("should use default height if not configured", () => {
            document.body.innerHTML = "";
            const container = TablePanel.create(mockMap, {});
            // When defaultHeight is undefined, style.height might be empty or 'undefined'
            // The actual behavior depends on whether undefined || '' is set
            expect(container).toBeDefined();
        });
    });
});
