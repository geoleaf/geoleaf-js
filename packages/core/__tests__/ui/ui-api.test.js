/**
 */
/* Phase 5.15 - ui-api */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
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
    attachFilterInputEvents: vi.fn(),
    attachAccordionEvents: vi.fn(),
    cleanupAllListeners: vi.fn(() => 0),
};
_g.GeoLeaf.Config = { getActiveProfile: vi.fn(() => null) };

// Le déféré est PORTEUR : `ui-api.ts` fait `_g.GeoLeaf.UI = …` au chargement et lit les
// doubles installés juste au-dessus. Un `import` statique se hisserait au-dessus d'eux et
// chargerait le module avant que `_g.GeoLeaf._UITheme` existe. `await import()` préserve
// l'ordre à la lettre tout en faisant passer le module par Vite — ce qui est le seul but.
beforeAll(async () => {
    await import("../../src/kernel/ui/ui-api.js");
    // ⚠️ B-60 — les méthodes de thème et de notification NE SONT PLUS posées par `ui-api.ts`.
    // Elles l'étaient derrière deux `if` de corps de module attendant `_UITheme` /
    // `_UINotifications`, valeurs écrites AU BOOT : les deux conditions étaient donc toujours
    // fausses en production. Cette suite les voyait vraies **parce qu'elle installe ses doubles
    // AVANT l'import différé** — c'est-à-dire qu'elle prouvait que le bloc fonctionnait dans la
    // seule condition qui ne se produit jamais. Les membres sont désormais câblés par
    // `setupUIKernel()` (`globals/globals.ui.ts`), en délégation paresseuse, et leur couverture
    // vit dans `__tests__/ui/b60-notifications-mounted.test.js`. Les assertions qui les
    // cherchaient ICI ont été retirées : elles ne testaient pas cette unité.
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

        it("init with enableEventDelegation false does not init delegation", () => {
            _g.GeoLeaf._UIEventDelegation.attachFilterInputEvents.mockClear();
            _g.GeoLeaf.UI.init({
                map: {},
                mapContainer: document.createElement("div"),
                enableEventDelegation: false,
            });
            expect(_g.GeoLeaf._UIEventDelegation.attachFilterInputEvents).not.toHaveBeenCalled();
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
