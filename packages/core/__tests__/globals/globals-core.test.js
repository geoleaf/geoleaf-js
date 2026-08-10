/**
 * Phase 60 — Step 1.6: src/globals/globals.core.ts (0% → 60%)
 */
// vi.hoisted(): the vi.mock() factories below close over these bindings and run hoisted,
// before the module body evaluates them. The former require() hid the TDZ by calling the
// factories late.
const stub = vi.hoisted(() => ({}));
const fn = vi.hoisted(() => () => {});
vi.mock("../../src/utils/log/index.ts", () => ({ Log: stub }));
// B.12 — complet par construction (voir globals/core.test.js).
vi.mock("../../src/utils/errors/errors.ts", async (importActual) => ({
    ...(await importActual()),
    Errors: stub,
}));
vi.mock("../../src/utils/constants/constants.ts", () => ({
    CONSTANTS: stub,
    VERSION_FALLBACK: "3.0.0-dev",
}));
// B.12 — complet par construction.
vi.mock("../../src/kernel/security/index.ts", async (importActual) => ({
    ...(await importActual()),
    Security: stub,
}));
vi.mock("../../src/kernel/security/csrf-token.ts", () => ({ CSRFToken: stub }));
vi.mock("../../src/utils/general/utils-base.ts", () => ({
    Utils: stub,
    validateUrl: fn,
    deepMerge: fn,
    debounce: fn,
    throttle: fn,
}));
// `applyCssText` is declared undefined — the value it already had. The Module._load shim
// returned undefined for undeclared exports in silence; the native mocker throws instead.
// `utils-namespace.ts` and `helpers.ts` import it, no test in this file references it, and
// giving it a spy would change what is tested.
vi.mock("../../src/utils/general/dom-helpers.ts", () => ({
    createElement: fn,
    applyCssText: undefined,
}));
vi.mock("../../src/kernel/security/dom-security.ts", () => ({ DOMSecurity: stub }));
vi.mock("../../src/utils/log/error-logger.ts", () => ({ ErrorLogger: stub }));
vi.mock("../../src/utils/general/event-listener-manager.ts", () => ({
    EventListenerManager: stub,
    globalEventManager: stub,
    events: {},
}));
vi.mock("../../src/utils/general/fetch-helper.ts", () => ({
    FetchHelper: { fetch: vi.fn(), get: vi.fn(), post: vi.fn() },
    FetchError: {},
}));
const mockMark = vi.fn();
const mockMeasure = vi.fn();
const mockGenerateReport = vi.fn(() => ({}));
const mockEstablishBaseline = vi.fn(() => ({}));
vi.mock("../../src/utils/performance/performance-profiler.ts", () => ({
    PerformanceProfiler: stub,
    getPerformanceProfiler: () => ({
        mark: mockMark,
        measure: mockMeasure,
        generateReport: mockGenerateReport,
        establishBaseline: mockEstablishBaseline,
    }),
}));
vi.mock("../../src/utils/general/timer-manager.ts", () => ({ TimerManager: stub }));
vi.mock("../../src/utils/general/object-utils.ts", () => ({
    getNestedValue: fn,
    hasNestedPath: fn,
    setNestedValue: fn,
}));
vi.mock("../../src/utils/general/scale-utils.ts", () => ({
    calculateMapScale: fn,
    isScaleInRange: fn,
    clearScaleCache: fn,
}));

import "../../src/globals/globals.core.js";

describe("globals/globals.core (step 1.6)", () => {
    it("attache Log, Errors, CONSTANTS, Utils au namespace", () => {
        expect(globalThis.GeoLeaf).toBeDefined();
        expect(globalThis.GeoLeaf.Log).toBe(stub);
        expect(globalThis.GeoLeaf.Errors).toBe(stub);
        expect(globalThis.GeoLeaf.CONSTANTS).toBe(stub);
        expect(globalThis.GeoLeaf.Utils).toBeDefined();
        expect(globalThis.GeoLeaf._version).toBeDefined();
    });

    it("Utils.performanceProfiler getter returns getPerformanceProfiler()", () => {
        const prof = globalThis.GeoLeaf.Utils.performanceProfiler;
        expect(prof).toBeDefined();
        expect(prof.mark).toBe(mockMark);
    });

    it("GeoLeaf.mark calls getPerformanceProfiler().mark", () => {
        globalThis.GeoLeaf.mark("test-mark");
        expect(mockMark).toHaveBeenCalledWith("test-mark");
    });

    it("GeoLeaf.measure calls getPerformanceProfiler().measure", () => {
        globalThis.GeoLeaf.measure("m1", "s", "e");
        expect(mockMeasure).toHaveBeenCalledWith("m1", "s", "e");
    });

    it("GeoLeaf.getPerformanceReport and establishBaseline call profiler", () => {
        globalThis.GeoLeaf.getPerformanceReport();
        globalThis.GeoLeaf.establishBaseline();
        expect(mockGenerateReport).toHaveBeenCalled();
        expect(mockEstablishBaseline).toHaveBeenCalled();
    });

    // S13 — the three MapHelpers shortcuts were removed with `map-helpers.ts`: 0 callers
    // monorepo-wide, 0 types, 0 docs, and a duck-type requiring Leaflet's `setView`.
    it("no longer registers the MapHelpers shortcuts", () => {
        expect(globalThis.GeoLeaf.ensureMap).toBeUndefined();
        expect(globalThis.GeoLeaf.requireMap).toBeUndefined();
        expect(globalThis.GeoLeaf.hasMap).toBeUndefined();
    });
});

// ── T22 — globals.core.ts: Security/Utils already set branches ───────────────
describe("globals.core — T22 (Security and Utils already set)", () => {
    it("does not overwrite Security or Utils when already present on GeoLeaf", async () => {
        // Pre-set Security and Utils before re-requiring the module
        vi.resetModules();
        globalThis.GeoLeaf = globalThis.GeoLeaf || {};
        globalThis.GeoLeaf.Security = { preExisting: true };
        globalThis.GeoLeaf.Utils = { preExisting: true };
        // Re-require the module — it should NOT overwrite existing Security/Utils
        // (the `if (!_g.GeoLeaf.Security)` and `if (!_g.GeoLeaf.Utils)` branches are false)
        await import("../../src/globals/globals.core.js");
        // The pre-existing properties are merged via Object.assign, not replaced
        expect(globalThis.GeoLeaf.Security).toBeDefined();
        expect(globalThis.GeoLeaf.Utils).toBeDefined();
    });
});

// ── T22 — globals.core.ts: __GEOLEAF_VERSION__ branch (MISS[3] cond[0]) ──────
// __GEOLEAF_VERSION__ is a build-time constant (declared via `declare const`).
// It cannot be set at runtime via globalThis — `typeof __GEOLEAF_VERSION__`
// checks the bare identifier, not a globalThis property. In test mode,
// it is always undefined so the shared VERSION_FALLBACK ("3.0.0-dev") is used.
describe("globals.core — T22 (__GEOLEAF_VERSION__ fallback)", () => {
    it("_version falls back to dev version when __GEOLEAF_VERSION__ is not defined at build time", () => {
        expect(globalThis.GeoLeaf._version).toBe("3.0.0-dev");
    });
});
