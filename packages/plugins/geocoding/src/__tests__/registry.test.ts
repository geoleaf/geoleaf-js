/**
 * Tests for registry.ts — Singleton lifecycle, config reading, search, selectResult.
 *
 * Ported from the core suite (`__tests__/geocoding/geocoding-registry.test.js`).
 * Plugin adaptations:
 *  - mocked modules are `../provider.js` and `../control.js`;
 *  - config is read via `GeoLeaf.Config.get("modules.geocoding", …)`
 *    (the core read `getActiveProfile().geocodingConfig`) — see `setConfig`;
 *  - `mountGeocodingControl` returns a handle object `{ destroy, reveal }`,
 *    so the control mock returns that shape (the core returned a bare function).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const mocks = vi.hoisted(() => ({
    provider: { search: vi.fn(async () => []) },
    mountControl: vi.fn(() => ({ destroy: vi.fn(), reveal: vi.fn() })),
}));

vi.mock("../provider.js", () => ({
    createProvider: vi.fn(() => mocks.provider),
}));
vi.mock("../control.js", () => ({
    mountGeocodingControl: mocks.mountControl,
}));

import { GeocodingRegistry } from "../registry.js";

const _g = globalThis as any;

/**
 * Wires `GeoLeaf.Config.get` to return `cfg` for the `modules.geocoding`
 * namespace — the only config seam the plugin reads (Plugin Contract v1).
 */
function setConfig(cfg) {
    _g.GeoLeaf.Config = {
        get: (key, def) => (key === "modules.geocoding" ? cfg : def),
    };
}

describe("GeocodingRegistry", () => {
    beforeEach(() => {
        // Fresh GeoLeaf namespace per test
        _g.GeoLeaf = {};
        vi.clearAllMocks();
    });

    // ── isEnabled ─────────────────────────────────────────────────────────────

    describe("isEnabled", () => {
        it("returns false when Config is missing", () => {
            expect(GeocodingRegistry.isEnabled()).toBe(false);
        });

        it("returns false when modules.geocoding is missing", () => {
            setConfig({});
            expect(GeocodingRegistry.isEnabled()).toBe(false);
        });

        it("returns false when enabled !== true", () => {
            setConfig({ enabled: false });
            expect(GeocodingRegistry.isEnabled()).toBe(false);
        });

        it("returns true when enabled === true", () => {
            setConfig({ enabled: true });
            expect(GeocodingRegistry.isEnabled()).toBe(true);
        });

        it("returns false and does not throw when Config.get throws", () => {
            _g.GeoLeaf.Config = {
                get: () => {
                    throw new Error("boom");
                },
            };
            expect(GeocodingRegistry.isEnabled()).toBe(false);
        });
    });

    // ── search ────────────────────────────────────────────────────────────────

    describe("search", () => {
        it("returns [] for empty/whitespace query", async () => {
            expect(await GeocodingRegistry.search("   ")).toEqual([]);
        });

        it("delegates to provider.search with trimmed query", async () => {
            setConfig({});
            const fakeResults = [{ label: "A", lat: 1, lng: 2 }];
            mocks.provider.search.mockResolvedValueOnce(fakeResults);

            const res = await GeocodingRegistry.search("  Paris  ", 3);
            expect(res).toBe(fakeResults);
            expect(mocks.provider.search).toHaveBeenCalledWith("Paris", 3);
        });

        it("uses resultLimit from config as default limit", async () => {
            setConfig({ resultLimit: 10 });
            mocks.provider.search.mockResolvedValueOnce([]);

            await GeocodingRegistry.search("test");
            expect(mocks.provider.search).toHaveBeenCalledWith("test", 10);
        });

        it("defaults limit to 5 when no config", async () => {
            setConfig({});
            mocks.provider.search.mockResolvedValueOnce([]);

            await GeocodingRegistry.search("test");
            expect(mocks.provider.search).toHaveBeenCalledWith("test", 5);
        });
    });

    // ── selectResult ──────────────────────────────────────────────────────────

    describe("selectResult", () => {
        it("calls adapter.flyTo when result has no bounds", () => {
            const flyTo = vi.fn();
            // The plugin resolves the adapter via GeoLeaf.Core.getMap().
            _g.GeoLeaf.Core = { getMap: () => ({ flyTo }) };
            setConfig({});

            GeocodingRegistry.selectResult({ label: "P", lat: 48, lng: 2 });
            expect(flyTo).toHaveBeenCalledWith({ lat: 48, lng: 2 }, 15);
        });

        it("uses flyToZoom from config", () => {
            const flyTo = vi.fn();
            _g.GeoLeaf.Core = { getMap: () => ({ flyTo }) };
            setConfig({ flyToZoom: 18 });

            GeocodingRegistry.selectResult({ label: "P", lat: 48, lng: 2 });
            expect(flyTo).toHaveBeenCalledWith({ lat: 48, lng: 2 }, 18);
        });

        it("calls adapter.fitBounds when result has bounds", () => {
            const fitBounds = vi.fn();
            _g.GeoLeaf.Core = { getMap: () => ({ fitBounds }) };
            setConfig({});

            const bounds = { north: 49, south: 47, east: 4, west: -1 };
            GeocodingRegistry.selectResult({ label: "IDF", lat: 48, lng: 2, bounds });
            expect(fitBounds).toHaveBeenCalledWith(
                bounds,
                expect.objectContaining({ animate: true })
            );
        });

        it("dispatches geoleaf:geocoding:result event", () => {
            _g.GeoLeaf.Core = { getMap: () => ({ flyTo: vi.fn() }) };
            setConfig({});

            const handler = vi.fn();
            document.addEventListener("geoleaf:geocoding:result", handler);

            GeocodingRegistry.selectResult({ label: "P", lat: 48, lng: 2 });
            expect(handler).toHaveBeenCalled();
            const detail = handler.mock.calls[0][0].detail;
            expect(detail.label).toBe("P");
            expect(detail.lat).toBe(48);
            expect(detail.lng).toBe(2);

            document.removeEventListener("geoleaf:geocoding:result", handler);
        });

        it("still dispatches event when no map adapter", () => {
            setConfig({});

            const handler = vi.fn();
            document.addEventListener("geoleaf:geocoding:result", handler);

            GeocodingRegistry.selectResult({ label: "P", lat: 48, lng: 2 });
            expect(handler).toHaveBeenCalled();

            document.removeEventListener("geoleaf:geocoding:result", handler);
        });
    });

    // ── destroy ───────────────────────────────────────────────────────────────

    describe("destroy", () => {
        it("does not throw when no control is mounted", () => {
            expect(() => GeocodingRegistry.destroy()).not.toThrow();
        });
    });

    // ── open ──────────────────────────────────────────────────────────────────

    describe("open", () => {
        it("does not throw when no control is mounted", () => {
            expect(() => GeocodingRegistry.open()).not.toThrow();
        });
    });

    // ── init + _onMapReady ────────────────────────────────────────────────────

    describe("init and _onMapReady", () => {
        beforeAll(() => {
            // _initialized is still false — no previous test called init()
            GeocodingRegistry.init();
        });

        it("init() is idempotent — second call is a no-op", () => {
            GeocodingRegistry.init();
            // no error = idempotent path covered
        });

        it("_onMapReady mounts control when enabled and container is present", () => {
            const container = document.createElement("div");
            mocks.mountControl.mockReturnValueOnce({ destroy: vi.fn(), reveal: vi.fn() });
            setConfig({ enabled: true, flyToZoom: 16 });
            _g.GeoLeaf.Core = { getMap: () => ({ getContainer: () => container }) };
            document.dispatchEvent(new Event("geoleaf:map:ready"));
            expect(mocks.mountControl).toHaveBeenCalled();
        });

        it("_onMapReady is a no-op when enabled is false", () => {
            setConfig({ enabled: false });
            document.dispatchEvent(new Event("geoleaf:map:ready"));
            expect(mocks.mountControl).not.toHaveBeenCalled();
        });

        it("_onMapReady is a no-op when container is null", () => {
            setConfig({ enabled: true });
            _g.GeoLeaf.Core = { getMap: () => ({ getContainer: () => null }) };
            document.dispatchEvent(new Event("geoleaf:map:ready"));
            expect(mocks.mountControl).not.toHaveBeenCalled();
        });

        it("_onMapReady tears down previous control before mounting new one", () => {
            const container = document.createElement("div");
            const destroy1 = vi.fn();
            const destroy2 = vi.fn();
            mocks.mountControl
                .mockReturnValueOnce({ destroy: destroy1, reveal: vi.fn() })
                .mockReturnValueOnce({ destroy: destroy2, reveal: vi.fn() });
            setConfig({ enabled: true });
            _g.GeoLeaf.Core = { getMap: () => ({ getContainer: () => container }) };
            // First mount
            document.dispatchEvent(new Event("geoleaf:map:ready"));
            // Second mount — should call destroy1 first
            document.dispatchEvent(new Event("geoleaf:map:ready"));
            expect(destroy1).toHaveBeenCalled();
            expect(mocks.mountControl).toHaveBeenCalledTimes(2);
        });
    });
});
