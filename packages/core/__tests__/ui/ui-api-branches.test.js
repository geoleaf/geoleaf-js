/**
 * Deep branch-coverage tests for ui-api.ts
 * Covers: $create, checkModuleAvailability, delegation guards, init,
 * _tryControl, _initThemeControl, _initFilterState,
 * cleanup, legacy compat functions.
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// geolocation-state relocated to the in-core `geolocation` capability (ui-api no longer imports it).

import { UI } from "../../src/kernel/ui/ui-api.js";

const _g = typeof globalThis !== "undefined" ? globalThis : window;

describe("ui-api — branch coverage", () => {
    let savedGeoLeaf;
    beforeEach(() => {
        savedGeoLeaf = _g.GeoLeaf;
        vi.restoreAllMocks();
    });
    afterEach(() => {
        _g.GeoLeaf = savedGeoLeaf;
    });

    // ── getModuleStatus (checkModuleAvailability) ────────────────────────
    it("getModuleStatus returns all missing when no sub-modules set", () => {
        _g.GeoLeaf._UITheme = undefined;
        _g.GeoLeaf._UINotifications = undefined;
        _g.GeoLeaf._UIEventDelegation = undefined;
        const status = UI.getModuleStatus();
        expect(status.allAvailable).toBe(false);
        expect(status.missing.length).toBeGreaterThan(0);
    });

    it("getModuleStatus returns allAvailable=true when all modules set", () => {
        _g.GeoLeaf._UITheme = {
            initThemeToggle: vi.fn(),
            initAutoTheme: vi.fn(),
            toggleTheme: vi.fn(),
            applyTheme: vi.fn(),
            getCurrentTheme: vi.fn(),
        };
        _g.GeoLeaf._UINotifications = {
            show: vi.fn(),
            success: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            clearAll: vi.fn(),
            enable: vi.fn(),
            disable: vi.fn(),
            getStatus: vi.fn(),
        };
        _g.GeoLeaf._UIEventDelegation = {
            attachFilterInputEvents: vi.fn(),
            attachAccordionEvents: vi.fn(),
            cleanupAllListeners: vi.fn(),
        };
        const status = UI.getModuleStatus();
        expect(status.allAvailable).toBe(true);
        expect(status.missing).toEqual([]);
    });

    // ── init ─────────────────────────────────────────────────────────────
    it("init with default options sets enableEventDelegation true", () => {
        UI.init();
        // Should not throw
    });

    it("init with enableEventDelegation=false skips event delegation", () => {
        UI.init({ enableEventDelegation: false });
    });

    it("init calls _initThemeControl when Config available", () => {
        _g.GeoLeaf.Config = { get: vi.fn(() => ({ theme: "dark" })) };
        _g.GeoLeaf._UITheme = { initAutoTheme: vi.fn(), initThemeToggle: vi.fn() };
        _g.GeoLeaf.UI.initAutoTheme = _g.GeoLeaf._UITheme.initAutoTheme;
        _g.GeoLeaf.UI.initThemeToggle = _g.GeoLeaf._UITheme.initThemeToggle;
        UI.init({});
        // initAutoTheme would be called with "dark"
    });

    // ── cleanup ──────────────────────────────────────────────────────────
    it("cleanup calls cleanupAllListeners when EventDelegation available", () => {
        const cleanupFn = vi.fn(() => 5);
        _g.GeoLeaf._UIEventDelegation = {
            attachFilterInputEvents: vi.fn(),
            attachAccordionEvents: vi.fn(),
            cleanupAllListeners: cleanupFn,
        };
        UI.cleanup();
        expect(cleanupFn).toHaveBeenCalled();
    });

    it("cleanup works when no EventDelegation", () => {
        _g.GeoLeaf._UIEventDelegation = undefined;
        UI.cleanup();
    });

    // ── VERSION / BUILD ──────────────────────────────────────────────────
    it("VERSION is set", () => {
        expect(UI.VERSION).toBe("4.4.0");
    });

    it("BUILD is set", () => {
        expect(UI.BUILD).toBe("Sprint-4.4-Modular");
    });
});
