/**
 * Branch-coverage tests for APIInitializationManager
 * Covers all conditional paths: parameter validation, option normalization,
 * map/ui option shapes, center/zoom resolution, UI theme method chain,
 * loadConfig async/cancel/error, and reset lifecycle.
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { APIInitializationManager } from "../../src/kernel/api/initialization-manager.js";

describe("APIInitializationManager — branch coverage", () => {
    let mgr;
    const _g = typeof globalThis !== "undefined" ? globalThis : {};

    beforeEach(() => {
        mgr = new APIInitializationManager();
        _g.GeoLeaf = { CONSTANTS: { DEFAULT_CENTER: [48, 2], DEFAULT_ZOOM: 10 } };
    });

    afterEach(() => {
        _g.GeoLeaf = {};
    });

    // ── constructor ───────────────────────────────────────────────────────
    it("constructor sets isReady=true and zero stats", () => {
        expect(mgr.isReady).toBe(true);
        expect(mgr.pendingPromise).toBeNull();
        expect(mgr.cancelled).toBe(false);
        expect(mgr.stats.initCalls).toBe(0);
    });

    // ── _validateInitParams ──────────────────────────────────────────────
    it("init throws when options is null", () => {
        expect(() => mgr.init(null, vi.fn())).toThrow("options object is required");
    });

    it("init throws when options is a string", () => {
        expect(() => mgr.init("bad", vi.fn())).toThrow("options object is required");
    });

    it("init throws when getModule is null", () => {
        expect(() => mgr.init({}, null)).toThrow("getModule function is required");
    });

    it("init throws when getModule is not a function", () => {
        expect(() => mgr.init({}, "string")).toThrow("getModule function is required");
    });

    // ── init: Core module validation ─────────────────────────────────────
    it("init throws when getModule returns null for Core", () => {
        expect(() => mgr.init({ target: "map" }, () => null)).toThrow(
            "Core.init() is not available"
        );
    });

    it("init throws when Core has no init method", () => {
        expect(() => mgr.init({ target: "map" }, () => ({}))).toThrow(
            "Core.init() is not available"
        );
    });

    // ── _normalizeInitOptions: flat vs nested ────────────────────────────
    it("init normalises flat options (target, center, zoom, theme)", () => {
        const coreInit = vi.fn();
        mgr.init({ target: "map", center: [45, 3], zoom: 8, theme: "dark" }, (name) =>
            name === "Core" ? { init: coreInit } : null
        );
        expect(coreInit).toHaveBeenCalledWith(
            expect.objectContaining({ mapId: "map", center: [45, 3], zoom: 8, theme: "dark" })
        );
    });

    it("init normalises nested map/ui options", () => {
        const coreInit = vi.fn();
        mgr.init(
            { map: { target: "container", center: [40, -3], zoom: 6 }, ui: { theme: "auto" } },
            (name) => (name === "Core" ? { init: coreInit } : null)
        );
        expect(coreInit).toHaveBeenCalledWith(
            expect.objectContaining({
                mapId: "container",
                center: [40, -3],
                zoom: 6,
                theme: "auto",
            })
        );
    });

    it("init uses mapId fallback when target not provided", () => {
        const coreInit = vi.fn();
        mgr.init({ mapId: "alt-map" }, (name) => (name === "Core" ? { init: coreInit } : null));
        expect(coreInit).toHaveBeenCalledWith(expect.objectContaining({ mapId: "alt-map" }));
    });

    it("init throws when no target/mapId provided", () => {
        expect(() => mgr.init({}, (name) => (name === "Core" ? { init: vi.fn() } : null))).toThrow(
            "map.target"
        );
    });

    // ── _resolveCenter / _resolveZoom defaults ───────────────────────────
    it("init uses DEFAULT_CENTER when center not provided", () => {
        const coreInit = vi.fn();
        mgr.init({ target: "map" }, (name) => (name === "Core" ? { init: coreInit } : null));
        expect(coreInit).toHaveBeenCalledWith(expect.objectContaining({ center: [48, 2] }));
    });

    it("init uses DEFAULT_ZOOM when zoom not provided", () => {
        const coreInit = vi.fn();
        mgr.init({ target: "map" }, (name) => (name === "Core" ? { init: coreInit } : null));
        expect(coreInit).toHaveBeenCalledWith(expect.objectContaining({ zoom: 10 }));
    });

    it("init uses fallback [0,0] when no CONSTANTS.DEFAULT_CENTER", () => {
        _g.GeoLeaf = {};
        const coreInit = vi.fn();
        mgr.init({ target: "map" }, (name) => (name === "Core" ? { init: coreInit } : null));
        expect(coreInit).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 0] }));
    });

    it("init uses fallback zoom=12 when no CONSTANTS.DEFAULT_ZOOM", () => {
        _g.GeoLeaf = {};
        const coreInit = vi.fn();
        mgr.init({ target: "map" }, (name) => (name === "Core" ? { init: coreInit } : null));
        expect(coreInit).toHaveBeenCalledWith(expect.objectContaining({ zoom: 12 }));
    });

    it("init uses 'light' as default theme when none provided", () => {
        const coreInit = vi.fn();
        mgr.init({ target: "map" }, (name) => (name === "Core" ? { init: coreInit } : null));
        expect(coreInit).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" }));
    });

    it("init picks theme from mapOpts.theme when uiOpts.theme undefined (flat)", () => {
        const coreInit = vi.fn();
        mgr.init({ target: "map", theme: "sombre" }, (name) =>
            name === "Core" ? { init: coreInit } : null
        );
        expect(coreInit).toHaveBeenCalledWith(expect.objectContaining({ theme: "sombre" }));
    });

    it("init propagates mapOptions passthrough", () => {
        const coreInit = vi.fn();
        mgr.init({ map: { target: "m", mapOptions: { maxZoom: 18 } }, ui: {} }, (name) =>
            name === "Core" ? { init: coreInit } : null
        );
        expect(coreInit).toHaveBeenCalledWith(
            expect.objectContaining({ mapOptions: { maxZoom: 18 } })
        );
    });

    it("init defaults mapOptions to {} when not provided", () => {
        const coreInit = vi.fn();
        mgr.init({ target: "m" }, (name) => (name === "Core" ? { init: coreInit } : null));
        expect(coreInit).toHaveBeenCalledWith(expect.objectContaining({ mapOptions: {} }));
    });

    it("init increments initCalls stat", () => {
        const coreInit = vi.fn();
        mgr.init({ target: "m" }, (n) => (n === "Core" ? { init: coreInit } : null));
        expect(mgr.stats.initCalls).toBe(1);
    });

    it("init increments errors on validation failure", () => {
        try {
            mgr.init(null, null);
        } catch (_) {
            /* expected */
        }
        expect(mgr.stats.errors).toBe(1);
    });

    // ── setTheme ─────────────────────────────────────────────────────────
    it("setTheme uses UI.applyTheme when available", () => {
        const applyTheme = vi.fn(() => true);
        const result = mgr.setTheme("dark", (n) => (n === "UI" ? { applyTheme } : null));
        expect(result).toBe(true);
        expect(applyTheme).toHaveBeenCalledWith("dark");
    });

    it("setTheme falls back to UI.setTheme when applyTheme missing", () => {
        const setTheme = vi.fn(() => true);
        const result = mgr.setTheme("dark", (n) => (n === "UI" ? { setTheme } : null));
        expect(result).toBe(true);
        expect(setTheme).toHaveBeenCalledWith("dark");
    });

    it("setTheme falls back to UI.theme() when applyTheme and setTheme missing", () => {
        const theme = vi.fn(() => true);
        const result = mgr.setTheme("dark", (n) => (n === "UI" ? { theme } : null));
        expect(result).toBe(true);
        expect(theme).toHaveBeenCalledWith("dark");
    });

    it("setTheme returns false when UI has no theme method", () => {
        const result = mgr.setTheme("dark", (n) => (n === "UI" ? {} : null));
        expect(result).toBe(false);
        expect(mgr.stats.errors).toBe(1);
    });

    it("setTheme returns false when UI is null", () => {
        const result = mgr.setTheme("dark", () => null);
        expect(result).toBe(false);
    });

    it("setTheme returns false when theme is empty string", () => {
        const result = mgr.setTheme("", vi.fn());
        expect(result).toBe(false);
    });

    it("setTheme returns false when theme is not a string", () => {
        const result = mgr.setTheme(123, vi.fn());
        expect(result).toBe(false);
    });

    it("setTheme returns false when getModule is not a function", () => {
        const result = mgr.setTheme("dark", null);
        expect(result).toBe(false);
    });

    // ── loadConfig ───────────────────────────────────────────────────────
    it("loadConfig throws when input is null", async () => {
        await expect(mgr.loadConfig(null, vi.fn())).rejects.toThrow("input is required");
    });

    it("loadConfig throws when getModule is null", async () => {
        await expect(mgr.loadConfig("url", null)).rejects.toThrow("getModule function is required");
    });

    it("loadConfig throws when Config module is missing", async () => {
        await expect(mgr.loadConfig("url", () => null)).rejects.toThrow(
            "Config.init() is not available"
        );
    });

    it("loadConfig normalises string URL to source:'url'", async () => {
        const configInit = vi.fn().mockResolvedValue({ ok: true });
        await mgr.loadConfig("https://example.com/profile.json", (n) =>
            n === "Config" ? { init: configInit } : null
        );
        expect(configInit).toHaveBeenCalledWith(
            expect.objectContaining({
                source: "url",
                url: "https://example.com/profile.json",
                autoEvent: true,
            })
        );
    });

    it("loadConfig normalises object with url to source:'url'", async () => {
        const configInit = vi.fn().mockResolvedValue({});
        await mgr.loadConfig({ url: "http://example.com" }, (n) =>
            n === "Config" ? { init: configInit } : null
        );
        expect(configInit).toHaveBeenCalledWith(expect.objectContaining({ source: "url" }));
    });

    it("loadConfig normalises object with data to source:'data'", async () => {
        const configInit = vi.fn().mockResolvedValue({});
        await mgr.loadConfig({ data: { layers: [] } }, (n) =>
            n === "Config" ? { init: configInit } : null
        );
        expect(configInit).toHaveBeenCalledWith(expect.objectContaining({ source: "data" }));
    });

    it("loadConfig sets autoEvent=true by default", async () => {
        const configInit = vi.fn().mockResolvedValue({});
        await mgr.loadConfig({ data: {} }, (n) => (n === "Config" ? { init: configInit } : null));
        expect(configInit).toHaveBeenCalledWith(expect.objectContaining({ autoEvent: true }));
    });

    it("loadConfig respects autoEvent=false", async () => {
        const configInit = vi.fn().mockResolvedValue({});
        await mgr.loadConfig({ data: {}, autoEvent: false }, (n) =>
            n === "Config" ? { init: configInit } : null
        );
        expect(configInit).toHaveBeenCalledWith(expect.objectContaining({ autoEvent: false }));
    });

    it("loadConfig cancels previous pending request", async () => {
        const _configInit1 = vi.fn(() => new Promise(() => {})); // Never resolves
        const configInit2 = vi.fn().mockResolvedValue({ v: 2 });
        const getModule = (n) => (n === "Config" ? { init: configInit2 } : null);

        // Start first load (will hang)
        mgr.pendingPromise = new Promise(() => {});
        // Start second load — should cancel first
        const result = await mgr.loadConfig("url2", getModule);
        expect(result).not.toBeNull();
    });

    it("loadConfig returns null when cancelled during await", async () => {
        let resolveConfig;
        const configInit = vi.fn(
            () =>
                new Promise((r) => {
                    resolveConfig = r;
                })
        );
        const getModule = (n) => (n === "Config" ? { init: configInit } : null);

        const loadPromise = mgr.loadConfig("url", getModule);

        // Simulate cancellation while awaiting
        mgr.cancelled = true;
        resolveConfig({});

        const result = await loadPromise;
        expect(result).toBeNull();
    });

    it("loadConfig increments errors on rejection", async () => {
        const configInit = vi.fn().mockRejectedValue(new Error("network"));
        await expect(
            mgr.loadConfig("url", (n) => (n === "Config" ? { init: configInit } : null))
        ).rejects.toThrow("network");
        expect(mgr.stats.errors).toBe(1);
        expect(mgr.pendingPromise).toBeNull();
    });

    it("loadConfig increments configLoads stat", async () => {
        const configInit = vi.fn().mockResolvedValue({});
        await mgr.loadConfig("url", (n) => (n === "Config" ? { init: configInit } : null));
        expect(mgr.stats.configLoads).toBe(1);
    });

    // ── getStats ─────────────────────────────────────────────────────────
    it("getStats.hasPendingRequest is true when pendingPromise set", () => {
        mgr.pendingPromise = new Promise(() => {});
        expect(mgr.getStats().hasPendingRequest).toBe(true);
    });

    it("getStats.hasPendingRequest is false when pendingPromise null", () => {
        expect(mgr.getStats().hasPendingRequest).toBe(false);
    });

    // ── reset ────────────────────────────────────────────────────────────
    it("reset cancels pending promise", () => {
        mgr.pendingPromise = new Promise(() => {});
        mgr.reset();
        expect(mgr.pendingPromise).toBeNull();
        expect(mgr.cancelled).toBe(false);
    });

    it("reset clears stats", () => {
        mgr.stats.initCalls = 5;
        mgr.stats.errors = 3;
        mgr.reset();
        expect(mgr.stats.initCalls).toBe(0);
        expect(mgr.stats.errors).toBe(0);
    });

    it("reset handles case without pending promise", () => {
        mgr.reset();
        expect(mgr.pendingPromise).toBeNull();
    });
});
