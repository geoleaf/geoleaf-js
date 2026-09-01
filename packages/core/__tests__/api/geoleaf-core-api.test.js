/**
 * T10.4.2 — geoleaf-core-api.test.js
 * Verifies all 30 named exports from bundle-esm-entry.ts:
 *   - Presence (non-null/undefined)
 *   - Type (object / function)
 *   - Key methods exist on each export
 *
 * Strategy: direct facade imports + minimal mocks.
 * Each facade file (geoleaf.*.ts) is thin: importing it exercises its code,
 * which is the primary coverage goal for T10.4.
 */
"use strict";

// ── Cross-cutting mocks ───────────────────────────────────────────────────────
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/constants/constants.js", () => ({
    CONSTANTS: { DEFAULT_ZOOM: 13, DEFAULT_CENTER: [45.764, 4.835], TILE_SIZE: 256 },
    VERSION_FALLBACK: "3.0.0-dev",
}));

vi.mock("../../src/kernel/events/event-bus.js", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

// ── Core / map mocks ──────────────────────────────────────────────────────────
vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    // Vitest 4: constructable mock (class returning the fake instance).
    MaplibreAdapter: vi.fn().mockImplementation(
        class {
            constructor() {
                return { init: vi.fn(), destroy: vi.fn(), getInternalMap: vi.fn(() => null) };
            }
        }
    ),
}));

vi.mock("../../src/kernel/map/map-container.js", () => ({
    resolveMapContainer: vi.fn(() => document.createElement("div")),
    applyThemeSafe: vi.fn(),
}));

vi.mock("../../src/kernel/map/theme.js", () => ({
    setTheme: vi.fn(),
    getTheme: vi.fn(() => "light"),
}));

// ── Notifications: _UINotifications singleton ─────────────────────────────────
// The facade imports the real singleton statically (a module-level `const`), so it is
// always present — it is NOT read off `globalThis.GeoLeaf`. The `_g.GeoLeaf._UINotifications`
// below is for the legacy `GeoLeaf.UI.*` surface in ui-api.ts, which does read it.

// ── globalThis.GeoLeaf setup for UI facade ────────────────────────────────────
// ui-api.ts reads _g.GeoLeaf.* at module evaluation time.
const _g = globalThis;
_g.GeoLeaf = _g.GeoLeaf || {};
_g.GeoLeaf._UITheme = {
    initThemeToggle: vi.fn(),
    initAutoTheme: vi.fn((cfg, cb) => {
        if (cb) cb(cfg);
    }),
    toggleTheme: vi.fn(),
    applyTheme: vi.fn(),
    getCurrentTheme: vi.fn(() => "light"),
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
    getStatus: vi.fn(() => ({ enabled: true })),
};
_g.GeoLeaf._UIEventDelegation = {
    attachFilterInputEvents: vi.fn(),
    attachAccordionEvents: vi.fn(),
    cleanupAllListeners: vi.fn(() => 0),
    initPoiClickDelegation: vi.fn(),
};
_g.GeoLeaf.Config = {
    getActiveProfile: vi.fn(() => null),
    get: vi.fn(() => null),
};
_g.GeoLeaf.Utils = {
    createElement: vi.fn((tag) => document.createElement(tag)),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("T10.4.2 — Core infrastructure exports", () => {
    let Core, Config, GeoLeafAPI;

    beforeAll(async () => {
        ({ Core } = await import("../../src/api/geoleaf.core.js"));
        ({ Config } = await import("../_helpers/load-wired-config.js"));
        ({ GeoLeafAPI } = await import("../../src/api/geoleaf.api.js"));
    });

    it("Core is a non-null object", () => {
        expect(Core).toBeDefined();
        expect(typeof Core).toBe("object");
    });

    it("Core has init, getMap, setTheme, getTheme, getAdapter", () => {
        expect(typeof Core.init).toBe("function");
        expect(typeof Core.getMap).toBe("function");
        expect(typeof Core.setTheme).toBe("function");
        expect(typeof Core.getTheme).toBe("function");
        expect(typeof Core.getAdapter).toBe("function");
    });

    it("Core.getAdapter is an alias of Core.getMap", () => {
        expect(Core.getAdapter).toBe(Core.getMap);
    });

    it("Config is a non-null object", () => {
        expect(Config).toBeDefined();
        expect(typeof Config).toBe("object");
    });

    it("Config has init, isLoaded, getSource", () => {
        expect(typeof Config.init).toBe("function");
        expect(typeof Config.isLoaded).toBe("function");
        expect(typeof Config.getSource).toBe("function");
    });

    it("Config has accessors from side-effect imports (get, getAll, getActiveProfile)", () => {
        expect(typeof Config.get).toBe("function");
        expect(typeof Config.getAll).toBe("function");
        expect(typeof Config.getActiveProfile).toBe("function");
    });

    it("GeoLeafAPI is defined and non-null", () => {
        expect(GeoLeafAPI).toBeDefined();
    });
});

describe("T10.4.2 — UI & Notifications exports", () => {
    let UI, Notifications;

    beforeAll(async () => {
        ({ UI } = await import("../../src/api/geoleaf.ui.js"));
        ({ Notifications } = await import("../../src/capabilities/toast-renderer/public-api.js"));
        // ⚠️ This suite describes the public surface AFTER BOOT, so it must
        // be simulated. `setTheme` / `toggleTheme` / `getCurrentTheme` /
        // `Notifications` are not set at import: they used to be, by two
        // module-body `if`s in `ui-api.ts` whose conditions were **always
        // false in production** (they waited for values written at boot).
        // These assertions thus passed on a mounting that never happened for
        // an integrator. The real wiring is `setupUIKernel()`.
        const { setupUIKernel } = await import("../../src/globals/globals.ui.js");
        setupUIKernel();
    });

    it("UI is a non-null object", () => {
        expect(UI).toBeDefined();
        expect(typeof UI).toBe("object");
    });

    it("UI has init, cleanup, setTheme, toggleTheme", () => {
        expect(typeof UI.init).toBe("function");
        expect(typeof UI.cleanup).toBe("function");
        expect(typeof UI.setTheme).toBe("function");
        expect(typeof UI.toggleTheme).toBe("function");
    });

    it("UI has getCurrentTheme, getModuleStatus, Notifications sub-namespace", () => {
        expect(typeof UI.getCurrentTheme).toBe("function");
        expect(typeof UI.getModuleStatus).toBe("function");
        expect(UI.Notifications).toBeDefined();
    });

    it("Notifications is a non-null object", () => {
        expect(Notifications).toBeDefined();
        expect(typeof Notifications).toBe("object");
    });

    it("Notifications has notify, success, error, warning, info, dismiss", () => {
        expect(typeof Notifications.notify).toBe("function");
        expect(typeof Notifications.success).toBe("function");
        expect(typeof Notifications.error).toBe("function");
        expect(typeof Notifications.warning).toBe("function");
        expect(typeof Notifications.info).toBe("function");
        expect(typeof Notifications.dismiss).toBe("function");
    });
});

describe("T10.4.2 — Optional module exports (Legend)", () => {
    let Legend, Baselayers, LayerManager;

    beforeAll(async () => {
        // Parallel imports + generous hook timeout: under the full `npm test` (turbo)
        // run these 9 facade module graphs are transformed (tsx) and instrumented
        // (istanbul) concurrently with the other workspaces, which can push 9 SEQUENTIAL
        // dynamic imports past the default 10 s hook budget (a flaky timeout that only
        // surfaces under CPU contention, never in an isolated core run). Loading them in
        // parallel keeps the hook well within budget; the explicit timeout is a margin.
        const [legendMod, baselayersMod, layerManagerMod] = await Promise.all([
            import("../../src/api/geoleaf.legend.js"),
            import("../../src/api/geoleaf.baselayers.js"),
            import("../../src/api/geoleaf.layer-manager.js"),
        ]);
        Legend = legendMod.Legend;
        Baselayers = baselayersMod.Baselayers;
        LayerManager = layerManagerMod.LayerManager;
    }, 30000);

    it("Legend is a non-null object with init/hideLegend/isLegendVisible", () => {
        expect(Legend).toBeDefined();
        expect(typeof Legend.init).toBe("function");
        expect(typeof Legend.hideLegend).toBe("function");
        expect(typeof Legend.isLegendVisible).toBe("function");
    });

    it("Baselayers, LayerManager are all defined objects", () => {
        expect(Baselayers).toBeDefined();
        expect(typeof Baselayers).toBe("object");
        expect(LayerManager).toBeDefined();
        expect(typeof LayerManager).toBe("object");
    });
});

describe("T10.4.2 — Events, Permalink, PWA exports", () => {
    let Events, Permalink, PWA;

    beforeAll(async () => {
        ({ Events } = await import("../../src/api/geoleaf.events.js"));
        ({ Permalink } = await import("../../src/api/geoleaf.permalink.js"));
        ({ PWA } = await import("../../src/api/geoleaf.pwa.js"));
    });

    it("Events is a non-null object with on/off/once", () => {
        expect(Events).toBeDefined();
        expect(typeof Events.on).toBe("function");
        expect(typeof Events.off).toBe("function");
        expect(typeof Events.once).toBe("function");
    });

    it("Permalink is defined", () => {
        expect(Permalink).toBeDefined();
    });

    it("PWA is defined", () => {
        expect(PWA).toBeDefined();
    });
});

describe("T10.4.2 — Utility exports (Log, Errors, CONSTANTS, Utils, Helpers, Validators)", () => {
    let Log, Errors, CONSTANTS, Utils, Helpers, Validators;

    beforeAll(async () => {
        ({ Log } = await import("../../src/utils/log/index.js"));
        ({ Errors } = await import("../../src/utils/errors/errors.js"));
        ({ CONSTANTS } = await import("../../src/utils/constants/constants.js"));
        ({ Utils } = await import("../../src/utils/general/utils-base.js"));
        ({ Helpers } = await import("../../src/api/geoleaf.helpers.js"));
        ({ Validators } = await import("../../src/api/geoleaf.validators.js"));
    });

    it("Log is a non-null object with debug/info/warn/error", () => {
        expect(Log).toBeDefined();
        expect(typeof Log.debug).toBe("function");
        expect(typeof Log.info).toBe("function");
        expect(typeof Log.warn).toBe("function");
        expect(typeof Log.error).toBe("function");
    });

    it("Errors is defined", () => {
        expect(Errors).toBeDefined();
    });

    it("CONSTANTS is a non-null object with DEFAULT_ZOOM", () => {
        expect(CONSTANTS).toBeDefined();
        expect(CONSTANTS.DEFAULT_ZOOM).toBeDefined();
    });

    it("Utils is defined", () => {
        expect(Utils).toBeDefined();
    });

    it("Helpers is a non-null object", () => {
        expect(Helpers).toBeDefined();
        expect(typeof Helpers).toBe("object");
    });

    it("Validators is a non-null object", () => {
        expect(Validators).toBeDefined();
        expect(typeof Validators).toBe("object");
    });
});

describe("T10.4.2 — API sub-module exports", () => {
    let APIController, APIFactoryManager, APIInitializationManager, APIModuleManager;
    let PluginRegistry, BootInfo, showBootInfo;

    beforeAll(async () => {
        ({
            APIController,
            APIFactoryManager,
            APIInitializationManager,
            APIModuleManager,
            PluginRegistry,
            BootInfo,
            showBootInfo,
        } = await import("../../src/kernel/api/index.js"));
    });

    it("APIController is defined", () => {
        expect(APIController).toBeDefined();
    });

    it("APIFactoryManager is defined", () => {
        expect(APIFactoryManager).toBeDefined();
    });

    it("APIInitializationManager is defined", () => {
        expect(APIInitializationManager).toBeDefined();
    });

    it("APIModuleManager is defined", () => {
        expect(APIModuleManager).toBeDefined();
    });

    it("PluginRegistry is a non-null object with register/isLoaded/getLoadedPlugins", () => {
        expect(PluginRegistry).toBeDefined();
        expect(typeof PluginRegistry.register).toBe("function");
        expect(typeof PluginRegistry.isLoaded).toBe("function");
        expect(typeof PluginRegistry.getLoadedPlugins).toBe("function");
    });

    it("BootInfo is defined", () => {
        expect(BootInfo).toBeDefined();
    });

    it("showBootInfo is a function", () => {
        expect(typeof showBootInfo).toBe("function");
    });
});
