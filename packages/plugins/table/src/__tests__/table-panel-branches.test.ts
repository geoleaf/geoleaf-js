/**
 * Deep branch-coverage tests for table/panel.ts
 * Covers: create, parseHeight, createToolbar, createLayerSelector,
 * populateLayerSelector, filterTableRows, updateToolbarButtons,
 * refreshLayerSelector, destroy, _isLayerVisible, _isTableLayer.
 *
 * Ported from the core suite (`__tests__/table/table-panel-branches.test.js`).
 * Adaptation: import paths point at the plugin's flat `src/` layout; the GeoJSON /
 * visibility seams are driven on the runtime `_g.GeoLeaf.*` namespace (panel.ts reads
 * `_g.GeoLeaf.GeoJSON.getAllLayers/getLayerById` and
 * `_g.GeoLeaf._LayerVisibilityManager.getVisibilityState`). The source built a `Map`
 * of layers and stubbed `GeoJSONShared.getLayers`; here the same `Map` data is exposed
 * through `getAllLayers` (entries → array) + `getLayerById` (map lookup).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ⚠️ ONE mock per specifier: `Log` and `tLabel` now come from the same barrel, so a
// second vi.mock("@geoleaf/host-runtime") would silently replace this one.
vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    tLabel: vi.fn((key: string) => key),
}));
vi.mock("../utils/events.js", () => ({
    // 🛑 DO NOT RE-NEUTRALISE THIS SEAM — measured on 17/08/2026.
    // Neutralising the seam forces `panel-resize.ts`'s FALLBACK, while `events`
    // is a constant module object: in production the condition is always true.
    // Seven suites in the package neutralised it, so that none exercised the
    // path production takes. This mock reproduces `utils/events.ts` exactly, `off` included.
    events: {
        on: vi.fn((target, type, handler, options) => {
            target.addEventListener(type, handler, options);
            return () => target.removeEventListener(type, handler, options);
        }),
        off: vi.fn((cleanup) => {
            if (typeof cleanup === "function") cleanup();
        }),
    },
}));
vi.mock("../table-seam.js", () => ({
    TableContract: {
        zoomToSelection: vi.fn(),
        highlightSelection: vi.fn(),
        exportSelection: vi.fn(),
        setLayer: vi.fn(),
        show: vi.fn(),
        toggle: vi.fn(),
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

/** Installs the visibility seam on `_g.GeoLeaf` and returns the vi.fn handle. */
function installVisibilitySeam(impl: (id: string) => { current?: boolean } | null) {
    const getVisibilityState = vi.fn(impl);
    _g.GeoLeaf._LayerVisibilityManager = { getVisibilityState } as any;
    return getVisibilityState;
}

describe("table/panel — branch coverage", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // Clean up DOM between tests
        document.querySelectorAll(".gl-table-panel").forEach((el) => el.remove());
        _g.GeoLeaf = {};
        installGeoJSONSeam(new Map());
        TablePanel._eventCleanups = [];
    });

    // ── create ───────────────────────────────────────────────────────────
    it("create builds panel with default height", () => {
        const container = TablePanel.create({} as any, { defaultHeight: "50%" } as any);
        expect(container).not.toBeNull();
        expect(container.classList.contains("gl-table-panel")).toBe(true);
        expect(container.style.height).toBe("50%");
    });

    it("create returns existing container if already present", () => {
        const first = TablePanel.create({} as any, {} as any);
        const second = TablePanel.create({} as any, {} as any);
        expect(first).toBe(second);
    });

    it("create uses 40% default height when none specified", () => {
        const container = TablePanel.create({} as any, {} as any);
        expect(container.style.height).toBe("40%");
    });

    it("create adds resize handle when resizable=true", () => {
        const container = TablePanel.create({} as any, { resizable: true } as any);
        expect(container.querySelector(".gl-table-panel__resize-handle")).not.toBeNull();
    });

    it("create does not add resize handle when resizable=false", () => {
        const container = TablePanel.create({} as any, { resizable: false } as any);
        expect(container.querySelector(".gl-table-panel__resize-handle")).toBeNull();
    });

    it("create adds export button when enableExportButton=true", () => {
        const container = TablePanel.create({} as any, { enableExportButton: true } as any);
        expect(container.querySelector("[data-table-btn='export']")).not.toBeNull();
    });

    it("create does not add export button by default", () => {
        document.querySelectorAll(".gl-table-panel").forEach((el) => el.remove());
        const container = TablePanel.create({} as any, {} as any);
        expect(container.querySelector("[data-table-btn='export']")).toBeNull();
    });

    it("create adds toolbar with layer selector and search", () => {
        const container = TablePanel.create({} as any, {} as any);
        expect(container.querySelector(".gl-table-panel__toolbar")).not.toBeNull();
        expect(container.querySelector("[data-table-layer-select]")).not.toBeNull();
        expect(container.querySelector("[data-table-search]")).not.toBeNull();
    });

    it("create adds toggle button", () => {
        const container = TablePanel.create({} as any, {} as any);
        expect(container.querySelector(".gl-table-panel__toggle-btn")).not.toBeNull();
    });

    // ── updateToolbarButtons ─────────────────────────────────────────────
    it("updateToolbarButtons enables buttons when selection > 0", () => {
        TablePanel.create({} as any, {} as any);
        TablePanel.updateToolbarButtons(3);
        const zoomBtn = document.querySelector("[data-table-btn='zoom']") as HTMLButtonElement;
        expect(zoomBtn.disabled).toBe(false);
    });

    it("updateToolbarButtons disables buttons when selection = 0", () => {
        TablePanel.create({} as any, {} as any);
        TablePanel.updateToolbarButtons(0);
        const zoomBtn = document.querySelector("[data-table-btn='zoom']") as HTMLButtonElement;
        expect(zoomBtn.disabled).toBe(true);
    });

    it("updateToolbarButtons deactivates highlight when no selection and was active", () => {
        TablePanel.create({} as any, {} as any);
        const hlBtn = document.querySelector("[data-table-btn='highlight']") as HTMLButtonElement;
        hlBtn.classList.add("gl-is-active");
        TablePanel.updateToolbarButtons(0);
        expect(hlBtn.classList.contains("gl-is-active")).toBe(false);
    });

    // ── refreshLayerSelector ─────────────────────────────────────────────
    it("refreshLayerSelector populates layer options from GeoJSONShared", () => {
        TablePanel.create({} as any, {} as any);
        const layers = new Map();
        layers.set("lyr1", {
            label: "Layer 1",
            config: { table: { enabled: true } },
        });
        installGeoJSONSeam(layers);
        installVisibilitySeam(() => ({ current: true }));
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        // 1 default + 1 layer
        expect(select.options.length).toBe(2);
    });

    it("refreshLayerSelector skips non-table layers", () => {
        TablePanel.create({} as any, {} as any);
        const layers = new Map();
        layers.set("lyr1", { config: { table: { enabled: false } } });
        installGeoJSONSeam(layers);
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        expect(select.options.length).toBe(1); // only default
    });

    it("refreshLayerSelector skips hidden layers", () => {
        TablePanel.create({} as any, {} as any);
        const layers = new Map();
        layers.set("lyr1", {
            config: { table: { enabled: true } },
        });
        installGeoJSONSeam(layers);
        installVisibilitySeam(() => ({ current: false }));
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        expect(select.options.length).toBe(1);
    });

    it("refreshLayerSelector restores previous selection", () => {
        TablePanel.create({} as any, {} as any);
        const layers = new Map();
        layers.set("lyr1", {
            label: "L1",
            config: { table: { enabled: true } },
        });
        layers.set("lyr2", {
            label: "L2",
            config: { table: { enabled: true } },
        });
        installGeoJSONSeam(layers);
        installVisibilitySeam(() => ({ current: true }));
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        select.value = "lyr2";
        // Refresh again
        TablePanel.refreshLayerSelector();
        expect(select.value).toBe("lyr2");
    });

    it("refreshLayerSelector falls back when active layer removed", () => {
        TablePanel.create({} as any, {} as any);
        const layers = new Map();
        layers.set("lyr1", {
            label: "L1",
            config: { table: { enabled: true } },
        });
        installGeoJSONSeam(layers);
        installVisibilitySeam(() => ({ current: true }));
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        select.value = "lyr1";
        // Now remove layers
        installGeoJSONSeam(new Map());
        TablePanel.refreshLayerSelector();
        expect(select.value).toBe("");
    });

    it("refreshLayerSelector updates placeholder text", () => {
        TablePanel.create({} as any, {} as any);
        installGeoJSONSeam(new Map());
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        expect(select.options[0].textContent).toBe("No visible layer");
    });

    // ── _isLayerVisible — VisibilityManager returns null state ──────────
    it("refreshLayerSelector treats null visState as hidden", () => {
        TablePanel.create({} as any, {} as any);
        const layers = new Map();
        layers.set("lyr1", {
            config: { table: { enabled: true } },
            _visibility: { current: true },
        });
        installGeoJSONSeam(layers);
        // getVisibilityState returns null → visState?.current === true → false → hidden
        installVisibilitySeam(() => null);
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        expect(select.options.length).toBe(1); // only default, layer is hidden
    });

    // ── destroy ──────────────────────────────────────────────────────────
    it("destroy calls cleanup functions", () => {
        const cleanup1 = vi.fn();
        const cleanup2 = vi.fn();
        TablePanel._eventCleanups = [cleanup1, cleanup2];
        TablePanel.destroy();
        expect(cleanup1).toHaveBeenCalled();
        expect(cleanup2).toHaveBeenCalled();
        expect(TablePanel._eventCleanups).toEqual([]);
    });

    it("destroy does nothing when no cleanups", () => {
        TablePanel._eventCleanups = [];
        TablePanel.destroy(); // Should not throw
    });

    // ── filterTableRows (via search input) ───────────────────────────────
    it("search input filters rows after debounce", async () => {
        TablePanel.create({} as any, {} as any);
        const table = document.querySelector(".gl-table-panel__table") as HTMLElement;
        const tbody = document.createElement("tbody");
        const row1 = document.createElement("tr");
        const td1 = document.createElement("td");
        td1.textContent = "Paris";
        row1.appendChild(td1);
        tbody.appendChild(row1);
        const row2 = document.createElement("tr");
        const td2 = document.createElement("td");
        td2.textContent = "Lyon";
        row2.appendChild(td2);
        tbody.appendChild(row2);
        table.appendChild(tbody);

        const input = document.querySelector("[data-table-search]") as HTMLInputElement;
        input.value = "paris";
        input.dispatchEvent(new Event("input"));

        // Wait for 350ms debounce
        await new Promise((resolve) => setTimeout(resolve, 350));

        expect(row1.style.display).toBe("");
        expect(row2.style.display).toBe("none");
    });

    it("search input shows all rows when empty", async () => {
        TablePanel.create({} as any, {} as any);
        const table = document.querySelector(".gl-table-panel__table") as HTMLElement;
        const tbody = document.createElement("tbody");
        const row = document.createElement("tr");
        const td = document.createElement("td");
        td.textContent = "test";
        row.appendChild(td);
        row.style.display = "none";
        tbody.appendChild(row);
        table.appendChild(tbody);

        const input = document.querySelector("[data-table-search]") as HTMLInputElement;
        input.value = "";
        input.dispatchEvent(new Event("input"));

        await new Promise((resolve) => setTimeout(resolve, 350));
        expect(row.style.display).toBe("");
    });
});
