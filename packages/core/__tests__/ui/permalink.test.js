/**
 *
 * Unit tests for the Permalink module (§1.3):
 *   - permalink-sync: readUrl, buildUrl, applyState, startSync
 *   - permalink-api: Permalink facade (init, readAndStore, applyStoredState, startSync, getState, buildUrl)
 *
 * Uses static ESM imports + vi.hoisted() so mock objects are available
 * both in vi.mock() factory functions and in test assertions.
 */

// ── Hoisted mock objects (available before vi.mock factories run) ──────────────

const { mockLog, mockVisibilityManager, mockGeoJSONShared } = vi.hoisted(() => ({
    mockLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockVisibilityManager: {
        setVisibility: vi.fn(),
        getVisibilityState: vi.fn(),
    },
    mockGeoJSONShared: {
        state: { layers: new Map() },
    },
}));

// ── vi.mock declarations (hoisted to top by Vitest) ───────────────────────────

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

// B.12 — complet par construction (voir security/permalink-injection.test.js).
vi.mock("../../src/kernel/security/index.js", async (importActual) => ({
    ...(await importActual()),
    /**
     * Lightweight in-test replica of validateCoordinates.
     * Mirrors the range-check logic in security/index.ts.
     */
    validateCoordinates(lat, lng) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng))
            throw new RangeError("Coordinates must be finite");
        if (lat < -90 || lat > 90) throw new RangeError(`Latitude out of range: ${lat}`);
        if (lng < -180 || lng > 180) throw new RangeError(`Longitude out of range: ${lng}`);
        return [lat, lng];
    },
    validateNumber(value, min = -Infinity, max = Infinity) {
        const num = Number(value);
        if (!Number.isFinite(num) || num < min || num > max) return null;
        return num;
    },
}));

vi.mock("../../src/kernel/geojson/visibility-manager.js", () => ({
    VisibilityManager: mockVisibilityManager,
}));

vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: mockGeoJSONShared,
}));

// ── Static ESM imports ────────────────────────────────────────────────────────

import {
    readUrl,
    buildUrl,
    applyState,
    startSync,
} from "../../src/capabilities/permalink/permalink-sync.js";
import { Permalink } from "../../src/capabilities/permalink/public-api.js";
import { DEFAULT_PERMALINK_FIELDS } from "../../src/capabilities/permalink/constants.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setHash(hash) {
    Object.defineProperty(window, "location", {
        value: { ...window.location, hash },
        writable: true,
    });
}

function setSearch(search) {
    Object.defineProperty(window, "location", {
        value: { ...window.location, search },
        writable: true,
    });
}

function makeMap(lat = 48.857, lng = 2.347, zoom = 12) {
    return {
        getCenter: () => ({ lat, lng }),
        getZoom: () => zoom,
        setView: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    };
}

// ── readUrl ───────────────────────────────────────────────────────────────────

describe("readUrl()", () => {
    afterEach(() => {
        setHash("");
        setSearch("");
    });

    it("returns null when hash is empty", () => {
        setHash("");
        expect(readUrl({ mode: "hash" })).toBeNull();
    });

    it("returns null when hash has no gl_lat param", () => {
        setHash("#unrelated=value");
        expect(readUrl({ mode: "hash" })).toBeNull();
    });

    it("parses a valid hash state", () => {
        setHash("#gl_lat=48.857&gl_lng=2.347&gl_zoom=12");
        const state = readUrl({ mode: "hash" });
        expect(state).not.toBeNull();
        expect(state.lat).toBeCloseTo(48.857, 3);
        expect(state.lng).toBeCloseTo(2.347, 3);
        expect(state.zoom).toBe(12);
    });

    it("returns null for out-of-range latitude", () => {
        setHash("#gl_lat=99&gl_lng=2.347&gl_zoom=12");
        expect(readUrl({ mode: "hash" })).toBeNull();
    });

    it("returns null for out-of-range longitude", () => {
        setHash("#gl_lat=48.857&gl_lng=200&gl_zoom=12");
        expect(readUrl({ mode: "hash" })).toBeNull();
    });

    it("returns null for non-numeric latitude (XSS attempt)", () => {
        setHash("#gl_lat=<script>alert(1)</script>&gl_lng=2&gl_zoom=12");
        expect(readUrl({ mode: "hash" })).toBeNull();
    });

    it("returns null for NaN values", () => {
        setHash("#gl_lat=NaN&gl_lng=2.347&gl_zoom=12");
        expect(readUrl({ mode: "hash" })).toBeNull();
    });

    it("parses optional layers field", () => {
        setHash("#gl_lat=48.857&gl_lng=2.347&gl_zoom=12&gl_layers=layer1,layer2");
        const state = readUrl({ mode: "hash", fields: ["lat", "lng", "zoom", "layers"] });
        expect(state.layers).toEqual(["layer1", "layer2"]);
    });

    it("parses optional filter field", () => {
        setHash("#gl_lat=48.857&gl_lng=2.347&gl_zoom=12&gl_filter=cafe");
        const state = readUrl({ mode: "hash", fields: ["lat", "lng", "zoom", "filter"] });
        expect(state.filter).toBe("cafe");
    });

    it("parses query mode", () => {
        setSearch("?gl_lat=44.0&gl_lng=3.5&gl_zoom=10");
        const state = readUrl({ mode: "query" });
        expect(state).not.toBeNull();
        expect(state.lat).toBeCloseTo(44.0, 1);
    });

    it("parses compact mode (base64 JSON)", () => {
        const payload = btoa(JSON.stringify({ lat: 48.857, lng: 2.347, zoom: 12 }));
        setHash(`#gl=${payload}`);
        const state = readUrl({ mode: "compact" });
        expect(state).not.toBeNull();
        expect(state.lat).toBeCloseTo(48.857, 3);
        expect(state.zoom).toBe(12);
    });

    it("returns null for malformed base64 in compact mode", () => {
        setHash("#gl=notbase64!!!");
        expect(readUrl({ mode: "compact" })).toBeNull();
    });

    it("caps layers list at 100 entries", () => {
        const layers = Array.from({ length: 150 }, (_, i) => `layer_${i}`).join(",");
        setHash(`#gl_lat=48.857&gl_lng=2.347&gl_zoom=12&gl_layers=${layers}`);
        const state = readUrl({ mode: "hash", fields: ["lat", "lng", "zoom", "layers"] });
        expect(state.layers.length).toBe(100);
    });

    it("caps filter text at 200 characters", () => {
        const longFilter = "a".repeat(300);
        setHash(`#gl_lat=48.857&gl_lng=2.347&gl_zoom=12&gl_filter=${longFilter}`);
        const state = readUrl({ mode: "hash", fields: ["lat", "lng", "zoom", "filter"] });
        expect(state.filter.length).toBe(200);
    });
});

// ── buildUrl ──────────────────────────────────────────────────────────────────

describe("buildUrl()", () => {
    const baseState = { lat: 48.857, lng: 2.347, zoom: 12 };

    it("returns empty string for null state", () => {
        expect(buildUrl(null, {})).toBe("");
    });

    it("produces a hash fragment by default", () => {
        const url = buildUrl(baseState, { mode: "hash" });
        expect(url).toMatch(/^#/);
        expect(url).toContain("gl_lat=");
        expect(url).toContain("gl_lng=");
        expect(url).toContain("gl_zoom=");
    });

    it("produces a query string in query mode", () => {
        const url = buildUrl(baseState, { mode: "query" });
        expect(url).toMatch(/^\?/);
    });

    it("produces base64 compact format in compact mode", () => {
        const url = buildUrl(baseState, { mode: "compact" });
        expect(url).toMatch(/^#gl=/);
        // The value should be valid base64 that decodes to JSON
        const b64 = url.replace("#gl=", "");
        const decoded = JSON.parse(atob(b64));
        expect(decoded.lat).toBeCloseTo(48.857, 3);
    });

    it("auto-compacts when param string exceeds 200 chars (many layers)", () => {
        const manyLayers = Array.from({ length: 20 }, (_, i) => `very-long-layer-name-${i}`);
        const state = { ...baseState, layers: manyLayers };
        const url = buildUrl(state, { mode: "hash" });
        // Should be compact when verbose URL would be > 200 chars
        expect(url).toMatch(/^#gl=/);
    });

    it("includes layers when fields contain 'layers'", () => {
        const state = { ...baseState, layers: ["alpha", "beta"] };
        const url = buildUrl(state, { mode: "hash", fields: ["lat", "lng", "zoom", "layers"] });
        expect(url).toContain("gl_layers=alpha%2Cbeta");
    });

    it("omits layers when 'layers' not in fields", () => {
        const state = { ...baseState, layers: ["alpha"] };
        const url = buildUrl(state, { mode: "hash", fields: ["lat", "lng", "zoom"] });
        expect(url).not.toContain("gl_layers");
    });

    it("rounds lat/lng to 6 decimal places", () => {
        const state = { lat: 48.12345678, lng: 2.98765432, zoom: 10 };
        const url = buildUrl(state, { mode: "hash" });
        expect(url).toContain("gl_lat=48.123457");
        expect(url).toContain("gl_lng=2.987654");
    });
});

// ── applyState ────────────────────────────────────────────────────────────────

describe("applyState()", () => {
    beforeEach(() => {
        mockVisibilityManager.setVisibility.mockClear();
    });

    it("calls map.setView with the stored lat/lng/zoom", () => {
        const map = makeMap();
        applyState({ lat: 45.0, lng: 3.0, zoom: 10 }, map);
        expect(map.setView).toHaveBeenCalledWith({ lat: 45, lng: 3 }, 10);
    });

    it("defers layer visibility to geoleaf:theme:applied", () => {
        const map = makeMap();
        applyState({ lat: 45.0, lng: 3.0, zoom: 10, layers: ["layerX"] }, map);

        // Not called yet (deferred)
        expect(mockVisibilityManager.setVisibility).not.toHaveBeenCalled();

        // Simulate theme:applied event
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        expect(mockVisibilityManager.setVisibility).toHaveBeenCalledWith("layerX", false, "user");
    });

    it("defers filter application to geoleaf:theme:applied (delegates to GeoLeaf.Filter)", () => {
        // S13: applyState maps the decoded state to the Filter capability's contract
        // and delegates on theme:applied — no DOM ghost injection. The panel must be
        // MOUNTED: `applyFilter()` writes onto the real controls, so an unmounted panel
        // defers the apply to `geoleaf:app:ready` (permalink-sync.test.js covers it).
        document.body.appendChild(
            Object.assign(document.createElement("div"), { id: "gl-filter-panel" })
        );
        const applyFilter = vi.fn();
        globalThis.GeoLeaf = {
            Filter: {
                getConfig: () => ({ fields: [{ id: "searchText", kind: "text" }] }),
                applyFilter,
            },
        };

        const map = makeMap();
        applyState({ lat: 45.0, lng: 3.0, zoom: 10, filter: "restaurant" }, map);

        // Before theme:applied — deferred
        expect(applyFilter).not.toHaveBeenCalled();

        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        // After theme:applied — delegated with the mapped state
        expect(applyFilter).toHaveBeenCalledWith({
            fields: [{ id: "searchText", kind: "text", text: "restaurant" }],
        });
        document.getElementById("gl-filter-panel")?.remove();
    });
});

// ── startSync ─────────────────────────────────────────────────────────────────

describe("startSync()", () => {
    it("attaches a moveend listener to the map", () => {
        const map = makeMap();
        startSync(map, { mode: "hash" });
        expect(map.on).toHaveBeenCalledWith("moveend", expect.any(Function));
    });
});

// ── Permalink facade ───────────────────────────────────────────────────────────

describe("Permalink facade", () => {
    beforeEach(() => {
        Permalink._reset();
        setHash("");
    });

    it("getState() returns null before readAndStore", () => {
        Permalink.init({ mode: "hash" });
        expect(Permalink.getState()).toBeNull();
    });

    it("readAndStore() caches parsed state", () => {
        setHash("#gl_lat=48.857&gl_lng=2.347&gl_zoom=12");
        Permalink.init({ mode: "hash" });
        Permalink.readAndStore();
        const state = Permalink.getState();
        expect(state).not.toBeNull();
        expect(state.zoom).toBe(12);
    });

    it("getState() returns null when URL has no permalink", () => {
        setHash("#other=stuff");
        Permalink.init({ mode: "hash" });
        Permalink.readAndStore();
        expect(Permalink.getState()).toBeNull();
    });

    it("buildUrl() delegates to buildUrl with stored state", () => {
        setHash("#gl_lat=48.857&gl_lng=2.347&gl_zoom=12");
        Permalink.init({ mode: "hash" });
        Permalink.readAndStore();
        const url = Permalink.buildUrl();
        expect(url).toContain("gl_lat=");
    });

    it("buildUrl() returns empty string when state is null", () => {
        Permalink.init({ mode: "hash" });
        expect(Permalink.buildUrl()).toBe("");
    });

    it("applyStoredState() calls map.setView when state exists", () => {
        setHash("#gl_lat=44.0&gl_lng=5.0&gl_zoom=8");
        Permalink.init({ mode: "hash" });
        Permalink.readAndStore();
        const map = makeMap();
        Permalink.applyStoredState(map);
        expect(map.setView).toHaveBeenCalledWith({ lat: 44, lng: 5 }, 8);
    });

    it("applyStoredState() is a no-op when state is null", () => {
        Permalink.init({ mode: "hash" });
        const map = makeMap();
        Permalink.applyStoredState(map);
        expect(map.setView).not.toHaveBeenCalled();
    });

    it("startSync() attaches moveend listener", () => {
        Permalink.init({ mode: "hash" });
        const map = makeMap();
        Permalink.startSync(map);
        expect(map.on).toHaveBeenCalledWith("moveend", expect.any(Function));
    });
});

// ── _captureState via startSync + DOM events (debounce exercised with fake timers) ──

describe("_captureState (via startSync + vi.useFakeTimers)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setHash("");
        mockGeoJSONShared.state.layers.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
        setHash("");
        mockGeoJSONShared.state.layers.clear();
        delete globalThis.GeoLeaf;
    });

    it("captures state and calls history.replaceState after geoleaf:filters:applied (hash mode)", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        const map = makeMap(48.857, 2.347, 12);
        map.on = vi.fn();
        startSync(map, { mode: "hash" });
        document.dispatchEvent(new CustomEvent("geoleaf:filters:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        replaceState.mockRestore();
    });

    it("captures state in query mode (writes pathname+?...)", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        const map = makeMap(48.857, 2.347, 12);
        map.on = vi.fn();
        startSync(map, { mode: "query" });
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        replaceState.mockRestore();
    });

    it("captures state after geoleaf:geojson:visibility-changed", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        const map = makeMap(48.857, 2.347, 12);
        map.on = vi.fn();
        startSync(map, { mode: "hash" });
        document.dispatchEvent(new CustomEvent("geoleaf:geojson:visibility-changed"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        replaceState.mockRestore();
    });

    it("captures hidden layers from GeoJSONShared.state.layers (layers field)", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        mockGeoJSONShared.state.layers.set("hidden-layer", {
            _visibility: { userOverride: true, logicalState: false },
        });
        const map = makeMap(48.0, 2.0, 10);
        map.on = vi.fn();
        startSync(map, { mode: "hash", fields: ["lat", "lng", "zoom", "layers"] });
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        const callArg = replaceState.mock.calls[0][2];
        expect(callArg).toContain("gl_layers=");
        replaceState.mockRestore();
    });

    it("captures shown layers from GeoJSONShared.state.layers (shownLayers field)", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        mockGeoJSONShared.state.layers.set("shown-layer", {
            _visibility: { userOverride: true, logicalState: true },
        });
        const map = makeMap(48.0, 2.0, 10);
        map.on = vi.fn();
        startSync(map, { mode: "hash", fields: ["lat", "lng", "zoom", "shownLayers"] });
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        replaceState.mockRestore();
    });

    it("_captureState: layers.forEach throws → catch silenced, replaceState still called", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        const original = mockGeoJSONShared.state.layers;
        mockGeoJSONShared.state.layers = {
            forEach: () => {
                throw new Error("simulated");
            },
        };
        const map = makeMap(48.0, 2.0, 10);
        map.on = vi.fn();
        startSync(map, { mode: "hash", fields: ["lat", "lng", "zoom", "layers", "shownLayers"] });
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        mockGeoJSONShared.state.layers = original;
        replaceState.mockRestore();
    });

    it("captures filter text via GeoLeaf.Filter.getActiveFilter", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        globalThis.GeoLeaf = {
            ...(globalThis.GeoLeaf || {}),
            Filter: {
                getActiveFilter: () => ({
                    fields: [{ id: "searchText", kind: "text", text: "café" }],
                }),
            },
        };

        const map = makeMap(48.0, 2.0, 10);
        map.on = vi.fn();
        startSync(map, { mode: "hash", fields: ["lat", "lng", "zoom", "filter"] });
        document.dispatchEvent(new CustomEvent("geoleaf:filters:applied"));
        vi.advanceTimersByTime(55);

        expect(replaceState).toHaveBeenCalled();
        const callArg = replaceState.mock.calls[0][2];
        expect(callArg).toContain("gl_filter=");
        replaceState.mockRestore();
    });

    it("captures category checkboxes from #gl-filter-panel", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        const panel = document.createElement("div");
        panel.id = "gl-filter-panel";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "gl-filter-tree__checkbox--category";
        cb.value = "cafe";
        cb.checked = true;
        panel.appendChild(cb);
        document.body.appendChild(panel);

        const map = makeMap(48.0, 2.0, 10);
        map.on = vi.fn();
        startSync(map, { mode: "hash", fields: ["lat", "lng", "zoom", "categories"] });
        document.dispatchEvent(new CustomEvent("geoleaf:filters:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        document.body.removeChild(panel);
        replaceState.mockRestore();
    });

    it("captures tag badges from #gl-filter-panel", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        const panel = document.createElement("div");
        panel.id = "gl-filter-panel";
        const badge = document.createElement("span");
        badge.className = "gl-filter-panel__tag-badge gl-is-selected";
        badge.setAttribute("data-tag-value", "vegan");
        panel.appendChild(badge);
        document.body.appendChild(panel);

        const map = makeMap(48.0, 2.0, 10);
        map.on = vi.fn();
        startSync(map, { mode: "hash", fields: ["lat", "lng", "zoom", "tags"] });
        document.dispatchEvent(new CustomEvent("geoleaf:filters:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        document.body.removeChild(panel);
        replaceState.mockRestore();
    });

    it("captures rating from #gl-filter-panel range input (value > 0)", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        const panel = document.createElement("div");
        panel.id = "gl-filter-panel";
        const rw = document.createElement("div");
        rw.setAttribute("data-gl-filter-id", "minRating");
        const ri = document.createElement("input");
        ri.type = "range";
        ri.value = "3";
        rw.appendChild(ri);
        panel.appendChild(rw);
        document.body.appendChild(panel);

        const map = makeMap(48.0, 2.0, 10);
        map.on = vi.fn();
        startSync(map, { mode: "hash", fields: ["lat", "lng", "zoom", "rating"] });
        document.dispatchEvent(new CustomEvent("geoleaf:filters:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        document.body.removeChild(panel);
        replaceState.mockRestore();
    });

    it("captures theme from GeoLeaf.ThemeSelector.getCurrentTheme()", () => {
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});
        globalThis.GeoLeaf = { ThemeSelector: { getCurrentTheme: vi.fn(() => "dark") } };
        const map = makeMap(48.0, 2.0, 10);
        map.on = vi.fn();
        startSync(map, { mode: "hash", fields: ["lat", "lng", "zoom", "theme"] });
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();
        replaceState.mockRestore();
    });

    it("_captureState: _pendingCategoriesState fallback fills missing DOM state", () => {
        // Simulate a scenario where DOM checkboxes are not yet hydrated but
        // _pendingCategoriesState is populated (ghost-timeout gap).
        // We can't set _pendingCategoriesState directly, but applyState sets it.
        // Use applyState to populate it, then immediately trigger startSync writeUrl.
        const replaceState = vi.spyOn(history, "replaceState").mockImplementation(() => {});

        const panel = document.createElement("div");
        panel.id = "gl-filter-panel";
        document.body.appendChild(panel);

        const map = makeMap(48.0, 2.0, 10);
        map.on = vi.fn();

        // applyState sets _pendingCategoriesState and registers theme:applied listener
        applyState({ lat: 48.0, lng: 2.0, zoom: 10, categories: ["cat1"] }, map);
        // Fire theme:applied → _applyLayersAndFilter runs, sets _pendingCategoriesState
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        // Now start sync with categories field so _captureState reads _pendingCategoriesState
        startSync(map, { mode: "hash", fields: ["lat", "lng", "zoom", "categories"] });
        document.dispatchEvent(new CustomEvent("geoleaf:filters:applied"));
        vi.advanceTimersByTime(55);
        expect(replaceState).toHaveBeenCalled();

        document.body.removeChild(panel);
        replaceState.mockRestore();
    });
});

// ── applyState — additional branches (shownLayers, categories, tags, rating, theme) ──

describe("applyState() — shownLayers branch", () => {
    beforeEach(() => {
        mockVisibilityManager.setVisibility.mockClear();
    });

    it("applies shownLayers via VisibilityManager.setVisibility(id, true, 'user')", () => {
        // restoreShownLayer checks GeoJSONShared.state.layers first; populate it so
        // VisibilityManager.setVisibility is called on the synchronous path.
        mockGeoJSONShared.state.layers.set("shownX", { visible: false });
        mockGeoJSONShared.state.layers.set("shownY", { visible: false });
        const map = makeMap();
        applyState({ lat: 45.0, lng: 3.0, zoom: 10, shownLayers: ["shownX", "shownY"] }, map);
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        expect(mockVisibilityManager.setVisibility).toHaveBeenCalledWith("shownX", true, "user");
        expect(mockVisibilityManager.setVisibility).toHaveBeenCalledWith("shownY", true, "user");
        mockGeoJSONShared.state.layers.clear();
    });

    it("shownLayers VisibilityManager.setVisibility throws → error is silenced", () => {
        mockVisibilityManager.setVisibility.mockImplementationOnce(() => {
            throw new Error("no layer");
        });
        const map = makeMap();
        expect(() => {
            applyState({ lat: 45.0, lng: 3.0, zoom: 10, shownLayers: ["noExist"] }, map);
            document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        }).not.toThrow();
    });
});

describe("applyState() — theme branch", () => {
    afterEach(() => {
        delete globalThis.GeoLeaf;
    });

    it("applies theme: calls ThemeSelector.setTheme when theme differs from current", () => {
        const mockThemeSelector = {
            getCurrentTheme: vi.fn(() => "light"),
            setTheme: vi.fn(() => Promise.resolve()),
        };
        globalThis.GeoLeaf = { ThemeSelector: mockThemeSelector };
        const map = makeMap();
        applyState({ lat: 45.0, lng: 3.0, zoom: 10, theme: "dark" }, map);
        document.dispatchEvent(new CustomEvent("geoleaf:themes:ready"));
        expect(mockThemeSelector.setTheme).toHaveBeenCalledWith("dark");
    });

    it("applies theme: _applyLayersAndFilter called directly when theme already matches", () => {
        const mockThemeSelector = {
            getCurrentTheme: vi.fn(() => "dark"),
            setTheme: vi.fn(() => Promise.resolve()),
        };
        globalThis.GeoLeaf = { ThemeSelector: mockThemeSelector };
        mockVisibilityManager.setVisibility.mockClear();
        const map = makeMap();
        applyState({ lat: 45.0, lng: 3.0, zoom: 10, theme: "dark", layers: ["hiddenL"] }, map);
        document.dispatchEvent(new CustomEvent("geoleaf:themes:ready"));
        // Theme already correct → _applyLayersAndFilter runs immediately (setView was called)
        expect(mockThemeSelector.setTheme).not.toHaveBeenCalled();
        expect(mockVisibilityManager.setVisibility).toHaveBeenCalledWith("hiddenL", false, "user");
    });

    it("applies theme: setTheme() rejection → _applyLayersAndFilter applied directly", async () => {
        const mockThemeSelector = {
            getCurrentTheme: vi.fn(() => "light"),
            setTheme: vi.fn(() => Promise.reject(new Error("theme load failed"))),
        };
        globalThis.GeoLeaf = { ThemeSelector: mockThemeSelector };
        mockVisibilityManager.setVisibility.mockClear();
        const map = makeMap();
        applyState({ lat: 45.0, lng: 3.0, zoom: 10, theme: "dark", layers: ["fallbackL"] }, map);
        document.dispatchEvent(new CustomEvent("geoleaf:themes:ready"));
        // Allow the .catch() to run
        await new Promise((r) => setTimeout(r, 10));
        // Fallback: _applyLayersAndFilter called directly after setTheme rejection
        expect(mockVisibilityManager.setVisibility).toHaveBeenCalledWith(
            "fallbackL",
            false,
            "user"
        );
    });
});

// ── DEFAULT_PERMALINK_FIELDS — single source of truth ────────────────────
// The default field set used to be inlined byte-identically in _captureState,
// _parseParams and buildUrl. It now lives once in constants.ts; these tests pin its
// contents and prove the build path consumes the full set (so the three round-trip
// sites cannot silently drift apart again).
// B.42: the view triple (lat/lng/zoom) left the list — it was inert (always written,
// always required), so it is now declared mandatory instead of being whitelistable.
describe("DEFAULT_PERMALINK_FIELDS — single source of truth", () => {
    it("declares exactly the seven optional facets", () => {
        expect([...DEFAULT_PERMALINK_FIELDS]).toEqual([
            "layers",
            "shownLayers",
            "filter",
            "categories",
            "tags",
            "rating",
            "theme",
        ]);
    });

    it("excludes the mandatory view triple (B.42 — no inert whitelist entries)", () => {
        expect(DEFAULT_PERMALINK_FIELDS).not.toContain("lat");
        expect(DEFAULT_PERMALINK_FIELDS).not.toContain("lng");
        expect(DEFAULT_PERMALINK_FIELDS).not.toContain("zoom");
    });

    it("buildUrl() with no config.fields serializes every default facet", () => {
        const url = buildUrl(
            {
                lat: 48.5,
                lng: 2.3,
                zoom: 10,
                layers: ["a"],
                shownLayers: ["b"],
                filter: "x",
                categories: ["c1"],
                tags: ["t1"],
                rating: 3,
                theme: "night",
            },
            {}
        );
        for (const key of [
            "gl_layers",
            "gl_shown",
            "gl_filter",
            "gl_cats",
            "gl_tags",
            "gl_rating",
            "gl_theme",
        ]) {
            expect(url).toContain(`${key}=`);
        }
    });
});

// ── startSync teardown / idempotence (listener leak fix) ──────────────────
describe("Permalink — startSync teardown / idempotence", () => {
    beforeEach(() => {
        Permalink._reset();
    });

    it("stopSync() detaches the moveend listener", () => {
        const map = makeMap();
        Permalink.init({});
        Permalink.startSync(map);
        expect(map.on).toHaveBeenCalledWith("moveend", expect.any(Function));
        Permalink.stopSync();
        expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    });

    it("a second startSync tears down the first (no stacked sessions)", () => {
        const map = makeMap();
        Permalink.init({});
        Permalink.startSync(map);
        Permalink.startSync(map);
        // the first session is torn down before the second attaches
        expect(map.off).toHaveBeenCalledTimes(1);
    });

    it("_reset() stops an active sync session", () => {
        const map = makeMap();
        Permalink.init({});
        Permalink.startSync(map);
        Permalink._reset();
        expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    });
});
