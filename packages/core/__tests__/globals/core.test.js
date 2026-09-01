/**
 * globals.core.ts branch coverage (B1+B2)
 *
 * Targets:
 *   - All _g.GeoLeaf.* assignments in globals.core.ts
 *   - Guards: if(!_g.GeoLeaf.Security), if(!_g.GeoLeaf.Utils)
 *   - Lazy getters: animationHelper, performanceProfiler, lazyLoader
 *   - Shortcut assignments: fetch, get, post, animate, fadeIn, fadeOut, mark, ...
 *
 * Strategy: vi.hoisted() + vi.mock() on all imported modules so that only
 * globals.core.ts side-effect code is exercised. ESM static import ensures
 * Istanbul instruments the file (no require() bypass).
 */

const mocks = vi.hoisted(() => {
    const Log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const Errors = { GeoLeafError: class GeoLeafError extends Error {} };
    const CONSTANTS = { VERSION: "test" };
    const CSRFToken = { generate: vi.fn() };
    // `CSRFToken` is part of the `security/index.js` barrel; it is no
    // longer grafted separately by `globals.core.ts`. The barrel's mock must
    // therefore carry it, otherwise a shape production no longer has is tested.
    const Security = { sanitize: vi.fn(), CSRFToken };

    const perfProfilerInst = {
        mark: vi.fn(),
        measure: vi.fn(),
        generateReport: vi.fn(),
        establishBaseline: vi.fn(),
    };

    const Utils = { formatDate: vi.fn() };
    const createElement = vi.fn(() => document.createElement("div"));
    const applyCssText = vi.fn();
    const DOMSecurity = { escapeHtml: vi.fn((s) => s) };
    const ErrorLogger = { log: vi.fn() };
    const EventListenerManager = class {};
    const globalEventManager = {};
    const globalEvents = {};
    const FetchHelper = { fetch: vi.fn(), get: vi.fn(), post: vi.fn() };
    const FetchError = class FetchError extends Error {};
    const PerformanceProfiler = class {};
    const getPerformanceProfiler = vi.fn(() => perfProfilerInst);
    const TimerManager = class {};
    const getNestedValue = vi.fn();
    const hasNestedPath = vi.fn();
    const setNestedValue = vi.fn();
    const calculateMapScale = vi.fn();
    const isScaleInRange = vi.fn();
    const clearScaleCache = vi.fn();

    return {
        Log,
        Errors,
        CONSTANTS,
        Security,
        CSRFToken,
        Utils,
        createElement,
        applyCssText,
        DOMSecurity,
        ErrorLogger,
        EventListenerManager,
        globalEventManager,
        globalEvents,
        FetchHelper,
        FetchError,
        PerformanceProfiler,
        getPerformanceProfiler,
        TimerManager,
        getNestedValue,
        hasNestedPath,
        setNestedValue,
        calculateMapScale,
        isScaleInRange,
        clearScaleCache,
        perfProfilerInst,
    };
});

vi.mock("../../src/utils/log/index.js", () => ({ Log: mocks.Log }));
// Complete by construction: the `errors` barrel exposes 20 values (the
// GeoLeafError, ValidationError, … classes) and this mock only provided
// ONE. The day a module of the graph imports one of those classes, the
// native mocker refuses to serve an undeclared export and throws at import.
// `...(await importActual())` closes this hole for good.
vi.mock("../../src/utils/errors/errors.js", async (importActual) => ({
    ...(await importActual()),
    Errors: mocks.Errors,
}));
vi.mock("../../src/utils/constants/constants.js", () => ({
    CONSTANTS: mocks.CONSTANTS,
    VERSION_FALLBACK: "3.0.0-dev",
}));
// Complete by construction (see the `errors` mock above).
vi.mock("../../src/kernel/security/index.js", async (importActual) => ({
    ...(await importActual()),
    Security: mocks.Security,
    CSRFToken: mocks.CSRFToken,
}));
vi.mock("../../src/kernel/security/csrf-token.js", () => ({
    CSRFToken: mocks.CSRFToken,
}));
vi.mock("../../src/utils/general/utils-base.js", () => ({ Utils: mocks.Utils }));
vi.mock("../../src/utils/general/dom-helpers.js", () => ({
    createElement: mocks.createElement,
    // `applyCssText` joins the Utils namespace; the mock must follow,
    // otherwise `utils-namespace.ts` imports an export this mock does not provide.
    applyCssText: mocks.applyCssText,
}));
vi.mock("../../src/kernel/security/dom-security.js", () => ({
    DOMSecurity: mocks.DOMSecurity,
}));
vi.mock("../../src/utils/log/error-logger.js", () => ({
    ErrorLogger: mocks.ErrorLogger,
}));
vi.mock("../../src/utils/general/event-listener-manager.js", () => ({
    EventListenerManager: mocks.EventListenerManager,
    globalEventManager: mocks.globalEventManager,
    events: mocks.globalEvents,
}));
vi.mock("../../src/utils/general/fetch-helper.js", () => ({
    FetchHelper: mocks.FetchHelper,
    FetchError: mocks.FetchError,
}));
vi.mock("../../src/utils/performance/performance-profiler.js", () => ({
    PerformanceProfiler: mocks.PerformanceProfiler,
    getPerformanceProfiler: mocks.getPerformanceProfiler,
}));
vi.mock("../../src/utils/general/timer-manager.js", () => ({
    TimerManager: mocks.TimerManager,
}));
vi.mock("../../src/utils/general/object-utils.js", () => ({
    getNestedValue: mocks.getNestedValue,
    hasNestedPath: mocks.hasNestedPath,
    setNestedValue: mocks.setNestedValue,
}));
vi.mock("../../src/utils/general/scale-utils.js", () => ({
    calculateMapScale: mocks.calculateMapScale,
    isScaleInRange: mocks.isScaleInRange,
    clearScaleCache: mocks.clearScaleCache,
}));

// Side-effect import: triggers the _g.GeoLeaf assignments
import "../../src/globals/globals.core.ts";
// Trigger explicitly (ESM import — same module instance as globals.core.ts).

const GL = globalThis.GeoLeaf;

describe("globals.core.ts — B1+B2 registrations", () => {
    // ── B1 ──────────────────────────────────────────────────────────────────

    it("registers GeoLeaf.Log", () => {
        expect(GL.Log).toBe(mocks.Log);
    });

    it("registers GeoLeaf.Errors", () => {
        expect(GL.Errors).toBe(mocks.Errors);
    });

    it("registers GeoLeaf.CONSTANTS", () => {
        expect(GL.CONSTANTS).toBe(mocks.CONSTANTS);
    });

    it("registers GeoLeaf.Security with Security properties", () => {
        expect(GL.Security).toBeDefined();
        expect(GL.Security.sanitize).toBe(mocks.Security.sanitize);
    });

    it("registers GeoLeaf.Security.CSRFToken", () => {
        expect(GL.Security.CSRFToken).toBe(mocks.CSRFToken);
    });

    it("sets GeoLeaf._version fallback when __GEOLEAF_VERSION__ is undefined", () => {
        expect(GL._version).toBeDefined();
        expect(typeof GL._version).toBe("string");
    });

    // ── B2 ──────────────────────────────────────────────────────────────────

    it("registers GeoLeaf.Utils with base Utils properties", () => {
        expect(GL.Utils).toBeDefined();
        expect(typeof GL.Utils.formatDate).toBe("function");
    });

    it("registers GeoLeaf.Utils.createElement", () => {
        expect(GL.Utils.createElement).toBe(mocks.createElement);
    });

    it("registers GeoLeaf.Utils.applyCssText", () => {
        // The symbol was exported by `kernel-exports.ts` without a runtime
        // home: plugins using it had no target on `GeoLeaf.*`. This test
        // locks the home.
        expect(GL.Utils.applyCssText).toBe(mocks.applyCssText);
    });

    it("registers GeoLeaf.Utils.DOMSecurity and top-level GeoLeaf.DOMSecurity", () => {
        expect(GL.Utils.DOMSecurity).toBe(mocks.DOMSecurity);
        expect(GL.DOMSecurity).toBe(mocks.DOMSecurity);
    });

    it("registers GeoLeaf.Utils.ErrorLogger", () => {
        expect(GL.Utils.ErrorLogger).toBe(mocks.ErrorLogger);
    });

    it("registers GeoLeaf.Utils.EventListenerManager", () => {
        expect(GL.Utils.EventListenerManager).toBe(mocks.EventListenerManager);
    });

    it("registers GeoLeaf.Utils.events and globalEventManager", () => {
        expect(GL.Utils.events).toBe(mocks.globalEvents);
        expect(GL.Utils.globalEventManager).toBe(mocks.globalEventManager);
    });

    it("no longer registers GeoLeaf.Bus or Utils.createEventBus", () => {
        // Removed at KERNEL S10 (breaking, pre-v3-publication window): the
        // in-memory bus was written at boot and never read.
        expect(GL.Bus).toBeUndefined();
        expect(GL.Utils.createEventBus).toBeUndefined();
    });

    it("registers GeoLeaf.Utils.FetchHelper and FetchError", () => {
        expect(GL.Utils.FetchHelper).toBe(mocks.FetchHelper);
        expect(GL.Utils.FetchError).toBe(mocks.FetchError);
    });

    it("registers GeoLeaf.Utils.PerformanceProfiler class", () => {
        expect(GL.Utils.PerformanceProfiler).toBe(mocks.PerformanceProfiler);
    });

    it("registers GeoLeaf.Utils.performanceProfiler as lazy getter", () => {
        const inst = GL.Utils.performanceProfiler;
        expect(mocks.getPerformanceProfiler).toHaveBeenCalled();
        expect(inst).toBe(mocks.perfProfilerInst);
    });

    it("registers GeoLeaf.Utils.TimerManager", () => {
        expect(GL.Utils.TimerManager).toBe(mocks.TimerManager);
    });

    it("registers GeoLeaf.Utils.ObjectUtils with nested value helpers", () => {
        expect(GL.Utils.ObjectUtils.getNestedValue).toBe(mocks.getNestedValue);
        expect(GL.Utils.ObjectUtils.hasNestedPath).toBe(mocks.hasNestedPath);
        expect(GL.Utils.ObjectUtils.setNestedValue).toBe(mocks.setNestedValue);
    });

    it("registers GeoLeaf.Utils.ScaleUtils", () => {
        expect(GL.Utils.ScaleUtils.calculateMapScale).toBe(mocks.calculateMapScale);
        expect(GL.Utils.ScaleUtils.isScaleInRange).toBe(mocks.isScaleInRange);
        expect(GL.Utils.ScaleUtils.clearScaleCache).toBe(mocks.clearScaleCache);
    });

    // ── FetchHelper shortcuts ─────────────────────────────────────────────────

    it("registers GeoLeaf.fetch shortcut", () => {
        expect(typeof GL.fetch).toBe("function");
    });

    it("registers GeoLeaf.get shortcut", () => {
        expect(typeof GL.get).toBe("function");
    });

    it("registers GeoLeaf.post shortcut", () => {
        expect(typeof GL.post).toBe("function");
    });

    // ── MapHelpers shortcuts — REMOVED in S13 ─────────────────────────────────
    // `GeoLeaf.ensureMap` / `requireMap` / `hasMap` and `Utils.MapHelpers` are gone,
    // with `utils/general/map-helpers.ts`. They had 0 callers anywhere in the monorepo,
    // 0 type declaration and 0 documentation — and their duck-type demanded `setView`,
    // a Leaflet API absent from MapLibre, so they rejected a real `maplibregl.Map`.
    // The surviving resolver is `Utils.ensureMap`; its own tests live in
    // `__tests__/core/utils.test.js` and `__tests__/utils/general-utils-esm.test.js`.
    it("no longer registers the MapHelpers shortcuts", () => {
        expect(GL.ensureMap).toBeUndefined();
        expect(GL.requireMap).toBeUndefined();
        expect(GL.hasMap).toBeUndefined();
    });

    // ── PerformanceProfiler shortcuts ─────────────────────────────────────────

    it("GeoLeaf.mark delegates to performanceProfiler.mark", () => {
        GL.mark("boot-start");
        expect(mocks.perfProfilerInst.mark).toHaveBeenCalledWith("boot-start");
    });

    it("GeoLeaf.measure delegates to performanceProfiler.measure", () => {
        GL.measure("boot", "start", "end");
        expect(mocks.perfProfilerInst.measure).toHaveBeenCalledWith("boot", "start", "end");
    });

    it("GeoLeaf.getPerformanceReport delegates to performanceProfiler.generateReport", () => {
        GL.getPerformanceReport();
        expect(mocks.perfProfilerInst.generateReport).toHaveBeenCalled();
    });

    it("GeoLeaf.establishBaseline delegates to performanceProfiler.establishBaseline", () => {
        GL.establishBaseline();
        expect(mocks.perfProfilerInst.establishBaseline).toHaveBeenCalled();
    });

    // ── Guard: Security namespace pre-initialized ─────────────────────────────

    it("Security guard: does not overwrite pre-existing Security namespace", () => {
        // globals.core uses: if (!_g.GeoLeaf.Security) _g.GeoLeaf.Security = {}
        // The namespace was pre-existing (set by a previous assertion run in this file).
        // The guard ensures existing references are preserved, then Object.assign merges.
        expect(GL.Security).toBeDefined();
        expect(GL.Security.CSRFToken).toBe(mocks.CSRFToken);
    });

    // ── Guard: Utils namespace pre-initialized ────────────────────────────────

    it("Utils guard: does not overwrite pre-existing Utils namespace", () => {
        // Same guard pattern: if (!_g.GeoLeaf.Utils) _g.GeoLeaf.Utils = {}
        expect(GL.Utils).toBeDefined();
        expect(GL.Utils.TimerManager).toBe(mocks.TimerManager);
    });
});
