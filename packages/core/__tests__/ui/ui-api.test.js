/**
 */
/* Phase 5.15 - ui-api */

// `vi.hoisted` — the double must be reachable by the assertions, and
// `vi.mock` is hoisted above module `const`s.
const { Log } = vi.hoisted(() => ({
    Log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log }));
// geolocation-state relocated to the in-core `geolocation` capability (ui-api no longer imports it).

const _g = typeof globalThis !== "undefined" ? globalThis : window;
_g.GeoLeaf = _g.GeoLeaf || {};
_g.GeoLeaf._UITheme = {
    initThemeToggle: vi.fn(),
    toggleTheme: vi.fn(),
    applyTheme: vi.fn(),
    getCurrentTheme: vi.fn(),
};
_g.GeoLeaf._UINotifications = {
    init: vi.fn(),
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
    // ⚠️ `attachFilterInputEvents` was removed from this double: the real
    // facade (`kernel/ui/event-delegation.ts`) carries
    // `attachTrackedListener`, `cleanupAllListeners` and
    // `attachAccordionEvents`, never that name. The test below asserted it
    // `.not.toHaveBeenCalled()` — true by vacuity, forever.
    attachTrackedListener: vi.fn(),
    attachAccordionEvents: vi.fn(),
    cleanupAllListeners: vi.fn(() => 0),
};
_g.GeoLeaf.Config = { getActiveProfile: vi.fn(() => null) };

// The deferral is LOAD-BEARING: `ui-api.ts` does `_g.GeoLeaf.UI = …` at
// load and reads the doubles installed just above. A static `import` would
// hoist above them and load the module before `_g.GeoLeaf._UITheme` exists.
// `await import()` preserves the order to the letter while still running
// the module through Vite — which is the only goal.
beforeAll(async () => {
    await import("../../src/kernel/ui/ui-api.js");
    // ⚠️ The theme and notification methods are NO LONGER set by
    // `ui-api.ts`. They were, behind two module-body `if`s waiting for
    // `_UITheme` / `_UINotifications`, values written AT BOOT: both
    // conditions were therefore always false in production. This suite saw
    // them true **because it installs its doubles BEFORE the deferred
    // import** — i.e. it proved the block worked in the one condition that
    // never occurs. The members are now wired by `setupUIKernel()`
    // (`globals/globals.ui.ts`), in lazy delegation, and their coverage
    // lives in `__tests__/ui/b60-notifications-mounted.test.js`. The
    // assertions looking for them HERE were removed: they did not test this unit.
});

describe("ui/ui-api (Phase 5.15)", () => {
    it("GeoLeaf.UI exists after load", () => {
        expect(_g.GeoLeaf.UI).toBeDefined();
    });

    it("checkModuleAvailability returns object with modules and missing", () => {
        if (typeof _g.GeoLeaf.UI.checkModuleAvailability !== "function") return;
        const r = _g.GeoLeaf.UI.checkModuleAvailability();
        expect(r).toHaveProperty("modules");
        expect(r).toHaveProperty("missing");
    });

    describe("Phase 9b — coverage 60%", () => {
        it("getModuleStatus returns checkModuleAvailability result", () => {
            const r = _g.GeoLeaf.UI.getModuleStatus();
            expect(r).toHaveProperty("modules");
            expect(r).toHaveProperty("allAvailable");
        });

        it("cleanup calls EventDelegation.cleanupAllListeners", () => {
            _g.GeoLeaf.UI.cleanup();
            expect(_g.GeoLeaf._UIEventDelegation.cleanupAllListeners).toHaveBeenCalled();
        });

        // 🛑 These two tests' oracle is the ONLY observable effect of
        // `initializeEventDelegation()` from outside: its log trace
        // (`ui-api.ts`). The member they queried,
        // `attachFilterInputEvents`, exists on no facade — the assertion was
        // true by vacuity. And `attachAccordionEvents`, the path's only real
        // member, would not do either: it is only called from a
        // `DOMContentLoaded` listener, on `.gl-filter-panel` elements no
        // code sets (`ui-api.ts`) — the assertion would be vacuous a
        // second time, through another mechanism.
        const DELEGATION_LOG = "[UI.Orchestrator] Event delegation initialisée";

        it("init with enableEventDelegation false does not init delegation", () => {
            _g.GeoLeaf.UI.cleanup(); // resets `_delegationInitialized` to false (ui-api.ts)
            Log.info.mockClear();
            _g.GeoLeaf.UI.init({
                map: {},
                mapContainer: document.createElement("div"),
                enableEventDelegation: false,
            });
            expect(Log.info).not.toHaveBeenCalledWith(DELEGATION_LOG);
        });

        // The POSITIVE side, without which the previous one discriminates
        // nothing: a negative assertion alone stays green if the subject
        // stops initialising delegation AT ALL.
        it("init with delegation enabled does init it", () => {
            _g.GeoLeaf.UI.cleanup();
            Log.info.mockClear();
            _g.GeoLeaf.UI.init({
                map: {},
                mapContainer: document.createElement("div"),
            });
            expect(Log.info).toHaveBeenCalledWith(DELEGATION_LOG);
        });

        // `_geolocationActive`/`_userPosition`/`_userPositionAccuracy`/`_geolocationWatchId` CDN-compat
        // proxies dropped — geolocation state is now read via `GeoLeaf.Geolocation.getState()`
        // (in-core `geolocation` capability).

        it("init theme throw is caught", () => {
            _g.GeoLeaf._UITheme.initThemeToggle.mockImplementation(() => {
                throw new Error("theme error");
            });
            expect(() =>
                _g.GeoLeaf.UI.init({ map: {}, mapContainer: document.createElement("div") })
            ).not.toThrow();
            _g.GeoLeaf._UITheme.initThemeToggle.mockImplementation(() => {});
        });
    });
});
