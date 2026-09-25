/**
 * A COG layer survives a basemap switch that replaces the map's style.
 *
 * Its image source and raster layer are placed on the engine directly, outside the GeoLeaf
 * adapter's registry: the transform a style replacement runs carries only what the adapter owns,
 * so the diff removed them. `injectImageSource` now declares them to the adapter driving the map
 * — found among the host's maps, since the integrator passes whichever map it wants — and
 * `removeImageSource` withdraws the declaration.
 *
 * The declaration crosses `@geoleaf/host-runtime`'s seam for real: only the host is faked. The
 * cases marked 🔴 were seen red on the code without the declaration. The browser half is
 * `e2e/58-style-swap-keeps-foreign-layers`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { injectImageSource, removeImageSource } from "../cog-renderer.js";

const BOUNDS: [number, number, number, number] = [-54, 3, -53, 4];

function makeMockMap() {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        getLayer: vi.fn(() => ({})),
        getSource: vi.fn(() => ({})),
    };
}

/**
 * Installs a host with two GeoLeaf maps, the SECOND driving `native`, and returns the second
 * adapter's recorder — the first one's must stay silent.
 *
 * @param native - The engine the second adapter drives.
 */
function hostWithSecondMapDriving(native: unknown) {
    const other = { getNativeMap: () => makeMockMap(), declareOwnedStyleIds: vi.fn() };
    const declare = vi.fn();
    const target = { getNativeMap: () => native, declareOwnedStyleIds: declare };
    const maps: Record<string, unknown> = { first: other, second: target };
    (globalThis as { GeoLeaf?: unknown }).GeoLeaf = {
        Core: {
            listMaps: () => Object.keys(maps),
            getMap: (id?: string) => (id ? maps[id] : other),
        },
    };
    return { declare, other: other.declareOwnedStyleIds };
}

afterEach(() => {
    delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
});

describe("COG — sa couche est déclarée à l'adaptateur qui pilote la carte reçue", () => {
    it("🔴 injectImageSource déclare sa couche et sa source sous `cog:<id>`, à la bonne carte", () => {
        const map = makeMockMap();
        const { declare, other } = hostWithSecondMapDriving(map);

        injectImageSource(map, "cog-1", "data:image/png;base64,", BOUNDS, {});

        expect(declare).toHaveBeenCalledWith("cog:cog-1", {
            layerIds: ["cog-1"],
            sourceIds: ["cog-1"],
        });
        expect(other).not.toHaveBeenCalled();
    });

    it("🔴 removeImageSource retire la déclaration", () => {
        const map = makeMockMap();
        const { declare } = hostWithSecondMapDriving(map);
        injectImageSource(map, "cog-1", "data:image/png;base64,", BOUNDS, {});
        declare.mockClear();

        removeImageSource(map, "cog-1");

        expect(declare).toHaveBeenCalledWith("cog:cog-1", null);
    });

    it("une carte que l'intégrateur pilote seul : la couche est posée, rien n'est déclaré", () => {
        const map = makeMockMap();
        const { declare, other } = hostWithSecondMapDriving(makeMockMap());

        expect(() =>
            injectImageSource(map, "cog-1", "data:image/png;base64,", BOUNDS, {})
        ).not.toThrow();
        expect(map.addLayer).toHaveBeenCalled();
        expect(declare).not.toHaveBeenCalled();
        expect(other).not.toHaveBeenCalled();
    });
});
