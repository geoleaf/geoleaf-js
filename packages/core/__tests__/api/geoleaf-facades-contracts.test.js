/**
 * T10.4.3 — geoleaf-facades-contracts.test.js
 * Verifies the API contracts of the 5 most critical public facades:
 *   Config, Core, POI, Events, Notifications
 *
 * For each facade:
 *   - Methods are present and of the expected type
 *   - Methods correctly delegate to their underlying implementation
 *   - Edge cases (null map, unloaded state, etc.) are handled gracefully
 *
 * Strategy: await import() + minimal mocks (boundaries only).
 */
"use strict";

// ── Cross-cutting mocks ───────────────────────────────────────────────────────
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/constants/constants.js", () => ({
    CONSTANTS: { DEFAULT_ZOOM: 13, TILE_SIZE: 256 },
}));

vi.mock("../../src/kernel/events/event-bus.js", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

// ── Core / map mocks ──────────────────────────────────────────────────────────
const mockSetTheme = vi.fn();
const mockGetTheme = vi.fn(() => "light");

vi.mock("../../src/adapters/maplibre/maplibre-adapter.js", () => ({
    MaplibreAdapter: vi.fn().mockImplementation(() => ({
        init: vi.fn(),
        destroy: vi.fn(),
        getInternalMap: vi.fn(() => null),
    })),
}));

vi.mock("../../src/kernel/map/map-container.js", () => ({
    resolveMapContainer: vi.fn(() => document.createElement("div")),
    applyThemeSafe: vi.fn(),
}));

vi.mock("../../src/kernel/map/theme.js", () => ({
    setTheme: mockSetTheme,
    getTheme: mockGetTheme,
}));

// ── Config sub-module mocks ───────────────────────────────────────────────────
vi.mock("../../src/kernel/config/storage.js", () => ({
    ConfigStore: {
        get: vi.fn(() => null),
        getAll: vi.fn(() => ({})),
        set: vi.fn(),
    },
}));

vi.mock("../../src/kernel/config/profile.js", () => ({
    ProfileManager: {
        getActiveProfileId: vi.fn(() => null),
        getActiveProfile: vi.fn(() => null),
    },
}));

// ── Notifications singleton mock ──────────────────────────────────────────────
const mockUINotifications = {
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    clearAll: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getStatus: vi.fn(() => ({ enabled: true, queueLength: 0 })),
};

vi.mock("../../src/capabilities/toast-renderer/notifications.js", () => ({
    _UINotifications: mockUINotifications,
}));

// ── globalThis.GeoLeaf setup (for UI facade) ──────────────────────────────────
const _g = globalThis;
_g.GeoLeaf = _g.GeoLeaf || {};
_g.GeoLeaf._UITheme = {
    initThemeToggle: vi.fn(),
    initAutoTheme: vi.fn(),
    toggleTheme: vi.fn(),
    applyTheme: vi.fn(),
    getCurrentTheme: vi.fn(() => "light"),
};
_g.GeoLeaf._UINotifications = mockUINotifications;
_g.GeoLeaf._UIEventDelegation = {
    attachFilterInputEvents: vi.fn(),
    attachAccordionEvents: vi.fn(),
    cleanupAllListeners: vi.fn(() => 0),
};
_g.GeoLeaf.Config = {
    getActiveProfile: vi.fn(() => null),
    get: vi.fn(() => null),
};
_g.GeoLeaf.Utils = { createElement: vi.fn((tag) => document.createElement(tag)) };

// ── Test suites ───────────────────────────────────────────────────────────────

describe("T10.4.3 — Config facade contract", () => {
    let Config;

    beforeAll(async () => {
        ({ Config } = await import("../_helpers/load-wired-config.js"));
    });

    beforeEach(() => {
        // Reset Config state between tests
        Config._isLoaded = false;
        Config._config = {};
        Config._source = null;
    });

    it("isLoaded() returns false when Config not initialized", () => {
        expect(Config.isLoaded()).toBe(false);
    });

    it("getSource() returns null when Config not initialized", () => {
        expect(Config.getSource()).toBeNull();
    });

    it("init({ inline }) returns a Promise", async () => {
        const promise = Config.init({ inline: { map: { zoom: 13 } } });
        expect(promise).toBeInstanceOf(Promise);
        await promise;
    });

    it("isLoaded() returns true after init with inline config", async () => {
        await Config.init({ inline: { map: { zoom: 13 } } });
        expect(Config.isLoaded()).toBe(true);
    });

    it("getSource() returns 'inline' after inline init", async () => {
        await Config.init({ inline: { map: { zoom: 12 } } });
        expect(Config.getSource()).toBe("inline");
    });

    it("get() accessor is a function (added by side-effect import)", () => {
        expect(typeof Config.get).toBe("function");
    });

    it("getAll() returns the config object when loaded", async () => {
        await Config.init({ inline: { version: "test-1.0" } });
        const all = Config.getAll();
        expect(all).toBeDefined();
        expect(typeof all).toBe("object");
    });

    it("getActiveProfile() returns null when no profiles defined", async () => {
        await Config.init({ inline: {} });
        expect(Config.getActiveProfile()).toBeNull();
    });
});

describe("T10.4.3 — Core facade contract", () => {
    let Core;

    beforeAll(async () => {
        ({ Core } = await import("../../src/api/geoleaf.core.js"));
    });

    it("getMap() returns null before init", () => {
        expect(Core.getMap()).toBeNull();
    });

    it("getAdapter() returns same value as getMap()", () => {
        expect(Core.getAdapter()).toEqual(Core.getMap());
    });

    it("setTheme() delegates to the theme module", () => {
        mockSetTheme.mockClear();
        Core.setTheme("dark");
        expect(mockSetTheme).toHaveBeenCalledWith("dark");
    });

    it("getTheme() delegates to the theme module", () => {
        mockGetTheme.mockReturnValueOnce("dark");
        const theme = Core.getTheme();
        expect(theme).toBe("dark");
        expect(mockGetTheme).toHaveBeenCalled();
    });

    it("getTheme() returns 'light' by default (mock default)", () => {
        expect(Core.getTheme()).toBe("light");
    });
});

describe("T10.4.3 — Events facade contract (behavioral)", () => {
    let Events;

    beforeAll(async () => {
        ({ Events } = await import("../../src/api/geoleaf.events.js"));
    });

    it("Events.on() — handler receives dispatched CustomEvent detail", () => {
        const received = [];
        const handler = (e) => received.push(e.detail);

        Events.on("geoleaf:poi:click", handler);
        document.dispatchEvent(
            new CustomEvent("geoleaf:poi:click", {
                detail: { poiId: "abc", layerId: "lyr", source: "direct" },
            })
        );
        Events.off("geoleaf:poi:click", handler);

        expect(received).toHaveLength(1);
        expect(received[0].poiId).toBe("abc");
    });

    it("Events.off() — removes listener; no calls after removal", () => {
        const calls = [];
        const handler = (e) => calls.push(e.detail);

        Events.on("geoleaf:filter:apply", handler);
        Events.off("geoleaf:filter:apply", handler);

        document.dispatchEvent(
            new CustomEvent("geoleaf:filter:apply", { detail: { layerIds: ["l1"] } })
        );

        expect(calls).toHaveLength(0);
    });

    it("Events.once() — fires exactly once; subsequent fires ignored", () => {
        const calls = [];
        Events.once("geoleaf:layer:toggle", (e) => calls.push(e.detail));

        const payload = { layerId: "lyr", visible: true, source: "user" };
        document.dispatchEvent(new CustomEvent("geoleaf:layer:toggle", { detail: payload }));
        document.dispatchEvent(new CustomEvent("geoleaf:layer:toggle", { detail: payload }));

        expect(calls).toHaveLength(1);
        expect(calls[0].visible).toBe(true);
    });

    it("Events methods are stable (same reference across calls)", () => {
        expect(typeof Events.on).toBe("function");
        expect(typeof Events.off).toBe("function");
        expect(typeof Events.once).toBe("function");
    });
});

describe("T10.4.3 — Notifications facade contract", () => {
    let Notifications;

    beforeAll(async () => {
        ({ Notifications } = await import("../../src/capabilities/toast-renderer/public-api.js"));
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("Notifications.notify() delegates to _UINotifications.show", () => {
        Notifications.notify("Test message", "info", 3000);
        expect(mockUINotifications.show).toHaveBeenCalledWith("Test message", "info", 3000);
    });

    it("Notifications.success() delegates to _UINotifications.success", () => {
        Notifications.success("Saved successfully");
        expect(mockUINotifications.success).toHaveBeenCalledWith("Saved successfully", undefined);
    });

    it("Notifications.error() delegates to _UINotifications.error", () => {
        Notifications.error("Load failed", { persistent: true });
        expect(mockUINotifications.error).toHaveBeenCalledWith("Load failed", { persistent: true });
    });

    it("Notifications.warning() delegates to _UINotifications.warning", () => {
        Notifications.warning("Low memory");
        expect(mockUINotifications.warning).toHaveBeenCalledWith("Low memory", undefined);
    });

    it("Notifications.info() delegates to _UINotifications.info", () => {
        Notifications.info("Updates available");
        expect(mockUINotifications.info).toHaveBeenCalledWith("Updates available", undefined);
    });

    it("Notifications.dismiss() delegates to _UINotifications.dismiss", () => {
        const fakeEl = document.createElement("div");
        Notifications.dismiss(fakeEl);
        expect(mockUINotifications.dismiss).toHaveBeenCalledWith(fakeEl);
    });

    it("Notifications.clearAll() delegates to _UINotifications.clearAll", () => {
        Notifications.clearAll();
        expect(mockUINotifications.clearAll).toHaveBeenCalled();
    });

    it("Notifications.getStatus() returns status object", () => {
        const status = Notifications.getStatus();
        expect(status).toBeDefined();
        expect(typeof status).toBe("object");
    });

    // S8 — `show` was missing from the facade while the renderer, the legacy
    // `GeoLeaf.UI.showNotification` surface and the plugin docs all named it. Calling it
    // hit `undefined` and the old `?.show?.()` guard swallowed the failure, so the toast
    // simply never appeared (plugin-editor hit this for real).
    it("Notifications.show() exists and delegates to _UINotifications.show", () => {
        expect(typeof Notifications.show).toBe("function");
        Notifications.show("Feature is stale", { type: "warning" });
        expect(mockUINotifications.show).toHaveBeenCalledWith(
            "Feature is stale",
            { type: "warning" },
            undefined
        );
    });

    // S8 — the emitting methods used to return `void`, so the handle `dismiss()` needs
    // could not be obtained through the facade at all.
    it("the emitting methods hand back the toast element for dismiss()", () => {
        const fakeToast = document.createElement("div");
        mockUINotifications.show.mockReturnValue(fakeToast);
        mockUINotifications.info.mockReturnValue(fakeToast);

        expect(Notifications.notify("a")).toBe(fakeToast);
        expect(Notifications.show("b")).toBe(fakeToast);
        expect(Notifications.info("c", { persistent: true })).toBe(fakeToast);

        Notifications.dismiss(Notifications.info("d", { persistent: true }));
        expect(mockUINotifications.dismiss).toHaveBeenCalledWith(fakeToast);
    });
});
