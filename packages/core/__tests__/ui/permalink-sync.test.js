/**
 * Tests pour permalink/permalink-sync — Phase D S5B.16 (18.13% → 70%)
 * Couvre : buildUrl, applyState, startSync, _captureState (via startSync), _restoreSearchBar,
 * _debounce (via timing), layer visibility, filter restore, theme, ghost elements.
 */
import { vi } from "vitest";

// ── Mocks hoisted (before imports) ─────────────────────────────────────────
const mockSetVisibility = vi.hoisted(() => vi.fn());
const mockGetCenter = vi.hoisted(() => vi.fn(() => ({ lat: 48.857, lng: 2.347 })));
const mockGetZoom = vi.hoisted(() => vi.fn(() => 12));
const mockGetCurrentTheme = vi.hoisted(() => vi.fn(() => "default"));
const mockSetTheme = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("../../src/kernel/geojson/visibility-manager.js", () => ({
    VisibilityManager: {
        setVisibility: mockSetVisibility,
    },
}));

const mockLayersMap = vi.hoisted(() => new Map());
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        state: {
            layers: mockLayersMap,
        },
    },
}));

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ThemeApplierCore — only the _loadLayerFromProfile bridge used by the
// shownLayers restoration path (gl_shown bug fix, A.7 sprint).
const mockLoadLayerFromProfile = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: {
        _loadLayerFromProfile: mockLoadLayerFromProfile,
    },
}));

import {
    buildUrl,
    applyState,
    startSync,
    readUrl,
} from "../../src/capabilities/permalink/permalink-sync.ts";

// ── Shared helpers ─────────────────────────────────────────────────────────

function makeMap(overrides = {}) {
    return {
        setView: vi.fn(),
        getCenter: mockGetCenter,
        getZoom: mockGetZoom,
        on: vi.fn(),
        off: vi.fn(),
        ...overrides,
    };
}

const defaultConfig = { mode: "hash" };

// ─────────────────────────────────────────────────────────────────────────────
//  buildUrl
// ─────────────────────────────────────────────────────────────────────────────
describe("buildUrl", () => {
    test("returns empty string for null state", () => {
        expect(buildUrl(null, defaultConfig)).toBe("");
    });

    test("returns empty string for undefined state", () => {
        expect(buildUrl(undefined, defaultConfig)).toBe("");
    });

    test("builds hash fragment with lat/lng/zoom", () => {
        const result = buildUrl({ lat: 48.857, lng: 2.347, zoom: 12 }, defaultConfig);
        expect(result).toMatch(/^#/);
        expect(result).toContain("gl_lat=48.857000");
        expect(result).toContain("gl_lng=2.347000");
        expect(result).toContain("gl_zoom=12");
    });

    test("builds query string when mode=query", () => {
        const result = buildUrl({ lat: 48.857, lng: 2.347, zoom: 12 }, { mode: "query" });
        expect(result).toMatch(/^\?/);
        expect(result).toContain("gl_lat=");
    });

    test("includes layers when state.layers is set", () => {
        const result = buildUrl(
            { lat: 48, lng: 2, zoom: 10, layers: ["layer-1", "layer-2"] },
            defaultConfig
        );
        expect(result).toContain("gl_layers=layer-1%2Clayer-2");
    });

    test("includes filter text in URL", () => {
        const result = buildUrl({ lat: 48, lng: 2, zoom: 10, filter: "café" }, defaultConfig);
        expect(result).toContain("gl_filter=caf");
    });

    test("includes theme in URL", () => {
        const result = buildUrl({ lat: 48, lng: 2, zoom: 10, theme: "dark" }, defaultConfig);
        expect(result).toContain("gl_theme=dark");
    });

    test("includes categories encoded", () => {
        const result = buildUrl(
            { lat: 48, lng: 2, zoom: 10, categories: ["cat-A", "cat-B"] },
            defaultConfig
        );
        expect(result).toContain("gl_cats=cat-A%2Ccat-B");
    });

    test("includes rating when > 0", () => {
        const result = buildUrl({ lat: 48, lng: 2, zoom: 10, rating: 3.5 }, defaultConfig);
        expect(result).toContain("gl_rating=3.5");
    });

    test("omits rating when 0", () => {
        const result = buildUrl({ lat: 48, lng: 2, zoom: 10, rating: 0 }, defaultConfig);
        expect(result).not.toContain("gl_rating");
    });

    test("uses compact (base64) when mode=compact", () => {
        const result = buildUrl({ lat: 48, lng: 2, zoom: 10 }, { mode: "compact" });
        expect(result).toMatch(/^#gl=/);
        // Verify it decodes back (URLSearchParams URL-encodes the value so decode first)
        const b64 = decodeURIComponent(result.replace("#gl=", ""));
        expect(() => JSON.parse(atob(b64))).not.toThrow();
    });

    test("respects fields restriction — omits layers when not in fields", () => {
        const result = buildUrl(
            { lat: 48, lng: 2, zoom: 10, layers: ["L1"] },
            { mode: "hash", fields: ["lat", "lng", "zoom"] }
        );
        expect(result).not.toContain("gl_layers");
    });

    test("includes shownLayers when set", () => {
        const result = buildUrl(
            { lat: 48, lng: 2, zoom: 10, shownLayers: ["L-explicit"] },
            defaultConfig
        );
        expect(result).toContain("gl_shown=L-explicit");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  applyState
// ─────────────────────────────────────────────────────────────────────────────
describe("applyState", () => {
    beforeEach(() => {
        mockSetVisibility.mockReset();
        document.body.innerHTML = "";
        globalThis.GeoLeaf = {
            ThemeSelector: {
                getCurrentTheme: mockGetCurrentTheme,
                setTheme: mockSetTheme,
            },
        };
    });

    test("calls map.setView with state lat/lng/zoom", () => {
        const map = makeMap();
        applyState({ lat: 48.857, lng: 2.347, zoom: 12 }, map);
        expect(map.setView).toHaveBeenCalledWith({ lat: 48.857, lng: 2.347 }, 12);
    });

    test("returns early when no deferred state (only coords)", () => {
        const map = makeMap();
        // No layers, no filter, no theme → no event listener needed
        applyState({ lat: 48, lng: 2, zoom: 10 }, map);
        expect(map.setView).toHaveBeenCalledTimes(1);
        // No setVisibility calls
        expect(mockSetVisibility).not.toHaveBeenCalled();
    });

    test("fallback: themes:ready never fires → deferred layers still apply after app:ready + grace", () => {
        // The event has exactly ONE emitter (theme-selector's init) behind three conditions;
        // a page missing any of them never emits. Before the fallback, everything deferred
        // under `hasTheme` was silently lost — layers and filter included, not just the theme.
        vi.useFakeTimers();
        try {
            const map = makeMap();
            applyState({ lat: 48, lng: 2, zoom: 10, theme: "nuit", layers: ["l-hid"] }, map);

            // No themes:ready. The reveal always ends up firing app:ready…
            document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
            expect(mockSetVisibility).not.toHaveBeenCalled(); // grace still running

            vi.advanceTimersByTime(2001);
            expect(mockSetVisibility).toHaveBeenCalledWith("l-hid", false, "user");
            // The theme switch itself is dropped — nothing mounted can switch.
            expect(mockSetTheme).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    test("fallback does not double-apply when themes:ready DID fire", () => {
        vi.useFakeTimers();
        try {
            const map = makeMap();
            mockGetCurrentTheme.mockReturnValue("nuit");
            applyState({ lat: 48, lng: 2, zoom: 10, theme: "nuit", layers: ["l-once"] }, map);

            document.dispatchEvent(new CustomEvent("geoleaf:themes:ready"));
            expect(mockSetVisibility).toHaveBeenCalledTimes(1);

            document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
            vi.advanceTimersByTime(5000);
            expect(mockSetVisibility).toHaveBeenCalledTimes(1); // latched, no second pass
        } finally {
            vi.useRealTimers();
        }
    });

    test("hides layers on geoleaf:theme:applied (no theme change)", () => {
        const map = makeMap();
        applyState({ lat: 48, lng: 2, zoom: 10, layers: ["layer-hidden"] }, map);

        // Simulate framework firing geoleaf:theme:applied
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(mockSetVisibility).toHaveBeenCalledWith("layer-hidden", false, "user");
    });

    test("shows shownLayers on geoleaf:theme:applied (layer already loaded)", () => {
        // Layer is already registered in GeoJSONShared → setVisibility called direct.
        mockLayersMap.set("L-forced-visible", { _visibility: {} });
        const map = makeMap();
        applyState({ lat: 48, lng: 2, zoom: 10, shownLayers: ["L-forced-visible"] }, map);

        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(mockSetVisibility).toHaveBeenCalledWith("L-forced-visible", true, "user");
        mockLayersMap.delete("L-forced-visible");
    });

    test("lazy-loads shown layer missing from active theme (gl_shown bug fix)", async () => {
        // Layer is in the profile but NOT loaded by the active theme — must be
        // fetched via ThemeApplierCore._loadLayerFromProfile before applying
        // the user-override. Without this fallback, copy/pasting a URL with
        // `gl_shown=...` would silently drop the layer.
        mockLoadLayerFromProfile.mockClear();
        mockLoadLayerFromProfile.mockResolvedValue(true);
        const map = makeMap();
        applyState({ lat: 48, lng: 2, zoom: 10, shownLayers: ["L-lazy"] }, map);
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(mockLoadLayerFromProfile).toHaveBeenCalledWith("L-lazy");
        // setVisibility is called once the promise resolves
        await Promise.resolve();
        await Promise.resolve();
        expect(mockSetVisibility).toHaveBeenCalledWith("L-lazy", true, "user");
    });

    test("applies both hidden and shown layers", () => {
        mockLayersMap.set("L-shown", { _visibility: {} });
        const map = makeMap();
        applyState(
            {
                lat: 48,
                lng: 2,
                zoom: 10,
                layers: ["L-hidden"],
                shownLayers: ["L-shown"],
            },
            map
        );

        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(mockSetVisibility).toHaveBeenCalledWith("L-hidden", false, "user");
        expect(mockSetVisibility).toHaveBeenCalledWith("L-shown", true, "user");
        mockLayersMap.delete("L-shown");
    });

    test("delegates filter restore to GeoLeaf.Filter.applyFilter on geoleaf:theme:applied", () => {
        // S13: permalink no longer scrapes/ghost-injects the DOM — it maps the decoded
        // state to the Filter capability's serialisation contract and delegates.
        // The panel must be MOUNTED for the delegation to fire on theme:applied:
        // `applyFilter()` writes onto the real controls, so an unmounted panel defers
        // the apply to `geoleaf:app:ready` (see the dedicated test below).
        document.body.appendChild(
            Object.assign(document.createElement("div"), { id: "gl-filter-panel" })
        );
        const applyFilter = vi.fn();
        globalThis.GeoLeaf.Filter = {
            getConfig: () => ({
                fields: [
                    { id: "searchText", kind: "text" },
                    { id: "categories", kind: "taxonomy" },
                    { id: "tags", kind: "tag" },
                    { id: "minRating", kind: "range" },
                ],
            }),
            applyFilter,
        };

        const map = makeMap();
        applyState(
            {
                lat: 48,
                lng: 2,
                zoom: 10,
                filter: "pizza",
                categories: ["cat-1"],
                tags: ["free"],
                rating: 4,
            },
            map
        );
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(applyFilter).toHaveBeenCalledTimes(1);
        expect(applyFilter).toHaveBeenCalledWith({
            fields: [
                { id: "searchText", kind: "text", text: "pizza" },
                { id: "categories", kind: "taxonomy", values: ["cat-1"] },
                { id: "tags", kind: "tag", values: ["free"] },
                { id: "minRating", kind: "range", range: { min: 4 } },
            ],
        });
        document.getElementById("gl-filter-panel")?.remove();
    });

    test("waits for geoleaf:app:ready when the filter panel is not mounted yet", () => {
        // Boot ordering: `applyState` registers its restore on `geoleaf:theme:applied`,
        // and `app/init-reveal.ts` registers `revealApp` on the SAME event AFTER it.
        // `revealApp` is what dispatches `geoleaf:app:ready`, on which
        // `capabilities/filter/lifecycle.ts` MOUNTS the panel. Applying on
        // theme:applied therefore wrote onto a null panel and the write was dropped
        // (deep link filtered the sources but left the search box empty).
        const applyFilter = vi.fn();
        globalThis.GeoLeaf.Filter = {
            getConfig: () => ({ fields: [{ id: "searchText", kind: "text" }] }),
            applyFilter,
        };

        applyState({ lat: 48, lng: 2, zoom: 10, filter: "montagne" }, makeMap());

        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        expect(applyFilter).not.toHaveBeenCalled(); // panel absent → deferred

        // The Filter capability mounts its panel on app:ready, before this listener.
        document.body.appendChild(
            Object.assign(document.createElement("div"), { id: "gl-filter-panel" })
        );
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(applyFilter).toHaveBeenCalledTimes(1);
        expect(applyFilter).toHaveBeenCalledWith({
            fields: [{ id: "searchText", kind: "text", text: "montagne" }],
        });
        document.getElementById("gl-filter-panel")?.remove();
    });

    test("skips filter restore gracefully when GeoLeaf.Filter is absent", () => {
        delete globalThis.GeoLeaf.Filter;
        const map = makeMap();
        expect(() => {
            applyState({ lat: 48, lng: 2, zoom: 10, filter: "x" }, map);
            document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        }).not.toThrow();
    });

    test("waits for geoleaf:themes:ready when theme change needed, then fires on theme:applied", () => {
        mockGetCurrentTheme.mockReturnValue("light"); // current theme is different

        const map = makeMap();
        applyState({ lat: 48, lng: 2, zoom: 10, layers: ["L1"], theme: "dark" }, map);

        // Fire geoleaf:themes:ready
        document.dispatchEvent(new CustomEvent("geoleaf:themes:ready"));
        // setTheme should be called
        expect(mockSetTheme).toHaveBeenCalledWith("dark");
        // layers/filter should NOT be applied yet (waiting for theme:applied)
        expect(mockSetVisibility).not.toHaveBeenCalled();

        // Now fire geoleaf:theme:applied
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        expect(mockSetVisibility).toHaveBeenCalledWith("L1", false, "user");
    });

    test("applies layers directly when current theme already matches (no setTheme call)", () => {
        mockGetCurrentTheme.mockReturnValue("dark"); // already correct

        const map = makeMap();
        applyState({ lat: 48, lng: 2, zoom: 10, layers: ["L2"], theme: "dark" }, map);

        document.dispatchEvent(new CustomEvent("geoleaf:themes:ready"));
        // setTheme NOT called — already correct
        expect(mockSetTheme).not.toHaveBeenCalled();
        // But layers should still be applied immediately
        expect(mockSetVisibility).toHaveBeenCalledWith("L2", false, "user");
    });

    test("handles missing VisibilityManager gracefully (throws caught)", () => {
        mockSetVisibility.mockImplementation(() => {
            throw new Error("not ready");
        });
        const map = makeMap();
        applyState({ lat: 48, lng: 2, zoom: 10, layers: ["L-fail"] }, map);
        expect(() =>
            document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"))
        ).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  startSync
// ─────────────────────────────────────────────────────────────────────────────
describe("startSync", () => {
    beforeEach(() => {
        mockGetCenter.mockReturnValue({ lat: 48.857, lng: 2.347 });
        mockGetZoom.mockReturnValue(12);
        document.body.innerHTML = "";
        mockLayersMap.clear();
        globalThis.GeoLeaf = {
            ThemeSelector: {
                getCurrentTheme: mockGetCurrentTheme,
            },
        };
        vi.spyOn(history, "replaceState").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("attaches moveend listener to map", () => {
        const map = makeMap();
        startSync(map, defaultConfig);
        expect(map.on).toHaveBeenCalledWith("moveend", expect.any(Function));
    });

    test("writes URL hash on moveend after debounce delay", async () => {
        vi.useFakeTimers();
        const map = makeMap();
        startSync(map, defaultConfig);

        // Retrieve the debounced moveend handler
        const moveendCall = map.on.mock.calls.find(([event]) => event === "moveend");
        const handler = moveendCall[1];

        // Simulate map moveend
        handler();
        // Should not write yet (debouncing)
        expect(history.replaceState).not.toHaveBeenCalled();

        // Advance past debounce (400ms)
        vi.advanceTimersByTime(450);
        expect(history.replaceState).toHaveBeenCalled();

        vi.useRealTimers();
    });

    test("rapid moveend events result in single URL write (debounce collapse)", async () => {
        vi.useFakeTimers();
        const map = makeMap();
        startSync(map, defaultConfig);

        const moveendCall = map.on.mock.calls.find(([event]) => event === "moveend");
        const handler = moveendCall[1];

        // Fire 5 rapid events within debounce window
        handler();
        vi.advanceTimersByTime(100);
        handler();
        vi.advanceTimersByTime(100);
        handler();
        vi.advanceTimersByTime(100);
        handler();
        vi.advanceTimersByTime(100);
        handler();

        // Still not written yet (last event < 400ms ago)
        expect(history.replaceState).not.toHaveBeenCalled();

        // Advance past debounce
        vi.advanceTimersByTime(450);
        // Only ONE write (debounce collapsed to last call)
        expect(history.replaceState).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    test("writes URL in query mode when config.mode = query", async () => {
        vi.useFakeTimers();
        const map = makeMap();
        startSync(map, { mode: "query" });

        const handler = map.on.mock.calls.find(([e]) => e === "moveend")[1];
        handler();
        vi.advanceTimersByTime(500);

        const [, , url] = history.replaceState.mock.calls[0];
        // jsdom location.pathname is '/' so the URL is /<pathname>?<params>
        expect(url).toMatch(/\?gl_/);

        vi.useRealTimers();
    });

    test("attaches geoleaf:geojson:visibility-changed listener to document", () => {
        const addEventSpy = vi.spyOn(document, "addEventListener");
        const map = makeMap();
        startSync(map, defaultConfig);
        expect(addEventSpy).toHaveBeenCalledWith(
            "geoleaf:geojson:visibility-changed",
            expect.any(Function)
        );
    });

    test("attaches geoleaf:filters:applied listener to document", () => {
        const addEventSpy = vi.spyOn(document, "addEventListener");
        const map = makeMap();
        startSync(map, defaultConfig);
        expect(addEventSpy).toHaveBeenCalledWith("geoleaf:filters:applied", expect.any(Function));
    });

    test("attaches geoleaf:theme:applied listener to document", () => {
        const addEventSpy = vi.spyOn(document, "addEventListener");
        const map = makeMap();
        startSync(map, defaultConfig);
        expect(addEventSpy).toHaveBeenCalledWith("geoleaf:theme:applied", expect.any(Function));
    });

    test("visibility event triggers URL write with short debounce (~50ms)", async () => {
        vi.useFakeTimers();
        const map = makeMap();
        startSync(map, defaultConfig);

        document.dispatchEvent(new CustomEvent("geoleaf:geojson:visibility-changed"));

        // Should NOT have written within 30ms
        vi.advanceTimersByTime(30);
        expect(history.replaceState).not.toHaveBeenCalled();

        // Should write after 50ms+
        vi.advanceTimersByTime(30);
        expect(history.replaceState).toHaveBeenCalled();

        vi.useRealTimers();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  _captureState (tested indirectly via startSync + moveend flush)
// ─────────────────────────────────────────────────────────────────────────────
describe("_captureState (via startSync)", () => {
    beforeEach(() => {
        mockGetCenter.mockReturnValue({ lat: 48.123, lng: 2.456 });
        mockGetZoom.mockReturnValue(14);
        mockLayersMap.clear();
        document.body.innerHTML = "";
        globalThis.GeoLeaf = {
            ThemeSelector: { getCurrentTheme: vi.fn(() => null) },
        };
        vi.spyOn(history, "replaceState").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("written URL includes current center and zoom", async () => {
        vi.useFakeTimers();
        const map = makeMap();
        startSync(map, defaultConfig);
        const handler = map.on.mock.calls.find(([e]) => e === "moveend")[1];
        handler();
        vi.advanceTimersByTime(500);

        const url = history.replaceState.mock.calls[0][2];
        expect(url).toContain("gl_lat=48.123000");
        expect(url).toContain("gl_lng=2.456000");
        expect(url).toContain("gl_zoom=14");

        vi.useRealTimers();
    });

    test("captures hidden layers (userOverride=true, logicalState=false)", async () => {
        vi.useFakeTimers();
        // Add a user-hidden layer
        mockLayersMap.set("L-user-hidden", {
            _visibility: { userOverride: true, logicalState: false },
        });

        const map = makeMap();
        startSync(map, defaultConfig);
        const handler = map.on.mock.calls.find(([e]) => e === "moveend")[1];
        handler();
        vi.advanceTimersByTime(500);

        const url = history.replaceState.mock.calls[0][2];
        expect(url).toContain("gl_layers=L-user-hidden");

        vi.useRealTimers();
    });

    test("does not include layers set to default visibility (no userOverride)", async () => {
        vi.useFakeTimers();
        mockLayersMap.set("L-default", {
            _visibility: { userOverride: false, logicalState: true },
        });

        const map = makeMap();
        startSync(map, defaultConfig);
        const handler = map.on.mock.calls.find(([e]) => e === "moveend")[1];
        handler();
        vi.advanceTimersByTime(500);

        const url = history.replaceState.mock.calls[0][2];
        expect(url).not.toContain("gl_layers=L-default");

        vi.useRealTimers();
    });

    test("captures filter text via GeoLeaf.Filter.getActiveFilter", async () => {
        vi.useFakeTimers();
        // S13: capture reads the Filter capability's serialised state, not the DOM.
        globalThis.GeoLeaf.Filter = {
            getActiveFilter: () => ({
                fields: [{ id: "searchText", kind: "text", text: "montmartre" }],
            }),
        };

        const map = makeMap();
        startSync(map, defaultConfig);
        const handler = map.on.mock.calls.find(([e]) => e === "moveend")[1];
        handler();
        vi.advanceTimersByTime(500);

        const url = history.replaceState.mock.calls[0][2];
        expect(url).toContain("gl_filter=montmartre");

        vi.useRealTimers();
    });

    test("captures current theme from GeoLeaf.ThemeSelector", async () => {
        vi.useFakeTimers();
        globalThis.GeoLeaf.ThemeSelector.getCurrentTheme = vi.fn(() => "night");

        const map = makeMap();
        startSync(map, defaultConfig);
        const handler = map.on.mock.calls.find(([e]) => e === "moveend")[1];
        handler();
        vi.advanceTimersByTime(500);

        const url = history.replaceState.mock.calls[0][2];
        expect(url).toContain("gl_theme=night");

        vi.useRealTimers();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe("edge cases", () => {
    test("readUrl returns null when no URL params present (clean URL)", () => {
        // jsdom starts with http://localhost/ — no params
        const result = readUrl({ mode: "hash" });
        expect(result).toBeNull();
    });

    test("applyState does not throw when document is unavailable shim", () => {
        const map = makeMap();
        // Only coords — no deferred state → returns before document access
        expect(() => applyState({ lat: 0, lng: 0, zoom: 1 }, map)).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  startSync teardown (listener leak fix)
// ─────────────────────────────────────────────────────────────────────────────
describe("startSync teardown", () => {
    test("returns a teardown that detaches moveend + every document listener", () => {
        const map = makeMap();
        const addSpy = vi.spyOn(document, "addEventListener");
        const removeSpy = vi.spyOn(document, "removeEventListener");

        const stop = startSync(map, defaultConfig);
        expect(typeof stop).toBe("function");

        const moveHandler = map.on.mock.calls.find((c) => c[0] === "moveend")[1];
        const docEvents = [
            "geoleaf:geojson:visibility-changed",
            "geoleaf:filters:applied",
            "geoleaf:theme:applied",
        ];

        stop();

        // moveend detached with the exact handler reference it was attached with.
        expect(map.off).toHaveBeenCalledWith("moveend", moveHandler);
        // each document listener removed with the same reference used to add it.
        for (const evt of docEvents) {
            const addedWith = addSpy.mock.calls.find((c) => c[0] === evt)[1];
            expect(removeSpy).toHaveBeenCalledWith(evt, addedWith);
        }

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });
});
