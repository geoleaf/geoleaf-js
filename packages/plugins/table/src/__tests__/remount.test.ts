/**
 * @geoleaf-plugins/table — the table goes away with the application, and comes back on the next.
 *
 * ## The defect
 *
 * `GeoLeaf.mount()` unmounts the application by destroying the core's module registry. The
 * table was reached by none of it: its panel is a child of `<body>`, its listeners sit on
 * `document` and on the map adapter, and its entry declared a toolbar slot with no teardown —
 * and declared nothing at all once loaded on demand. Measured in a real browser: the panel
 * stayed OPEN in a page whose application was unmounted, `gl-table-open` stayed on `<body>`,
 * and the next application found the table bound to the map that had gone.
 *
 * ## What is pinned
 *
 * - the teardown removes the panel, the body class, every listener, and forgets the map;
 * - the next activation builds the table again, on the map alive THEN;
 * - the entry registers that teardown on both loading paths — with its toolbar slot before the
 *   boot, without it after.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** The global the plugin reads, as the tests install it. */
const carrier = globalThis as Record<string, unknown>;

/** A map adapter stub that records its subscriptions. */
function makeMap() {
    return { on: vi.fn(), off: vi.fn(), fire: vi.fn(), removeLayer: vi.fn() };
}

/** Installs a namespace: one map, the table enabled, a registry in the given state. */
function installHost(map: ReturnType<typeof makeMap>, initialized: boolean) {
    const register = vi.fn();
    carrier["GeoLeaf"] = {
        I18n: { registerDict: vi.fn(), getLabel: (key: string) => key },
        plugins: { register: vi.fn() },
        registry: { register, isInitialized: () => initialized },
        mount: () => undefined,
        Core: { getMap: () => map },
        Config: {
            get: (key: string, fallback?: unknown) =>
                key === "modules.table" ? { enabled: true, defaultVisible: false } : fallback,
        },
        GeoJSON: { getAllLayers: () => [], getLayerById: () => null, getLayerData: () => null },
        Log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    };
    return register;
}

/** Evaluates the entry afresh, and hands back the modules that share its state. */
async function loadPlugin() {
    vi.resetModules();
    await import("../entry.js");
    const { TableLifecycle } = await import("../lifecycle.js");
    const { tableState } = await import("../table-state.js");
    const { Table } = await import("../table-api.js");
    return { TableLifecycle, tableState, Table };
}

beforeEach(() => {
    document.body.innerHTML = "";
    document.body.className = "";
});

afterEach(() => {
    delete carrier["GeoLeaf"];
    document.body.innerHTML = "";
    document.body.className = "";
    vi.restoreAllMocks();
});

describe("the table is torn down with the application", () => {
    it("🛑 the teardown removes the panel, the body class and the map it held", async () => {
        const map = makeMap();
        installHost(map, false);
        const { TableLifecycle, tableState, Table } = await loadPlugin();

        expect(TableLifecycle.ensureInitialized()).toBe(true);
        Table.show();
        expect(document.querySelectorAll(".gl-table-panel")).toHaveLength(1);
        expect(document.body.classList.contains("gl-table-open")).toBe(true);
        expect(Table.isOpen()).toBe(true);

        TableLifecycle.destroy();

        expect(document.querySelectorAll(".gl-table-panel")).toHaveLength(0);
        expect(document.body.classList.contains("gl-table-open")).toBe(false);
        expect(Table.isOpen()).toBe(false);
        expect(tableState._map).toBeNull();
        expect(tableState._container).toBeNull();
    });

    it("🛑 every listener it attached is given back — the map's, and the document's", async () => {
        const map = makeMap();
        installHost(map, false);
        const added = vi.spyOn(document, "addEventListener");
        const removed = vi.spyOn(document, "removeEventListener");
        const { TableLifecycle } = await loadPlugin();
        TableLifecycle.ensureInitialized();

        const onMap = map.on.mock.calls.map(([name, handler]) => ({ name, handler }));
        expect(onMap.map((entry) => entry.name).sort()).toEqual([
            "geoleaf:geojson:layers-loaded",
            "geoleaf:geojson:visibility-changed",
        ]);

        TableLifecycle.destroy();

        for (const { name, handler } of onMap) expect(map.off).toHaveBeenCalledWith(name, handler);
        for (const name of [
            "geoleaf:filters:applied",
            "geoleaf:layer:updated",
            "geoleaf:theme:applied",
        ]) {
            const handler = added.mock.calls.find(([event]) => event === name)?.[1];
            expect(handler, `${name} was attached`).toBeTypeOf("function");
            expect(removed, `${name} is given back`).toHaveBeenCalledWith(name, handler);
        }
    });

    it("🛑 the next activation builds the table again, on the map alive then", async () => {
        const first = makeMap();
        installHost(first, false);
        const { TableLifecycle, tableState } = await loadPlugin();
        TableLifecycle.ensureInitialized();
        const firstPanel = tableState._container;
        TableLifecycle.destroy();

        const second = makeMap();
        (carrier["GeoLeaf"] as { Core: { getMap: () => unknown } }).Core.getMap = () => second;

        expect(TableLifecycle.ensureInitialized()).toBe(true);
        expect(tableState._map).toBe(second);
        expect(tableState._container).not.toBe(firstPanel);
        expect(document.querySelectorAll(".gl-table-panel")).toHaveLength(1);
        expect(second.on).toHaveBeenCalled();
    });

    it("tolerates a table that was never built, and a second call", async () => {
        installHost(makeMap(), false);
        const { TableLifecycle } = await loadPlugin();
        expect(() => TableLifecycle.destroy()).not.toThrow();
        expect(() => TableLifecycle.destroy()).not.toThrow();
    });

    it("🛑 releases its state even when closing the panel throws — the map already destroyed", async () => {
        const map = makeMap();
        installHost(map, false);
        const { TableLifecycle, tableState, Table } = await loadPlugin();
        TableLifecycle.ensureInitialized();
        Table.show();
        vi.spyOn(Table, "hide").mockImplementation(() => {
            throw new Error("the map is gone");
        });

        expect(() => TableLifecycle.destroy()).toThrow("the map is gone");

        // What a teardown that stops half-way leaves behind is a table that never mounts again.
        expect(tableState._container).toBeNull();
        expect(tableState._map).toBeNull();
        expect(document.querySelectorAll(".gl-table-panel")).toHaveLength(0);
    });
});

describe("the entry registers that teardown on both loading paths", () => {
    it("before the boot: the module carries the teardown and the toolbar slot", async () => {
        const register = installHost(makeMap(), false);
        const { TableLifecycle } = await loadPlugin();

        expect(register).toHaveBeenCalledTimes(1);
        const module = register.mock.calls[0]![0] as {
            id: string;
            ui?: Record<string, unknown>;
            init: () => void;
            destroy: () => void;
        };
        expect(module.id).toBe("table");
        expect(Object.keys(module.ui ?? {}).sort()).toEqual(["desktopTabButton", "mobileIcon"]);

        TableLifecycle.ensureInitialized();
        module.destroy();
        expect(document.querySelectorAll(".gl-table-panel")).toHaveLength(0);
    });

    it("🛑 after the boot: the teardown is registered too, without the slot", async () => {
        const register = installHost(makeMap(), true);
        const { TableLifecycle } = await loadPlugin();

        expect(register).toHaveBeenCalledTimes(1);
        const module = register.mock.calls[0]![0] as { id: string; destroy: () => void };
        expect(module.id).toBe("table");
        // The button belongs to the lazy declaration that drew it.
        expect("ui" in module).toBe(false);

        TableLifecycle.ensureInitialized();
        module.destroy();
        expect(document.querySelectorAll(".gl-table-panel")).toHaveLength(0);
    });
});
