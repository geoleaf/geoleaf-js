/**
 * Basemap attribution is displayed — by MapLibre's own control — and a vector basemap's declared
 * credit reaches it.
 *
 * The adapter created the map with `attributionControl: false`, copied from the Leaflet-era
 * adapter with no motive, and nothing replaced it: the `attribution` a raster basemap sets on its
 * source was never shown, although providers require it (OpenStreetMap: "clearly on the map").
 * And a vector basemap's `attribution`, declared in the profile, was read by no code at all.
 * Decided on 13/09/2026: MapLibre's native control, collapsing only below 640 px — expanded at
 * load, collapsed at the first drag. That is `attributionControl: {}`, NOT an omitted key: the
 * map's own default is `{ compact: true }`, a button at every width.
 *
 * The cases marked 🔴 were seen red on the code that disabled the control.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/kernel/events/event-bus.js", () => ({ dispatchGeoLeafEvent: vi.fn() }));

const { MaplibreAdapter } = await import("../../src/adapters/maplibre/maplibre-adapter.js");
const { buildGeoLeafStyleTransform } =
    await import("../../src/adapters/maplibre/maplibre-style-transform.js");
const { registerBaseLayer, setBaseLayer, setMap, _resetStateForTesting, _baseLayers } =
    await import("../../src/kernel/basemaps/registry.js");

type MapOptions = Record<string, unknown>;
const g = globalThis as unknown as Record<string, unknown>;
let constructed: MapOptions[] = [];

beforeEach(() => {
    constructed = [];
    const instance = {
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        remove: vi.fn(),
        fitBounds: vi.fn(),
        getContainer: vi.fn(() => document.createElement("div")),
    };
    g.maplibregl = {
        // A class, given to `vi.fn` itself: the adapter calls `new`, and `mockImplementation`
        // is typed for plain functions only.
        Map: vi.fn(
            class {
                constructor(options: MapOptions) {
                    constructed.push(options);
                    return instance;
                }
            }
        ),
    };
});

afterEach(() => {
    delete g.maplibregl;
});

/** An incoming vector style with one credited source and one bare source. */
function vectorStyle() {
    return {
        version: 8,
        sources: {
            base: { type: "vector", url: "https://tiles.test/base.json" },
            credited: {
                type: "vector",
                url: "https://tiles.test/c.json",
                attribution: "© Provider",
            },
        },
        layers: [{ id: "water", type: "fill", source: "base" }],
    };
}

const NOTHING_OWNED = { layerIds: new Set<string>(), sourceIds: new Set<string>() };

describe("attribution des fonds — contrôle natif", () => {
    it("🔴 la carte est créée avec le contrôle d'attribution, repli seulement sous 640 px", () => {
        new MaplibreAdapter().init({ container: "map" } as never);
        expect(constructed).toHaveLength(1);
        // `{}`: no `compact` → responsive. `false` hid it; the map default forces a button.
        expect(constructed[0]?.attributionControl).toEqual({});
    });
});

describe("attribution d'un fond vectoriel — transformation de style", () => {
    it("🔴 pose le crédit du profil sur les sources du fond qui n'en portent aucun, dès le premier chargement", () => {
        const transform = buildGeoLeafStyleTransform(() => NOTHING_OWNED, {
            attribution: "© Profil",
        });
        const out = transform(undefined, vectorStyle());
        const sources = out.sources as Record<string, { attribution?: string }>;
        expect(sources.base?.attribution).toBe("© Profil");
        expect(sources.credited?.attribution).toBe("© Provider");
    });

    it("sans crédit déclaré, laisse le style tel quel", () => {
        const next = vectorStyle();
        expect(buildGeoLeafStyleTransform(() => NOTHING_OWNED)(undefined, next)).toBe(next);
    });

    it("🔴 l'adaptateur rend une transformation dès qu'un crédit est déclaré, même sans couche possédée", () => {
        const adapter = new MaplibreAdapter();
        expect(typeof adapter.buildStyleChangeTransform({ attribution: "© Profil" })).toBe(
            "function"
        );
        // This case also asserted `toBeNull()` without a credit. That `null` was a defect, not a
        // contract: an empty registry when the transform is BUILT says nothing about the registry
        // when a style URL has downloaded and MapLibre RUNS it — the layers created meanwhile
        // were erased. Inverted; the full proof is `maplibre-style-transform-ownership.test.ts`.
        expect(typeof adapter.buildStyleChangeTransform()).toBe("function");
    });
});

describe("attribution d'un fond vectoriel — le registre la transmet", () => {
    const build = vi.fn(() => null);

    beforeEach(() => {
        for (const k of Object.keys(_baseLayers)) delete _baseLayers[k];
        _resetStateForTesting();
        const GeoLeaf = (g.GeoLeaf ??= {}) as Record<string, unknown>;
        GeoLeaf.Core = { getAdapter: () => ({ buildStyleChangeTransform: build }) };
        setMap({
            addSource: vi.fn(),
            addLayer: vi.fn(),
            getLayer: vi.fn(() => null),
            getSource: vi.fn(() => null),
            getStyle: vi.fn(() => ({ layers: [] })),
            setStyle: vi.fn(),
            once: vi.fn(),
            loaded: vi.fn(() => true),
            isStyleLoaded: vi.fn(() => true),
        });
    });

    afterEach(() => {
        (g.GeoLeaf as Record<string, unknown>).Core = null;
        setMap(null);
    });

    it("🔴 passe l'attribution déclarée d'un fond vectoriel à l'adaptateur", () => {
        registerBaseLayer("plan", {
            type: "maplibre",
            style: "https://tiles.test/style.json",
            attribution: "© Producteur",
        });
        setBaseLayer("plan");
        expect(build).toHaveBeenCalledWith({ attribution: "© Producteur" });
    });
});
