/**
 * kernel/map (0% branches → cible 60%)
 *
 * Uses static imports so Istanbul instruments the source files.
 * (require() bypasses Vite/Istanbul transform → 0% coverage)
 *
 * Targets:
 *  - src/kernel/map/theme.ts
 *  - src/kernel/map/map-container.ts
 *  - src/kernel/map/facade.ts  (Core)
 *  - src/kernel/map/scale-control.ts
 */

// ─── vi.hoisted : mock refs available before static imports ──────────────────
const mocks = vi.hoisted(() => ({
    Log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    adapter: {
        init: vi.fn(),
        destroy: vi.fn(),
        getMap: vi.fn().mockReturnValue({}),
        getCenter: vi.fn().mockReturnValue({ lat: 48.85, lng: 2.35 }),
        getZoom: vi.fn().mockReturnValue(10),
        addControl: vi.fn().mockReturnValue({ remove: vi.fn() }),
        removeControl: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        setView: vi.fn(),
        getContainer: vi
            .fn()
            .mockReturnValue({ getBoundingClientRect: vi.fn().mockReturnValue({ height: 600 }) }),
        pointToLatLng: vi.fn().mockReturnValue({ lat: 48, lng: 2 }),
    },
    domCreate: vi.fn((tag, className, parent) => domCreateDouble(tag, className, parent)),
    blockMapPropagation: vi.fn(),
    haversineDistance: vi.fn().mockReturnValue(5000),
}));

import { domCreateDouble } from "../_helpers/dom-create-double.js";

// ─── vi.mock — dependencies ───────────────────────────────────────────────────
vi.mock("../../src/utils/log/index.js", () => ({ Log: mocks.Log }));

vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    // Vitest 4: constructable mock — class whose constructor returns the hoisted fake.
    MaplibreAdapter: vi.fn().mockImplementation(
        class {
            constructor() {
                return mocks.adapter;
            }
        }
    ),
}));

vi.mock("../../src/utils/general/dom-helpers.js", () => ({
    domCreate: mocks.domCreate,
}));

vi.mock("../../src/utils/controls/propagation-blocker.js", () => ({
    blockMapPropagation: mocks.blockMapPropagation,
}));

vi.mock("../../src/utils/geo/haversine.js", () => ({
    haversineDistance: mocks.haversineDistance,
}));

// ─── Static imports → Istanbul instruments these source files ─────────────────
import { setTheme, getTheme } from "../../src/kernel/map/theme.js";
import {
    resolveMapContainer,
    padBounds,
    applyThemeSafe,
} from "../../src/kernel/map/map-container.js";
import { Core } from "../../src/kernel/map/facade.js";

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — theme.ts
// ─────────────────────────────────────────────────────────────────────────────
describe("theme.ts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.className = "";
    });

    it("getTheme() returns 'light' by default", () => {
        expect(getTheme()).toBe("light");
    });

    it("setTheme('dark') applies gl-theme-dark to body", () => {
        setTheme("dark");
        expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
        expect(document.body.classList.contains("gl-theme-light")).toBe(false);
    });

    it("setTheme('light') applies gl-theme-light to body", () => {
        setTheme("dark");
        setTheme("light");
        expect(document.body.classList.contains("gl-theme-light")).toBe(true);
        expect(document.body.classList.contains("gl-theme-dark")).toBe(false);
    });

    it("setTheme() with no arg emits a warning and does not change theme", () => {
        setTheme("dark");
        vi.clearAllMocks();
        setTheme(undefined);
        expect(mocks.Log.warn).toHaveBeenCalled();
        expect(getTheme()).toBe("dark");
    });

    it("setTheme('invalid') emits a warning and does not change theme", () => {
        setTheme("dark");
        vi.clearAllMocks();
        setTheme("invalid");
        expect(mocks.Log.warn).toHaveBeenCalled();
        expect(getTheme()).toBe("dark");
    });

    it("setTheme updates getTheme() return value", () => {
        setTheme("dark");
        expect(getTheme()).toBe("dark");
        setTheme("light");
        expect(getTheme()).toBe("light");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — map-container.ts
// ─────────────────────────────────────────────────────────────────────────────
describe("map-container.ts — resolveMapContainer", () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="map-el"></div>';
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("returns the element when found", () => {
        const el = resolveMapContainer("map-el");
        expect(el).toBeTruthy();
        expect(el.id).toBe("map-el");
    });

    it("throws when mapId is missing", () => {
        expect(() => resolveMapContainer(undefined)).toThrow("mapId");
    });

    it("throws when mapId is null", () => {
        expect(() => resolveMapContainer(null)).toThrow("mapId");
    });

    it("throws when no element matches the id", () => {
        expect(() => resolveMapContainer("no-such-id")).toThrow("no-such-id");
    });
});

describe("map-container.ts — padBounds", () => {
    const base = { north: 49, south: 48, east: 3, west: 2 };

    it("expands bounds symmetrically with ratio 0.1", () => {
        const result = padBounds(base, 0.1);
        expect(result.north).toBeGreaterThan(base.north);
        expect(result.south).toBeLessThan(base.south);
        expect(result.east).toBeGreaterThan(base.east);
        expect(result.west).toBeLessThan(base.west);
    });

    it("returns same bounds with ratio 0", () => {
        const result = padBounds(base, 0);
        expect(result).toEqual(base);
    });

    it("returns a new object (immutable)", () => {
        const result = padBounds(base, 0.5);
        expect(result).not.toBe(base);
    });
});

describe("map-container.ts — applyThemeSafe", () => {
    afterEach(() => {
        globalThis.GeoLeaf = undefined;
    });

    it("no-ops when GeoLeaf.UI is not loaded", () => {
        globalThis.GeoLeaf = undefined;
        expect(() => applyThemeSafe("light")).not.toThrow();
    });

    it("calls GeoLeaf.UI.applyTheme when available, without persisting", () => {
        const applyTheme = vi.fn();
        globalThis.GeoLeaf = { UI: { applyTheme } };
        applyThemeSafe("dark");
        expect(applyTheme).toHaveBeenCalledWith("dark", false);
    });

    it("logs a warning and does not throw when applyTheme raises", () => {
        globalThis.GeoLeaf = {
            UI: {
                applyTheme: vi.fn().mockImplementation(() => {
                    throw new Error("boom");
                }),
            },
        };
        expect(() => applyThemeSafe("light")).not.toThrow();
        expect(mocks.Log.warn).toHaveBeenCalled();
    });

    it("no-ops when GeoLeaf exists but UI is absent", () => {
        globalThis.GeoLeaf = {};
        expect(() => applyThemeSafe("dark")).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — index.ts (Core)
// The module-level singleton _mapInstance persists across tests since we use
// static imports. We use vi.isolateModules() to get a fresh Core per test in
// tests that exercise init() branches — this is the same approach as existing
// core-init.test.js but adapted for Istanbul static import instrumentation.
// ─────────────────────────────────────────────────────────────────────────────
describe("Core (index.ts) — static import (coverage only)", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        globalThis.GeoLeaf = undefined;
        vi.clearAllMocks();
    });

    it("getAdapter() is an alias for getMap()", () => {
        expect(Core.getAdapter).toBe(Core.getMap);
    });

    it("setTheme and getTheme are delegated from theme.ts", () => {
        Core.setTheme("dark");
        expect(Core.getTheme()).toBe("dark");
        Core.setTheme("light");
    });
});

// Tests that require a fresh singleton use vi.resetModules() + require()
// (same pattern as core-init.test.js — istanbul instruments via static imports above)
describe("Core (index.ts) — isolated module per test", () => {
    let FreshCore;
    let freshAdapter;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="test-map"></div>';
        globalThis.GeoLeaf = undefined;

        // Fresh adapter state reset (mocks.adapter is reused via the hoisted mock factory)
        mocks.adapter.init.mockClear();
        mocks.adapter.destroy.mockClear();

        // Re-require to get a fresh _mapInstance = null
        FreshCore = (await import("../../src/kernel/map/facade.js")).Core;
        freshAdapter = mocks.adapter;
    });

    afterEach(() => {
        document.body.innerHTML = "";
        globalThis.GeoLeaf = undefined;
        vi.clearAllMocks();
    });

    it("getMap() returns null before init", () => {
        expect(FreshCore.getMap()).toBeNull();
    });

    it("init() with valid mapId returns an adapter", () => {
        const result = FreshCore.init({ mapId: "test-map" });
        expect(result).toBeTruthy();
        expect(freshAdapter.init).toHaveBeenCalled();
    });

    it("init() calls adapter.init with container element", () => {
        FreshCore.init({ mapId: "test-map" });
        expect(freshAdapter.init).toHaveBeenCalledWith(
            expect.objectContaining({ container: expect.any(HTMLElement) })
        );
    });

    it("init() passes zoom option", () => {
        FreshCore.init({ mapId: "test-map", zoom: 12 });
        expect(freshAdapter.init).toHaveBeenCalledWith(expect.objectContaining({ zoom: 12 }));
    });

    it("init() converts center [lat, lng] array to {lat, lng}", () => {
        FreshCore.init({ mapId: "test-map", center: [48.85, 2.35] });
        expect(freshAdapter.init).toHaveBeenCalledWith(
            expect.objectContaining({ center: { lat: 48.85, lng: 2.35 } })
        );
    });

    it("init() omits center entirely when center is not an array", () => {
        FreshCore.init({ mapId: "test-map", center: "bad" });
        // STRENGTHENED assertion: the key must be ABSENT, not present at
        // `undefined`. The distinction `exactOptionalPropertyTypes` makes
        // observable — a key present at `undefined` overwrites a default in
        // a spread merge, an absent key leaves it intact.
        // `"center" in opts === false` implies the old assertion; the
        // converse is false.
        const opts = freshAdapter.init.mock.calls[0][0];
        expect("center" in opts).toBe(false);
    });

    it("init() passes maxBounds when valid GeoLeafBounds object provided", () => {
        const bounds = { north: 49, south: 48, east: 3, west: 2 };
        FreshCore.init({ mapId: "test-map", mapOptions: { maxBounds: bounds } });
        expect(freshAdapter.init).toHaveBeenCalledWith(
            expect.objectContaining({ maxBounds: bounds })
        );
    });

    it("init() ignores maxBounds when not a valid GeoLeafBounds object", () => {
        FreshCore.init({ mapId: "test-map", mapOptions: { maxBounds: "invalid" } });
        const opts = freshAdapter.init.mock.calls[0][0];
        expect("maxBounds" in opts).toBe(false);
    });

    it("init() ignores incomplete maxBounds (missing south)", () => {
        FreshCore.init({
            mapId: "test-map",
            mapOptions: { maxBounds: { north: 49, east: 3, west: 2 } },
        });
        const opts = freshAdapter.init.mock.calls[0][0];
        expect("maxBounds" in opts).toBe(false);
    });

    it("init() calls applyThemeSafe with the theme option", () => {
        const applyTheme = vi.fn();
        globalThis.GeoLeaf = { UI: { applyTheme } };
        FreshCore.init({ mapId: "test-map", theme: "dark" });
        expect(applyTheme).toHaveBeenCalledWith("dark", false);
    });

    it("init() defaults to 'light' theme when none provided, and does not persist it", () => {
        const applyTheme = vi.fn();
        globalThis.GeoLeaf = { UI: { applyTheme } };
        FreshCore.init({ mapId: "test-map" });
        // `false` = do not write to localStorage — see backlog B.18.
        expect(applyTheme).toHaveBeenCalledWith("light", false);
    });

    it("init() recycles existing instance on 2nd call (singleton)", () => {
        FreshCore.init({ mapId: "test-map" });
        freshAdapter.init.mockClear();
        FreshCore.init({ mapId: "test-map" });
        // adapter.init should NOT be called again — recycled
        expect(freshAdapter.init).not.toHaveBeenCalled();
        expect(mocks.Log.warn).toHaveBeenCalledWith(expect.stringContaining("already initialized"));
    });

    it("init() returns null when mapId is missing", () => {
        const result = FreshCore.init({});
        expect(result).toBeNull();
        expect(mocks.Log.error).toHaveBeenCalled();
    });

    it("init() returns null when DOM container is not found", () => {
        const result = FreshCore.init({ mapId: "does-not-exist" });
        expect(result).toBeNull();
        expect(mocks.Log.error).toHaveBeenCalled();
    });

    it("init() invokes GeoLeaf.Core.onError callback on error", () => {
        const onError = vi.fn();
        globalThis.GeoLeaf = { Core: { onError } };
        FreshCore.init({ mapId: "does-not-exist" });
        expect(onError).toHaveBeenCalled();
    });

    it("init() swallows errors thrown in GeoLeaf.Core.onError", () => {
        globalThis.GeoLeaf = {
            Core: {
                onError: vi.fn().mockImplementation(() => {
                    throw new Error("cb boom");
                }),
            },
        };
        expect(() => FreshCore.init({ mapId: "does-not-exist" })).not.toThrow();
        // 2 error logs: one for the original error + one for the callback error
        expect(mocks.Log.error).toHaveBeenCalledTimes(2);
    });

    it("init() uses DEFAULT_ZOOM (finite number) when zoom is not provided", () => {
        FreshCore.init({ mapId: "test-map" });
        const opts = freshAdapter.init.mock.calls[0]?.[0];
        expect(typeof opts?.zoom).toBe("number");
        expect(isNaN(opts.zoom)).toBe(false);
    });

    it("init() uses DEFAULT_ZOOM when zoom is NaN", () => {
        FreshCore.init({ mapId: "test-map", zoom: NaN });
        const opts = freshAdapter.init.mock.calls[0]?.[0];
        expect(typeof opts?.zoom).toBe("number");
        expect(isNaN(opts.zoom)).toBe(false);
    });
});
