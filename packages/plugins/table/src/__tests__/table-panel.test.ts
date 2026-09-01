/**
 * Phase 4.11 — table/panel.ts unit tests.
 *
 * Ported from the core suite (`__tests__/table/table-panel.test.js`).
 * Adaptation: import paths point at the plugin's flat `src/` layout; the GeoJSON /
 * visibility seams are driven on the runtime `_g.GeoLeaf.*` namespace (panel.ts reads
 * `_g.GeoLeaf.GeoJSON.getAllLayers/getLayerById` and
 * `_g.GeoLeaf._LayerVisibilityManager.getVisibilityState`). The source built a `Map`
 * of layers and stubbed `GeoJSONShared.getLayers`; here the same `Map` data is exposed
 * through `getAllLayers` (entries → array) + `getLayerById` (map lookup). The
 * `LayerVisibilityManager` and `Log` references taken inside test bodies map to the
 * installed `_g.GeoLeaf._LayerVisibilityManager` handle and the mocked `Log` import.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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
// vi.mock factories are hoisted above declarations; lift the shared handles with vi.hoisted.
const { setLayer, updateToolbarButtons, highlightSelection } = vi.hoisted(() => ({
    setLayer: vi.fn(),
    updateToolbarButtons: vi.fn(),
    highlightSelection: vi.fn(),
}));
vi.mock("../table-seam.js", () => ({
    TableContract: {
        register: vi.fn(),
        setLayer,
        updateToolbarButtons,
        zoomToSelection: vi.fn(),
        highlightSelection,
        exportSelection: vi.fn(),
        toggle: vi.fn(),
        show: vi.fn(),
    },
}));

import { TablePanel } from "../panel.js";
import { _g } from "../table-state.js";
import { Log } from "@geoleaf/host-runtime";

// Source data shape: a Map of layerId → layerData. The plugin reads the GeoJSON
// seam via getAllLayers (entries → array of {id, ...data}) + getLayerById.
const getLayers = vi.fn(() => new Map<string, any>());

/** (Re)installs the GeoJSON + visibility seams on `_g.GeoLeaf` from `getLayers()`. */
function installSeams() {
    const visibility = { getVisibilityState: vi.fn(() => ({ current: true })) };
    _g.GeoLeaf.GeoJSON = {
        getAllLayers: () =>
            Array.from(getLayers().entries(), ([id, data]) => ({ id, ...(data as object) })),
        getLayerById: (id: string) => getLayers().get(id) ?? null,
    } as any;
    _g.GeoLeaf._LayerVisibilityManager = visibility as any;
    return visibility;
}

let visibilitySeam = { getVisibilityState: vi.fn(() => ({ current: true })) };

describe("modules/table/panel (Phase 4.11)", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        getLayers.mockReturnValue(new Map());
        _g.GeoLeaf = {};
        visibilitySeam = installSeams();
    });

    it("create returns existing container if .gl-table-panel in DOM", () => {
        const existing = document.createElement("div");
        existing.className = "gl-table-panel";
        document.body.appendChild(existing);
        const result = TablePanel.create(
            {} as any,
            {
                defaultHeight: "40%",
                resizable: false,
            } as any
        );
        expect(result).toBe(existing);
    });

    it("create builds panel with table when no existing panel", () => {
        const result = TablePanel.create(
            {} as any,
            {
                defaultHeight: "50%",
                resizable: false,
            } as any
        );
        expect(result).not.toBeNull();
        expect(result.className).toContain("gl-table-panel");
        expect(result.querySelector(".gl-table-panel__table")).not.toBeNull();
    });

    it("create with resizable true adds resize handle", () => {
        const result = TablePanel.create(
            {} as any,
            {
                defaultHeight: "40%",
                resizable: true,
            } as any
        );
        expect(result.querySelector(".gl-table-panel__resize-handle")).not.toBeNull();
    });

    it("resize handle mousedown and mousemove triggers parseHeight and height update", () => {
        const result = TablePanel.create(
            {} as any,
            {
                defaultHeight: "40%",
                resizable: true,
                minHeight: "300px",
                maxHeight: "80%",
            } as any
        );
        const handle = result.querySelector(".gl-table-panel__resize-handle") as HTMLElement;
        handle.querySelector(".gl-table-panel__resize-bar");
        (result as any).getBoundingClientRect = () => ({ height: 400 });
        Object.defineProperty(result, "offsetHeight", { value: 400, configurable: true });
        // ⚠️ The move/release listeners now live on the HANDLE, set at
        // `pointerdown` and removed at the end — no longer permanently on `document`.
        handle.dispatchEvent(
            new PointerEvent("pointerdown", { clientY: 500, button: 0, bubbles: true })
        );
        handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, bubbles: true }));
        handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        // ⚠️ This was `expect(result.style.height).toBeDefined()` — an ALWAYS
        // true assertion (`style.height` returns `""` when nothing is set, and
        // `""` is defined). It would have passed on a handler doing nothing at
        // all. The value is computable: starting height 400, cursor from 500
        // to 300 → delta 200 → 600, within the [300px, 80% of viewport] bounds.
        expect(result.style.height).toBe("600px");
    });

    it("🛑 un second pointeur n'ouvre pas un second geste", () => {
        const result = TablePanel.create(
            {} as any,
            { defaultHeight: "40%", resizable: true, minHeight: "300px", maxHeight: "80%" } as any
        );
        const handle = result.querySelector(".gl-table-panel__resize-handle") as HTMLElement;
        Object.defineProperty(result, "offsetHeight", { value: 400, configurable: true });

        handle.dispatchEvent(
            new PointerEvent("pointerdown", { clientY: 500, button: 0, bubbles: true })
        );
        // Second finger: if it rearmed the gesture, `startY` would restart
        // from 400 and the next movement would yield a wrong height.
        handle.dispatchEvent(
            new PointerEvent("pointerdown", { clientY: 400, button: 0, bubbles: true })
        );
        handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, bubbles: true }));
        handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

        expect(result.style.height).toBe("600px");
    });

    it("un clic droit ne redimensionne pas", () => {
        const result = TablePanel.create(
            {} as any,
            { defaultHeight: "40%", resizable: true, minHeight: "300px", maxHeight: "80%" } as any
        );
        const handle = result.querySelector(".gl-table-panel__resize-handle") as HTMLElement;
        Object.defineProperty(result, "offsetHeight", { value: 400, configurable: true });
        // The panel is born with `defaultHeight` set: the assertion is about
        // the ABSENCE of change, not an empty value.
        const before = result.style.height;

        handle.dispatchEvent(
            new PointerEvent("pointerdown", { clientY: 500, button: 2, bubbles: true })
        );
        handle.dispatchEvent(new PointerEvent("pointermove", { clientY: 300, bubbles: true }));

        expect(result.style.height).toBe(before);
    });

    it("🛑 `pointercancel` relâche le curseur et la sélection posés sur TOUT le document", () => {
        const result = TablePanel.create(
            {} as any,
            { defaultHeight: "40%", resizable: true, minHeight: "300px", maxHeight: "80%" } as any
        );
        const handle = result.querySelector(".gl-table-panel__resize-handle") as HTMLElement;
        Object.defineProperty(result, "offsetHeight", { value: 400, configurable: true });

        handle.dispatchEvent(
            new PointerEvent("pointerdown", { clientY: 500, button: 0, bubbles: true })
        );
        expect(document.body.style.cursor).toBe("ns-resize");

        // A touch gesture can be claimed away; a mouse gesture cannot. Without
        // this branch, `ns-resize` and `user-select: none` stayed on the whole page.
        handle.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
        expect(document.body.style.cursor).toBe("");
        expect(document.body.style.userSelect).toBe("");
    });

    it("create with enableExportButton true adds export button", () => {
        const result = TablePanel.create(
            {} as any,
            {
                defaultHeight: "40%",
                resizable: false,
                enableExportButton: true,
            } as any
        );
        expect(result.querySelector("[data-table-btn='export']")).not.toBeNull();
    });

    it("refreshLayerSelector populates select when getLayers returns layers", () => {
        const map = new Map();
        map.set("ly1", {
            config: { table: { enabled: true } },
            label: "Layer 1",
            _visibility: { current: true },
        });
        getLayers.mockReturnValue(map);
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        expect(select).not.toBeNull();
        expect(select.options.length).toBeGreaterThan(1);
    });

    it("refreshLayerSelector calls setLayer when current value no longer in options", () => {
        const map = new Map();
        map.set("ly2", {
            config: { table: { enabled: true } },
            label: "Layer 2",
            _visibility: { current: true },
        });
        getLayers.mockReturnValue(map);
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        const opt = document.createElement("option");
        opt.value = "ly1";
        opt.textContent = "Old";
        select.appendChild(opt);
        select.value = "ly1";
        setLayer.mockClear();
        TablePanel.refreshLayerSelector();
        expect(setLayer).toHaveBeenCalled();
    });

    it("populateLayerSelector skips layer when visibility false", () => {
        const LayerVisibilityManager = visibilitySeam;
        LayerVisibilityManager.getVisibilityState.mockReturnValue({ current: false });
        const map = new Map();
        map.set("ly1", {
            config: { table: { enabled: true } },
            label: "Layer 1",
        });
        getLayers.mockReturnValue(map);
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        expect(select.options.length).toBe(1);
    });

    it("updateToolbarButtons enables zoom/highlight when selectedCount > 0", () => {
        TablePanel.create(
            {} as any,
            {
                defaultHeight: "40%",
                resizable: false,
                enableExportButton: true,
            } as any
        );
        const zoomBtn = document.querySelector("[data-table-btn='zoom']") as HTMLButtonElement;
        const highlightBtn = document.querySelector(
            "[data-table-btn='highlight']"
        ) as HTMLButtonElement;
        TablePanel.updateToolbarButtons(1);
        expect(zoomBtn.disabled).toBe(false);
        expect(highlightBtn.disabled).toBe(false);
    });

    it("updateToolbarButtons disables highlight and calls highlightSelection false when selectedCount 0", () => {
        TablePanel.create(
            {} as any,
            {
                defaultHeight: "40%",
                resizable: false,
                enableExportButton: true,
            } as any
        );
        const highlightBtn = document.querySelector(
            "[data-table-btn='highlight']"
        ) as HTMLButtonElement;
        highlightBtn.classList.add("gl-is-active");
        highlightSelection.mockClear();
        TablePanel.updateToolbarButtons(0);
        expect(highlightBtn.classList.contains("gl-is-active")).toBe(false);
        expect(highlightSelection).toHaveBeenCalledWith(false);
    });

    it("destroy cleans up event cleanups", () => {
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        expect(() => TablePanel.destroy()).not.toThrow();
    });

    it("search input filterTableRows hides non-matching rows", () => {
        vi.useFakeTimers();
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        const wrapper = document.querySelector(".gl-table-panel__wrapper") as HTMLElement;
        const table = wrapper.querySelector(".gl-table-panel__table") as HTMLElement;
        const tbody = document.createElement("tbody");
        const tr1 = document.createElement("tr");
        tr1.appendChild(document.createElement("td"));
        tr1.cells[0].textContent = "hello";
        const tr2 = document.createElement("tr");
        tr2.appendChild(document.createElement("td"));
        tr2.cells[0].textContent = "world";
        tbody.appendChild(tr1);
        tbody.appendChild(tr2);
        table.appendChild(tbody);
        const input = document.querySelector("[data-table-search]") as HTMLInputElement;
        expect(input).not.toBeNull();
        input.value = "hello";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(400);
        expect(tr1.style.display).not.toBe("none");
        expect(tr2.style.display).toBe("none");
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(400);
        expect(tr2.style.display).toBe("");
        vi.useRealTimers();
    });
});

// ── T22 — table/panel.ts branch coverage ─────────────────────────────────────
describe("modules/table/panel — T22 branch coverage", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        getLayers.mockReturnValue(new Map());
        _g.GeoLeaf = {};
        visibilitySeam = installSeams();
        const LayerVisibilityManager = visibilitySeam;
        LayerVisibilityManager.getVisibilityState.mockReturnValue({ current: true });
    });

    it("refreshLayerSelector returns early when no select in DOM (branch 45.0)", () => {
        // No panel created — no select element
        expect(() => TablePanel.refreshLayerSelector()).not.toThrow();
    });

    it("refreshLayerSelector logs warning when getLayers returns empty map (branch 19.0)", () => {
        getLayers.mockReturnValue(new Map());
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        Log.warn.mockClear();
        TablePanel.refreshLayerSelector();
        expect(Log.warn).toHaveBeenCalled();
    });

    it("change event on layer select covers e.target.value not-nullish (branch 14.0)", () => {
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        const opt = document.createElement("option");
        opt.value = "layerX";
        select.appendChild(opt);
        select.value = "layerX";
        select.dispatchEvent(new Event("change"));
        // e.target.value = "layerX" (not nullish) — covers ?? branch [0]
    });

    it("populateLayerSelector skips layer when table.enabled is false (branch 21.0)", () => {
        const map = new Map();
        map.set("ly1", {
            config: { table: { enabled: false } },
            label: "Layer 1",
            _visibility: { current: true },
        });
        getLayers.mockReturnValue(map);
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        expect(select.options.length).toBe(1); // just the default option
    });

    it("populateLayerSelector uses config.title when label absent (branch 24.1)", () => {
        const map = new Map();
        map.set("ly-titled", {
            config: { table: { enabled: true }, title: "Config Title" },
            _visibility: { current: true },
        });
        getLayers.mockReturnValue(map);
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        expect(select.options[1].textContent).toBe("Config Title");
    });

    it("populateLayerSelector uses layerId when label and title absent (branch 24.2)", () => {
        const map = new Map();
        map.set("id-fallback", {
            config: { table: { enabled: true } },
            _visibility: { current: true },
        });
        getLayers.mockReturnValue(map);
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        TablePanel.refreshLayerSelector();
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        expect(select.options[1].textContent).toBe("id-fallback");
    });

    it("filterTableRows returns early when no tbody (branch 27.0)", () => {
        vi.useFakeTimers();
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        // No tbody added — table is empty
        const input = document.querySelector("[data-table-search]") as HTMLInputElement;
        input.value = "test";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(400);
        // No throw expected
        vi.useRealTimers();
    });

    it("toggle button click invokes the contract toggle without throwing", () => {
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        const toggleBtn = document.querySelector(
            ".gl-table-panel__toggle-btn"
        ) as HTMLButtonElement;
        // The handler simply delegates to TableContract.toggle(); active-state reset
        // now lives in Table.hide() (see _syncTriggerButtons), not in the panel.
        expect(() => toggleBtn.click()).not.toThrow();
    });

    it("refreshLayerSelector restores current selection when layer still available (branch 46.0)", () => {
        const map = new Map();
        map.set("ly1", { config: { table: { enabled: true } }, label: "Layer 1" });
        getLayers.mockReturnValue(map);
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        TablePanel.refreshLayerSelector(); // populates ly1
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        select.value = "ly1";
        TablePanel.refreshLayerSelector(); // ly1 still in map → restores selection
        expect(select.value).toBe("ly1");
    });

    it("refreshLayerSelector calls setLayer('') when current layer removed and no others (branch 50.1)", () => {
        TablePanel.create({} as any, { defaultHeight: "40%", resizable: false } as any);
        const select = document.querySelector("[data-table-layer-select]") as HTMLSelectElement;
        const opt = document.createElement("option");
        opt.value = "removed-layer";
        select.appendChild(opt);
        select.value = "removed-layer";
        // Refresh with empty map → removed-layer not in new options AND no other layers
        getLayers.mockReturnValue(new Map());
        setLayer.mockClear();
        TablePanel.refreshLayerSelector();
        expect(setLayer).toHaveBeenCalledWith("");
    });
});
