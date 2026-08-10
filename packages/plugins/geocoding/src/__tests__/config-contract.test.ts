/**
 * Config contract (family B2) — `modules.geocoding.*`.
 *
 * Ported from the core config-contract suite
 * (`__tests__/config/s10-features-geocoding.test.js`). The single behavioural
 * change is the config seam: the plugin reads `modules.geocoding` via
 * `GeoLeaf.Config.get(key, default)` (the core read the root `geocodingConfig`
 * key via `getActiveProfile()`), so `withModuleConfig` wires `Config.get`.
 *
 *   - provider (addok|nominatim|photon|https URL|default) → createProvider factory
 *   - countrycodes (Nominatim-only) + bbox → provider URL building
 *   - enabled → GeocodingRegistry.isEnabled()
 *   - @anomaly ANO-032: debounceMs/minChars (wired, 0 profile data) → control gate
 *
 * Consumers: ../{provider,registry,control}.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    createProvider,
    AddokProvider,
    NominatimProvider,
    PhotonProvider,
    CustomProvider,
} from "../provider.js";
import { mountGeocodingControl } from "../control.js";
import { GeocodingRegistry } from "../registry.js";

function mockFetch() {
    const fn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ type: "FeatureCollection", features: [] }),
    });
    vi.stubGlobal("fetch", fn);
    return fn;
}

// ── modules.geocoding.provider — factory selection ───────────────────────────
describe("config B2 — modules.geocoding.provider (createProvider)", () => {
    it("addok → AddokProvider", () => {
        expect(createProvider({ provider: "addok" })).toBeInstanceOf(AddokProvider);
    });
    it("nominatim → NominatimProvider", () => {
        expect(createProvider({ provider: "nominatim" })).toBeInstanceOf(NominatimProvider);
    });
    it("photon → PhotonProvider", () => {
        expect(createProvider({ provider: "photon" })).toBeInstanceOf(PhotonProvider);
    });
    it("custom https:// URL → CustomProvider", () => {
        expect(createProvider({ provider: "https://geo.example/api" })).toBeInstanceOf(
            CustomProvider
        );
    });
    it("missing provider → AddokProvider (default)", () => {
        expect(createProvider({})).toBeInstanceOf(AddokProvider);
    });
    it("unknown / unsafe value → AddokProvider (safe fallback)", () => {
        expect(createProvider({ provider: "weird" })).toBeInstanceOf(AddokProvider);
        expect(createProvider({ provider: "http://insecure" })).toBeInstanceOf(AddokProvider);
    });
});

// ── countrycodes (Nominatim-only) + bbox → URL building ──────────────────────
describe("config B2 — modules.geocoding.countrycodes + bbox (provider URLs)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("Nominatim applies countrycodes", async () => {
        const fetchFn = mockFetch();
        await new NominatimProvider({ countrycodes: "fr" }).search("paris", 5);
        expect(fetchFn.mock.calls[0][0]).toContain("countrycodes=fr");
    });

    it("Addok ignores countrycodes (Nominatim-only param)", async () => {
        const fetchFn = mockFetch();
        await new AddokProvider({ countrycodes: "fr" }).search("paris", 5);
        expect(fetchFn.mock.calls[0][0]).not.toContain("countrycodes");
    });

    it("Nominatim bbox → viewbox + bounded=1", async () => {
        const fetchFn = mockFetch();
        await new NominatimProvider({ bbox: [-5, 41, 10, 51] }).search("x", 5);
        const url = fetchFn.mock.calls[0][0];
        expect(url).toContain("viewbox=-5,51,10,41");
        expect(url).toContain("bounded=1");
    });

    it("Photon bbox → bbox=west,south,east,north", async () => {
        const fetchFn = mockFetch();
        await new PhotonProvider({ bbox: [-5, 41, 10, 51] }).search("x", 5);
        expect(fetchFn.mock.calls[0][0]).toContain("bbox=-5,41,10,51");
    });

    it("Addok bbox → centroid lat/lon (proximity bias)", async () => {
        const fetchFn = mockFetch();
        await new AddokProvider({ bbox: [-5, 41, 10, 51] }).search("x", 5);
        const url = fetchFn.mock.calls[0][0];
        expect(url).toContain("lat=46.00000");
        expect(url).toContain("lon=2.50000");
    });
});

// ── modules.geocoding.enabled → control mounted only when true ───────────────
describe("config B2 — modules.geocoding.enabled (GeocodingRegistry.isEnabled)", () => {
    let prevGeoLeaf;
    beforeEach(() => {
        prevGeoLeaf = globalThis.GeoLeaf;
    });
    afterEach(() => {
        globalThis.GeoLeaf = prevGeoLeaf;
    });
    const withModuleConfig = (cfg) => {
        globalThis.GeoLeaf = {
            Config: { get: (k, d) => (k === "modules.geocoding" ? cfg : d) },
        };
    };

    it("enabled:true → isEnabled() true", () => {
        withModuleConfig({ enabled: true });
        expect(GeocodingRegistry.isEnabled()).toBe(true);
    });
    it("enabled:false → isEnabled() false", () => {
        withModuleConfig({ enabled: false });
        expect(GeocodingRegistry.isEnabled()).toBe(false);
    });
    it("enabled absent → isEnabled() false", () => {
        withModuleConfig({});
        expect(GeocodingRegistry.isEnabled()).toBe(false);
    });
});

// ── @anomaly ANO-032 — debounceMs / minChars (wired, 0 profile data) ─────────
describe("@anomaly ANO-032 — modules.geocoding.debounceMs / minChars (capability)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    function mount(config) {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const provider = { search: vi.fn().mockResolvedValue([]) };
        const handle = mountGeocodingControl(container, provider, config, () => {});
        const input = container.querySelector("input");
        return { provider, input, handle };
    }

    function type(input, value) {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    it("minChars gate: below the threshold no search fires (default 3)", () => {
        vi.useFakeTimers();
        const { provider, input } = mount({});
        type(input, "ab");
        vi.advanceTimersByTime(1000);
        expect(provider.search).not.toHaveBeenCalled();
    });

    it("debounceMs: search fires after the debounce once minChars is reached (defaults 3/300)", () => {
        vi.useFakeTimers();
        const { provider, input } = mount({});
        type(input, "abc");
        vi.advanceTimersByTime(299);
        expect(provider.search).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(provider.search).toHaveBeenCalledWith("abc", 5);
    });

    it("override minChars/debounceMs is honoured", () => {
        vi.useFakeTimers();
        const { provider, input } = mount({ minChars: 1, debounceMs: 50, resultLimit: 8 });
        type(input, "a");
        vi.advanceTimersByTime(50);
        expect(provider.search).toHaveBeenCalledWith("a", 8);
    });
});
