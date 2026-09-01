/**
 *
 * T4.2 — kernel/map (0% → ≥60% branches)
 * Tests for:
 *   - src/kernel/map/facade.ts  (Core.init, getMap, getAdapter)
 *   - src/kernel/map/map-container.ts (resolveMapContainer, padBounds,
 *                                               applyThemeSafe)
 */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => {
    // Vitest 4: `new MaplibreAdapter()` requires a constructable mock (class returning fake).
    const MockMaplibreAdapter = vi.fn().mockImplementation(
        class {
            constructor() {
                return {
                    init: vi.fn(),
                    destroy: vi.fn(),
                    getMap: vi.fn().mockReturnValue({}),
                };
            }
        }
    );
    return { MaplibreAdapter: MockMaplibreAdapter };
});

vi.mock("../../src/kernel/map/theme.js", () => ({
    setTheme: vi.fn(),
    getTheme: vi.fn().mockReturnValue("light"),
}));

const _g = typeof globalThis !== "undefined" ? globalThis : window;

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Core (index.ts)
// Each test uses vi.resetModules() to get a fresh _mapInstance = null
// ─────────────────────────────────────────────────────────────────────────────
describe("Core (kernel/map/facade.ts)", () => {
    let Core;
    let Log;

    beforeEach(async () => {
        vi.resetModules();
        document.body.innerHTML = '<div id="test-map"></div>';
        _g.GeoLeaf = undefined;
        // Re-require after reset to get fresh module-level _mapInstance = null
        Core = (await import("../../src/kernel/map/facade.js")).Core;
        Log = (await import("../../src/utils/log/index.js")).Log;
    });

    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
        _g.GeoLeaf = undefined;
    });

    // ── Core.getMap / getAdapter before init ────────────────────────────────

    it("getMap returns null before init", () => {
        expect(Core.getMap()).toBeNull();
    });

    it("getAdapter returns null before init", () => {
        expect(Core.getAdapter()).toBeNull();
    });

    // ── Core.init — happy path ───────────────────────────────────────────────

    it("init returns a MaplibreAdapter instance on success", () => {
        const adapter = Core.init({ mapId: "test-map" });
        expect(adapter).not.toBeNull();
        expect(adapter.init).toHaveBeenCalled();
    });

    it("init calls MaplibreAdapter.init with container and options", () => {
        const adapter = Core.init({ mapId: "test-map", zoom: 10 });
        expect(adapter.init).toHaveBeenCalledWith(expect.objectContaining({ zoom: 10 }));
    });

    it("init passes center from [lat, lng] array", () => {
        const adapter = Core.init({ mapId: "test-map", center: [48.8566, 2.3522] });
        expect(adapter.init).toHaveBeenCalledWith(
            expect.objectContaining({ center: { lat: 48.8566, lng: 2.3522 } })
        );
    });

    it("init uses DEFAULT_ZOOM (number) when zoom is not provided", () => {
        const adapter = Core.init({ mapId: "test-map" });
        const opts = adapter.init.mock.calls[0][0];
        expect(typeof opts.zoom).toBe("number");
    });

    it("init passes maxBounds when mapOptions.maxBounds is a valid GeoLeafBounds", () => {
        const bounds = { north: 49, south: 48, east: 3, west: 2 };
        const adapter = Core.init({ mapId: "test-map", mapOptions: { maxBounds: bounds } });
        expect(adapter.init).toHaveBeenCalledWith(expect.objectContaining({ maxBounds: bounds }));
    });

    it("init ignores maxBounds when it is not a valid GeoLeafBounds object", () => {
        const adapter = Core.init({ mapId: "test-map", mapOptions: { maxBounds: "invalid" } });
        const opts = adapter.init.mock.calls[0][0];
        expect(opts.maxBounds).toBeUndefined();
    });

    it("getMap returns the adapter after init", () => {
        const adapter = Core.init({ mapId: "test-map" });
        expect(Core.getMap()).toBe(adapter);
    });

    it("getAdapter returns same value as getMap", () => {
        Core.init({ mapId: "test-map" });
        expect(Core.getAdapter()).toBe(Core.getMap());
    });

    it("logs info on successful init", () => {
        Core.init({ mapId: "test-map" });
        expect(Log.info).toHaveBeenCalledWith(expect.stringContaining("initialized successfully"));
    });

    // ── Core.init — already-initialized recycling ────────────────────────────

    it("returns existing instance and warns on second init call", () => {
        const first = Core.init({ mapId: "test-map" });
        const second = Core.init({ mapId: "test-map" });
        expect(second).toBe(first);
        expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("already initialized"));
    });

    it("does not construct a second MaplibreAdapter on recycled call", () => {
        const first = Core.init({ mapId: "test-map" });
        const second = Core.init({ mapId: "test-map" });
        // second call returns the SAME adapter — no second instantiation
        expect(first).toBe(second);
    });

    // ── Core.init — error paths ──────────────────────────────────────────────

    it("returns null when mapId is missing (empty string)", () => {
        const result = Core.init({ mapId: "" });
        expect(result).toBeNull();
    });

    it("returns null when mapId is undefined", () => {
        const result = Core.init({});
        expect(result).toBeNull();
    });

    it("returns null when element is not found in DOM", () => {
        const result = Core.init({ mapId: "does-not-exist" });
        expect(result).toBeNull();
    });

    it("logs error when init throws (missing DOM element enters the catch)", () => {
        // A non-empty but unknown mapId passes the early guard, then resolveMapContainer
        // throws inside the try → exercises the catch branch.
        Core.init({ mapId: "does-not-exist" });
        expect(Log.error).toHaveBeenCalledWith(
            expect.stringContaining("init failed for"),
            expect.any(String)
        );
    });

    it("logs an explicit error when mapId is missing (early guard, no throw)", () => {
        Core.init({});
        expect(Log.error).toHaveBeenCalledWith(expect.stringContaining("requires options.mapId"));
    });

    it("calls GeoLeaf.Core.onError callback when init throws", () => {
        const onError = vi.fn();
        _g.GeoLeaf = { Core: { onError } };
        Core.init({ mapId: "does-not-exist" });
        expect(onError).toHaveBeenCalled();
    });

    it("handles an onError callback that itself throws", () => {
        _g.GeoLeaf = {
            Core: {
                onError: vi.fn().mockImplementation(() => {
                    throw new Error("onError blew up");
                }),
            },
        };
        const result = Core.init({ mapId: "does-not-exist" });
        expect(result).toBeNull();
        // second Log.error for the onError throw
        expect(Log.error).toHaveBeenCalledWith(
            expect.stringContaining("Error in Core.onError()"),
            expect.any(Error)
        );
    });

    it("resets _mapInstance to null on error so next init is fresh", () => {
        // First call fails
        Core.init({ mapId: "" });
        // Second call on valid mapId should succeed
        const adapter = Core.init({ mapId: "test-map" });
        expect(adapter).not.toBeNull();
    });

    // ── _centerFromArray private helper (tested via init) ───────────────────

    it("ignores center when array length < 2", () => {
        const adapter = Core.init({ mapId: "test-map", center: [48] });
        const opts = adapter.init.mock.calls[0][0];
        // _centerFromArray returns undefined for short arrays
        expect(opts.center).toBeUndefined();
    });

    it("ignores center when value is not an array", () => {
        const adapter = Core.init({ mapId: "test-map", center: "48,2" });
        const opts = adapter.init.mock.calls[0][0];
        expect(opts.center).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — map-container.ts
// No module-level state — require fresh in beforeEach after Section 1 resets
// ─────────────────────────────────────────────────────────────────────────────
describe("map-container.ts", () => {
    let resolveMapContainer, padBounds, applyThemeSafe;
    let Log;

    beforeEach(async () => {
        // After Section 1's vi.resetModules(), map-container is not in cache.
        // Require fresh so we get the same Log mock instance as the module uses.
        ({ resolveMapContainer, padBounds, applyThemeSafe } =
            await import("../../src/kernel/map/map-container.js"));
        Log = (await import("../../src/utils/log/index.js")).Log;
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="map-el"></div>';
        _g.GeoLeaf = undefined;
    });

    afterEach(() => {
        document.body.innerHTML = "";
        _g.GeoLeaf = undefined;
    });

    // ── resolveMapContainer ──────────────────────────────────────────────────

    it("resolveMapContainer throws when mapId is null", () => {
        expect(() => resolveMapContainer(null)).toThrow(/mapId/i);
    });

    it("resolveMapContainer throws when mapId is empty string", () => {
        expect(() => resolveMapContainer("")).toThrow(/mapId/i);
    });

    it("resolveMapContainer throws when mapId is undefined", () => {
        expect(() => resolveMapContainer(undefined)).toThrow(/mapId/i);
    });

    it("resolveMapContainer throws when element is not found", () => {
        expect(() => resolveMapContainer("no-such-id")).toThrow(/No DOM element/i);
    });

    it("resolveMapContainer returns the HTMLElement when found", () => {
        const el = resolveMapContainer("map-el");
        expect(el).toBeInstanceOf(HTMLElement);
        expect(el.id).toBe("map-el");
    });

    // ── padBounds ────────────────────────────────────────────────────────────

    it("padBounds expands north and south by latSpan * ratio", () => {
        const b = { north: 1, south: 0, east: 0, west: 0 };
        const r = padBounds(b, 0.5); // latSpan = 1, lngSpan = 0
        expect(r.north).toBeCloseTo(1.5);
        expect(r.south).toBeCloseTo(-0.5);
    });

    it("padBounds expands east and west by lngSpan * ratio", () => {
        const b = { north: 0, south: 0, east: 4, west: 0 };
        const r = padBounds(b, 0.25); // lngSpan = 4
        expect(r.east).toBeCloseTo(5);
        expect(r.west).toBeCloseTo(-1);
    });

    it("padBounds with ratio 0 returns unchanged values", () => {
        const b = { north: 10, south: 5, east: 20, west: 15 };
        const r = padBounds(b, 0);
        expect(r.north).toBe(10);
        expect(r.south).toBe(5);
        expect(r.east).toBe(20);
        expect(r.west).toBe(15);
    });

    it("padBounds does not mutate the original bounds object", () => {
        const b = { north: 1, south: 0, east: 2, west: 0 };
        padBounds(b, 0.3);
        expect(b.north).toBe(1); // unchanged
    });

    // ── applyThemeSafe ───────────────────────────────────────────────────────

    it("applyThemeSafe applies the theme WITHOUT persisting by default", () => {
        const applyTheme = vi.fn();
        _g.GeoLeaf = { UI: { applyTheme } };
        applyThemeSafe("dark");
        // The `false` is the load-bearing part (backlog B.18): the boot applies a theme,
        // it never chooses one. Persisting here overwrote the user's stored choice.
        expect(applyTheme).toHaveBeenCalledWith("dark", false);
    });

    it("applyThemeSafe can persist when explicitly asked to", () => {
        const applyTheme = vi.fn();
        _g.GeoLeaf = { UI: { applyTheme } };
        applyThemeSafe("dark", true);
        expect(applyTheme).toHaveBeenCalledWith("dark", true);
    });

    it("applyThemeSafe is a no-op when GeoLeaf is undefined", () => {
        _g.GeoLeaf = undefined;
        expect(() => applyThemeSafe("dark")).not.toThrow();
    });

    it("applyThemeSafe is a no-op when GeoLeaf.UI is absent", () => {
        _g.GeoLeaf = {};
        expect(() => applyThemeSafe("dark")).not.toThrow();
    });

    it("applyThemeSafe is a no-op when applyTheme is not a function", () => {
        _g.GeoLeaf = { UI: { applyTheme: "not-a-function" } };
        expect(() => applyThemeSafe("dark")).not.toThrow();
    });

    it("applyThemeSafe logs a warning when applyTheme throws", () => {
        _g.GeoLeaf = {
            UI: {
                applyTheme: vi.fn().mockImplementation(() => {
                    throw new Error("theme error");
                }),
            },
        };
        applyThemeSafe("dark");
        expect(Log.warn).toHaveBeenCalledWith(
            expect.stringContaining("Error applying theme"),
            expect.any(Error)
        );
    });
});
