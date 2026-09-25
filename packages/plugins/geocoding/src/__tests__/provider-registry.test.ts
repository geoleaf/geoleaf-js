/**
 * The provider registry — which services a search asks, in what order, and what happens to
 * a name nobody registered.
 *
 * Three promises are held here:
 *
 * 1. **Local first, and no network off-network.** `provider: ["layers", "nominatim"]` asks the
 *    layers the map holds (`GeoLeaf.Layers.search`) before the address service, and does not
 *    ask the address service at all while the browser says it is offline — a request that
 *    can only fail costs the user its timeout.
 * 2. **An unknown name is NAMED.** A single `provider` string nobody registered still falls
 *    back on the default service, as it always did (GC-11) — but it now says so, names the
 *    value and the known ones, and announces that the next minor will refuse it. Inside the
 *    new list form, which no profile written before it can hold, an unknown name is refused
 *    at once: no fallback, no request.
 * 3. **A feature found locally is focused, not merely flown to**: `GeoLeaf.Layers.focus`
 *    frames AND selects it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createProvider, registerProvider } from "../provider-registry.js";
import { AddokProvider, NominatimProvider } from "../provider.js";
import { GeocodingRegistry } from "../registry.js";

const _g = globalThis as any;

/** A GeoJSON answer from an address service, with one result. */
function addressAnswer(label: string) {
    return {
        ok: true,
        json: async () => ({
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [2, 48] },
                    properties: { label },
                },
            ],
        }),
    };
}

/** What `GeoLeaf.Layers.search` answers in these tests. */
const LOCAL_HIT = {
    label: "PT-4472",
    lat: 45.25,
    lng: 5.5,
    layerId: "assets",
    layerLabel: "Assets",
    featureId: "PT-4472",
};

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.fn>;
let online: boolean;

beforeEach(() => {
    warn = vi.fn();
    _g.GeoLeaf = {
        Log: { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
        Layers: {
            search: vi.fn(() => [LOCAL_HIT]),
            focus: vi.fn(() => true),
        },
    };
    fetchMock = vi.fn(async () => addressAnswer("Une adresse"));
    vi.stubGlobal("fetch", fetchMock);
    online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete _g.GeoLeaf;
});

describe("registration", () => {
    it("a registered name resolves to its factory's provider", async () => {
        const mine = { search: vi.fn(async () => []) };
        registerProvider("mine", () => mine);
        await createProvider({ provider: "mine" }).search("x", 5);
        expect(mine.search).toHaveBeenCalledWith("x", 5);
    });

    it("the built-in names still resolve as before", () => {
        expect(createProvider({ provider: "nominatim" })).toBeInstanceOf(NominatimProvider);
        expect(createProvider({})).toBeInstanceOf(AddokProvider);
    });
});

describe("the `layers` provider — what the map holds", () => {
    it("answers from GeoLeaf.Layers.search, with the feature's identity kept", async () => {
        const results = await createProvider({ provider: "layers" }).search("PT-4472", 5);
        expect(_g.GeoLeaf.Layers.search).toHaveBeenCalledWith("PT-4472", { limit: 5 });
        expect(results).toEqual([expect.objectContaining(LOCAL_HIT)]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("answers nothing — and throws nothing — on a core without the member", async () => {
        delete _g.GeoLeaf.Layers.search;
        expect(await createProvider({ provider: "layers" }).search("x", 5)).toEqual([]);
    });
});

describe("a list — local first, and no network off-network", () => {
    it("online: local results come before the address service's", async () => {
        const results = await createProvider({ provider: ["layers", "nominatim"] }).search(
            "PT-4472",
            5
        );
        expect(results.map((r) => r.label)).toEqual(["PT-4472", "Une adresse"]);
    });

    it("offline: the address service is not even asked", async () => {
        online = false;
        const results = await createProvider({ provider: ["layers", "nominatim"] }).search(
            "PT-4472",
            5
        );
        expect(results.map((r) => r.label)).toEqual(["PT-4472"]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("the total stays within the limit, local results kept first", async () => {
        _g.GeoLeaf.Layers.search = vi.fn(() => [LOCAL_HIT, { ...LOCAL_HIT, label: "PT-4473" }]);
        const results = await createProvider({ provider: ["layers", "nominatim"] }).search("PT", 2);
        expect(results.map((r) => r.label)).toEqual(["PT-4472", "PT-4473"]);
    });
});

describe("an unknown name is named", () => {
    it("a single string keeps its fallback, and says so — naming the value and the refusal to come", () => {
        expect(createProvider({ provider: "nominatum" })).toBeInstanceOf(AddokProvider);
        const [message] = warn.mock.calls.at(-1) ?? [];
        expect(String(message)).toContain('"nominatum"');
        expect(String(message)).toContain("nominatim");
        expect(String(message)).toMatch(/refus/i);
    });

    it("an insecure URL is named the same way", () => {
        expect(createProvider({ provider: "http://insecure.example" })).toBeInstanceOf(
            AddokProvider
        );
        expect(String(warn.mock.calls.at(-1)?.[0])).toContain('"http://insecure.example"');
    });

    it("inside a list, it is refused at once: no fallback, no request", async () => {
        const results = await createProvider({ provider: ["layers", "nominatum"] }).search("x", 5);
        expect(results.map((r) => r.label)).toEqual(["PT-4472"]);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(String(warn.mock.calls.at(-1)?.[0])).toContain('"nominatum"');
    });
});

describe("selecting a result", () => {
    it("a local result is focused through GeoLeaf.Layers.focus", () => {
        GeocodingRegistry.selectResult({ ...LOCAL_HIT });
        expect(_g.GeoLeaf.Layers.focus).toHaveBeenCalledWith("assets", "PT-4472");
    });

    it("an address result is flown to, as before", () => {
        const flyTo = vi.fn();
        _g.GeoLeaf.Core = { getMap: () => ({ flyTo, fitBounds: vi.fn() }) };
        _g.GeoLeaf.Config = { get: (_k: string, d: unknown) => d };
        GeocodingRegistry.selectResult({ label: "Une adresse", lat: 48, lng: 2 });
        expect(flyTo).toHaveBeenCalledWith({ lat: 48, lng: 2 }, 15);
        expect(_g.GeoLeaf.Layers.focus).not.toHaveBeenCalled();
    });
});
